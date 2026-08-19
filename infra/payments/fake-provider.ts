import {
  isAuthenticWebhook,
  signWebhookPayload,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider,
  type PaymentWebhookEvent,
  type RefundRequest,
  type WebhookDelivery,
} from "./provider.ts";

export type FakeProviderOptions = {
  webhookSecret: string;
  /** Where the hosted checkout would live. Kept same-origin so nothing leaves the app. */
  checkoutBaseUrl: string;
  now?: () => Date;
  crypto?: Crypto;
};

/**
 * A provider that behaves like a real one without moving money.
 *
 * It exists so the order state machine, webhook idempotency and refund paths can
 * be exercised end to end before a commercial processor is chosen. It signs its
 * own deliveries with the same HMAC scheme the real adapter will verify, so the
 * verification path under test is the production one.
 *
 * It never claims a payment happened on its own: a webhook only arrives when the
 * operator or a test sends one.
 */
export function createFakePaymentProvider(options: FakeProviderOptions): PaymentProvider & {
  signDelivery(event: PaymentWebhookEvent): Promise<WebhookDelivery>;
} {
  const now = options.now ?? (() => new Date());

  return {
    name: "fake",

    async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
      const providerPaymentId = `fake_${request.orderId}`;
      const redirect = new URL(options.checkoutBaseUrl);
      redirect.searchParams.set("order", request.orderId);
      redirect.searchParams.set("amount", String(request.amountMinor));

      return { providerPaymentId, redirectUrl: redirect.href };
    },

    async verifyWebhook(delivery: WebhookDelivery): Promise<PaymentWebhookEvent | null> {
      const authentic = await isAuthenticWebhook({
        secret: options.webhookSecret,
        delivery,
        now: now(),
        crypto: options.crypto,
      });
      if (!authentic) return null;

      let payload: unknown;
      try {
        payload = JSON.parse(delivery.rawBody);
      } catch {
        return null;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

      const body = payload as Record<string, unknown>;
      const providerEventId = typeof body.id === "string" ? body.id : "";
      const providerPaymentId = typeof body.paymentId === "string" ? body.paymentId : "";
      const orderId = typeof body.orderId === "string" ? body.orderId : "";
      const amountMinor = Number(body.amountMinor);
      const status = body.status;
      const known = status === "succeeded" || status === "failed" || status === "refunded" || status === "pending";

      if (!providerEventId || !providerPaymentId || !orderId || !known) return null;
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return null;

      return {
        providerEventId,
        eventType: typeof body.type === "string" ? body.type : `payment.${status}`,
        providerPaymentId,
        orderId,
        amountMinor,
        status,
        payload: body,
      };
    },

    async refund(request: RefundRequest) {
      return { providerRefundId: `fake_refund_${request.providerPaymentId}` };
    },

    /** Test and staging helper: produces a delivery this provider will accept. */
    async signDelivery(event: PaymentWebhookEvent): Promise<WebhookDelivery> {
      const rawBody = JSON.stringify({
        id: event.providerEventId,
        type: event.eventType,
        paymentId: event.providerPaymentId,
        orderId: event.orderId,
        amountMinor: event.amountMinor,
        status: event.status,
      });
      const timestamp = String(now().getTime());

      return {
        rawBody,
        timestamp,
        signature: await signWebhookPayload(options.webhookSecret, timestamp, rawBody, options.crypto),
      };
    },
  };
}

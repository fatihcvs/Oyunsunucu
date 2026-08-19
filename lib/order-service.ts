import { AuthFlowError, type AuthService } from "./auth-service.ts";
import { createPriceSnapshot, isTerminal, type OrderStatus } from "./order-contracts.ts";
import { isSafeReturnPath } from "./auth-contracts.ts";
import type { PaymentProvider, WebhookDelivery } from "../infra/payments/provider.ts";
import type {
  OrderRecord,
  PaymentEventOutcome,
  PostgresOrderRepository,
} from "../infra/postgres/order-repository.ts";

export type OrderServiceDependencies = {
  auth: AuthService;
  orders: PostgresOrderRepository;
  provider: PaymentProvider;
  appOrigin: string;
  now?: () => Date;
  onOperationalError?: (error: unknown) => void;
};

export type StartCheckoutInput = {
  rawToken: string;
  draft: unknown;
  serverDraftId?: string | null;
  returnTo?: string | null;
};

export type StartCheckoutResult = {
  orderId: string;
  totalMinor: number;
  redirectUrl: string;
};

export class OrderFlowError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OrderFlowError";
    this.status = status;
    this.code = code;
  }
}

function reportOperationalError(dependencies: OrderServiceDependencies, error: unknown) {
  try {
    dependencies.onOperationalError?.(error);
  } catch {
    // Observability must never change the payment outcome.
  }
}

export function createOrderService(dependencies: OrderServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    /**
     * Opens an order for the signed-in customer and hands back a checkout link.
     *
     * The price is frozen from the catalog here, not taken from the request:
     * a client cannot name its own amount.
     */
    async startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
      const session = await dependencies.auth.authenticateSession(input.rawToken);
      if (!session) {
        throw new AuthFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
      }

      const snapshot = createPriceSnapshot(input.draft);
      if (!snapshot) {
        throw new OrderFlowError(400, "INVALID_ORDER", "Sipariş edilen yapılandırma satışa açık değil.");
      }

      const openedAt = now();
      let order: OrderRecord;
      try {
        order = await dependencies.orders.createOrder({
          ownerUserId: session.userId,
          serverDraftId: input.serverDraftId ?? null,
          snapshot,
          now: openedAt,
        });
      } catch (error) {
        reportOperationalError(dependencies, error);
        throw new OrderFlowError(503, "ORDER_UNAVAILABLE", "Sipariş şu anda oluşturulamadı.");
      }

      const returnPath = isSafeReturnPath(input.returnTo) ? input.returnTo : "/hesap";
      let checkout;
      try {
        checkout = await dependencies.provider.createCheckout({
          orderId: order.orderId,
          amountMinor: order.totalMinor,
          currency: "TRY",
          returnUrl: new URL(returnPath, dependencies.appOrigin).href,
          buyerEmail: session.email,
        });
      } catch (error) {
        reportOperationalError(dependencies, error);
        throw new OrderFlowError(503, "PAYMENT_UNAVAILABLE", "Ödeme sağlayıcısına şu anda ulaşılamıyor.");
      }

      const moved = await dependencies.orders.transitionOrder({
        orderId: order.orderId,
        expectedFrom: "draft",
        to: "pending_payment",
        now: openedAt,
        actorUserId: session.userId,
      });
      if (!moved) {
        throw new OrderFlowError(409, "ORDER_NOT_PENDING", "Sipariş ödeme aşamasına alınamadı.");
      }

      return {
        orderId: order.orderId,
        totalMinor: order.totalMinor,
        redirectUrl: checkout.redirectUrl,
      };
    },

    /**
     * Applies one provider delivery.
     *
     * Authentication is the signature, not a session: the provider calls this
     * endpoint, never the customer's browser. An unverifiable delivery is
     * rejected before any database work happens.
     */
    async applyWebhook(delivery: WebhookDelivery): Promise<PaymentEventOutcome> {
      const event = await dependencies.provider.verifyWebhook(delivery);
      if (!event) {
        throw new OrderFlowError(400, "WEBHOOK_REJECTED", "Ödeme bildirimi doğrulanamadı.");
      }

      try {
        return await dependencies.orders.recordPaymentEvent({
          provider: dependencies.provider.name,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          providerPaymentId: event.providerPaymentId,
          orderId: event.orderId,
          amountMinor: event.amountMinor,
          paymentStatus: event.status,
          payload: event.payload,
          now: now(),
        });
      } catch (error) {
        reportOperationalError(dependencies, error);
        // A mismatched amount or unknown order is the provider's problem to
        // retry, not something to swallow into a success.
        const known = error as { status?: number; code?: string };
        if (known?.status === 409 && known.code) {
          throw new OrderFlowError(409, known.code, "Ödeme bildirimi siparişle bağdaşmıyor.");
        }
        throw new OrderFlowError(503, "WEBHOOK_UNAVAILABLE", "Ödeme bildirimi şu anda işlenemedi.");
      }
    },

    /** Reads an order for its owner only; a stranger gets the same answer as a missing one. */
    async readOrder(rawToken: string, orderId: string) {
      const session = await dependencies.auth.authenticateSession(rawToken);
      if (!session) {
        throw new AuthFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
      }

      const order = await dependencies.orders.findOrder(orderId);
      if (!order || order.ownerUserId !== session.userId) {
        throw new OrderFlowError(404, "ORDER_NOT_FOUND", "Sipariş bulunamadı.");
      }

      return {
        orderId: order.orderId,
        status: order.status as OrderStatus,
        totalMinor: order.totalMinor,
        subtotalMinor: order.subtotalMinor,
        vatMinor: order.vatMinor,
        terminal: isTerminal(order.status as OrderStatus),
        items: await dependencies.orders.listOrderItems(order.orderId),
      };
    },
  };
}

export type OrderService = ReturnType<typeof createOrderService>;

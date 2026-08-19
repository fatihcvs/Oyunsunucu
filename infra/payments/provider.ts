/**
 * Provider-independent payment contract.
 *
 * Nothing above this file knows which processor is in use. Swapping providers
 * must not touch the order state machine, the schema, or the panel.
 */
export type CheckoutRequest = {
  orderId: string;
  amountMinor: number;
  currency: "TRY";
  /** Where the customer returns after paying; always same-origin. */
  returnUrl: string;
  buyerEmail: string;
};

export type CheckoutSession = {
  providerPaymentId: string;
  redirectUrl: string;
};

export type PaymentWebhookEvent = {
  providerEventId: string;
  eventType: string;
  providerPaymentId: string;
  orderId: string;
  amountMinor: number;
  status: "pending" | "succeeded" | "failed" | "refunded";
  payload: Record<string, unknown>;
};

export type RefundRequest = {
  providerPaymentId: string;
  amountMinor: number;
  reason?: string;
};

export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Returns null for anything that is not a genuine, fresh delivery. */
  verifyWebhook(delivery: WebhookDelivery): Promise<PaymentWebhookEvent | null>;
  refund(request: RefundRequest): Promise<{ providerRefundId: string }>;
}

export type WebhookDelivery = {
  /** The exact bytes received. Re-serialising JSON changes the signature. */
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
};

/** Deliveries older than this are refused, so a captured payload cannot be replayed later. */
export const WEBHOOK_FRESHNESS_MS = 5 * 60_000;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Compares two digests without leaking where they differ.
 *
 * A plain `===` returns as soon as a byte differs, and that timing difference
 * is enough to recover a valid signature one character at a time.
 */
export function timingSafeEqualHex(left: string, right: string) {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function signWebhookPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
  cryptoSource: Crypto = globalThis.crypto,
) {
  const key = await cryptoSource.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // The timestamp is inside the signed material; otherwise it could be edited
  // to make an old delivery look fresh.
  const digest = await cryptoSource.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function isAuthenticWebhook(input: {
  secret: string;
  delivery: WebhookDelivery;
  now: Date;
  freshnessMs?: number;
  crypto?: Crypto;
}) {
  const { signature, timestamp, rawBody } = input.delivery;
  if (!signature || !timestamp) return false;

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;

  const age = Math.abs(input.now.getTime() - sentAt);
  if (age > (input.freshnessMs ?? WEBHOOK_FRESHNESS_MS)) return false;

  const expected = await signWebhookPayload(input.secret, timestamp, rawBody, input.crypto);
  return timingSafeEqualHex(expected, signature.trim().toLowerCase());
}

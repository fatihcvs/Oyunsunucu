import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBHOOK_FRESHNESS_MS,
  isAuthenticWebhook,
  signWebhookPayload,
  timingSafeEqualHex,
} from "../infra/payments/provider.ts";
import { createFakePaymentProvider } from "../infra/payments/fake-provider.ts";
import { createPaymentProvider } from "../lib/order-composition.ts";
import { handlePaymentWebhook } from "../app/api/payments/webhook/route.ts";
import { handleCreateOrder } from "../app/api/orders/route.ts";

const SECRET = "w".repeat(48);
const now = new Date("2026-08-16T12:00:00.000Z");
const origin = "https://riftory.example";

const event = {
  providerEventId: "evt-1",
  eventType: "payment.succeeded",
  providerPaymentId: "pay-1",
  orderId: "11111111-1111-4111-8111-111111111111",
  amountMinor: 54_800,
  status: "succeeded",
  payload: {},
};

function provider(options = {}) {
  return createFakePaymentProvider({
    webhookSecret: SECRET,
    checkoutBaseUrl: `${origin}/odeme/sahte`,
    now: () => options.now ?? now,
  });
}

test("compares digests without revealing where they differ", () => {
  assert.equal(timingSafeEqualHex("abcd", "abcd"), true);
  assert.equal(timingSafeEqualHex("abcd", "abce"), false);
  assert.equal(timingSafeEqualHex("abcd", "abc"), false);
  assert.equal(timingSafeEqualHex("", ""), true);
});

test("accepts only a delivery signed with the shared secret", async () => {
  const delivery = await provider().signDelivery(event);
  assert.equal(await isAuthenticWebhook({ secret: SECRET, delivery, now }), true);

  // Wrong secret, tampered body, tampered signature: all refused.
  assert.equal(await isAuthenticWebhook({ secret: "x".repeat(48), delivery, now }), false);
  assert.equal(
    await isAuthenticWebhook({
      secret: SECRET,
      delivery: { ...delivery, rawBody: delivery.rawBody.replace("54800", "1") },
      now,
    }),
    false,
  );
  assert.equal(
    await isAuthenticWebhook({ secret: SECRET, delivery: { ...delivery, signature: "00" }, now }),
    false,
  );
  assert.equal(
    await isAuthenticWebhook({ secret: SECRET, delivery: { ...delivery, signature: null }, now }),
    false,
  );
});

test("refuses a captured delivery replayed later", async () => {
  const delivery = await provider().signDelivery(event);

  const justInside = new Date(now.getTime() + WEBHOOK_FRESHNESS_MS - 1_000);
  assert.equal(await isAuthenticWebhook({ secret: SECRET, delivery, now: justInside }), true);

  const tooOld = new Date(now.getTime() + WEBHOOK_FRESHNESS_MS + 1_000);
  assert.equal(await isAuthenticWebhook({ secret: SECRET, delivery, now: tooOld }), false);
});

test("a moved timestamp cannot make an old delivery look fresh", async () => {
  const delivery = await provider().signDelivery(event);
  const fresh = String(new Date(now.getTime() + WEBHOOK_FRESHNESS_MS + 60_000).getTime());

  // The timestamp is inside the signed material, so editing it breaks the digest.
  assert.equal(
    await isAuthenticWebhook({
      secret: SECRET,
      delivery: { ...delivery, timestamp: fresh },
      now: new Date(now.getTime() + WEBHOOK_FRESHNESS_MS + 60_000),
    }),
    false,
  );
});

test("the signature covers the exact bytes, not the parsed value", async () => {
  const delivery = await provider().signDelivery(event);
  const reserialised = JSON.stringify(JSON.parse(delivery.rawBody), null, 2);

  assert.notEqual(reserialised, delivery.rawBody);
  assert.notEqual(
    await signWebhookPayload(SECRET, delivery.timestamp, reserialised),
    delivery.signature,
  );
});

test("parses only a delivery that names an order, payment and known status", async () => {
  const fake = provider();
  const verified = await fake.verifyWebhook(await fake.signDelivery(event));
  assert.equal(verified.orderId, event.orderId);
  assert.equal(verified.amountMinor, 54_800);

  for (const broken of [
    { ...event, orderId: "" },
    { ...event, providerPaymentId: "" },
    { ...event, status: "yarim" },
    { ...event, amountMinor: -1 },
  ]) {
    assert.equal(await fake.verifyWebhook(await fake.signDelivery(broken)), null, JSON.stringify(broken.status));
  }
});

test("the provider stays off until it is explicitly configured", () => {
  assert.equal(createPaymentProvider({ APP_ORIGIN: origin }), null);
  assert.equal(createPaymentProvider({ APP_ORIGIN: origin, PAYMENT_PROVIDER: "fake" }), null);
  assert.equal(
    createPaymentProvider({ APP_ORIGIN: origin, PAYMENT_PROVIDER: "fake", PAYMENT_WEBHOOK_SECRET: "kisa" }),
    null,
  );
  assert.notEqual(
    createPaymentProvider({ APP_ORIGIN: origin, PAYMENT_PROVIDER: "fake", PAYMENT_WEBHOOK_SECRET: SECRET }),
    null,
  );
});

test("the webhook endpoint answers honestly before anything is configured", async () => {
  const response = await handlePaymentWebhook(
    new Request(`${origin}/api/payments/webhook`, { method: "POST", body: "{}" }),
    {},
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "ORDERS_NOT_CONFIGURED");
});

test("rejects an unsigned delivery without touching the database", async () => {
  let touched = false;
  const service = {
    applyWebhook: async (delivery) => {
      const verified = await provider().verifyWebhook(delivery);
      if (!verified) {
        const error = new Error("Ödeme bildirimi doğrulanamadı.");
        error.name = "OrderFlowError";
        throw Object.assign(error, { status: 400, code: "WEBHOOK_REJECTED" });
      }
      touched = true;
      return { applied: true, orderStatus: "paid", paymentId: "p" };
    },
  };

  const response = await handlePaymentWebhook(
    new Request(`${origin}/api/payments/webhook`, {
      method: "POST",
      body: JSON.stringify({ id: "evt-x", orderId: event.orderId, status: "succeeded" }),
    }),
    { APP_ORIGIN: origin },
    { orderService: service },
  );

  assert.equal(response.status, 500);
  assert.equal(touched, false);
});

test("an order request without a session never reaches pricing", async () => {
  const response = await handleCreateOrder(
    new Request(`${origin}/api/orders`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ draft: { gameId: "minecraft" } }),
    }),
    { APP_ORIGIN: origin },
    { orderService: { startCheckout: async () => { throw new Error("çağrılmamalıydı"); } } },
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "SESSION_REQUIRED");
});

test("refuses a cross-origin order request", async () => {
  const response = await handleCreateOrder(
    new Request(`${origin}/api/orders`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    }),
    { APP_ORIGIN: origin },
    { orderService: { startCheckout: async () => { throw new Error("çağrılmamalıydı"); } } },
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "ORIGIN_REJECTED");
});

import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { createNodePostgresDatabase } from "../../infra/postgres/node-pg-executor.ts";
import { loadMigrations } from "../../infra/postgres/node-migration-source.ts";
import { runMigrations } from "../../infra/postgres/migration-runner.ts";
import { PostgresAuthRepository } from "../../infra/postgres/auth-repository.ts";
import {
  OrderTransitionError,
  PaymentAmountMismatchError,
  PostgresOrderRepository,
} from "../../infra/postgres/order-repository.ts";
import { createOpaqueToken } from "../../lib/auth-security.ts";
import { createAuthService } from "../../lib/auth-service.ts";
import { createOrderService } from "../../lib/order-service.ts";
import { createFakePaymentProvider } from "../../infra/payments/fake-provider.ts";
import { createPriceSnapshot, toMinor } from "../../lib/order-contracts.ts";
import { DEFAULT_SERVER_DRAFT } from "../../lib/catalog.ts";

const connectionString = process.env.TEST_DATABASE_URL?.trim();
const skip = connectionString
  ? false
  : "TEST_DATABASE_URL tanımlı değil; PostgreSQL entegrasyon testleri atlandı.";

const now = new Date();
const later = new Date(now.getTime() + 5 * 60_000);

let database;
let auth;
let orders;

before(async () => {
  if (skip) return;
  database = createNodePostgresDatabase({ connectionString });
  auth = new PostgresAuthRepository(database);
  orders = new PostgresOrderRepository(database);
  const migrations = await loadMigrations();
  await database.session((session) => runMigrations(session, migrations));
});

after(async () => {
  if (database) await database.close();
});

// These files share one database, so they must not run in parallel: the npm
// script pins `--test-concurrency=1`. Truncating here while another file is
// mid-transaction would both lose its rows and block on the table lock.
beforeEach(async () => {
  if (skip) return;
  await database.query(
    "TRUNCATE orders, order_items, price_snapshots, payments, payment_events, refunds, users, auth_accounts, auth_sessions, verification_tokens, consents, server_drafts, draft_import_receipts, audit_logs, auth_rate_limits, oauth_states RESTART IDENTITY CASCADE",
  );
});

/** A real signed-in owner, since orders reference a user row. */
async function createOwner(email = "buyer@example.com") {
  const token = await createOpaqueToken();
  const challengeId = await auth.createMagicLinkChallenge({
    purpose: "verify_email",
    email,
    tokenHash: token.tokenHash,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    returnTo: "/panel",
    displayName: "Riftory Alıcısı",
    consentVersion: "kvkk-iletisim-v1-2026-08-14",
    requestedIp: null,
  });
  await auth.markMagicLinkDelivered(challengeId, now);

  const session = await createOpaqueToken();
  const exchange = await auth.exchangeMagicLink({
    challengeTokenHash: token.tokenHash,
    sessionTokenHash: session.tokenHash,
    sessionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    now,
    ipAddress: null,
    userAgent: null,
  });
  return exchange.userId;
}

async function openOrder(overrides = {}) {
  const ownerUserId = overrides.ownerUserId ?? await createOwner();
  const snapshot = createPriceSnapshot(overrides.draft ?? DEFAULT_SERVER_DRAFT);
  const order = await orders.createOrder({ ownerUserId, serverDraftId: null, snapshot, now });
  return { ownerUserId, snapshot, order };
}

test("freezes the price with the order in one transaction", { skip }, async () => {
  const { order, snapshot } = await openOrder();

  assert.equal(order.status, "draft");
  assert.equal(order.totalMinor, snapshot.totalMinor);
  assert.equal(order.subtotalMinor + order.vatMinor, order.totalMinor);

  const items = await orders.listOrderItems(order.orderId);
  assert.equal(items.length, snapshot.lineItems.length);
  assert.equal(items.reduce((sum, item) => sum + item.amountMinor, 0), order.totalMinor);

  const stored = await orders.readPriceSnapshot(order.orderId);
  assert.deepEqual(stored.specification, DEFAULT_SERVER_DRAFT);
  assert.equal(stored.totalMinor, snapshot.totalMinor);
});

test("a paid amount never changes when the catalog price changes", { skip }, async () => {
  const { order } = await openOrder();
  await orders.transitionOrder({ orderId: order.orderId, expectedFrom: "draft", to: "pending_payment", now });

  await orders.recordPaymentEvent({
    provider: "test-provider",
    providerEventId: "evt-price-1",
    eventType: "payment.succeeded",
    providerPaymentId: "pay-price-1",
    orderId: order.orderId,
    amountMinor: order.totalMinor,
    paymentStatus: "succeeded",
    payload: { id: "evt-price-1" },
    now,
  });

  // The catalog moves after the fact — the order must not follow it.
  const laterSnapshot = createPriceSnapshot({ ...DEFAULT_SERVER_DRAFT, planId: "pro-12" });
  assert.notEqual(laterSnapshot.totalMinor, order.totalMinor);

  const stillPaid = await orders.findOrder(order.orderId);
  assert.equal(stillPaid.status, "paid");
  assert.equal(stillPaid.totalMinor, order.totalMinor);
  assert.equal((await orders.readPriceSnapshot(order.orderId)).totalMinor, order.totalMinor);

  const charged = await database.query("SELECT amount_minor FROM payments WHERE order_id = $1::uuid", [order.orderId]);
  assert.equal(Number(charged.rows[0].amount_minor), order.totalMinor);
});

test("the same webhook delivered ten times moves the order once", { skip }, async () => {
  const { order } = await openOrder();
  await orders.transitionOrder({ orderId: order.orderId, expectedFrom: "draft", to: "pending_payment", now });

  const delivery = {
    provider: "test-provider",
    providerEventId: "evt-repeat-1",
    eventType: "payment.succeeded",
    providerPaymentId: "pay-repeat-1",
    orderId: order.orderId,
    amountMinor: order.totalMinor,
    paymentStatus: "succeeded",
    payload: { id: "evt-repeat-1" },
    now,
  };

  const outcomes = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    outcomes.push(await orders.recordPaymentEvent(delivery));
  }

  assert.equal(outcomes.filter((outcome) => outcome.applied).length, 1);
  assert.ok(outcomes.every((outcome) => outcome.orderStatus === "paid"));

  const payments = await database.query("SELECT id FROM payments WHERE order_id = $1::uuid", [order.orderId]);
  const events = await database.query("SELECT id FROM payment_events WHERE provider_event_id = 'evt-repeat-1'");
  assert.equal(payments.rows.length, 1, "tekrar teslim ikinci ödeme kaydı üretti");
  assert.equal(events.rows.length, 1, "tekrar teslim ikinci olay kaydı üretti");
});

test("concurrent deliveries of one webhook still apply once", { skip }, async () => {
  const { order } = await openOrder();
  await orders.transitionOrder({ orderId: order.orderId, expectedFrom: "draft", to: "pending_payment", now });

  const delivery = {
    provider: "test-provider",
    providerEventId: "evt-race-1",
    eventType: "payment.succeeded",
    providerPaymentId: "pay-race-1",
    orderId: order.orderId,
    amountMinor: order.totalMinor,
    paymentStatus: "succeeded",
    payload: { id: "evt-race-1" },
    now,
  };

  const outcomes = await Promise.all(
    Array.from({ length: 6 }, () => orders.recordPaymentEvent(delivery)),
  );

  assert.equal(outcomes.filter((outcome) => outcome.applied).length, 1);
  assert.equal((await database.query("SELECT id FROM payments")).rows.length, 1);
  assert.equal((await orders.findOrder(order.orderId)).status, "paid");
});

test("refuses a payment whose amount is not the frozen total", { skip }, async () => {
  const { order } = await openOrder();
  await orders.transitionOrder({ orderId: order.orderId, expectedFrom: "draft", to: "pending_payment", now });

  await assert.rejects(
    () => orders.recordPaymentEvent({
      provider: "test-provider",
      providerEventId: "evt-short-1",
      eventType: "payment.succeeded",
      providerPaymentId: "pay-short-1",
      orderId: order.orderId,
      amountMinor: order.totalMinor - toMinor(50),
      paymentStatus: "succeeded",
      payload: { id: "evt-short-1" },
      now,
    }),
    PaymentAmountMismatchError,
  );

  assert.equal((await orders.findOrder(order.orderId)).status, "pending_payment");
  assert.equal((await database.query("SELECT id FROM payments")).rows.length, 0);
});

test("a failed payment can be retried but never skips a state", { skip }, async () => {
  const { order } = await openOrder();
  await orders.transitionOrder({ orderId: order.orderId, expectedFrom: "draft", to: "pending_payment", now });

  await orders.recordPaymentEvent({
    provider: "test-provider",
    providerEventId: "evt-fail-1",
    eventType: "payment.failed",
    providerPaymentId: "pay-fail-1",
    orderId: order.orderId,
    amountMinor: order.totalMinor,
    paymentStatus: "failed",
    payload: { id: "evt-fail-1" },
    now,
  });
  assert.equal((await orders.findOrder(order.orderId)).status, "failed");

  const retried = await orders.transitionOrder({
    orderId: order.orderId,
    expectedFrom: "failed",
    to: "pending_payment",
    now: later,
  });
  assert.equal(retried.status, "pending_payment");

  // The state machine refuses a jump the product does not allow.
  await assert.rejects(
    () => orders.transitionOrder({ orderId: order.orderId, expectedFrom: "pending_payment", to: "active", now: later }),
    OrderTransitionError,
  );
  // A transition from a state the order is no longer in changes nothing.
  assert.equal(
    await orders.transitionOrder({ orderId: order.orderId, expectedFrom: "draft", to: "cancelled", now: later }),
    null,
  );
  assert.equal((await orders.findOrder(order.orderId)).status, "pending_payment");
});

test("carries a signed-in customer from checkout to a paid order", { skip }, async () => {
  const ownerUserId = await createOwner("checkout@example.com");
  const sessionToken = await createOpaqueToken();
  await database.query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1::uuid, decode($2, 'hex'), $3)`,
    [ownerUserId, sessionToken.tokenHash, new Date(now.getTime() + 30 * 24 * 60 * 60_000)],
  );

  const provider = createFakePaymentProvider({
    webhookSecret: "w".repeat(48),
    checkoutBaseUrl: "https://riftory.example/odeme/sahte",
  });
  const service = createOrderService({
    auth: createAuthService({
      repository: auth,
      mailer: null,
      appOrigin: "https://riftory.example",
      rateLimitSecret: "s".repeat(32),
    }),
    orders,
    provider,
    appOrigin: "https://riftory.example",
  });

  const checkout = await service.startCheckout({
    rawToken: sessionToken.rawToken,
    draft: DEFAULT_SERVER_DRAFT,
    returnTo: "/hesap",
  });
  assert.match(checkout.redirectUrl, /odeme\/sahte/);
  assert.equal((await orders.findOrder(checkout.orderId)).status, "pending_payment");

  const delivery = await provider.signDelivery({
    providerEventId: "evt-e2e-1",
    eventType: "payment.succeeded",
    providerPaymentId: "pay-e2e-1",
    orderId: checkout.orderId,
    amountMinor: checkout.totalMinor,
    status: "succeeded",
    payload: {},
  });

  const applied = await service.applyWebhook(delivery);
  assert.equal(applied.applied, true);
  assert.equal(applied.orderStatus, "paid");

  // The provider retries; the order must not move again.
  const retry = await service.applyWebhook(delivery);
  assert.equal(retry.applied, false);
  assert.equal(retry.orderStatus, "paid");
  assert.equal((await database.query("SELECT id FROM payments")).rows.length, 1);

  const readBack = await service.readOrder(sessionToken.rawToken, checkout.orderId);
  assert.equal(readBack.status, "paid");
  assert.equal(readBack.totalMinor, checkout.totalMinor);
  assert.equal(readBack.subtotalMinor + readBack.vatMinor, readBack.totalMinor);
});

test("hides another customer's order behind the same answer as a missing one", { skip }, async () => {
  const { order } = await openOrder({ ownerUserId: await createOwner("owner@example.com") });

  const strangerId = await createOwner("stranger@example.com");
  const strangerToken = await createOpaqueToken();
  await database.query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1::uuid, decode($2, 'hex'), $3)`,
    [strangerId, strangerToken.tokenHash, new Date(now.getTime() + 30 * 24 * 60 * 60_000)],
  );

  const service = createOrderService({
    auth: createAuthService({
      repository: auth,
      mailer: null,
      appOrigin: "https://riftory.example",
      rateLimitSecret: "s".repeat(32),
    }),
    orders,
    provider: createFakePaymentProvider({
      webhookSecret: "w".repeat(48),
      checkoutBaseUrl: "https://riftory.example/odeme/sahte",
    }),
    appOrigin: "https://riftory.example",
  });

  const foreign = await assert.rejects(
    () => service.readOrder(strangerToken.rawToken, order.orderId),
    (error) => error.code === "ORDER_NOT_FOUND" && error.status === 404,
  );
  assert.equal(foreign, undefined);

  await assert.rejects(
    () => service.readOrder(strangerToken.rawToken, "22222222-2222-4222-8222-222222222222"),
    (error) => error.code === "ORDER_NOT_FOUND",
  );
});

test("keeps every order and its money on its own owner", { skip }, async () => {
  const first = await openOrder({ ownerUserId: await createOwner("first@example.com") });
  const second = await openOrder({
    ownerUserId: await createOwner("second@example.com"),
    draft: { ...DEFAULT_SERVER_DRAFT, planId: "pro-12" },
  });

  assert.notEqual(first.order.ownerUserId, second.order.ownerUserId);
  assert.notEqual(first.order.totalMinor, second.order.totalMinor);

  const owned = await database.query(
    "SELECT id::text AS id FROM orders WHERE id = $1::uuid AND owner_user_id = $2::uuid",
    [second.order.orderId, first.order.ownerUserId],
  );
  assert.equal(owned.rows.length, 0);

  const actions = await database.query(
    "SELECT action FROM audit_logs WHERE action LIKE 'order.%' ORDER BY id",
  );
  assert.deepEqual(actions.rows.map((row) => row.action), ["order.created", "order.created"]);
});

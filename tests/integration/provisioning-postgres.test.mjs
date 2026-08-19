import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { createNodePostgresDatabase } from "../../infra/postgres/node-pg-executor.ts";
import { loadMigrations } from "../../infra/postgres/node-migration-source.ts";
import { runMigrations } from "../../infra/postgres/migration-runner.ts";
import { PostgresAuthRepository } from "../../infra/postgres/auth-repository.ts";
import { PostgresAdminRepository } from "../../infra/postgres/admin-repository.ts";
import { PostgresOrderRepository } from "../../infra/postgres/order-repository.ts";
import { PostgresProvisioningRepository } from "../../infra/postgres/provisioning-repository.ts";
import { createOpaqueToken } from "../../lib/auth-security.ts";
import { createPriceSnapshot } from "../../lib/order-contracts.ts";
import { JOB_MAX_ATTEMPTS, retryDelayMs } from "../../lib/provisioning-contracts.ts";
import { DEFAULT_SERVER_DRAFT } from "../../lib/catalog.ts";

const connectionString = process.env.TEST_DATABASE_URL?.trim();
const skip = connectionString
  ? false
  : "TEST_DATABASE_URL tanımlı değil; PostgreSQL entegrasyon testleri atlandı.";

const now = new Date();
const later = new Date(now.getTime() + 60_000);

let database;
let auth;
let admin;
let orders;
let provisioning;

before(async () => {
  if (skip) return;
  database = createNodePostgresDatabase({ connectionString });
  auth = new PostgresAuthRepository(database);
  admin = new PostgresAdminRepository(database);
  orders = new PostgresOrderRepository(database);
  provisioning = new PostgresProvisioningRepository(database);
  const migrations = await loadMigrations();
  await database.session((session) => runMigrations(session, migrations));
});

after(async () => {
  if (database) await database.close();
});

beforeEach(async () => {
  if (skip) return;
  await database.query(
    "TRUNCATE servers, provider_resources, provisioning_jobs, server_events, orders, order_items, price_snapshots, payments, payment_events, refunds, users, auth_accounts, auth_sessions, verification_tokens, consents, server_drafts, draft_import_receipts, audit_logs, auth_rate_limits, oauth_states RESTART IDENTITY CASCADE",
  );
});

async function paidOrder() {
  const token = await createOpaqueToken();
  const challengeId = await auth.createMagicLinkChallenge({
    purpose: "verify_email",
    email: "owner@example.com",
    tokenHash: token.tokenHash,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    returnTo: "/panel",
    displayName: "Sunucu Sahibi",
    consentVersion: "kvkk-iletisim-v1-2026-08-14",
    requestedIp: null,
  });
  await auth.markMagicLinkDelivered(challengeId, now);
  const session = await createOpaqueToken();
  const identity = await auth.exchangeMagicLink({
    challengeTokenHash: token.tokenHash,
    sessionTokenHash: session.tokenHash,
    sessionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    now,
    ipAddress: null,
    userAgent: null,
  });

  const snapshot = createPriceSnapshot(DEFAULT_SERVER_DRAFT);
  const order = await orders.createOrder({
    ownerUserId: identity.userId,
    serverDraftId: null,
    snapshot,
    now,
  });
  await orders.transitionOrder({ orderId: order.orderId, expectedFrom: "draft", to: "pending_payment", now });

  return { order, ownerUserId: identity.userId };
}

const specification = {
  gameId: DEFAULT_SERVER_DRAFT.gameId,
  softwareId: DEFAULT_SERVER_DRAFT.softwareId,
  planId: DEFAULT_SERVER_DRAFT.planId,
  regionId: DEFAULT_SERVER_DRAFT.regionId,
  serverName: DEFAULT_SERVER_DRAFT.serverName,
};

test("a paid order queues exactly one server, however many times it is applied", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();

  // The same paid order is applied ten times, as a redelivered webhook would.
  const results = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    results.push(await provisioning.enqueueServerSetup({
      orderId: order.orderId,
      ownerUserId,
      specification,
      now,
    }));
  }

  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.server.serverId)).size, 1);
  assert.equal((await database.query("SELECT id FROM servers")).rows.length, 1);
  assert.equal((await database.query("SELECT id FROM provisioning_jobs")).rows.length, 1);
});

test("concurrent applications of one order still queue one server", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();

  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => provisioning.enqueueServerSetup({
      orderId: order.orderId,
      ownerUserId,
      specification,
      now,
    })),
  );

  const servers = await database.query("SELECT id FROM servers");
  const jobs = await database.query("SELECT id FROM provisioning_jobs");
  assert.equal(servers.rows.length, 1, "eş zamanlı istekler ikinci sunucu üretti");
  assert.equal(jobs.rows.length, 1, "eş zamanlı istekler ikinci iş üretti");
  assert.ok(results.some((result) => result.status === "fulfilled"));
});

test("an admin manual allocation is idempotent, audited and never invents an order", { skip }, async () => {
  const { ownerUserId } = await paidOrder();
  const requestId = "3cba76ba-7255-4b9b-8d03-65d77c442510";
  const input = {
    requestId,
    customerEmail: "owner@example.com",
    actorUserId: ownerUserId,
    specification,
    activeServerLimit: 10,
    now,
  };

  const first = await admin.provisionServer(input);
  const replay = await admin.provisionServer(input);
  const conflict = await admin.provisionServer({
    ...input,
    specification: { ...specification, serverName: "Başka Dünya" },
  });

  assert.equal(first.status, "queued");
  assert.deepEqual(replay, { status: "existing", serverId: first.serverId, jobId: first.jobId });
  assert.deepEqual(conflict, { status: "idempotency_conflict" });

  const stored = await database.query(
    `SELECT s.order_id, s.provider_reference, j.kind,
            (SELECT count(*)::int FROM audit_logs WHERE action = 'admin.server.provisioned') AS audit_count,
            (SELECT count(*)::int FROM server_events WHERE kind = 'admin_manual_provisioned') AS event_count
       FROM servers s
       JOIN provisioning_jobs j ON j.server_id = s.id
      WHERE s.id = $1::uuid`,
    [first.serverId],
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].order_id, null);
  assert.equal(stored.rows[0].provider_reference, `admin-manual:${requestId}`);
  assert.equal(stored.rows[0].kind, "create_server");
  assert.equal(stored.rows[0].audit_count, 1);
  assert.equal(stored.rows[0].event_count, 1);

  assert.deepEqual(
    await admin.provisionServer({ ...input, requestId: "8ee3601d-38b0-44ce-ad7d-40f7d4673398", activeServerLimit: 1 }),
    { status: "limit_reached" },
  );
});

test("two workers never take the same job", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();
  await provisioning.enqueueServerSetup({ orderId: order.orderId, ownerUserId, specification, now });

  const claims = await Promise.all([
    provisioning.claimJob("worker-a", now),
    provisioning.claimJob("worker-b", now),
    provisioning.claimJob("worker-c", now),
  ]);

  const taken = claims.filter(Boolean);
  assert.equal(taken.length, 1);
  assert.equal(taken[0].kind, "create_server");
  assert.equal(taken[0].payload.planId, specification.planId);

  // Nothing is left to claim while the lease holds.
  assert.equal(await provisioning.claimJob("worker-d", now), null);
});

test("an abandoned lease becomes claimable again", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();
  await provisioning.enqueueServerSetup({ orderId: order.orderId, ownerUserId, specification, now });

  const first = await provisioning.claimJob("worker-a", now);
  assert.notEqual(first, null);

  const afterLease = new Date(now.getTime() + 10 * 60_000);
  const second = await provisioning.claimJob("worker-b", afterLease);
  assert.equal(second.jobId, first.jobId);
  assert.equal(second.attempts, 2, "yeniden sahiplenme deneme sayısını artırmadı");
});

test("a double-clicked command queues one operation, not two", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();
  const queued = await provisioning.enqueueServerSetup({ orderId: order.orderId, ownerUserId, specification, now });
  const setup = await provisioning.claimJob("worker-a", now);
  await provisioning.completeJob({
    jobId: setup.jobId,
    serverId: queued.server.serverId,
    serverStatus: "online",
    connection: { host: "oyun.example", port: 25565 },
    customerMessage: "hazır",
    now,
  });

  // Two tabs, or an impatient click, must not send two commands.
  const first = await provisioning.enqueueLifecycleJob({
    serverId: queued.server.serverId,
    ownerUserId,
    kind: "restart_server",
    now: later,
  });
  const second = await provisioning.enqueueLifecycleJob({
    serverId: queued.server.serverId,
    ownerUserId,
    kind: "restart_server",
    now: later,
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.jobId, first.jobId);

  // A different command while one is outstanding joins it rather than racing it.
  const conflicting = await provisioning.enqueueLifecycleJob({
    serverId: queued.server.serverId,
    ownerUserId,
    kind: "stop_server",
    now: later,
  });
  assert.equal(conflicting.jobId, first.jobId);

  const open = await database.query(
    "SELECT id FROM provisioning_jobs WHERE server_id = $1::uuid AND status IN ('pending','leased')",
    [queued.server.serverId],
  );
  assert.equal(open.rows.length, 1);
});

test("lists only the caller's own servers, with what they connect to", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();
  const queued = await provisioning.enqueueServerSetup({ orderId: order.orderId, ownerUserId, specification, now });

  // Before the job runs there is no address yet, and the setup job is showing.
  const queuedView = await provisioning.listServersForOwner(ownerUserId);
  assert.equal(queuedView.length, 1);
  assert.equal(queuedView[0].connection, null);
  assert.equal(queuedView[0].pendingJobKind, "create_server");

  const job = await provisioning.claimJob("worker-a", now);
  await provisioning.completeJob({
    jobId: job.jobId,
    serverId: queued.server.serverId,
    serverStatus: "online",
    connection: { host: "metro.proxy.rlwy.net", port: 28520 },
    customerMessage: "Sunucun hazır.",
    now: later,
  });

  const listed = await provisioning.listServersForOwner(ownerUserId);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "online");
  assert.deepEqual(listed[0].connection, { host: "metro.proxy.rlwy.net", port: 28520 });
  assert.equal(listed[0].pendingJobKind, null);

  // A stranger sees nothing, not somebody else's server.
  assert.deepEqual(await provisioning.listServersForOwner("33333333-3333-4333-8333-333333333333"), []);

  const events = await provisioning.listServerEvents(queued.server.serverId);
  assert.equal(events[0].message, "Sunucun hazır.");
  // The technical detail stays out of the customer's history.
  assert.equal("operatorDetail" in events[0], false);
});

test("a deleted server drops out of the owner's list", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();
  const queued = await provisioning.enqueueServerSetup({ orderId: order.orderId, ownerUserId, specification, now });

  await database.query("UPDATE servers SET status = 'deleted' WHERE id = $1::uuid", [queued.server.serverId]);
  assert.deepEqual(await provisioning.listServersForOwner(ownerUserId), []);
});

test("refuses a command for a server the caller does not own", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();
  const queued = await provisioning.enqueueServerSetup({ orderId: order.orderId, ownerUserId, specification, now });

  await assert.rejects(
    () => provisioning.enqueueLifecycleJob({
      serverId: queued.server.serverId,
      ownerUserId: "33333333-3333-4333-8333-333333333333",
      kind: "stop_server",
      now: later,
    }),
    /Sunucu bulunamadı/,
  );
});

test("records what the provider created so nothing is orphaned", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();
  const queued = await provisioning.enqueueServerSetup({ orderId: order.orderId, ownerUserId, specification, now });
  const job = await provisioning.claimJob("worker-a", now);

  assert.equal(await provisioning.recordProviderResource({
    serverId: queued.server.serverId,
    provider: "docker",
    resourceKind: "container",
    providerResourceId: "container-1",
    now,
  }), true);

  // A retry re-reports the same resource; it must not be counted twice.
  assert.equal(await provisioning.recordProviderResource({
    serverId: queued.server.serverId,
    provider: "docker",
    resourceKind: "container",
    providerResourceId: "container-1",
    now,
  }), false);

  await provisioning.completeJob({
    jobId: job.jobId,
    serverId: queued.server.serverId,
    serverStatus: "online",
    connection: { host: "riftory.example", port: 25565 },
    customerMessage: "Sunucun hazır.",
    now: later,
  });

  const server = await database.query(
    "SELECT status, connection_host, connection_port FROM servers WHERE id = $1::uuid",
    [queued.server.serverId],
  );
  assert.equal(server.rows[0].status, "online");
  assert.equal(server.rows[0].connection_host, "riftory.example");
  assert.equal(Number(server.rows[0].connection_port), 25565);

  const resources = await database.query("SELECT provider_resource_id FROM provider_resources");
  assert.equal(resources.rows.length, 1);
});

test("retries a failure with backoff and gives up at the ceiling", { skip }, async () => {
  const { order, ownerUserId } = await paidOrder();
  const queued = await provisioning.enqueueServerSetup({ orderId: order.orderId, ownerUserId, specification, now });

  const first = await provisioning.failJob({
    jobId: (await provisioning.claimJob("worker-a", now)).jobId,
    serverId: queued.server.serverId,
    attempts: 1,
    operatorDetail: "provider 500",
    customerMessage: "Kurulum yeniden denenecek.",
    now,
  });
  assert.equal(first.retrying, true);

  const scheduled = await database.query("SELECT status, run_after FROM provisioning_jobs");
  assert.equal(scheduled.rows[0].status, "pending");
  assert.ok(new Date(scheduled.rows[0].run_after).getTime() >= now.getTime() + retryDelayMs(1) - 1_000);

  // Not due yet: a worker must not pick it up early.
  assert.equal(await provisioning.claimJob("worker-b", now), null);

  const exhausted = await provisioning.failJob({
    jobId: scheduled.rows[0].id ?? (await provisioning.claimJob("worker-b", new Date(now.getTime() + 60 * 60_000))).jobId,
    serverId: queued.server.serverId,
    attempts: JOB_MAX_ATTEMPTS,
    operatorDetail: "provider kalıcı hata",
    customerMessage: "Kurulum tamamlanamadı, destek ekibi bilgilendirildi.",
    now: later,
  });
  assert.equal(exhausted.retrying, false);

  const dead = await database.query("SELECT status FROM provisioning_jobs");
  assert.equal(dead.rows[0].status, "dead");
  const server = await database.query("SELECT status FROM servers WHERE id = $1::uuid", [queued.server.serverId]);
  assert.equal(server.rows[0].status, "failed");

  // The customer message and the technical detail stay separate.
  const events = await database.query("SELECT customer_message, operator_detail FROM server_events ORDER BY id DESC LIMIT 1");
  assert.match(events.rows[0].customer_message, /destek ekibi/);
  assert.match(events.rows[0].operator_detail, /kalıcı hata/);
});

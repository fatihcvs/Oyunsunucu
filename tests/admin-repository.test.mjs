import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAdminRepository } from "../infra/postgres/admin-repository.ts";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const SERVER_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-16T18:00:00.000Z");

class DashboardDatabase {
  statements = [];
  async query(text, values = []) {
    this.statements.push({ text, values });
    if (text.includes("AS is_admin")) {
      return { rows: [{ user_id: USER_ID, email: "a@b.c", display_name: "Müşteri", status: "active", email_verified_at: NOW, created_at: NOW, is_admin: false, server_count: "1" }] };
    }
    if (text.includes("FROM audit_logs a")) {
      return { rows: [{ audit_id: "7", action: "admin.server.command", email: "a@b.c", target_type: "server", target_id: SERVER_ID, occurred_at: NOW }] };
    }
    if (text.includes("AS has_own_password")) {
      return { rows: [{ user_id: USER_ID, email: "a@b.c", display_name: "Admin", role: "owner", has_own_password: true, created_at: NOW }] };
    }
    if (text.includes("FROM admin_memberships")) return { rows: [{ role: "operator" }] };
    if (text.includes("FROM users") && text.includes("created_last_24_hours")) {
      return { rows: [{ total: "4", active: "3", created_last_24_hours: "1" }] };
    }
    if (text.includes("FROM orders") && text.includes("paid_or_active")) {
      return { rows: [{ total: "2", pending_payment: "1", paid_or_active: "1", failed: "0" }] };
    }
    if (text.includes("FROM servers") && text.includes("count(*) FILTER")) {
      return { rows: [{ total: "1", online: "1", provisioning: "0", failed: "0" }] };
    }
    if (text.includes("FROM provisioning_jobs") && text.includes("queued")) {
      return { rows: [{ queued: "1", leased: "0", dead: "1" }] };
    }
    if (text.includes("FROM orders o")) {
      return { rows: [{ order_id: JOB_ID, email: "a@b.c", display_name: "Admin", status: "paid", total_minor: "12500", currency: "TRY", created_at: NOW }] };
    }
    if (text.includes("FROM servers s")) {
      return { rows: [{ server_id: SERVER_ID, email: "a@b.c", name: "Paper", game_id: "minecraft", software_id: "paper", plan_id: "starter-4", region_id: "eu-west", source: "manual", status: "online", connection_host: "host", connection_port: 25565, created_at: NOW, updated_at: NOW, pending_kind: null }] };
    }
    if (text.includes("FROM provisioning_jobs j")) {
      return { rows: [{ job_id: JOB_ID, server_id: SERVER_ID, server_name: "Paper", email: "a@b.c", kind: "create_server", status: "dead", attempts: 5, max_attempts: 5, last_error: "timeout", run_after: NOW, updated_at: NOW }] };
    }
    return { rows: [] };
  }
  async transaction(callback) { return callback(this); }
}

test("loads the admin read model with parameterized search values", async () => {
  const database = new DashboardDatabase();
  const repository = new PostgresAdminRepository(database);
  const result = await repository.loadDashboard({ query: "paper%' OR true --", now: NOW });

  assert.equal(result.metrics.users.total, 4);
  assert.equal(result.orders[0].totalMinor, 12500);
  assert.equal(result.servers[0].connection.port, 25565);
  assert.equal(result.jobs[0].lastError, "timeout");
  assert.ok(database.statements.every((statement) => !statement.text.includes("paper%' OR true --")));
  assert.ok(database.statements.some((statement) => statement.values.includes("%paper%' OR true --%")));
});

test("requires an active user as well as an admin membership", async () => {
  const database = new DashboardDatabase();
  const repository = new PostgresAdminRepository(database);
  assert.deepEqual(await repository.findMembership(USER_ID), { role: "operator" });
  const statement = database.statements[0];
  assert.match(statement.text, /u\.status = 'active'/);
  assert.deepEqual(statement.values, [USER_ID]);
});

class ManualProvisionDatabase {
  statements = [];
  activeServers = 2;
  customer = true;
  existing = null;
  async query(text, values = []) {
    this.statements.push({ text: text.trim(), values: [...values] });
    if (text.includes("FROM users") && text.includes("email_verified_at IS NOT NULL")) {
      return { rows: this.customer ? [{ user_id: USER_ID }] : [] };
    }
    if (text.includes("FROM provisioning_jobs j") && text.includes("idempotency_key")) {
      return { rows: this.existing ? [this.existing] : [] };
    }
    if (text.includes("count(*)::text AS active_servers")) {
      return { rows: [{ active_servers: String(this.activeServers) }] };
    }
    if (text.includes("INSERT INTO servers")) {
      return { rows: [{ id: SERVER_ID, owner_user_id: USER_ID, status: "requested", game_id: "minecraft", software_id: "paper", plan_id: "mini-2", region_id: "eu-west", name: "Beta World" }] };
    }
    if (text.includes("INSERT INTO provisioning_jobs")) return { rows: [{ id: JOB_ID }] };
    return { rows: [] };
  }
  async transaction(callback) { return callback(this); }
}

function manualProvisionInput(overrides = {}) {
  return {
    requestId: "33333333-3333-4333-8333-333333333333",
    customerEmail: "player@example.com",
    actorUserId: USER_ID,
    specification: {
      gameId: "minecraft",
      softwareId: "paper",
      planId: "mini-2",
      regionId: "eu-west",
      serverName: "Beta World",
    },
    activeServerLimit: 10,
    now: NOW,
    ...overrides,
  };
}

test("queues one audited manual server under the closed-beta capacity lock", async () => {
  const database = new ManualProvisionDatabase();
  const repository = new PostgresAdminRepository(database);
  const result = await repository.provisionServer(manualProvisionInput());

  assert.deepEqual(result, { status: "queued", serverId: SERVER_ID, jobId: JOB_ID });
  const texts = database.statements.map((statement) => statement.text);
  assert.ok(database.statements.some((statement) => statement.values.includes("admin-manual-server-capacity")));
  assert.ok(texts.some((text) => text.includes("INSERT INTO provisioning_jobs")));
  assert.ok(texts.some((text) => text.includes("admin.server.provisioned")));
  assert.ok(texts.some((text) => text.includes("admin_manual_provisioned")));
  assert.ok(!texts.some((text) => text.includes("INSERT INTO orders")));
});

test("refuses a manual server before writing resources when beta capacity is full", async () => {
  const database = new ManualProvisionDatabase();
  database.activeServers = 10;
  const repository = new PostgresAdminRepository(database);
  assert.deepEqual(await repository.provisionServer(manualProvisionInput()), { status: "limit_reached" });
  assert.ok(!database.statements.some((statement) => statement.text.includes("INSERT INTO servers")));
});

test("replays the same manual request but rejects the same id for different specifications", async () => {
  const database = new ManualProvisionDatabase();
  database.existing = {
    job_id: JOB_ID,
    id: SERVER_ID,
    owner_user_id: USER_ID,
    status: "requested",
    game_id: "minecraft",
    software_id: "paper",
    plan_id: "mini-2",
    region_id: "eu-west",
    name: "Beta World",
  };
  const repository = new PostgresAdminRepository(database);
  assert.deepEqual(
    await repository.provisionServer(manualProvisionInput()),
    { status: "existing", serverId: SERVER_ID, jobId: JOB_ID },
  );
  assert.deepEqual(
    await repository.provisionServer(manualProvisionInput({
      specification: { ...manualProvisionInput().specification, serverName: "Another World" },
    })),
    { status: "idempotency_conflict" },
  );
  assert.ok(!database.statements.some((statement) => statement.text.includes("INSERT INTO servers")));
});

class RetryDatabase {
  statements = [];
  active = false;
  status = "dead";
  async query(text, values = []) {
    this.statements.push({ text: text.trim(), values: [...values] });
    if (text.includes("FROM provisioning_jobs") && text.includes("FOR UPDATE")) {
      return { rows: [{ id: JOB_ID, server_id: SERVER_ID, kind: "create_server", status: this.status }] };
    }
    if (text.startsWith("SELECT 1 FROM provisioning_jobs")) return { rows: this.active ? [{ "?column?": 1 }] : [] };
    return { rows: [] };
  }
  async transaction(callback) { return callback(this); }
}

test("requeues a dead job, resets a failed create server and audits the actor", async () => {
  const database = new RetryDatabase();
  const repository = new PostgresAdminRepository(database);
  const outcome = await repository.retryJob({ jobId: JOB_ID, actorUserId: USER_ID, now: NOW });

  assert.deepEqual(outcome, { status: "queued", jobId: JOB_ID, serverId: SERVER_ID });
  const texts = database.statements.map((statement) => statement.text);
  assert.ok(texts.some((text) => text.startsWith("UPDATE provisioning_jobs")));
  assert.ok(texts.some((text) => text.includes("status = 'requested'")));
  assert.ok(texts.some((text) => text.includes("admin.provisioning.retry")));
  assert.ok(texts.some((text) => text.includes("admin_job_retried")));
});

test("does not retry when another server operation is active", async () => {
  const database = new RetryDatabase();
  database.active = true;
  const repository = new PostgresAdminRepository(database);
  assert.deepEqual(
    await repository.retryJob({ jobId: JOB_ID, actorUserId: USER_ID, now: NOW }),
    { status: "conflict" },
  );
  assert.ok(!database.statements.some((statement) => statement.text.startsWith("UPDATE provisioning_jobs")));
});

test("does not replay a pending or successful job", async () => {
  const database = new RetryDatabase();
  database.status = "succeeded";
  const repository = new PostgresAdminRepository(database);
  assert.deepEqual(
    await repository.retryJob({ jobId: JOB_ID, actorUserId: USER_ID, now: NOW }),
    { status: "not_retryable" },
  );
});

class CommandDatabase {
  statements = [];
  serverStatus = "online";
  serverExists = true;
  pendingJob = false;
  async query(text, values = []) {
    this.statements.push({ text: text.trim(), values: [...values] });
    if (text.includes("FROM servers WHERE id")) {
      return { rows: this.serverExists ? [{ id: SERVER_ID, status: this.serverStatus }] : [] };
    }
    if (text.includes("FROM provisioning_jobs") && text.includes("IN ('pending', 'leased')")) {
      return { rows: this.pendingJob ? [{ id: JOB_ID }] : [] };
    }
    if (text.includes("INSERT INTO provisioning_jobs")) return { rows: [{ id: JOB_ID }] };
    return { rows: [] };
  }
  async transaction(callback) { return callback(this); }
}

function commandInput(overrides = {}) {
  return {
    serverId: SERVER_ID,
    kind: "stop_server",
    allowedStatuses: ["online"],
    actorUserId: USER_ID,
    now: NOW,
    ...overrides,
  };
}

test("queues one audited lifecycle command under the per-server lock", async () => {
  const database = new CommandDatabase();
  const repository = new PostgresAdminRepository(database);
  const result = await repository.commandServer(commandInput());

  assert.deepEqual(result, { status: "queued", jobId: JOB_ID, created: true });
  assert.ok(database.statements.some((statement) => statement.values.includes(`server-operation:${SERVER_ID}`)));
  const texts = database.statements.map((statement) => statement.text);
  assert.ok(texts.some((text) => text.includes("INSERT INTO provisioning_jobs")));
  assert.ok(texts.some((text) => text.includes("INSERT INTO server_events")));
  assert.ok(database.statements.some((statement) => statement.values.includes("admin.server.command")
    || statement.text.includes("admin.server.command")));
});

test("refuses a command the server's state cannot carry out, before writing a job", async () => {
  const database = new CommandDatabase();
  database.serverStatus = "provisioning";
  const repository = new PostgresAdminRepository(database);
  assert.deepEqual(await repository.commandServer(commandInput()), { status: "not_allowed" });
  assert.ok(!database.statements.some((statement) => statement.text.includes("INSERT INTO provisioning_jobs")));
});

test("a missing server and a busy server are answered without queueing anything", async () => {
  const missing = new CommandDatabase();
  missing.serverExists = false;
  assert.deepEqual(
    await new PostgresAdminRepository(missing).commandServer(commandInput()),
    { status: "not_found" },
  );

  const busy = new CommandDatabase();
  busy.pendingJob = true;
  assert.deepEqual(
    await new PostgresAdminRepository(busy).commandServer(commandInput()),
    { status: "conflict" },
  );
  assert.ok(!busy.statements.some((statement) => statement.text.includes("INSERT INTO provisioning_jobs")));
});

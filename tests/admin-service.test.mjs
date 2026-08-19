import assert from "node:assert/strict";
import test from "node:test";
import { createAdminService } from "../lib/admin-service.ts";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-16T18:00:00.000Z");
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const SERVER_ID = "44444444-4444-4444-8444-444444444444";

const session = {
  sessionId: "session-1",
  sessionFamilyId: "family-1",
  userId: USER_ID,
  email: "admin@riftory.example",
  displayName: "Riftory Admin",
  expiresAt: new Date("2026-08-17T18:00:00.000Z"),
};

function dashboardData() {
  return {
    metrics: {
      users: { total: 4, active: 3, createdLast24Hours: 1 },
      orders: { total: 2, pendingPayment: 1, paidOrActive: 1, failed: 0 },
      servers: { total: 1, online: 1, provisioning: 0, failed: 0 },
      jobs: { queued: 0, leased: 0, dead: 0 },
    },
    orders: [], servers: [], jobs: [], customers: [], auditLogs: [], memberships: [],
    generatedAt: NOW.toISOString(),
  };
}

function build({ role = "operator", activeSession = session, repository = {}, memberships = {} } = {}) {
  const retried = [];
  const provisioned = [];
  const commanded = [];
  const membershipCalls = [];
  const service = createAdminService({
    auth: { async authenticateSession() { return activeSession; } },
    repository: {
      async findMembership() { return role ? { role } : null; },
      async loadDashboard() { return dashboardData(); },
      async retryJob(input) { retried.push(input); return { status: "queued", jobId: input.jobId, serverId: null }; },
      async commandServer(input) {
        commanded.push(input);
        return { status: "queued", jobId: JOB_ID, created: true };
      },
      async provisionServer(input) {
        provisioned.push(input);
        return { status: "queued", serverId: "44444444-4444-4444-8444-444444444444", jobId: JOB_ID };
      },
      ...repository,
    },
    memberships: {
      async grantMembership(input) {
        membershipCalls.push({ action: "grant", input });
        return { status: "granted", userId: SERVER_ID };
      },
      async revokeMembership(input) {
        membershipCalls.push({ action: "revoke", input });
        return { status: "revoked" };
      },
      ...memberships,
    },
    now: () => NOW,
  });
  return { service, retried, provisioned, commanded, membershipCalls };
}

function provisionInput(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    customerEmail: " player@example.com ",
    serverName: " Beta Dünyası ",
    gameId: "minecraft",
    softwareId: "paper",
    planId: "mini-2",
    regionId: "eu-west",
    confirmCost: true,
    ...overrides,
  };
}

test("returns the operational dashboard only after session and membership checks", async () => {
  const { service } = build({ role: "support" });
  const result = await service.dashboard("token", "  minecraft  ");

  assert.equal(result.viewer.email, session.email);
  assert.equal(result.viewer.role, "support");
  assert.equal(result.capabilities.canRetryJobs, false);
  assert.equal(result.capabilities.canProvisionServers, false);
  assert.equal(result.capacity.limit, 10);
  assert.ok(result.catalog.games.some((game) => game.id === "minecraft"));
  assert.equal(result.metrics.servers.online, 1);
});

test("rejects a signed-out caller before reading an admin membership", async () => {
  let membershipRead = false;
  const { service } = build({
    activeSession: null,
    repository: { async findMembership() { membershipRead = true; return { role: "owner" }; } },
  });

  await assert.rejects(() => service.dashboard("bad-token"), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.code, "SESSION_REQUIRED");
    return true;
  });
  assert.equal(membershipRead, false);
});

test("a customer session without membership cannot read operations data", async () => {
  let dashboardRead = false;
  const { service } = build({
    role: null,
    repository: { async loadDashboard() { dashboardRead = true; return dashboardData(); } },
  });

  await assert.rejects(() => service.dashboard("token"), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, "ADMIN_REQUIRED");
    return true;
  });
  assert.equal(dashboardRead, false);
});

test("rejects control characters and oversized admin searches", async () => {
  const { service } = build();
  await assert.rejects(() => service.dashboard("token", "x\nquery"), /geçersiz/i);
  await assert.rejects(() => service.dashboard("token", "x".repeat(81)), /geçersiz/i);
});

test("owner and operator roles can retry a failed job", async () => {
  for (const role of ["owner", "operator"]) {
    const { service, retried } = build({ role });
    const result = await service.retryJob("token", JOB_ID);
    assert.equal(result.status, "queued");
    assert.equal(retried[0].actorUserId, USER_ID);
    assert.equal(retried[0].now.toISOString(), NOW.toISOString());
  }
});

test("support is read-only", async () => {
  const { service, retried } = build({ role: "support" });
  await assert.rejects(() => service.retryJob("token", JOB_ID), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, "ADMIN_WRITE_REQUIRED");
    return true;
  });
  assert.equal(retried.length, 0);
});

test("owner and operator can queue a catalog-validated manual beta server", async () => {
  for (const role of ["owner", "operator"]) {
    const { service, provisioned } = build({ role });
    const result = await service.provisionServer("token", provisionInput());
    assert.equal(result.created, true);
    assert.equal(provisioned[0].actorUserId, USER_ID);
    assert.equal(provisioned[0].customerEmail, "player@example.com");
    assert.equal(provisioned[0].specification.serverName, "Beta Dünyası");
    assert.equal(provisioned[0].activeServerLimit, 10);
  }
});

test("manual provisioning requires write role, explicit cost consent and a live catalog combination", async () => {
  const support = build({ role: "support" });
  await assert.rejects(
    () => support.service.provisionServer("token", provisionInput()),
    (error) => error.code === "ADMIN_WRITE_REQUIRED",
  );
  assert.equal(support.provisioned.length, 0);

  const { service, provisioned } = build();
  for (const [overrides, code] of [
    [{ confirmCost: false }, "COST_CONFIRMATION_REQUIRED"],
    [{ customerEmail: "not-email" }, "INVALID_CUSTOMER_EMAIL"],
    [{ serverName: "x" }, "INVALID_SERVER_NAME"],
    [{ softwareId: "forge" }, "INVALID_SERVER_SPECIFICATION"],
    [{ softwareId: "fabric", planId: "mini-2" }, "PLAN_TOO_SMALL"],
  ]) {
    await assert.rejects(
      () => service.provisionServer("token", provisionInput(overrides)),
      (error) => error.code === code,
    );
  }
  assert.equal(provisioned.length, 0);
});

test("maps manual provisioning repository outcomes to stable admin errors", async () => {
  for (const [status, code] of [
    ["customer_not_found", "CUSTOMER_NOT_FOUND"],
    ["limit_reached", "BETA_CAPACITY_REACHED"],
    ["idempotency_conflict", "IDEMPOTENCY_CONFLICT"],
  ]) {
    const { service } = build({ repository: { async provisionServer() { return { status }; } } });
    await assert.rejects(
      () => service.provisionServer("token", provisionInput()),
      (error) => error.code === code,
    );
  }
});

test("maps repository retry outcomes to explicit operator errors", async () => {
  for (const [status, code] of [
    ["not_found", "JOB_NOT_FOUND"],
    ["not_retryable", "JOB_NOT_RETRYABLE"],
    ["conflict", "SERVER_JOB_IN_FLIGHT"],
  ]) {
    const { service } = build({ repository: { async retryJob() { return { status }; } } });
    await assert.rejects(() => service.retryJob("token", JOB_ID), (error) => {
      assert.equal(error.code, code);
      return true;
    });
  }
});

test("database errors become a stable unavailable response", async () => {
  const { service } = build({ repository: { async loadDashboard() { throw new Error("postgres secret detail"); } } });
  await assert.rejects(() => service.dashboard("token"), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, "ADMIN_UNAVAILABLE");
    assert.doesNotMatch(error.message, /postgres secret detail/);
    return true;
  });
});

test("queues a lifecycle command and reports the job it created", async () => {
  const { service, commanded } = build();
  const result = await service.commandServer("token", { serverId: SERVER_ID, command: "durdur" });

  assert.deepEqual(result, { queued: true, jobId: JOB_ID, command: "durdur" });
  assert.equal(commanded.length, 1);
  assert.equal(commanded[0].kind, "stop_server");
  assert.deepEqual(commanded[0].allowedStatuses, ["online"]);
  assert.equal(commanded[0].actorUserId, USER_ID);
});

test("deletion is owner work, and support cannot command at all", async () => {
  const operator = build({ role: "operator" });
  await assert.rejects(
    () => operator.service.commandServer("token", { serverId: SERVER_ID, command: "sil" }),
    (error) => error.status === 403 && error.code === "ADMIN_OWNER_REQUIRED",
  );
  assert.equal(operator.commanded.length, 0);

  const owner = build({ role: "owner" });
  const result = await owner.service.commandServer("token", { serverId: SERVER_ID, command: "sil" });
  assert.equal(result.queued, true);
  assert.equal(owner.commanded[0].kind, "delete_server");

  const support = build({ role: "support" });
  await assert.rejects(
    () => support.service.commandServer("token", { serverId: SERVER_ID, command: "durdur" }),
    (error) => error.status === 403 && error.code === "ADMIN_WRITE_REQUIRED",
  );
  assert.equal(support.commanded.length, 0);
});

test("an unknown command or malformed server id never reaches the queue", async () => {
  const { service, commanded } = build();
  await assert.rejects(
    () => service.commandServer("token", { serverId: SERVER_ID, command: "format" }),
    (error) => error.status === 400 && error.code === "UNKNOWN_SERVER_COMMAND",
  );
  await assert.rejects(
    () => service.commandServer("token", { serverId: "not-a-uuid", command: "durdur" }),
    (error) => error.status === 400 && error.code === "INVALID_SERVER_ID",
  );
  assert.equal(commanded.length, 0);
});

test("a command the server's state cannot carry out is refused as a conflict", async () => {
  const { service } = build({
    repository: { async commandServer() { return { status: "not_allowed" }; } },
  });
  await assert.rejects(
    () => service.commandServer("token", { serverId: SERVER_ID, command: "baslat" }),
    (error) => error.status === 409 && error.code === "COMMAND_NOT_ALLOWED",
  );
});

test("membership management is owner-only and validates what it is given", async () => {
  const operator = build({ role: "operator" });
  await assert.rejects(
    () => operator.service.grantMembership("token", { email: "a@b.co", role: "operator" }),
    (error) => error.status === 403 && error.code === "ADMIN_OWNER_REQUIRED",
  );
  assert.equal(operator.membershipCalls.length, 0);

  const owner = build({ role: "owner" });
  await assert.rejects(
    () => owner.service.grantMembership("token", { email: "not-an-email", role: "operator" }),
    (error) => error.status === 400 && error.code === "INVALID_EMAIL",
  );
  await assert.rejects(
    () => owner.service.grantMembership("token", { email: "a@b.co", role: "root" }),
    (error) => error.status === 400 && error.code === "INVALID_ROLE",
  );
  assert.equal(owner.membershipCalls.length, 0);

  const granted = await owner.service.grantMembership("token", { email: " A@B.co ", role: "support" });
  assert.equal(granted.granted, true);
  assert.equal(owner.membershipCalls[0].input.email, "a@b.co");
  assert.equal(owner.membershipCalls[0].input.role, "support");
});

test("the console refuses to strip its own or the last owner's access", async () => {
  const self = build({ role: "owner", memberships: { async revokeMembership() { return { status: "self" }; } } });
  await assert.rejects(
    () => self.service.revokeMembership("token", { userId: USER_ID }),
    (error) => error.status === 409 && error.code === "CANNOT_REVOKE_SELF",
  );

  const last = build({ role: "owner", memberships: { async revokeMembership() { return { status: "last_owner" }; } } });
  await assert.rejects(
    () => last.service.revokeMembership("token", { userId: SERVER_ID }),
    (error) => error.status === 409 && error.code === "LAST_OWNER",
  );

  const owner = build({ role: "owner" });
  const result = await owner.service.revokeMembership("token", { userId: SERVER_ID });
  assert.equal(result.revoked, true);
});

test("the dashboard says which of the new powers the viewer actually has", async () => {
  const owner = await build({ role: "owner" }).service.dashboard("token");
  assert.deepEqual(owner.capabilities, {
    canRetryJobs: true,
    canProvisionServers: true,
    canCommandServers: true,
    canDeleteServers: true,
    canManageMemberships: true,
  });

  const support = await build({ role: "support" }).service.dashboard("token");
  assert.deepEqual(support.capabilities, {
    canRetryJobs: false,
    canProvisionServers: false,
    canCommandServers: false,
    canDeleteServers: false,
    canManageMemberships: false,
  });
});

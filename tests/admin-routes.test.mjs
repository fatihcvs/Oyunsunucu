import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminAction, handleAdminDashboard } from "../app/api/admin/route.ts";
import { SESSION_COOKIE_NAME } from "../lib/auth-security.ts";

const origin = "https://riftory.example";
const environment = { APP_ORIGIN: origin };
const token = "a".repeat(43);
const jobId = "11111111-1111-4111-8111-111111111111";
const requestId = "33333333-3333-4333-8333-333333333333";

function service(overrides = {}) {
  return {
    async dashboard(_token, query) { return { query, metrics: {}, orders: [], servers: [], jobs: [] }; },
    async retryJob(_token, receivedJobId) { return { status: "queued", jobId: receivedJobId, serverId: null }; },
    async provisionServer() { return { created: true, serverId: "server-1", jobId: "job-1", message: "queued" }; },
    ...overrides,
  };
}

function request(path = "/api/admin", init = {}) {
  return new Request(`${origin}${path}`, {
    ...init,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...(init.headers ?? {}) },
  });
}

test("admin reads require a real session cookie", async () => {
  const response = await handleAdminDashboard(
    new Request(`${origin}/api/admin`),
    environment,
    { adminService: service() },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "SESSION_REQUIRED");
});

test("passes a bounded search to the admin service and disables caching", async () => {
  let received;
  const response = await handleAdminDashboard(
    request("/api/admin?q=paper"),
    environment,
    { adminService: service({ async dashboard(rawToken, query) { received = { rawToken, query }; return { ok: true }; } }) },
  );
  assert.equal(response.status, 200);
  assert.equal(received.rawToken, token);
  assert.equal(received.query, "paper");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("admin mutations reject a foreign origin before calling the service", async () => {
  let called = false;
  const response = await handleAdminAction(
    request("/api/admin", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ action: "retry_job", jobId }),
    }),
    environment,
    { adminService: service({ async retryJob() { called = true; return {}; } }) },
  );
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("only the explicit retry action reaches the service", async () => {
  let received;
  const response = await handleAdminAction(
    request("/api/admin", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ action: "retry_job", jobId }),
    }),
    environment,
    { adminService: service({ async retryJob(rawToken, receivedJobId) { received = { rawToken, receivedJobId }; return { status: "queued" }; } }) },
  );
  assert.equal(response.status, 202);
  assert.equal(received.rawToken, token);
  assert.equal(received.receivedJobId, jobId);
});

test("manual provisioning passes only the explicit server fields to the admin service", async () => {
  let received;
  const response = await handleAdminAction(
    request("/api/admin", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        action: "provision_server",
        requestId,
        customerEmail: "player@example.com",
        serverName: "Beta World",
        gameId: "minecraft",
        softwareId: "paper",
        planId: "mini-2",
        regionId: "eu-west",
        confirmCost: true,
        ownerUserId: "attacker-selected-owner",
      }),
    }),
    environment,
    {
      adminService: service({
        async provisionServer(rawToken, input) {
          received = { rawToken, input };
          return { created: true, serverId: "server-1", jobId: "job-1", message: "queued" };
        },
      }),
    },
  );
  assert.equal(response.status, 202);
  assert.equal(received.rawToken, token);
  assert.equal(received.input.requestId, requestId);
  assert.equal("ownerUserId" in received.input, false);
});

test("unknown admin actions never reach an operation", async () => {
  let called = false;
  const response = await handleAdminAction(
    request("/api/admin", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ action: "delete_everything", jobId }),
    }),
    environment,
    { adminService: service({ async retryJob() { called = true; } }) },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "UNKNOWN_ADMIN_ACTION");
  assert.equal(called, false);
});

test("an unconfigured deployment returns 503 instead of an empty admin view", async () => {
  const response = await handleAdminDashboard(new Request("http://localhost/api/admin"), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "ADMIN_NOT_CONFIGURED");
});

test("routes a lifecycle command to the service and answers 202", async () => {
  let received;
  const response = await handleAdminAction(
    request("/api/admin", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ action: "command_server", serverId: "server-9", command: "durdur" }),
    }),
    environment,
    {
      adminService: service({
        async commandServer(_token, input) { received = input; return { queued: true, jobId, command: input.command }; },
      }),
    },
  );

  assert.equal(response.status, 202);
  assert.deepEqual(received, { serverId: "server-9", command: "durdur" });
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("routes membership grant and revoke without inventing defaults", async () => {
  const calls = [];
  const overrides = {
    adminService: service({
      async grantMembership(_token, input) { calls.push(["grant", input]); return { granted: true, userId: "u1", message: "ok" }; },
      async revokeMembership(_token, input) { calls.push(["revoke", input]); return { revoked: true, message: "ok" }; },
    }),
  };

  const granted = await handleAdminAction(
    request("/api/admin", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ action: "grant_membership", email: "a@b.co", role: "operator" }),
    }),
    environment,
    overrides,
  );
  const revoked = await handleAdminAction(
    request("/api/admin", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ action: "revoke_membership", userId: "u1" }),
    }),
    environment,
    overrides,
  );

  assert.equal(granted.status, 200);
  assert.equal(revoked.status, 200);
  assert.deepEqual(calls, [
    ["grant", { email: "a@b.co", role: "operator" }],
    ["revoke", { userId: "u1" }],
  ]);
});

test("a command from a foreign origin never reaches the service", async () => {
  let called = false;
  const response = await handleAdminAction(
    request("/api/admin", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ action: "command_server", serverId: "server-9", command: "sil" }),
    }),
    environment,
    { adminService: service({ async commandServer() { called = true; return {}; } }) },
  );

  assert.equal(response.status, 403);
  assert.equal(called, false);
});

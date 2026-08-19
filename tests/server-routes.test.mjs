import assert from "node:assert/strict";
import test from "node:test";
import { handleListServers, handleServerCommand } from "../app/api/servers/route.ts";
import { SESSION_COOKIE_NAME } from "../lib/auth-security.ts";

const origin = "https://riftory.example";
const environment = { APP_ORIGIN: origin };
const SESSION_TOKEN = "a".repeat(43);
const SERVER_ID = "11111111-1111-4111-8111-111111111111";

function fakeService(overrides = {}) {
  return {
    async listServers() { return { servers: [] }; },
    async readServer() { return { server: null, events: [] }; },
    async commandServer() { return { jobId: "job-1", queued: true }; },
    ...overrides,
  };
}

function signedInRequest(body) {
  return new Request(`${origin}/api/servers`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

test("listing without a session is refused", async () => {
  const response = await handleListServers(
    new Request(`${origin}/api/servers`),
    environment,
    { serverService: fakeService() },
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "SESSION_REQUIRED");
});

test("listing answers 503 while the panel has no database behind it", async () => {
  const response = await handleListServers(new Request(`${origin}/api/servers`), {});

  assert.equal(response.status, 503);
  // An unconfigured deployment says so rather than pretending the customer has
  // no servers.
  assert.match((await response.json()).code, /NOT_CONFIGURED|ADAPTER_NOT_BOUND/);
});

test("a command from a foreign origin is rejected", async () => {
  const request = new Request(`${origin}/api/servers`, {
    method: "POST",
    headers: {
      origin: "https://saldirgan.example",
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`,
    },
    body: JSON.stringify({ serverId: SERVER_ID, command: "durdur" }),
  });

  let called = false;
  const response = await handleServerCommand(request, environment, {
    serverService: fakeService({ async commandServer() { called = true; return {}; } }),
  });

  assert.equal(response.status, 403);
  assert.equal(called, false, "reddedilen istek yine de servise ulaştı");
});

test("an unknown command never reaches the queue", async () => {
  let called = false;
  const response = await handleServerCommand(
    signedInRequest({ serverId: SERVER_ID, command: "sil" }),
    environment,
    { serverService: fakeService({ async commandServer() { called = true; return {}; } }) },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "UNKNOWN_COMMAND");
  assert.equal(called, false);
});

test("a valid command is accepted and passed through", async () => {
  const received = [];
  const response = await handleServerCommand(
    signedInRequest({ serverId: SERVER_ID, command: "yeniden-baslat" }),
    environment,
    {
      serverService: fakeService({
        async commandServer(input) { received.push(input); return { jobId: "job-1", queued: true }; },
      }),
    },
  );

  assert.equal(response.status, 202);
  assert.equal(received[0].command, "yeniden-baslat");
  assert.equal(received[0].serverId, SERVER_ID);
  // Answers must never be cached: a stale panel would show the wrong state.
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("the panel keeps working when sign-in delivery is switched off", async () => {
  // Only the three foundations, no mail provider and no Discord: an existing
  // customer must not lose their servers because new sign-ups are paused.
  const sessionOnly = {
    DATABASE_URL: "postgres://user:pass@localhost:5432/riftory",
    AUTH_SECRET: "s".repeat(32),
    APP_ORIGIN: origin,
  };

  const response = await handleListServers(new Request(`${origin}/api/servers`), sessionOnly, {
    repository: {},
  });

  // No session cookie, so 401 — the point is that it is not 503.
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "SESSION_REQUIRED");
});

test("without a database the panel still says so", async () => {
  const response = await handleListServers(new Request(`${origin}/api/servers`), {
    AUTH_SECRET: "s".repeat(32),
    APP_ORIGIN: origin,
  });

  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "PANEL_NOT_CONFIGURED");
});

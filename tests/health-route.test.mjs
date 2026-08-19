import assert from "node:assert/strict";
import test from "node:test";
import { createHealthResponse } from "../app/api/health/route.ts";

const liveEnvironment = {
  APP_ORIGIN: "https://riftory.example",
  DATABASE_URL: "postgresql://riftory:secret@database.internal:5432/riftory",
  AUTH_SECRET: "s".repeat(32),
  EMAIL_FROM: "hello@riftory.example",
  RESEND_API_KEY: "re_12345678901234567890",
};

test("reports ok only when the database actually answers", async () => {
  const healthy = await createHealthResponse(liveEnvironment, { checkDatabase: async () => true });
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), {
    status: "ok",
    database: true,
    auth: { configured: true, magicLink: true, discord: false },
  });
});

test("stays reachable but degraded when the database is down", async () => {
  const degraded = await createHealthResponse(liveEnvironment, { checkDatabase: async () => false });

  // A transient database failure must not make the platform replace a process
  // that can still serve the public site.
  assert.equal(degraded.status, 200);
  assert.equal((await degraded.json()).status, "degraded");
});

test("never returns secret values", async () => {
  const response = await createHealthResponse(liveEnvironment, { checkDatabase: async () => true });
  const body = await response.text();

  assert.doesNotMatch(body, /re_12345678901234567890|database\.internal|ssssssss/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("separates configuration readiness from database reachability", async () => {
  const unconfigured = await createHealthResponse({}, { checkDatabase: async () => false });
  assert.deepEqual(await unconfigured.json(), {
    status: "degraded",
    database: false,
    auth: { configured: false, magicLink: false, discord: false },
  });
});

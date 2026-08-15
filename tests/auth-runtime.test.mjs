import assert from "node:assert/strict";
import test from "node:test";
import {
  getAuthRuntimeReadiness,
  publicAuthRuntimeStatus,
} from "../lib/auth-runtime.ts";
import { createAuthStatusResponse } from "../app/api/auth/status/route.ts";

const configuredEmailEnvironment = {
  DATABASE_URL: "postgresql://riftory:secret@database.internal:5432/riftory",
  AUTH_SECRET: "s".repeat(32),
  EMAIL_FROM: "Riftory <hello@riftory.example>",
  RESEND_API_KEY: "re_12345678901234567890",
};

test("keeps live authentication disabled when runtime variables are absent", () => {
  const status = getAuthRuntimeReadiness({});
  assert.equal(status.ready, false);
  assert.equal(status.checks.database, false);
  assert.equal(status.checks.magicLink, false);
  assert.ok(status.missing.includes("DATABASE_URL"));
  assert.ok(status.missing.includes("RESEND_API_KEY_OR_POSTMARK_SERVER_TOKEN"));
});

test("requires a PostgreSQL URL, 32-byte secret and a complete email provider", () => {
  const ready = getAuthRuntimeReadiness(configuredEmailEnvironment);
  assert.equal(ready.checks.database, true);
  assert.equal(ready.checks.sessionSecret, true);
  assert.equal(ready.checks.emailDelivery, true);
  assert.equal(ready.checks.magicLink, true);

  const weak = getAuthRuntimeReadiness({
    ...configuredEmailEnvironment,
    DATABASE_URL: "https://database.example",
    AUTH_SECRET: "too-short",
  });
  assert.equal(weak.checks.database, false);
  assert.equal(weak.checks.sessionSecret, false);
  assert.equal(weak.ready, false);
});

test("never returns environment secret values in the public readiness shape", async () => {
  const status = publicAuthRuntimeStatus(configuredEmailEnvironment);
  assert.doesNotMatch(JSON.stringify(status), /re_12345678901234567890|postgresql:\/\/riftory|ssssssss/);

  const response = createAuthStatusResponse(configuredEmailEnvironment);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = await response.text();
  assert.match(body, /"live":false/);
  assert.match(body, /"postgresAdapter":false/);
  assert.doesNotMatch(body, /re_12345678901234567890|database\.internal/);
});

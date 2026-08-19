import assert from "node:assert/strict";
import test from "node:test";
import { publicSessionView, readSessionToken } from "../lib/auth-session.ts";
import { SESSION_COOKIE_NAME } from "../lib/auth-security.ts";
import { resolveAuthService } from "../lib/auth-composition.ts";
import { getAuthRuntimeReadiness } from "../lib/auth-runtime.ts";

const TOKEN = "a".repeat(43);

function requestWithCookie(cookie) {
  return new Request("https://riftory.example/api/auth/session", {
    headers: cookie === null ? {} : { cookie },
  });
}

const liveEnvironment = {
  APP_ORIGIN: "https://riftory.example",
  DATABASE_URL: "postgresql://riftory:secret@database.internal:5432/riftory",
  AUTH_SECRET: "s".repeat(32),
  EMAIL_FROM: "hello@riftory.example",
  RESEND_API_KEY: "re_12345678901234567890",
};

test("reads only a well-formed host-only session cookie", () => {
  assert.equal(readSessionToken(requestWithCookie(null)), null);
  assert.equal(readSessionToken(requestWithCookie(`${SESSION_COOKIE_NAME}=${TOKEN}`)), TOKEN);
  assert.equal(readSessionToken(requestWithCookie(`theme=dark; ${SESSION_COOKIE_NAME}=${TOKEN}; locale=tr`)), TOKEN);
  assert.equal(readSessionToken(requestWithCookie(`${SESSION_COOKIE_NAME}=not-a-token`)), null);
  assert.equal(readSessionToken(requestWithCookie(`riftory_session=${TOKEN}`)), null);
});

test("ignores a malformed duplicate that would otherwise mask the real cookie", () => {
  const cookie = `${SESSION_COOKIE_NAME}=broken; ${SESSION_COOKIE_NAME}=${TOKEN}`;
  assert.equal(readSessionToken(requestWithCookie(cookie)), TOKEN);
});

test("exposes only the owner's own identity in the public session view", () => {
  const view = publicSessionView({
    sessionId: "session-id",
    sessionFamilyId: "family-id",
    userId: "user-id",
    email: "player@example.com",
    displayName: "Oyuncu",
    expiresAt: new Date("2026-09-14T12:00:00.000Z"),
  });

  assert.deepEqual(view, {
    authenticated: true,
    user: { displayName: "Oyuncu", email: "player@example.com" },
    session: { expiresAt: "2026-09-14T12:00:00.000Z" },
  });
  assert.doesNotMatch(JSON.stringify(view), /session-id|family-id|user-id/);
});

test("keeps the three composition outcomes distinct", () => {
  assert.deepEqual(resolveAuthService({}).status, "not_configured");
  assert.equal(resolveAuthService({ ...liveEnvironment, APP_ORIGIN: "" }).status, "not_configured");

  // A complete environment on a Node runtime binds the real driver.
  const live = resolveAuthService(liveEnvironment);
  assert.equal(live.status, "ready");
  assert.equal(typeof live.service.requestMagicLink, "function");

  // `adapter_not_bound` now means the runtime cannot host the driver at all.
  assert.equal(resolveAuthService(liveEnvironment, { repository: null }).status, "adapter_not_bound");
});

test("never reports readiness when the delivery origin is present but unusable", () => {
  const withPath = { ...liveEnvironment, APP_ORIGIN: "https://riftory.example/panel" };
  assert.equal(getAuthRuntimeReadiness(withPath).checks.appOrigin, false);
  assert.equal(resolveAuthService(withPath).status, "not_configured");
  assert.equal(resolveAuthService({ ...liveEnvironment, APP_ORIGIN: "http://riftory.example" }).status, "not_configured");
});

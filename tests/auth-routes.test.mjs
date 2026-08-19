import assert from "node:assert/strict";
import test from "node:test";
import { handleEmailAuthVerify } from "../app/api/auth/email/verify/route.ts";
import { handleSessionRead } from "../app/api/auth/session/route.ts";
import { handleSessionRefresh } from "../app/api/auth/session/refresh/route.ts";
import { handleSignOut } from "../app/api/auth/signout/route.ts";
import { handleDraftImport } from "../app/api/auth/drafts/import/route.ts";
import { AuthFlowError as ServiceFlowError } from "../lib/auth-service.ts";
import { DraftImportConflictError } from "../infra/postgres/auth-repository.ts";
import { DEFAULT_SERVER_DRAFT } from "../lib/catalog.ts";
import { AuthFlowError } from "../lib/auth-service.ts";
import { SESSION_COOKIE_NAME } from "../lib/auth-security.ts";

const origin = "https://riftory.example";
const environment = { APP_ORIGIN: origin };
const SESSION_TOKEN = "a".repeat(43);
const NEXT_TOKEN = "b".repeat(43);

const activeSession = {
  sessionId: "session-id",
  sessionFamilyId: "family-id",
  userId: "user-id",
  email: "player@example.com",
  displayName: "Oyuncu",
  expiresAt: new Date("2026-09-14T12:00:00.000Z"),
};

class FakeAuthService {
  consumed = [];
  rotated = [];
  signedOut = [];
  signedOutEverywhere = [];
  session = null;
  consumeError = null;

  async consumeMagicLink(input) {
    this.consumed.push(input);
    if (this.consumeError) throw this.consumeError;
    return { sessionToken: SESSION_TOKEN, userId: "user-id", sessionId: "session-id", returnTo: "/panel" };
  }

  async authenticateSession(rawToken) {
    return rawToken === SESSION_TOKEN ? this.session : null;
  }

  async rotateSession(input) {
    this.rotated.push(input);
    return this.session
      ? { sessionToken: NEXT_TOKEN, expiresAt: new Date("2026-09-20T12:00:00.000Z") }
      : null;
  }

  async signOut(input) {
    this.signedOut.push(input);
    return { signedOut: Boolean(this.session), revokedSessions: this.session ? 1 : 0 };
  }

  async signOutEverywhere(input) {
    this.signedOutEverywhere.push(input);
    return { signedOut: Boolean(this.session), revokedSessions: this.session ? 3 : 0 };
  }

  imports = [];
  importError = null;
  importReplay = false;

  async importDeviceDraft(input) {
    this.imports.push(input);
    if (this.importError) throw this.importError;
    return {
      code: this.importReplay ? "DRAFT_ALREADY_IMPORTED" : "DRAFT_IMPORTED",
      serverDraftId: "draft-id",
    };
  }
}

function mutation(path, body, options = {}) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      origin,
      "content-type": "application/json",
      ...(options.token ? { cookie: `${SESSION_COOKIE_NAME}=${options.token}` } : {}),
      ...options.headers,
    },
  });
}

function read(path, options = {}) {
  return new Request(`${origin}${path}`, {
    headers: options.token ? { cookie: `${SESSION_COOKIE_NAME}=${options.token}` } : {},
  });
}

test("consumes a link only on a same-origin request with a live adapter", async () => {
  const service = new FakeAuthService();

  const crossOrigin = await handleEmailAuthVerify(
    mutation("/api/auth/email/verify", { token: SESSION_TOKEN }, { headers: { origin: "https://evil.example" } }),
    environment,
    { service },
  );
  assert.equal(crossOrigin.status, 403);

  const unconfigured = await handleEmailAuthVerify(
    mutation("/api/auth/email/verify", { token: SESSION_TOKEN }),
    {},
  );
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).code, "AUTH_NOT_CONFIGURED");
  assert.equal(service.consumed.length, 0);
});

test("rejects a malformed token before any repository lookup", async () => {
  const service = new FakeAuthService();
  const response = await handleEmailAuthVerify(
    mutation("/api/auth/email/verify", { token: "short" }),
    environment,
    { service },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_OR_EXPIRED_LINK");
  assert.equal(service.consumed.length, 0);
});

test("issues a host-only session cookie and a safe return path", async () => {
  const service = new FakeAuthService();
  const response = await handleEmailAuthVerify(
    mutation("/api/auth/email/verify", { token: SESSION_TOKEN }, { headers: { "x-forwarded-for": "203.0.113.7" } }),
    environment,
    { service },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { code: "SESSION_CREATED", returnTo: "/panel" });

  const cookie = response.headers.get("set-cookie") ?? "";
  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=${SESSION_TOKEN};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.equal(service.consumed[0].clientDiscriminator, "203.0.113.7");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("passes a rate-limit decision through with a Retry-After header", async () => {
  const service = new FakeAuthService();
  service.consumeError = new AuthFlowError(429, "RATE_LIMITED", "Çok fazla deneme yapıldı.", 42);

  const response = await handleEmailAuthVerify(
    mutation("/api/auth/email/verify", { token: SESSION_TOKEN }),
    environment,
    { service },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal((await response.json()).code, "RATE_LIMITED");
});

test("answers the session endpoint without leaking session identifiers", async () => {
  const service = new FakeAuthService();

  const anonymous = await handleSessionRead(read("/api/auth/session"), environment, { service });
  assert.deepEqual(await anonymous.json(), { authenticated: false });
  assert.equal(anonymous.headers.get("set-cookie"), null);

  const stale = await handleSessionRead(read("/api/auth/session", { token: NEXT_TOKEN }), environment, { service });
  assert.deepEqual(await stale.json(), { authenticated: false });
  assert.match(stale.headers.get("set-cookie") ?? "", /Max-Age=0/);

  service.session = activeSession;
  const live = await handleSessionRead(read("/api/auth/session", { token: SESSION_TOKEN }), environment, { service });
  const body = await live.text();
  assert.match(body, /"displayName":"Oyuncu"/);
  assert.doesNotMatch(body, /session-id|family-id|user-id/);
  assert.match(live.headers.get("cache-control") ?? "", /no-store/);
});

test("rotates a live session and clears a dead one", async () => {
  const service = new FakeAuthService();

  const dead = await handleSessionRefresh(mutation("/api/auth/session/refresh", {}), environment, { service });
  assert.equal(dead.status, 401);
  assert.equal((await dead.json()).code, "SESSION_NOT_ACTIVE");
  assert.match(dead.headers.get("set-cookie") ?? "", /Max-Age=0/);

  service.session = activeSession;
  const rotated = await handleSessionRefresh(
    mutation("/api/auth/session/refresh", {}, { token: SESSION_TOKEN }),
    environment,
    { service },
  );
  assert.equal(rotated.status, 200);
  assert.equal((await rotated.json()).code, "SESSION_ROTATED");
  assert.ok((rotated.headers.get("set-cookie") ?? "").startsWith(`${SESSION_COOKIE_NAME}=${NEXT_TOKEN};`));
  assert.equal(service.rotated[0].rawToken, SESSION_TOKEN);
});

test("takes draft ownership from the session cookie, never from the request body", async () => {
  const service = new FakeAuthService();
  const body = { importKey: "6bde3a42-64c1-4c9f-8b0a-1ce9cd53c413", draft: DEFAULT_SERVER_DRAFT };

  const anonymous = await handleDraftImport(mutation("/api/auth/drafts/import", body), environment, { service });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).code, "SESSION_REQUIRED");
  assert.equal(service.imports.length, 0);

  const imported = await handleDraftImport(
    mutation("/api/auth/drafts/import", { ...body, ownerUserId: "someone-else" }, { token: SESSION_TOKEN }),
    environment,
    { service },
  );
  assert.equal(imported.status, 201);
  assert.deepEqual(await imported.json(), { code: "DRAFT_IMPORTED", serverDraftId: "draft-id" });
  assert.deepEqual(Object.keys(service.imports[0]).sort(), ["draft", "importKey", "rawToken"]);
  assert.equal(service.imports[0].rawToken, SESSION_TOKEN);
});

test("answers a replayed import with 200 and a changed payload with 409", async () => {
  const service = new FakeAuthService();
  const body = { importKey: "6bde3a42-64c1-4c9f-8b0a-1ce9cd53c413", draft: DEFAULT_SERVER_DRAFT };

  service.importReplay = true;
  const replay = await handleDraftImport(
    mutation("/api/auth/drafts/import", body, { token: SESSION_TOKEN }),
    environment,
    { service },
  );
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).code, "DRAFT_ALREADY_IMPORTED");

  service.importError = new DraftImportConflictError();
  const conflict = await handleDraftImport(
    mutation("/api/auth/drafts/import", body, { token: SESSION_TOKEN }),
    environment,
    { service },
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "DRAFT_IMPORT_CONFLICT");
});

test("rejects a malformed import envelope before reaching the repository", async () => {
  const service = new FakeAuthService();

  for (const body of [{ draft: DEFAULT_SERVER_DRAFT }, { importKey: "  " }, {}]) {
    const response = await handleDraftImport(
      mutation("/api/auth/drafts/import", body, { token: SESSION_TOKEN }),
      environment,
      { service },
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_DRAFT");
  }

  service.importError = new ServiceFlowError(400, "INVALID_DRAFT", "Sunucu taslağı geçersiz.");
  const invalidDraft = await handleDraftImport(
    mutation("/api/auth/drafts/import", { importKey: "not-a-uuid", draft: { gameId: "quake" } }, { token: SESSION_TOKEN }),
    environment,
    { service },
  );
  assert.equal(invalidDraft.status, 400);
});

test("always clears the browser cookie on sign-out and honours the requested scope", async () => {
  const service = new FakeAuthService();
  service.session = activeSession;

  const single = await handleSignOut(
    mutation("/api/auth/signout", {}, { token: SESSION_TOKEN }),
    environment,
    { service },
  );
  assert.equal(single.status, 200);
  assert.deepEqual(await single.json(), { code: "SIGNED_OUT", scope: "current", revokedSessions: 1 });
  assert.match(single.headers.get("set-cookie") ?? "", /Max-Age=0/);

  const everywhere = await handleSignOut(
    mutation("/api/auth/signout", { scope: "all" }, { token: SESSION_TOKEN }),
    environment,
    { service },
  );
  assert.equal((await everywhere.json()).revokedSessions, 3);
  assert.equal(service.signedOutEverywhere.length, 1);

  const withoutCookie = await handleSignOut(mutation("/api/auth/signout", {}), environment, { service });
  assert.deepEqual(await withoutCookie.json(), { code: "SIGNED_OUT", scope: "current", revokedSessions: 0 });
  assert.equal(service.signedOut.length, 1);

  const invalidScope = await handleSignOut(
    mutation("/api/auth/signout", { scope: "everyone" }, { token: SESSION_TOKEN }),
    environment,
    { service },
  );
  assert.equal(invalidScope.status, 400);
});

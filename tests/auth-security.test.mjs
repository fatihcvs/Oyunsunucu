import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_RATE_LIMIT_POLICIES,
  ResourceAccessError,
  SESSION_COOKIE_NAME,
  assertResourceOwner,
  buildExpiredSessionCookie,
  buildSessionCookie,
  createDeviceDraftImportCommand,
  createOpaqueToken,
  createRateLimitBucketKey,
  createSecretRateLimitBucketKey,
  evaluateFixedWindowRateLimit,
  isAllowedMutationOrigin,
  isSessionActive,
} from "../lib/auth-security.ts";
import { DEFAULT_SERVER_DRAFT } from "../lib/catalog.ts";

test("creates opaque 256-bit tokens and stores only a SHA-256 representation", async () => {
  const first = await createOpaqueToken();
  const second = await createOpaqueToken();

  assert.match(first.rawToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.rawToken, second.rawToken);
  assert.notEqual(first.tokenHash, first.rawToken);
});

test("builds host-only secure session cookies and a symmetric logout cookie", () => {
  const rawToken = "a".repeat(43);
  const cookie = buildSessionCookie(rawToken, new Date("2026-08-15T00:00:00Z"));
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=${rawToken};`));
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.match(buildExpiredSessionCookie(), /Max-Age=0/);
  assert.throws(() => buildSessionCookie("header\r\ninjection"), TypeError);
});

test("rejects expired or revoked sessions", () => {
  const now = new Date("2026-08-15T00:00:00Z");
  assert.equal(isSessionActive({ expiresAt: "2026-08-16T00:00:00Z" }, now), true);
  assert.equal(isSessionActive({ expiresAt: "2026-08-14T00:00:00Z" }, now), false);
  assert.equal(isSessionActive({ expiresAt: "2026-08-16T00:00:00Z", revokedAt: now }, now), false);
});

test("hides foreign resources behind the same not-found response", () => {
  assert.doesNotThrow(() => assertResourceOwner("user-a", "user-a"));
  for (const actor of ["user-b", null, undefined]) {
    assert.throws(() => assertResourceOwner(actor, "user-a"), (error) => {
      assert.equal(error instanceof ResourceAccessError, true);
      assert.equal(error.status, 404);
      assert.equal(error.code, "RESOURCE_NOT_FOUND");
      return true;
    });
  }
});

test("accepts only explicitly allowed mutation origins", () => {
  const allowed = ["https://riftory.com", "https://panel.riftory.com"];
  assert.equal(isAllowedMutationOrigin("https://riftory.com", allowed), true);
  assert.equal(isAllowedMutationOrigin("https://evil.example", allowed), false);
  assert.equal(isAllowedMutationOrigin("https://riftory.com.evil.example", allowed), false);
  assert.equal(isAllowedMutationOrigin(null, allowed), false);
});

test("blocks attempts after the configured fixed-window limit", () => {
  const policy = AUTH_RATE_LIMIT_POLICIES.magicLink;
  let state = null;
  const startedAt = Date.parse("2026-08-15T00:00:00Z");

  for (let index = 0; index < policy.maxAttempts; index += 1) {
    const decision = evaluateFixedWindowRateLimit(state, policy, startedAt + index);
    assert.equal(decision.allowed, true);
    state = decision.nextState;
  }

  const blocked = evaluateFixedWindowRateLimit(state, policy, startedAt + 10);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterMs, policy.blockMs);
});

test("hashes rate-limit identities and produces idempotent draft import commands", async () => {
  const bucket = await createRateLimitBucketKey("magic-link", " Player@Example.com ");
  assert.match(bucket, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(bucket, /player/i);

  const input = {
    actorUserId: "d9d47d02-73c4-4d20-86f8-91b8c846ff25",
    importKey: "6bde3a42-64c1-4c9f-8b0a-1ce9cd53c413",
    draft: DEFAULT_SERVER_DRAFT,
  };
  const first = await createDeviceDraftImportCommand(input);
  const replay = await createDeviceDraftImportCommand(input);
  assert.deepEqual(first, replay);
  assert.equal(first?.ownerUserId, input.actorUserId);
  assert.equal(await createDeviceDraftImportCommand({ ...input, importKey: "bad" }), null);
  assert.equal(await createDeviceDraftImportCommand({ ...input, draft: { ...DEFAULT_SERVER_DRAFT, gameId: "rust" } }), null);
});

test("peppers persistent rate-limit buckets with a 32-byte application secret", async () => {
  const discriminator = "player@example.com|203.0.113.7";
  const first = await createSecretRateLimitBucketKey("a".repeat(32), "magic-link", discriminator);
  const second = await createSecretRateLimitBucketKey("b".repeat(32), "magic-link", discriminator);

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /player/i);
  await assert.rejects(
    () => createSecretRateLimitBucketKey("short", "magic-link", discriminator),
    TypeError,
  );
});

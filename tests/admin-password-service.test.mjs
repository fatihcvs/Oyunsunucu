import assert from "node:assert/strict";
import test from "node:test";
import { createAdminPasswordService } from "../lib/admin-password-service.ts";
import { createAdminPasswordHash, verifyAdminPassword } from "../lib/auth-security.ts";

const NOW = new Date("2026-08-16T20:00:00.000Z");
const EMAIL = "fatihcvs55@gmail.com";
const PASSWORD = "correct horse battery staple";
const BOOTSTRAP_HASH = await createAdminPasswordHash(PASSWORD, { iterations: 210_000 });
const OWN_PASSWORD = "kendi parolam 2026";
const OWN_HASH = await createAdminPasswordHash(OWN_PASSWORD, { iterations: 210_000 });
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_TOKEN = "t".repeat(43);

function build(overrides = {}) {
  const sessions = [];
  const changes = [];
  let rateLimitInput;
  const repository = {
    async findPasswordIdentity() {
      return { userId: USER_ID, role: "operator", passwordHash: null };
    },
    async openPasswordSession(input) {
      sessions.push(input);
      return { role: "operator" };
    },
    async findCredential() {
      return { role: "operator", passwordHash: null };
    },
    async changePassword(input) {
      changes.push(input);
      return { status: "changed", revokedSessions: 2 };
    },
    ...(overrides.repository ?? {}),
  };
  const service = createAdminPasswordService({
    bootstrapEmail: EMAIL,
    bootstrapPasswordHash: BOOTSTRAP_HASH,
    rateLimitSecret: "s".repeat(32),
    now: () => NOW,
    auth: {
      async authenticateSession() {
        return { sessionId: "s1", sessionFamilyId: "f1", userId: USER_ID, email: EMAIL, displayName: "Admin", expiresAt: NOW };
      },
    },
    rateLimiter: {
      async takeRateLimit(input) {
        rateLimitInput = input;
        return { allowed: true, remaining: 4, retryAfterMs: 0, nextState: { attempts: 1, windowStartedAtMs: NOW.getTime(), blockedUntilMs: null } };
      },
    },
    ...overrides,
    repository,
  });
  return { service, sessions, changes, getRateLimitInput: () => rateLimitInput };
}

test("opens a normal hashed session for the bootstrap identity while it has no stored password", async () => {
  const { service, sessions, getRateLimitInput } = build();
  const result = await service.signIn({
    email: "  FATIHCVS55@gmail.com ",
    password: PASSWORD,
    clientDiscriminator: "203.0.113.8",
    ipAddress: "203.0.113.8",
    userAgent: "test-agent",
  });

  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.role, "operator");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].userId, USER_ID);
  assert.match(sessions[0].sessionTokenHash, /^[a-f0-9]{64}$/);
  assert.equal("password" in sessions[0], false);
  assert.equal(getRateLimitInput().scope, "admin-password");
  assert.doesNotMatch(getRateLimitInput().bucketHash, /203\.0\.113\.8/);
});

test("prefers the stored password over the bootstrap one once it exists", async () => {
  const { service, sessions } = build({
    repository: {
      async findPasswordIdentity() {
        return { userId: USER_ID, role: "owner", passwordHash: OWN_HASH };
      },
      async openPasswordSession(input) {
        sessions.push(input);
        return { role: "owner" };
      },
    },
  });

  const result = await service.signIn({ email: EMAIL, password: OWN_PASSWORD, clientDiscriminator: "client" });
  assert.equal(result.role, "owner");

  // The environment credential stops working for an account that set its own.
  await assert.rejects(
    () => service.signIn({ email: EMAIL, password: PASSWORD, clientDiscriminator: "client" }),
    (error) => error.status === 401 && error.code === "ADMIN_CREDENTIALS_REJECTED",
  );
});

test("refuses the bootstrap password for an admin who is not the bootstrap identity", async () => {
  const { service, sessions } = build({
    repository: {
      async findPasswordIdentity() {
        return { userId: USER_ID, role: "support", passwordHash: null };
      },
    },
  });

  await assert.rejects(
    () => service.signIn({ email: "baska@example.com", password: PASSWORD, clientDiscriminator: "client" }),
    (error) => error.status === 401 && error.code === "ADMIN_CREDENTIALS_REJECTED",
  );
  assert.equal(sessions.length, 0);
});

test("uses the same public rejection for a wrong email, password, or missing membership", async () => {
  for (const input of [
    { email: "not-an-email", password: PASSWORD },
    { email: EMAIL, password: "wrong password" },
  ]) {
    const { service, sessions } = build();
    await assert.rejects(
      () => service.signIn({ ...input, clientDiscriminator: "client" }),
      (error) => error.status === 401 && error.code === "ADMIN_CREDENTIALS_REJECTED",
    );
    assert.equal(sessions.length, 0);
  }

  const { service } = build({ repository: { async findPasswordIdentity() { return null; } } });
  await assert.rejects(
    () => service.signIn({ email: EMAIL, password: PASSWORD, clientDiscriminator: "client" }),
    (error) => error.status === 401 && error.code === "ADMIN_CREDENTIALS_REJECTED",
  );
});

test("stops before password verification when the persistent bucket is blocked", async () => {
  const { service } = build({
    rateLimiter: {
      async takeRateLimit() {
        return { allowed: false, remaining: 0, retryAfterMs: 90_000, nextState: { attempts: 6, windowStartedAtMs: NOW.getTime(), blockedUntilMs: NOW.getTime() + 90_000 } };
      },
    },
  });
  await assert.rejects(
    () => service.signIn({ email: EMAIL, password: PASSWORD, clientDiscriminator: "client" }),
    (error) => error.status === 429 && error.retryAfterSeconds === 90,
  );
});

test("stores a new verifier and keeps only the session that changed it", async () => {
  const { service, changes } = build();
  const result = await service.changePassword({
    rawToken: SESSION_TOKEN,
    currentPassword: PASSWORD,
    newPassword: "yeni parola 2026",
  });

  assert.equal(result.changed, true);
  assert.equal(result.revokedSessions, 2);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].userId, USER_ID);
  assert.match(changes[0].keepSessionTokenHash, /^[a-f0-9]{64}$/);
  assert.match(changes[0].passwordHash, /^pbkdf2-sha256\$\d+\$/);
  assert.equal(await verifyAdminPassword("yeni parola 2026", changes[0].passwordHash), true);
  assert.equal(await verifyAdminPassword(PASSWORD, changes[0].passwordHash), false);
  assert.equal(JSON.stringify(changes[0]).includes("yeni parola 2026"), false);
});

test("refuses a password change that cannot prove the current password", async () => {
  const { service, changes } = build();
  await assert.rejects(
    () => service.changePassword({ rawToken: SESSION_TOKEN, currentPassword: "yanlış", newPassword: "yeni parola 2026" }),
    (error) => error.status === 401 && error.code === "CURRENT_PASSWORD_REJECTED",
  );
  assert.equal(changes.length, 0);
});

test("refuses a weak, unchanged or non-string new password", async () => {
  for (const [newPassword, code] of [
    ["kısa", "WEAK_PASSWORD"],
    [" boşluklu parola ", "WEAK_PASSWORD"],
    [null, "WEAK_PASSWORD"],
    [PASSWORD, "PASSWORD_UNCHANGED"],
  ]) {
    const { service, changes } = build();
    await assert.rejects(
      () => service.changePassword({ rawToken: SESSION_TOKEN, currentPassword: PASSWORD, newPassword }),
      (error) => error.code === code && error.status === 400,
    );
    assert.equal(changes.length, 0);
  }
});

test("a caller without a session or without a membership cannot change the password", async () => {
  const signedOut = build({ auth: { async authenticateSession() { return null; } } });
  await assert.rejects(
    () => signedOut.service.changePassword({ rawToken: SESSION_TOKEN, currentPassword: PASSWORD, newPassword: "yeni parola 2026" }),
    (error) => error.status === 401 && error.code === "SESSION_REQUIRED",
  );

  const notAdmin = build({ repository: { async findCredential() { return null; } } });
  await assert.rejects(
    () => notAdmin.service.changePassword({ rawToken: SESSION_TOKEN, currentPassword: PASSWORD, newPassword: "yeni parola 2026" }),
    (error) => error.status === 403 && error.code === "ADMIN_REQUIRED",
  );
});

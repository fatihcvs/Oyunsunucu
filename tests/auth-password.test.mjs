import assert from "node:assert/strict";
import test from "node:test";
import { createAuthService } from "../lib/auth-service.ts";
import { createPasswordHash, verifyPassword } from "../lib/auth-security.ts";

const NOW = new Date("2026-08-19T12:00:00.000Z");
const EMAIL = "oyuncu@example.com";
const PASSWORD = "cok gizli parola";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const STORED_HASH = await createPasswordHash(PASSWORD, { iterations: 210_000 });

function build({ repository = {}, rateLimited = false } = {}) {
  const registered = [];
  const opened = [];
  const service = createAuthService({
    appOrigin: "https://riftory.example",
    rateLimitSecret: "s".repeat(32),
    now: () => NOW,
    repository: {
      async takeRateLimit() {
        return rateLimited
          ? { allowed: false, remaining: 0, retryAfterMs: 60_000, nextState: { attempts: 11, windowStartedAtMs: NOW.getTime(), blockedUntilMs: NOW.getTime() + 60_000 } }
          : { allowed: true, remaining: 9, retryAfterMs: 0, nextState: { attempts: 1, windowStartedAtMs: NOW.getTime(), blockedUntilMs: null } };
      },
      async registerWithPassword(input) {
        registered.push(input);
        return {
          userId: USER_ID,
          sessionId: "session-1",
          sessionFamilyId: "family-1",
          email: input.email,
          displayName: input.displayName,
          returnTo: "/panel",
        };
      },
      async findPasswordAccount() {
        return { userId: USER_ID, passwordHash: STORED_HASH, displayName: "Oyuncu" };
      },
      async openPasswordAccountSession(input) {
        opened.push(input);
        return {
          userId: USER_ID,
          sessionId: "session-2",
          sessionFamilyId: "family-2",
          email: EMAIL,
          displayName: "Oyuncu",
          returnTo: "/panel",
        };
      },
      ...repository,
    },
  });
  return { service, registered, opened };
}

const CLIENT = { clientDiscriminator: "203.0.113.9", ipAddress: "203.0.113.9", userAgent: "test" };

test("registration stores only a verifier and signs the customer straight in", async () => {
  const { service, registered } = build();
  const result = await service.registerWithPassword({
    ...CLIENT,
    email: "  OYUNCU@example.com ",
    password: PASSWORD,
    displayName: "  Oyuncu  ",
  });

  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.returnTo, "/panel");
  assert.equal(registered.length, 1);
  assert.equal(registered[0].email, EMAIL);
  assert.equal(registered[0].displayName, "Oyuncu");
  assert.match(registered[0].passwordHash, /^pbkdf2-sha256\$\d+\$/);
  assert.equal(await verifyPassword(PASSWORD, registered[0].passwordHash), true);
  // The plaintext never reaches the repository.
  assert.equal(JSON.stringify(registered[0]).includes(PASSWORD), false);
});

test("a weak password, bad address or missing name never reaches the database", async () => {
  const cases = [
    { email: EMAIL, password: "kisa", displayName: "Oyuncu", code: "WEAK_PASSWORD" },
    { email: EMAIL, password: " boşluklu parola ", displayName: "Oyuncu", code: "WEAK_PASSWORD" },
    { email: "gecersiz", password: PASSWORD, displayName: "Oyuncu", code: "INVALID_EMAIL" },
    { email: EMAIL, password: PASSWORD, displayName: "x", code: "INVALID_DISPLAY_NAME" },
  ];
  for (const input of cases) {
    const { service, registered } = build();
    await assert.rejects(
      () => service.registerWithPassword({ ...CLIENT, ...input }),
      (error) => error.status === 400 && error.code === input.code,
    );
    assert.equal(registered.length, 0);
  }
});

test("an address that already has an account is told to sign in instead", async () => {
  const { service } = build({ repository: { async registerWithPassword() { return { taken: true }; } } });
  await assert.rejects(
    () => service.registerWithPassword({ ...CLIENT, email: EMAIL, password: PASSWORD, displayName: "Oyuncu" }),
    (error) => error.status === 409 && error.code === "EMAIL_TAKEN",
  );
});

test("sign-in opens a session for the right password only", async () => {
  const { service, opened } = build();
  const result = await service.signInWithPassword({ ...CLIENT, email: EMAIL, password: PASSWORD });

  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].userId, USER_ID);
  assert.match(opened[0].sessionTokenHash, /^[a-f0-9]{64}$/);
});

test("a wrong password and an unknown address answer identically", async () => {
  const wrongPassword = build();
  await assert.rejects(
    () => wrongPassword.service.signInWithPassword({ ...CLIENT, email: EMAIL, password: "yanlış parola" }),
    (error) => error.status === 401 && error.code === "CREDENTIALS_REJECTED",
  );
  assert.equal(wrongPassword.opened.length, 0);

  const unknown = build({ repository: { async findPasswordAccount() { return null; } } });
  await assert.rejects(
    () => unknown.service.signInWithPassword({ ...CLIENT, email: "yok@example.com", password: PASSWORD }),
    (error) => error.status === 401 && error.code === "CREDENTIALS_REJECTED",
  );
  assert.equal(unknown.opened.length, 0);
});

test("the rate limiter guards both paths before any password work", async () => {
  for (const call of ["registerWithPassword", "signInWithPassword"]) {
    const { service, registered, opened } = build({ rateLimited: true });
    await assert.rejects(
      () => service[call]({ ...CLIENT, email: EMAIL, password: PASSWORD, displayName: "Oyuncu" }),
      (error) => error.status === 429 && error.code === "RATE_LIMITED",
    );
    assert.equal(registered.length + opened.length, 0);
  }
});

test("a database outage is an honest 503, not a rejected credential", async () => {
  const { service } = build({
    repository: { async findPasswordAccount() { throw new Error("bağlantı yok"); } },
  });
  await assert.rejects(
    () => service.signInWithPassword({ ...CLIENT, email: EMAIL, password: PASSWORD }),
    (error) => error.status === 503 && error.code === "AUTH_UNAVAILABLE",
  );
});

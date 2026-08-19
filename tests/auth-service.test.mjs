import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthFlowError,
  MAGIC_LINK_ACCEPTED_MESSAGE,
  createAuthService,
} from "../lib/auth-service.ts";
import { sha256Hex } from "../lib/auth-security.ts";

class FakeRepository {
  challenges = [];
  delivered = [];
  failed = [];
  exchanges = [];
  sessionLookups = [];
  exchangeResult = null;
  sessionResult = null;
  rateDecision = {
    allowed: true,
    remaining: 4,
    retryAfterMs: 0,
    nextState: { attempts: 1, windowStartedAtMs: 0, blockedUntilMs: null },
  };

  async takeRateLimit(input) {
    this.rateInput = input;
    return this.rateDecision;
  }

  async createMagicLinkChallenge(input) {
    this.challenges.push(input);
    return `challenge-${this.challenges.length}`;
  }

  async markMagicLinkDelivered(id) {
    this.delivered.push(id);
    return true;
  }

  async markMagicLinkDeliveryFailed(id) {
    this.failed.push(id);
    return true;
  }

  async exchangeMagicLink(input) {
    this.exchanges.push(input);
    return this.exchangeResult;
  }

  async findActiveSession(tokenHash) {
    this.sessionLookups.push(tokenHash);
    return this.sessionResult;
  }

  rotations = [];
  revocations = [];
  globalRevocations = [];
  rotationResult = null;

  async rotateSession(input) {
    this.rotations.push(input);
    return this.rotationResult;
  }

  async revokeSession(sessionId, actorUserId) {
    this.revocations.push({ sessionId, actorUserId });
    return true;
  }

  async revokeAllUserSessions(actorUserId) {
    this.globalRevocations.push(actorUserId);
    return 4;
  }

  reuseChecks = [];
  reuseResult = null;

  async revokeSessionFamilyOnReuse(tokenHash) {
    this.reuseChecks.push(tokenHash);
    return this.reuseResult;
  }
}

class FakeMailer {
  deliveries = [];
  error = null;

  async sendMagicLink(input) {
    this.deliveries.push(input);
    if (this.error) throw this.error;
  }
}

function setup(overrides = {}) {
  const repository = overrides.repository ?? new FakeRepository();
  const mailer = overrides.mailer ?? new FakeMailer();
  const operationalErrors = [];
  const service = createAuthService({
    repository,
    mailer,
    appOrigin: "https://riftory.example",
    rateLimitSecret: "r".repeat(32),
    now: () => new Date("2026-08-15T12:00:00.000Z"),
    onOperationalError: (error) => operationalErrors.push(error),
  });
  return { service, repository, mailer, operationalErrors };
}

test("returns the same enumeration-safe result for sign-in and registration", async () => {
  const { service } = setup();
  const signin = await service.requestMagicLink({
    mode: "signin",
    email: "player@example.com",
    returnTo: "/panel",
    clientDiscriminator: "203.0.113.7",
  });
  const register = await service.requestMagicLink({
    mode: "register",
    email: "new-player@example.com",
    displayName: "Yeni Oyuncu",
    returnTo: "/panel",
    clientDiscriminator: "203.0.113.8",
  });

  assert.deepEqual(signin, register);
  assert.deepEqual(signin, {
    accepted: true,
    code: "MAGIC_LINK_ACCEPTED",
    message: MAGIC_LINK_ACCEPTED_MESSAGE,
  });
  assert.doesNotMatch(JSON.stringify(signin), /player@example\.com/);
});

test("persists only a hash while delivering the raw one-time token", async () => {
  const { service, repository, mailer } = setup();
  await service.requestMagicLink({
    mode: "register",
    email: " PLAYER@EXAMPLE.COM ",
    displayName: "  Riftory   Oyuncusu ",
    returnTo: "/hesap",
    clientDiscriminator: "browser-a",
  });

  assert.equal(repository.challenges.length, 1);
  const challenge = repository.challenges[0];
  const delivery = mailer.deliveries[0];
  const rawToken = new URL(delivery.link).searchParams.get("token");
  assert.match(rawToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge.tokenHash, await sha256Hex(rawToken));
  assert.notEqual(challenge.tokenHash, rawToken);
  assert.equal(challenge.email, "player@example.com");
  assert.equal(challenge.displayName, "Riftory Oyuncusu");
  assert.equal(repository.delivered[0], "challenge-1");
  assert.match(repository.rateInput.bucketHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(repository.rateInput.bucketHash, /player/i);
});

test("revokes an unusable challenge without exposing a mail-provider failure", async () => {
  const mailer = new FakeMailer();
  mailer.error = new Error("provider unavailable");
  const { service, repository, operationalErrors } = setup({ mailer });

  const result = await service.requestMagicLink({
    mode: "signin",
    email: "player@example.com",
    clientDiscriminator: "browser-a",
  });
  assert.equal(result.code, "MAGIC_LINK_ACCEPTED");
  assert.deepEqual(repository.delivered, []);
  assert.deepEqual(repository.failed, ["challenge-1"]);
  assert.equal(operationalErrors.length, 1);
});

test("enforces a persistent rate-limit decision before creating a token", async () => {
  const repository = new FakeRepository();
  repository.rateDecision = {
    allowed: false,
    remaining: 0,
    retryAfterMs: 30_000,
    nextState: { attempts: 6, windowStartedAtMs: 0, blockedUntilMs: 30_000 },
  };
  const { service, mailer } = setup({ repository });

  await assert.rejects(
    () => service.requestMagicLink({
      mode: "signin",
      email: "player@example.com",
      clientDiscriminator: "browser-a",
    }),
    (error) => {
      assert.equal(error instanceof AuthFlowError, true);
      assert.equal(error.status, 429);
      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.retryAfterSeconds, 30);
      return true;
    },
  );
  assert.equal(repository.challenges.length, 0);
  assert.equal(mailer.deliveries.length, 0);
});

test("rejects invalid, expired and replayed links with the same public error", async () => {
  const { service, repository } = setup();

  await assert.rejects(
    () => service.consumeMagicLink({ rawToken: "invalid" }),
    (error) => error.code === "INVALID_OR_EXPIRED_LINK" && error.status === 400,
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => service.consumeMagicLink({ rawToken: "a".repeat(43) }),
      (error) => error.code === "INVALID_OR_EXPIRED_LINK" && error.status === 400,
    );
  }
  assert.equal(repository.exchanges.length, 2);
});

test("returns a raw session only after the repository atomically exchanges hashes", async () => {
  const { service, repository } = setup();
  repository.exchangeResult = {
    userId: "user-id",
    sessionId: "session-id",
    sessionFamilyId: "family-id",
    email: "player@example.com",
    displayName: "Oyuncu",
    returnTo: "//evil.example",
  };
  const rawChallenge = "b".repeat(43);
  const result = await service.consumeMagicLink({
    rawToken: rawChallenge,
    userAgent: `  ${"browser".repeat(100)}  `,
  });

  const exchange = repository.exchanges[0];
  assert.equal(exchange.challengeTokenHash, await sha256Hex(rawChallenge));
  assert.notEqual(exchange.sessionTokenHash, result.sessionToken);
  assert.equal(exchange.sessionTokenHash, await sha256Hex(result.sessionToken));
  assert.equal(exchange.userAgent.length, 512);
  assert.equal(result.returnTo, "/panel");
});

test("blocks link-guessing attempts before comparing any token hash", async () => {
  const repository = new FakeRepository();
  repository.rateDecision = {
    allowed: false,
    remaining: 0,
    retryAfterMs: 61_000,
    nextState: { attempts: 11, windowStartedAtMs: 0, blockedUntilMs: 61_000 },
  };
  const { service } = setup({ repository });

  await assert.rejects(
    () => service.consumeMagicLink({ rawToken: "d".repeat(43), clientDiscriminator: "203.0.113.7" }),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 61);
      return true;
    },
  );
  assert.equal(repository.exchanges.length, 0);
  assert.equal(repository.rateInput.scope, "magic-link-callback");
  assert.doesNotMatch(repository.rateInput.bucketHash, /203\.0\.113\.7/);
});

test("rotates a live session into a fresh token without reusing the presented one", async () => {
  const { service, repository } = setup();
  repository.sessionResult = {
    sessionId: "session-id",
    sessionFamilyId: "family-id",
    userId: "user-id",
    email: "player@example.com",
    displayName: "Oyuncu",
    expiresAt: new Date("2026-09-14T12:00:00Z"),
  };
  repository.rotationResult = {
    sessionId: "next-session-id",
    sessionFamilyId: "family-id",
    expiresAt: new Date("2026-09-14T12:00:00Z"),
  };

  const presented = "e".repeat(43);
  const rotated = await service.rotateSession({ rawToken: presented, ipAddress: "203.0.113.7" });
  const command = repository.rotations[0];

  assert.notEqual(rotated.sessionToken, presented);
  assert.match(rotated.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(command.sessionId, "session-id");
  assert.equal(command.actorUserId, "user-id");
  assert.equal(command.sessionTokenHash, await sha256Hex(rotated.sessionToken));
  assert.notEqual(command.sessionTokenHash, rotated.sessionToken);

  repository.sessionResult = null;
  assert.equal(await service.rotateSession({ rawToken: presented }), null);
});

test("revokes one device or every device only for the presented owner", async () => {
  const { service, repository } = setup();
  const rawToken = "f".repeat(43);

  assert.deepEqual(await service.signOut({ rawToken }), { signedOut: false, revokedSessions: 0 });
  assert.deepEqual(repository.revocations, []);

  repository.sessionResult = {
    sessionId: "session-id",
    sessionFamilyId: "family-id",
    userId: "user-id",
    email: "player@example.com",
    displayName: "Oyuncu",
    expiresAt: new Date("2026-09-14T12:00:00Z"),
  };
  assert.deepEqual(await service.signOut({ rawToken }), { signedOut: true, revokedSessions: 1 });
  assert.deepEqual(repository.revocations, [{ sessionId: "session-id", actorUserId: "user-id" }]);

  assert.deepEqual(await service.signOutEverywhere({ rawToken }), { signedOut: true, revokedSessions: 4 });
  assert.deepEqual(repository.globalRevocations, ["user-id"]);
});

test("burns the session family when a replaced token comes back", async () => {
  const { service, repository } = setup();
  repository.sessionResult = null;
  repository.reuseResult = { familyId: "family-id", userId: "user-id", revokedSessions: 2 };

  const replayed = "d".repeat(43);
  assert.equal(await service.authenticateSession(replayed), null);
  assert.deepEqual(repository.reuseChecks, [await sha256Hex(replayed)]);

  // A live session must never trigger the reuse path.
  repository.sessionResult = {
    sessionId: "session-id",
    sessionFamilyId: "family-id",
    userId: "user-id",
    email: "player@example.com",
    displayName: "Oyuncu",
    expiresAt: new Date("2026-09-14T12:00:00Z"),
  };
  await service.authenticateSession("e".repeat(43));
  assert.equal(repository.reuseChecks.length, 1);
});

test("a failing reuse check never turns into a failed sign-in", async () => {
  const repository = new FakeRepository();
  repository.revokeSessionFamilyOnReuse = async () => { throw new Error("veritabani hatasi"); };
  const { service, operationalErrors } = setup({ repository });

  assert.equal(await service.authenticateSession("f".repeat(43)), null);
  assert.equal(operationalErrors.length, 1);
});

test("hashes browser session tokens before lookup", async () => {
  const { service, repository } = setup();
  repository.sessionResult = {
    sessionId: "session-id",
    sessionFamilyId: "family-id",
    userId: "user-id",
    email: "player@example.com",
    displayName: "Oyuncu",
    expiresAt: new Date("2026-08-16T00:00:00Z"),
  };
  const rawToken = "c".repeat(43);
  assert.equal((await service.authenticateSession(rawToken)).userId, "user-id");
  assert.equal(repository.sessionLookups[0], await sha256Hex(rawToken));
  assert.equal(await service.authenticateSession("invalid"), null);
});

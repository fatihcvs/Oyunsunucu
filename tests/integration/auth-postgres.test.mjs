import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { createNodePostgresDatabase } from "../../infra/postgres/node-pg-executor.ts";
import { loadMigrations } from "../../infra/postgres/node-migration-source.ts";
import { readAppliedMigrations, runMigrations } from "../../infra/postgres/migration-runner.ts";
import { PostgresAuthRepository, DraftImportConflictError } from "../../infra/postgres/auth-repository.ts";
import { AUTH_RATE_LIMIT_POLICIES, createOpaqueToken, sha256Hex } from "../../lib/auth-security.ts";
import { createAuthService } from "../../lib/auth-service.ts";
import { CATALOG_VERSION, DEFAULT_SERVER_DRAFT } from "../../lib/catalog.ts";

const connectionString = process.env.TEST_DATABASE_URL?.trim();
const skip = connectionString
  ? false
  : "TEST_DATABASE_URL tanımlı değil; PostgreSQL entegrasyon testleri atlandı.";

// Relative to the real clock: rows carry a database-side `created_at`, and every
// table checks `expires_at > created_at`. A hard-coded instant silently starts
// failing the moment the wall clock passes it.
const now = new Date();
const later = new Date(now.getTime() + 5 * 60_000);
const sessionExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60_000);

let database;
let repository;

before(async () => {
  if (skip) return;
  database = createNodePostgresDatabase({ connectionString });
  repository = new PostgresAuthRepository(database);
  const migrations = await loadMigrations();
  await database.session((session) => runMigrations(session, migrations));
});

after(async () => {
  if (database) await database.close();
});

beforeEach(async () => {
  if (skip) return;
  await database.query(
    "TRUNCATE users, auth_accounts, auth_sessions, verification_tokens, consents, server_drafts, draft_import_receipts, audit_logs, auth_rate_limits, oauth_states RESTART IDENTITY CASCADE",
  );
});

async function createChallenge(overrides = {}) {
  const token = await createOpaqueToken();
  const challengeId = await repository.createMagicLinkChallenge({
    purpose: "verify_email",
    email: "player@example.com",
    tokenHash: token.tokenHash,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    returnTo: "/panel",
    displayName: "Riftory Oyuncusu",
    consentVersion: "kvkk-iletisim-v1-2026-08-14",
    requestedIp: "203.0.113.7",
    ...overrides,
  });
  return { ...token, challengeId };
}

function exchangeInput(challengeTokenHash, sessionTokenHash, at = now) {
  return {
    challengeTokenHash,
    sessionTokenHash,
    sessionExpiresAt: sessionExpiry,
    now: at,
    ipAddress: "203.0.113.7",
    userAgent: "integration test",
  };
}

test("applies every migration once and records a stable checksum", { skip }, async () => {
  const migrations = await loadMigrations();
  const rerun = await database.session((session) => runMigrations(session, migrations));

  assert.deepEqual(rerun.applied, []);
  assert.deepEqual(rerun.skipped, migrations.map((migration) => migration.id));

  const ledger = await readAppliedMigrations(database);
  assert.deepEqual(ledger.map((row) => row.id), migrations.map((migration) => migration.id));
  assert.ok(ledger.every((row) => /^[a-f0-9]{64}$/.test(row.checksum)));
});

test("stops the run when an applied migration file changed", { skip }, async () => {
  const migrations = await loadMigrations();
  const tampered = migrations.map((migration) => (
    migration.id === "0002_auth_security"
      ? { ...migration, sql: `${migration.sql}\n-- tampered` }
      : migration
  ));

  await assert.rejects(
    () => database.session((session) => runMigrations(session, tampered)),
    (error) => error.name === "MigrationChecksumError" && error.migrationId === "0002_auth_security",
  );
});

test("creates the user, account, consent, session and audit trail in one exchange", { skip }, async () => {
  const challenge = await createChallenge();
  assert.equal(await repository.markMagicLinkDelivered(challenge.challengeId, now), true);

  const session = await createOpaqueToken();
  const result = await repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, session.tokenHash));

  assert.equal(result.email, "player@example.com");
  assert.equal(result.displayName, "Riftory Oyuncusu");
  assert.equal(result.returnTo, "/panel");

  const users = await database.query("SELECT id::text, email, email_verified_at FROM users");
  assert.equal(users.rows.length, 1);
  assert.notEqual(users.rows[0].email_verified_at, null);

  const accounts = await database.query("SELECT provider, provider_account_id FROM auth_accounts");
  assert.deepEqual(accounts.rows, [{ provider: "email", provider_account_id: "player@example.com" }]);

  const consents = await database.query("SELECT consent_key, document_version, granted FROM consents");
  assert.deepEqual(consents.rows, [{
    consent_key: "kvkk_communication",
    document_version: "kvkk-iletisim-v1-2026-08-14",
    granted: true,
  }]);

  const audits = await database.query("SELECT action FROM audit_logs ORDER BY id");
  assert.deepEqual(audits.rows.map((row) => row.action), ["auth.magic_link.consumed"]);
});

test("refuses an undelivered, expired, revoked or already consumed link", { skip }, async () => {
  const undelivered = await createChallenge();
  const session = await createOpaqueToken();
  assert.equal(
    await repository.exchangeMagicLink(exchangeInput(undelivered.tokenHash, session.tokenHash)),
    null,
  );

  // Expiry is proven by consuming after the deadline, never by back-dating a
  // row: the table's own check constraint forbids an expiry before creation.
  const expired = await createChallenge({ expiresAt: new Date(now.getTime() + 60_000) });
  await repository.markMagicLinkDelivered(expired.challengeId, now);
  const expiredSession = await createOpaqueToken();
  assert.equal(
    await repository.exchangeMagicLink(
      exchangeInput(expired.tokenHash, expiredSession.tokenHash, new Date(now.getTime() + 120_000)),
    ),
    null,
  );

  const failed = await createChallenge();
  await repository.markMagicLinkDeliveryFailed(failed.challengeId, now);
  const failedSession = await createOpaqueToken();
  assert.equal(
    await repository.exchangeMagicLink(exchangeInput(failed.tokenHash, failedSession.tokenHash)),
    null,
  );

  assert.equal((await database.query("SELECT id FROM users")).rows.length, 0);
  assert.equal((await database.query("SELECT id FROM auth_sessions")).rows.length, 0);
});

test("creates exactly one session when the same link is exchanged concurrently", { skip }, async () => {
  const challenge = await createChallenge();
  await repository.markMagicLinkDelivered(challenge.challengeId, now);

  const attempts = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const session = await createOpaqueToken();
      return repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, session.tokenHash));
    }),
  );

  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal((await database.query("SELECT id FROM users")).rows.length, 1);
  assert.equal((await database.query("SELECT id FROM auth_sessions")).rows.length, 1);
});

test("keeps one identity when two different links for one address race", { skip }, async () => {
  const first = await createChallenge();
  const second = await createChallenge();
  await repository.markMagicLinkDelivered(first.challengeId, now);
  await repository.markMagicLinkDelivered(second.challengeId, now);

  const results = await Promise.all([first, second].map(async (challenge) => {
    const session = await createOpaqueToken();
    return repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, session.tokenHash));
  }));

  assert.equal(results.filter(Boolean).length, 2);
  assert.equal(new Set(results.map((result) => result.userId)).size, 1);
  assert.equal((await database.query("SELECT id FROM users")).rows.length, 1);
  assert.equal((await database.query("SELECT id FROM auth_sessions")).rows.length, 2);
});

test("finds, rotates and revokes a session only for its owner", { skip }, async () => {
  const challenge = await createChallenge();
  await repository.markMagicLinkDelivered(challenge.challengeId, now);
  const first = await createOpaqueToken();
  const exchange = await repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, first.tokenHash));

  const active = await repository.findActiveSession(first.tokenHash, now);
  assert.equal(active.userId, exchange.userId);
  assert.equal(active.sessionFamilyId, exchange.sessionFamilyId);

  const stranger = "11111111-1111-4111-8111-111111111111";
  assert.equal(await repository.touchSession(exchange.sessionId, stranger, now), false);
  assert.equal(await repository.revokeSession(exchange.sessionId, stranger, now), false);

  const next = await createOpaqueToken();
  const rotated = await repository.rotateSession({
    sessionId: exchange.sessionId,
    actorUserId: exchange.userId,
    sessionTokenHash: next.tokenHash,
    sessionExpiresAt: sessionExpiry,
    now: later,
    ipAddress: "203.0.113.8",
    userAgent: "integration test",
  });

  assert.equal(rotated.sessionFamilyId, exchange.sessionFamilyId);
  assert.equal(await repository.findActiveSession(first.tokenHash, later), null);
  assert.equal((await repository.findActiveSession(next.tokenHash, later)).sessionId, rotated.sessionId);

  const lineage = await database.query(
    "SELECT rotated_from_session_id::text AS parent FROM auth_sessions WHERE id = $1::uuid",
    [rotated.sessionId],
  );
  assert.equal(lineage.rows[0].parent, exchange.sessionId);

  assert.equal(await repository.revokeSession(rotated.sessionId, exchange.userId, later), true);
  assert.equal(await repository.findActiveSession(next.tokenHash, later), null);

  const actions = await database.query("SELECT action FROM audit_logs ORDER BY id");
  assert.deepEqual(actions.rows.map((row) => row.action), [
    "auth.magic_link.consumed",
    "auth.session.rotated",
    "auth.session.revoked",
  ]);
});

test("revokes every live session for one user and counts them once", { skip }, async () => {
  const sessions = [];
  for (let index = 0; index < 3; index += 1) {
    const challenge = await createChallenge();
    await repository.markMagicLinkDelivered(challenge.challengeId, now);
    const token = await createOpaqueToken();
    sessions.push({
      token,
      exchange: await repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, token.tokenHash)),
    });
  }

  const userId = sessions[0].exchange.userId;
  assert.equal(await repository.revokeAllUserSessions(userId, later), 3);
  assert.equal(await repository.revokeAllUserSessions(userId, later), 0);

  for (const session of sessions) {
    assert.equal(await repository.findActiveSession(session.token.tokenHash, later), null);
  }
});

test("enforces the persistent rate limit window under concurrent attempts", { skip }, async () => {
  const bucketHash = await sha256Hex("magic-link:player@example.com");
  const policy = AUTH_RATE_LIMIT_POLICIES.magicLink;

  const decisions = await Promise.all(
    Array.from({ length: policy.maxAttempts + 3 }, () => repository.takeRateLimit({
      scope: "magic-link",
      bucketHash,
      policy,
      now,
    })),
  );

  assert.equal(decisions.filter((decision) => decision.allowed).length, policy.maxAttempts);
  const blocked = await repository.takeRateLimit({ scope: "magic-link", bucketHash, policy, now });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);

  const afterBlock = new Date(now.getTime() + policy.blockMs + policy.windowMs + 1_000);
  const recovered = await repository.takeRateLimit({ scope: "magic-link", bucketHash, policy, now: afterBlock });
  assert.equal(recovered.allowed, true);

  const rows = await database.query("SELECT scope, encode(bucket_key, 'hex') AS bucket_key FROM auth_rate_limits");
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].bucket_key, bucketHash);
});

test("imports a device draft once and rejects a changed payload for the same key", { skip }, async () => {
  const challenge = await createChallenge();
  await repository.markMagicLinkDelivered(challenge.challengeId, now);
  const token = await createOpaqueToken();
  const { userId } = await repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, token.tokenHash));

  const command = {
    ownerUserId: userId,
    importKey: "6bde3a42-64c1-4c9f-8b0a-1ce9cd53c413",
    payloadHash: await sha256Hex(JSON.stringify(DEFAULT_SERVER_DRAFT)),
    draft: DEFAULT_SERVER_DRAFT,
  };

  const first = await repository.importDeviceDraft(command, "catalog-v1");
  assert.equal(first.replay, false);

  const replays = await Promise.all(
    Array.from({ length: 4 }, () => repository.importDeviceDraft(command, "catalog-v1")),
  );
  assert.ok(replays.every((result) => result.replay && result.serverDraftId === first.serverDraftId));
  assert.equal((await database.query("SELECT id FROM server_drafts")).rows.length, 1);

  await assert.rejects(
    () => repository.importDeviceDraft({ ...command, payloadHash: "f".repeat(64) }, "catalog-v1"),
    DraftImportConflictError,
  );
});

test("moves a device draft into the account exactly once after a real sign-in", { skip }, async () => {
  const deliveries = [];
  const service = createAuthService({
    repository,
    mailer: { sendMagicLink: async (input) => deliveries.push(input) },
    appOrigin: "https://riftory.example",
    rateLimitSecret: "s".repeat(32),
  });

  await service.requestMagicLink({
    mode: "register",
    email: "player@example.com",
    displayName: "Riftory Oyuncusu",
    returnTo: "/hesap",
    clientDiscriminator: "203.0.113.7",
  });
  const rawChallenge = new URL(deliveries[0].link).searchParams.get("token");
  const signedIn = await service.consumeMagicLink({
    rawToken: rawChallenge,
    clientDiscriminator: "203.0.113.7",
  });
  assert.equal(signedIn.returnTo, "/hesap");

  const importKey = "6bde3a42-64c1-4c9f-8b0a-1ce9cd53c413";
  const first = await service.importDeviceDraft({
    rawToken: signedIn.sessionToken,
    importKey,
    draft: DEFAULT_SERVER_DRAFT,
  });
  assert.equal(first.code, "DRAFT_IMPORTED");

  // The browser retries on every visit; the account must not collect copies.
  const replays = await Promise.all(Array.from({ length: 5 }, () => service.importDeviceDraft({
    rawToken: signedIn.sessionToken,
    importKey,
    draft: DEFAULT_SERVER_DRAFT,
  })));
  assert.ok(replays.every((result) => result.code === "DRAFT_ALREADY_IMPORTED"));
  assert.ok(replays.every((result) => result.serverDraftId === first.serverDraftId));

  const stored = await database.query(
    "SELECT owner_user_id::text AS owner, catalog_version, specification FROM server_drafts",
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].owner, signedIn.userId);
  assert.equal(stored.rows[0].catalog_version, CATALOG_VERSION);
  assert.deepEqual(stored.rows[0].specification, DEFAULT_SERVER_DRAFT);

  await assert.rejects(
    () => service.importDeviceDraft({
      rawToken: signedIn.sessionToken,
      importKey,
      draft: { ...DEFAULT_SERVER_DRAFT, planId: "pro-12" },
    }),
    DraftImportConflictError,
  );

  await service.signOut({ rawToken: signedIn.sessionToken });
  await assert.rejects(
    () => service.importDeviceDraft({
      rawToken: signedIn.sessionToken,
      importKey,
      draft: DEFAULT_SERVER_DRAFT,
    }),
    (error) => error.status === 401 && error.code === "SESSION_REQUIRED",
  );
});

test("consumes an OAuth state exactly once, even concurrently", { skip }, async () => {
  const state = await createOpaqueToken();
  await repository.createOAuthState({
    provider: "discord",
    stateHash: state.tokenHash,
    codeVerifier: "v".repeat(43),
    returnTo: "/hesap",
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    requestedIp: "203.0.113.7",
  });

  const attempts = await Promise.all(Array.from({ length: 6 }, () => repository.consumeOAuthState({
    provider: "discord",
    stateHash: state.tokenHash,
    now,
  })));
  const accepted = attempts.filter(Boolean);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].returnTo, "/hesap");
  assert.equal(accepted[0].codeVerifier, "v".repeat(43));

  const expired = await createOpaqueToken();
  await repository.createOAuthState({
    provider: "discord",
    stateHash: expired.tokenHash,
    codeVerifier: "w".repeat(43),
    returnTo: "/panel",
    expiresAt: new Date(now.getTime() + 60_000),
    requestedIp: null,
  });
  assert.equal(
    await repository.consumeOAuthState({
      provider: "discord",
      stateHash: expired.tokenHash,
      now: new Date(now.getTime() + 120_000),
    }),
    null,
  );
});

test("links a Discord account to one identity and reuses it on return", { skip }, async () => {
  const discordAccount = {
    provider: "discord",
    providerAccountId: "discord-account-id",
    email: "player@example.com",
    displayName: "Riftory Oyuncusu",
  };

  const firstToken = await createOpaqueToken();
  const first = await repository.exchangeOAuthAccount({
    ...discordAccount,
    sessionTokenHash: firstToken.tokenHash,
    sessionExpiresAt: sessionExpiry,
    now,
    ipAddress: "203.0.113.7",
    userAgent: "integration test",
  });
  assert.equal(first.email, "player@example.com");

  // A later sign-in with a changed Discord display name keeps the same identity.
  const secondToken = await createOpaqueToken();
  const second = await repository.exchangeOAuthAccount({
    ...discordAccount,
    displayName: "Yeni Ad",
    sessionTokenHash: secondToken.tokenHash,
    sessionExpiresAt: sessionExpiry,
    now: later,
    ipAddress: null,
    userAgent: null,
  });
  assert.equal(second.userId, first.userId);

  assert.equal((await database.query("SELECT id FROM users")).rows.length, 1);
  const accounts = await database.query(
    "SELECT provider, provider_account_id, user_id::text AS user_id FROM auth_accounts",
  );
  assert.deepEqual(accounts.rows, [{
    provider: "discord",
    provider_account_id: "discord-account-id",
    user_id: first.userId,
  }]);

  const actions = await database.query("SELECT action FROM audit_logs ORDER BY id");
  assert.deepEqual(actions.rows.map((row) => row.action), ["auth.oauth.consumed", "auth.oauth.consumed"]);
});

test("adopts an existing email identity instead of creating a duplicate user", { skip }, async () => {
  const challenge = await createChallenge();
  await repository.markMagicLinkDelivered(challenge.challengeId, now);
  const emailToken = await createOpaqueToken();
  const viaEmail = await repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, emailToken.tokenHash));

  const discordToken = await createOpaqueToken();
  const viaDiscord = await repository.exchangeOAuthAccount({
    provider: "discord",
    providerAccountId: "discord-account-id",
    email: "player@example.com",
    displayName: "Riftory Oyuncusu",
    sessionTokenHash: discordToken.tokenHash,
    sessionExpiresAt: sessionExpiry,
    now: later,
    ipAddress: null,
    userAgent: null,
  });

  assert.equal(viaDiscord.userId, viaEmail.userId);
  assert.equal((await database.query("SELECT id FROM users")).rows.length, 1);
  const providers = await database.query("SELECT provider FROM auth_accounts ORDER BY provider");
  assert.deepEqual(providers.rows.map((row) => row.provider), ["discord", "email"]);
});

test("never opens a session for a user the provider account does not belong to", { skip }, async () => {
  const owners = [];
  for (const email of ["first@example.com", "second@example.com"]) {
    const challenge = await createChallenge({ email });
    await repository.markMagicLinkDelivered(challenge.challengeId, now);
    const token = await createOpaqueToken();
    owners.push(await repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, token.tokenHash)));
  }

  const linkToken = await createOpaqueToken();
  const linked = await repository.exchangeOAuthAccount({
    provider: "discord",
    providerAccountId: "shared-discord-id",
    email: "first@example.com",
    displayName: "Riftory Oyuncusu",
    sessionTokenHash: linkToken.tokenHash,
    sessionExpiresAt: sessionExpiry,
    now,
    ipAddress: null,
    userAgent: null,
  });
  assert.equal(linked.userId, owners[0].userId);

  // The same Discord account later reports the other user's address.
  const stolenToken = await createOpaqueToken();
  const stolen = await repository.exchangeOAuthAccount({
    provider: "discord",
    providerAccountId: "shared-discord-id",
    email: "second@example.com",
    displayName: "Riftory Oyuncusu",
    sessionTokenHash: stolenToken.tokenHash,
    sessionExpiresAt: sessionExpiry,
    now: later,
    ipAddress: null,
    userAgent: null,
  });

  assert.equal(stolen.userId, owners[0].userId);
  assert.notEqual(stolen.userId, owners[1].userId);
  const session = await repository.findActiveSession(stolenToken.tokenHash, later);
  assert.equal(session.userId, owners[0].userId);
});

test("a replayed session token burns the whole family", { skip }, async () => {
  const challenge = await createChallenge();
  await repository.markMagicLinkDelivered(challenge.challengeId, now);
  const first = await createOpaqueToken();
  const exchange = await repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, first.tokenHash));

  const second = await createOpaqueToken();
  const rotated = await repository.rotateSession({
    sessionId: exchange.sessionId,
    actorUserId: exchange.userId,
    sessionTokenHash: second.tokenHash,
    sessionExpiresAt: sessionExpiry,
    now: later,
    ipAddress: null,
    userAgent: null,
  });
  assert.equal((await repository.findActiveSession(second.tokenHash, later)).sessionId, rotated.sessionId);

  // The captured predecessor comes back after rotation.
  const reuse = await repository.revokeSessionFamilyOnReuse(first.tokenHash, later);
  assert.equal(reuse.familyId, exchange.sessionFamilyId);
  assert.equal(reuse.revokedSessions, 1);

  // The successor is dead too: holding a stolen token gains nothing.
  assert.equal(await repository.findActiveSession(second.tokenHash, later), null);

  const actions = await database.query("SELECT action FROM audit_logs ORDER BY id");
  assert.deepEqual(actions.rows.map((row) => row.action), [
    "auth.magic_link.consumed",
    "auth.session.rotated",
    "auth.session.reuse_detected",
  ]);

  // An unknown token is not a reuse event.
  assert.equal(await repository.revokeSessionFamilyOnReuse((await createOpaqueToken()).tokenHash, later), null);
});

test("purges dead identity records without touching live ones", { skip }, async () => {
  const grace = { verificationTokenGraceMs: 7 * 24 * 60 * 60 * 1000 };

  // Live: a delivered link and an open OAuth state, both still valid.
  const liveChallenge = await createChallenge();
  await repository.markMagicLinkDelivered(liveChallenge.challengeId, now);
  const liveState = await createOpaqueToken();
  await repository.createOAuthState({
    provider: "discord",
    stateHash: liveState.tokenHash,
    codeVerifier: "v".repeat(43),
    returnTo: "/panel",
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    requestedIp: null,
  });

  // Dead: an expired link and a consumed state.
  const expiredChallenge = await createChallenge({ expiresAt: new Date(now.getTime() + 60_000) });
  const consumedState = await createOpaqueToken();
  await repository.createOAuthState({
    provider: "discord",
    stateHash: consumedState.tokenHash,
    codeVerifier: "w".repeat(43),
    returnTo: "/panel",
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    requestedIp: null,
  });
  await repository.consumeOAuthState({ provider: "discord", stateHash: consumedState.tokenHash, now });

  const removed = await repository.purgeExpiredAuthRecords(new Date(now.getTime() + 120_000), grace);
  assert.equal(removed.verificationTokens, 1);
  assert.equal(removed.oauthStates, 1);

  // The live records must still be usable after the purge.
  const remainingTokens = await database.query("SELECT id::text AS id FROM verification_tokens");
  assert.equal(remainingTokens.rows.length, 1);
  assert.equal(remainingTokens.rows[0].id, liveChallenge.challengeId);

  const stillUsable = await repository.consumeOAuthState({
    provider: "discord",
    stateHash: liveState.tokenHash,
    now: new Date(now.getTime() + 120_000),
  });
  assert.equal(stillUsable.returnTo, "/panel");
  assert.equal(
    await repository.exchangeMagicLink(
      exchangeInput(expiredChallenge.tokenHash, (await createOpaqueToken()).tokenHash),
    ),
    null,
  );
});

test("keeps a blocked rate-limit bucket until its block has elapsed", { skip }, async () => {
  const policy = AUTH_RATE_LIMIT_POLICIES.magicLink;
  const bucketHash = await sha256Hex("purge:blocked-bucket");
  const grace = { verificationTokenGraceMs: 7 * 24 * 60 * 60 * 1000 };

  for (let attempt = 0; attempt <= policy.maxAttempts; attempt += 1) {
    await repository.takeRateLimit({ scope: "magic-link", bucketHash, policy, now });
  }
  const blocked = await repository.takeRateLimit({ scope: "magic-link", bucketHash, policy, now });
  assert.equal(blocked.allowed, false);

  // Purging a blocked bucket would hand the caller a fresh allowance.
  const duringBlock = await repository.purgeExpiredAuthRecords(
    new Date(now.getTime() + policy.blockMs / 2),
    grace,
  );
  assert.equal(duringBlock.rateLimitBuckets, 0);
  assert.equal(
    (await repository.takeRateLimit({ scope: "magic-link", bucketHash, policy, now })).allowed,
    false,
  );

  const afterBlock = await repository.purgeExpiredAuthRecords(
    new Date(now.getTime() + grace.verificationTokenGraceMs + policy.blockMs + 60_000),
    grace,
  );
  assert.equal(afterBlock.rateLimitBuckets, 1);
});

test("scopes drafts to their owner so a foreign user cannot read them", { skip }, async () => {
  const owners = [];
  for (const email of ["first@example.com", "second@example.com"]) {
    const challenge = await createChallenge({ email });
    await repository.markMagicLinkDelivered(challenge.challengeId, now);
    const token = await createOpaqueToken();
    owners.push(await repository.exchangeMagicLink(exchangeInput(challenge.tokenHash, token.tokenHash)));
  }

  const importKey = "0f6f3e0c-2f4a-4f36-9d2f-3b0f1f0a8a11";
  const payloadHash = await sha256Hex(JSON.stringify(DEFAULT_SERVER_DRAFT));
  const first = await repository.importDeviceDraft(
    { ownerUserId: owners[0].userId, importKey, payloadHash, draft: DEFAULT_SERVER_DRAFT },
    "catalog-v1",
  );
  const second = await repository.importDeviceDraft(
    { ownerUserId: owners[1].userId, importKey, payloadHash, draft: DEFAULT_SERVER_DRAFT },
    "catalog-v1",
  );

  assert.notEqual(first.serverDraftId, second.serverDraftId);
  const owned = await database.query(
    "SELECT id::text FROM server_drafts WHERE id = $1::uuid AND owner_user_id = $2::uuid",
    [second.serverDraftId, owners[0].userId],
  );
  assert.equal(owned.rows.length, 0);
});

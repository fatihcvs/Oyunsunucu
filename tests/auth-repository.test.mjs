import assert from "node:assert/strict";
import test from "node:test";
import {
  DraftImportConflictError,
  PostgresAuthRepository,
} from "../infra/postgres/auth-repository.ts";
import { AUTH_RATE_LIMIT_POLICIES } from "../lib/auth-security.ts";
import { DEFAULT_SERVER_DRAFT } from "../lib/catalog.ts";

class RecordingDatabase {
  calls = [];
  transactions = 0;

  constructor(responder = () => ({ rows: [] })) {
    this.responder = responder;
  }

  async query(text, values = []) {
    const call = { text, values: [...values] };
    this.calls.push(call);
    return this.responder(call);
  }

  async transaction(callback) {
    this.transactions += 1;
    return callback(this);
  }
}

test("inserts magic-link challenges with parameterized SQL and a hash only", async () => {
  const database = new RecordingDatabase((call) => {
    if (call.text.includes("INSERT INTO verification_tokens")) {
      return { rows: [{ id: "challenge-id" }] };
    }
    return { rows: [] };
  });
  const repository = new PostgresAuthRepository(database);
  const rawToken = "secret-raw-token-that-must-never-reach-sql";
  const tokenHash = "a".repeat(64);

  const id = await repository.createMagicLinkChallenge({
    purpose: "signin",
    email: "player@example.com",
    tokenHash,
    expiresAt: new Date("2026-08-15T12:10:00Z"),
    returnTo: "/panel",
    displayName: null,
    consentVersion: null,
    requestedIp: null,
  });

  assert.equal(id, "challenge-id");
  assert.equal(database.calls.length, 1);
  assert.match(database.calls[0].text, /decode\(\$3, 'hex'\)/);
  assert.doesNotMatch(database.calls[0].text, /player@example\.com|aaaaaa/);
  assert.ok(database.calls[0].values.includes(tokenHash));
  assert.ok(!database.calls[0].values.includes(rawToken));
});

test("exchanges a delivered link, identity and session inside one transaction", async () => {
  const database = new RecordingDatabase((call) => {
    if (call.text.includes("UPDATE verification_tokens")) {
      return {
        rows: [{
          destination_email: "player@example.com",
          purpose: "signin",
          requested_display_name: null,
          consent_version: null,
          return_to: "/hesap",
        }],
      };
    }
    if (call.text.includes("FROM users")) {
      return { rows: [{ id: "user-id", email: "player@example.com", display_name: "Oyuncu" }] };
    }
    if (call.text.includes("INSERT INTO auth_sessions")) {
      return { rows: [{ id: "session-id", family_id: "family-id" }] };
    }
    return { rows: [] };
  });
  const repository = new PostgresAuthRepository(database);
  const challengeHash = "b".repeat(64);
  const sessionHash = "c".repeat(64);

  const result = await repository.exchangeMagicLink({
    challengeTokenHash: challengeHash,
    sessionTokenHash: sessionHash,
    sessionExpiresAt: new Date("2026-09-14T12:00:00Z"),
    now: new Date("2026-08-15T12:00:00Z"),
    ipAddress: "203.0.113.7",
    userAgent: "test browser",
  });

  assert.equal(database.transactions, 1);
  assert.deepEqual(result, {
    userId: "user-id",
    sessionId: "session-id",
    sessionFamilyId: "family-id",
    email: "player@example.com",
    displayName: "Oyuncu",
    returnTo: "/hesap",
  });
  assert.ok(database.calls.some((call) => call.text.includes("delivery_status = 'sent'")));
  assert.ok(database.calls.some((call) => call.text.includes("INSERT INTO audit_logs")));
  assert.ok(database.calls.some((call) => call.values.includes(challengeHash)));
  assert.ok(database.calls.some((call) => call.values.includes(sessionHash)));
  assert.ok(database.calls.every((call) => !call.text.includes(challengeHash) && !call.text.includes(sessionHash)));
});

test("serializes persistent rate-limit updates with a hashed advisory key", async () => {
  const database = new RecordingDatabase();
  const repository = new PostgresAuthRepository(database);
  const bucketHash = "d".repeat(64);
  const decision = await repository.takeRateLimit({
    scope: "magic-link",
    bucketHash,
    policy: AUTH_RATE_LIMIT_POLICIES.magicLink,
    now: new Date("2026-08-15T12:00:00Z"),
  });

  assert.equal(database.transactions, 1);
  assert.equal(decision.allowed, true);
  assert.equal(decision.remaining, 4);
  assert.ok(database.calls[0].text.includes("pg_advisory_xact_lock"));
  assert.ok(database.calls[0].values[0].endsWith(bucketHash));
  assert.ok(database.calls.some((call) => call.text.includes("ON CONFLICT (scope, bucket_key)")));
});

test("scopes session mutations to the authenticated owner", async () => {
  const database = new RecordingDatabase(() => ({ rows: [] }));
  const repository = new PostgresAuthRepository(database);
  const changed = await repository.revokeSession(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    new Date("2026-08-15T12:00:00Z"),
  );

  assert.equal(changed, false);
  assert.match(database.calls[0].text, /id = \$1::uuid AND user_id = \$2::uuid/);
  assert.ok(!database.calls.some((call) => call.text.includes("INSERT INTO audit_logs")));
});

test("audits a revoked session inside the same transaction", async () => {
  const database = new RecordingDatabase((call) => (
    call.text.includes("UPDATE auth_sessions") ? { rows: [{ id: "session-id" }] } : { rows: [] }
  ));
  const revoked = await new PostgresAuthRepository(database).revokeSession(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    new Date("2026-08-15T12:00:00Z"),
  );

  assert.equal(revoked, true);
  assert.equal(database.transactions, 1);
  assert.ok(database.calls.some((call) => call.text.includes("'auth.session.revoked'")));
});

test("rotates a session into the same family and links its predecessor", async () => {
  const database = new RecordingDatabase((call) => {
    if (call.text.includes("UPDATE auth_sessions")) return { rows: [{ family_id: "family-id" }] };
    if (call.text.includes("INSERT INTO auth_sessions")) return { rows: [{ id: "next-session-id" }] };
    return { rows: [] };
  });
  const sessionTokenHash = "c".repeat(64);
  const result = await new PostgresAuthRepository(database).rotateSession({
    sessionId: "11111111-1111-4111-8111-111111111111",
    actorUserId: "22222222-2222-4222-8222-222222222222",
    sessionTokenHash,
    sessionExpiresAt: new Date("2026-09-14T12:00:00Z"),
    now: new Date("2026-08-15T12:00:00Z"),
    ipAddress: "203.0.113.7",
    userAgent: "test browser",
  });

  assert.equal(database.transactions, 1);
  assert.equal(result.sessionId, "next-session-id");
  assert.equal(result.sessionFamilyId, "family-id");
  const insert = database.calls.find((call) => call.text.includes("INSERT INTO auth_sessions"));
  assert.match(insert.text, /rotated_from_session_id/);
  assert.ok(insert.values.includes("family-id"));
  assert.ok(insert.values.includes(sessionTokenHash));
  assert.ok(database.calls.some((call) => call.text.includes("'auth.session.rotated'")));
});

test("refuses to rotate a revoked or expired session", async () => {
  const database = new RecordingDatabase(() => ({ rows: [] }));
  const result = await new PostgresAuthRepository(database).rotateSession({
    sessionId: "11111111-1111-4111-8111-111111111111",
    actorUserId: "22222222-2222-4222-8222-222222222222",
    sessionTokenHash: "d".repeat(64),
    sessionExpiresAt: new Date("2026-09-14T12:00:00Z"),
    now: new Date("2026-08-15T12:00:00Z"),
    ipAddress: null,
    userAgent: null,
  });

  assert.equal(result, null);
  assert.ok(!database.calls.some((call) => call.text.includes("INSERT INTO auth_sessions")));
});

test("replays an identical device draft import and rejects a changed payload", async () => {
  const command = {
    ownerUserId: "d9d47d02-73c4-4d20-86f8-91b8c846ff25",
    importKey: "6bde3a42-64c1-4c9f-8b0a-1ce9cd53c413",
    payloadHash: "e".repeat(64),
    draft: DEFAULT_SERVER_DRAFT,
  };
  const replayDatabase = new RecordingDatabase((call) => {
    if (call.text.includes("FROM draft_import_receipts")) {
      return { rows: [{ server_draft_id: "draft-id", payload_hash: command.payloadHash }] };
    }
    return { rows: [] };
  });
  const replay = await new PostgresAuthRepository(replayDatabase).importDeviceDraft(command, "catalog-v1");
  assert.deepEqual(replay, { serverDraftId: "draft-id", replay: true });
  assert.ok(!replayDatabase.calls.some((call) => call.text.includes("INSERT INTO server_drafts")));

  const conflictDatabase = new RecordingDatabase((call) => {
    if (call.text.includes("FROM draft_import_receipts")) {
      return { rows: [{ server_draft_id: "draft-id", payload_hash: "f".repeat(64) }] };
    }
    return { rows: [] };
  });
  await assert.rejects(
    () => new PostgresAuthRepository(conflictDatabase).importDeviceDraft(command, "catalog-v1"),
    DraftImportConflictError,
  );
});

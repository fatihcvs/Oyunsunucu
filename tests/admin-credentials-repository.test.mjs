import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAdminCredentialsRepository } from "../infra/postgres/admin-credentials-repository.ts";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-16T18:00:00.000Z");

class CredentialsDatabase {
  statements = [];
  membership = true;
  storedPasswordHash = null;
  owners = 2;
  user = true;
  existingMembership = false;

  async query(text, values = []) {
    this.statements.push({ text: text.trim(), values: [...values] });
    if (text.includes("FROM users u") && text.includes("JOIN admin_memberships")) {
      return {
        rows: this.membership
          ? [{ user_id: USER_ID, role: "operator", password_hash: this.storedPasswordHash }]
          : [],
      };
    }
    if (text.includes("FROM admin_memberships m") && text.includes("JOIN users u")) {
      return {
        rows: this.membership ? [{ role: "operator", password_hash: this.storedPasswordHash }] : [],
      };
    }
    if (text.includes("INSERT INTO auth_sessions")) return { rows: [{ id: SESSION_ID }] };
    if (text.includes("UPDATE admin_memberships")) {
      return { rows: this.membership ? [{ role: "operator" }] : [] };
    }
    if (text.includes("UPDATE auth_sessions")) return { rows: [], rowCount: 3 };
    if (text.includes("FROM users") && text.includes("email_verified_at IS NOT NULL")) {
      return { rows: this.user ? [{ user_id: USER_ID }] : [] };
    }
    if (text.includes("FROM admin_memberships WHERE user_id") && text.includes("FOR UPDATE")) {
      return { rows: this.existingMembership ? [{ role: "operator" }] : [] };
    }
    if (text.includes("count(*)::text AS total") && text.includes("role = 'owner'")) {
      return { rows: [{ total: String(this.owners) }] };
    }
    return { rows: [] };
  }

  async transaction(callback) { return callback(this); }
}

test("reads the identity with its stored verifier, without ever selecting a plaintext", async () => {
  const database = new CredentialsDatabase();
  database.storedPasswordHash = "pbkdf2-sha256$310000$salt$hash";
  const repository = new PostgresAdminCredentialsRepository(database);

  assert.deepEqual(await repository.findPasswordIdentity("admin@example.com"), {
    userId: USER_ID,
    role: "operator",
    passwordHash: "pbkdf2-sha256$310000$salt$hash",
  });
  assert.match(database.statements[0].text, /email_verified_at IS NOT NULL/);
  assert.deepEqual(database.statements[0].values, ["admin@example.com"]);
});

test("reports no stored verifier as null so the bootstrap credential can cover it", async () => {
  const database = new CredentialsDatabase();
  const repository = new PostgresAdminCredentialsRepository(database);
  const identity = await repository.findPasswordIdentity("admin@example.com");
  assert.equal(identity.passwordHash, null);
});

test("opens an audited session only while the membership is still active", async () => {
  const database = new CredentialsDatabase();
  const repository = new PostgresAdminCredentialsRepository(database);
  const result = await repository.openPasswordSession({
    userId: USER_ID,
    sessionTokenHash: "a".repeat(64),
    sessionExpiresAt: new Date(NOW.getTime() + 60_000),
    ipAddress: "203.0.113.9",
    userAgent: "test",
    now: NOW,
  });

  assert.deepEqual(result, { role: "operator" });
  const texts = database.statements.map((statement) => statement.text);
  assert.ok(texts.some((text) => text.includes("INSERT INTO auth_sessions")));
  assert.ok(texts.some((text) => text.includes("auth.admin_password.consumed")));

  database.membership = false;
  const denied = new PostgresAdminCredentialsRepository(database);
  assert.equal(
    await denied.openPasswordSession({
      userId: USER_ID,
      sessionTokenHash: "b".repeat(64),
      sessionExpiresAt: new Date(NOW.getTime() + 60_000),
      ipAddress: null,
      userAgent: null,
      now: NOW,
    }),
    null,
  );
});

test("a password change ends every other session of the same admin", async () => {
  const database = new CredentialsDatabase();
  const repository = new PostgresAdminCredentialsRepository(database);
  const result = await repository.changePassword({
    userId: USER_ID,
    passwordHash: "pbkdf2-sha256$310000$salt$hash",
    keepSessionTokenHash: "c".repeat(64),
    now: NOW,
  });

  assert.deepEqual(result, { status: "changed", revokedSessions: 3 });
  const revoke = database.statements.find((statement) => statement.text.includes("UPDATE auth_sessions"));
  assert.match(revoke.text, /token_hash <> decode/);
  assert.ok(database.statements.some((statement) => statement.text.includes("admin.password.changed")));
});

test("a password change refuses an oversized or non-hex session digest", async () => {
  const repository = new PostgresAdminCredentialsRepository(new CredentialsDatabase());
  await assert.rejects(
    () => repository.changePassword({
      userId: USER_ID,
      passwordHash: "pbkdf2-sha256$310000$salt$hash",
      keepSessionTokenHash: "not-a-digest",
      now: NOW,
    }),
    TypeError,
  );
});

test("grants a membership to an existing verified account and audits it", async () => {
  const database = new CredentialsDatabase();
  const repository = new PostgresAdminCredentialsRepository(database);
  const result = await repository.grantMembership({
    email: "operator@example.com",
    role: "operator",
    actorUserId: OTHER_USER_ID,
    now: NOW,
  });

  assert.deepEqual(result, { status: "granted", userId: USER_ID });
  assert.ok(database.statements.some((statement) => statement.text.includes("INSERT INTO admin_memberships")));
  assert.ok(database.statements.some((statement) => statement.values.includes("admin.membership.granted")));
});

test("never invents an account for a membership grant", async () => {
  const database = new CredentialsDatabase();
  database.user = false;
  const repository = new PostgresAdminCredentialsRepository(database);
  assert.deepEqual(
    await repository.grantMembership({
      email: "nobody@example.com",
      role: "operator",
      actorUserId: OTHER_USER_ID,
      now: NOW,
    }),
    { status: "user_not_found" },
  );
  assert.ok(!database.statements.some((statement) => statement.text.includes("INSERT INTO users")));
  assert.ok(!database.statements.some((statement) => statement.text.includes("INSERT INTO admin_memberships")));
});

test("refuses to revoke your own membership or the last owner", async () => {
  const database = new CredentialsDatabase();
  const repository = new PostgresAdminCredentialsRepository(database);
  assert.deepEqual(
    await repository.revokeMembership({ userId: USER_ID, actorUserId: USER_ID, now: NOW }),
    { status: "self" },
  );
  assert.equal(database.statements.length, 0);
});

test("revoking a membership also ends that admin's sessions", async () => {
  const database = new CredentialsDatabase();
  database.existingMembership = true;
  const repository = new PostgresAdminCredentialsRepository(database);
  const result = await repository.revokeMembership({
    userId: USER_ID,
    actorUserId: OTHER_USER_ID,
    now: NOW,
  });

  assert.deepEqual(result, { status: "revoked" });
  const texts = database.statements.map((statement) => statement.text);
  assert.ok(texts.some((text) => text.includes("DELETE FROM admin_memberships")));
  assert.ok(texts.some((text) => text.includes("UPDATE auth_sessions SET revoked_at")));
  assert.ok(texts.some((text) => text.includes("admin.membership.revoked")));
});

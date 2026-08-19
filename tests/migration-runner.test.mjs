import assert from "node:assert/strict";
import test from "node:test";
import {
  MigrationChecksumError,
  migrationBody,
  runMigrations,
  sortMigrations,
} from "../infra/postgres/migration-runner.ts";
import { loadMigrations } from "../infra/postgres/node-migration-source.ts";

class RecordingSession {
  statements = [];
  ledger = [];

  async query(text, values = []) {
    this.statements.push({ text: text.trim(), values: [...values] });
    if (text.includes("SELECT id, checksum FROM schema_migrations")) {
      return { rows: this.ledger };
    }
    return { rows: [] };
  }
}

const migrations = [
  { id: "0002_second", sql: "BEGIN;\nALTER TABLE users ADD COLUMN nickname text;\nCOMMIT;\n" },
  { id: "0001_first", sql: "BEGIN;\nCREATE TABLE users (id uuid PRIMARY KEY);\nCOMMIT;\n" },
];

test("orders migrations by identifier and rejects unusable names", () => {
  assert.deepEqual(sortMigrations(migrations).map((migration) => migration.id), ["0001_first", "0002_second"]);
  assert.throws(() => sortMigrations([{ id: "first", sql: "" }]), TypeError);
  assert.throws(() => sortMigrations([{ id: "0001_a", sql: "" }, { id: "0001_a", sql: "" }]), TypeError);
});

test("strips a file's own transaction wrapper so the ledger commits with the schema", () => {
  assert.equal(migrationBody(migrations[1].sql), "CREATE TABLE users (id uuid PRIMARY KEY);");
  assert.equal(migrationBody("CREATE INDEX x ON users (id);"), "CREATE INDEX x ON users (id);");
});

test("applies pending migrations in order under one advisory lock", async () => {
  const session = new RecordingSession();
  const result = await runMigrations(session, migrations);

  assert.deepEqual(result, { applied: ["0001_first", "0002_second"], skipped: [] });

  const texts = session.statements.map((statement) => statement.text);
  assert.ok(texts[0].includes("CREATE TABLE IF NOT EXISTS schema_migrations"));
  assert.ok(texts[1].includes("pg_advisory_lock"));
  assert.ok(texts.at(-1).includes("pg_advisory_unlock"));
  assert.equal(texts.filter((text) => text === "BEGIN").length, 2);
  assert.equal(texts.filter((text) => text === "COMMIT").length, 2);
  assert.ok(!texts.some((text) => text.startsWith("BEGIN;")));

  const ledgerWrites = session.statements.filter((statement) => statement.text.includes("INSERT INTO schema_migrations"));
  assert.deepEqual(ledgerWrites.map((statement) => statement.values[0]), ["0001_first", "0002_second"]);
  assert.ok(ledgerWrites.every((statement) => /^[a-f0-9]{64}$/.test(statement.values[1])));
});

test("skips already applied migrations and never reruns their statements", async () => {
  const first = new RecordingSession();
  await runMigrations(first, migrations);
  const checksums = first.statements
    .filter((statement) => statement.text.includes("INSERT INTO schema_migrations"))
    .map((statement) => ({ id: statement.values[0], checksum: statement.values[1] }));

  const second = new RecordingSession();
  second.ledger = checksums;
  const result = await runMigrations(second, migrations);

  assert.deepEqual(result, { applied: [], skipped: ["0001_first", "0002_second"] });
  assert.ok(!second.statements.some((statement) => statement.text.includes("CREATE TABLE users")));
});

test("stops before touching the schema when a recorded checksum no longer matches", async () => {
  const session = new RecordingSession();
  session.ledger = [{ id: "0001_first", checksum: "0".repeat(64) }];

  await assert.rejects(() => runMigrations(session, migrations), MigrationChecksumError);
  assert.ok(!session.statements.some((statement) => statement.text.includes("ALTER TABLE users")));
  assert.ok(session.statements.at(-1).text.includes("pg_advisory_unlock"));
});

test("rolls back a failing migration instead of recording it", async () => {
  const session = new RecordingSession();
  session.query = async function query(text, values = []) {
    this.statements.push({ text: text.trim(), values: [...values] });
    if (text.includes("SELECT id, checksum FROM schema_migrations")) return { rows: [] };
    if (text.includes("CREATE TABLE users")) throw new Error("syntax error");
    return { rows: [] };
  };

  await assert.rejects(() => runMigrations(session, migrations), /syntax error/);
  const texts = session.statements.map((statement) => statement.text);
  assert.ok(texts.includes("ROLLBACK"));
  assert.ok(!texts.some((text) => text.includes("INSERT INTO schema_migrations")));
  assert.ok(texts.at(-1).includes("pg_advisory_unlock"));
});

test("keeps the checked-in migration files loadable and ordered", async () => {
  const files = await loadMigrations();
  assert.deepEqual(files.map((migration) => migration.id), [
    "0001_identity",
    "0002_auth_security",
    "0003_magic_link_flows",
    "0004_oauth_states",
    "0005_orders_payments",
    "0006_provisioning",
    "0007_admin_console",
    "0008_admin_credentials",
    "0009_server_settings",
    "0010_password_accounts",
    "0011_user_balances",
  ]);
  assert.ok(files.every((migration) => migration.sql.includes("BEGIN;")));
});

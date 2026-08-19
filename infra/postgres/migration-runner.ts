import type { SqlExecutor } from "./auth-repository.ts";

export type Migration = {
  /** Sort key and identity, e.g. `0001_identity`. */
  id: string;
  sql: string;
};

export type AppliedMigration = {
  id: string;
  checksum: string;
};

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

export class MigrationChecksumError extends Error {
  readonly migrationId: string;

  constructor(migrationId: string) {
    super(`Uygulanmış migration değiştirilmiş: ${migrationId}`);
    this.name = "MigrationChecksumError";
    this.migrationId = migrationId;
  }
}

const MIGRATION_ID = /^[0-9]{4}_[a-z0-9_]+$/;
const ADVISORY_LOCK_KEY = "riftory:schema-migrations";

const CREATE_LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sortMigrations(migrations: readonly Migration[]) {
  for (const migration of migrations) {
    if (!MIGRATION_ID.test(migration.id)) {
      throw new TypeError(`Geçersiz migration adı: ${migration.id}`);
    }
  }

  const ordered = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
  const duplicate = ordered.find((migration, index) => ordered[index - 1]?.id === migration.id);
  if (duplicate) throw new TypeError(`Yinelenen migration adı: ${duplicate.id}`);
  return ordered;
}

/**
 * Removes a file's own transaction wrapper.
 *
 * The runner opens the transaction itself so the schema change and its ledger
 * row commit together; a nested `COMMIT` inside the file would otherwise end
 * that transaction early and leave the ledger write outside it.
 */
export function migrationBody(sql: string) {
  const trimmed = sql.trim();
  const withoutBegin = trimmed.replace(/^BEGIN\s*;/i, "");
  if (withoutBegin === trimmed) return trimmed;
  return withoutBegin.replace(/COMMIT\s*;?\s*$/i, "").trim();
}

/**
 * Applies pending migrations in order, exactly once, on a single session.
 *
 * `session` must be one dedicated connection: the advisory lock is session
 * scoped, so a pooled executor that spreads statements across connections would
 * lock one connection and release another.
 */
export async function runMigrations(
  session: SqlExecutor,
  migrations: readonly Migration[],
): Promise<MigrationResult> {
  const ordered = sortMigrations(migrations);
  await session.query(CREATE_LEDGER);
  await session.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [ADVISORY_LOCK_KEY]);

  try {
    const ledger = await session.query<{ id: unknown; checksum: unknown }>(
      "SELECT id, checksum FROM schema_migrations",
    );
    const applied = new Map<string, string>(
      ledger.rows.map((row) => [String(row.id), String(row.checksum)]),
    );

    const result: MigrationResult = { applied: [], skipped: [] };
    for (const migration of ordered) {
      const checksum = await sha256Hex(migration.sql);
      const previous = applied.get(migration.id);

      if (previous !== undefined) {
        if (previous !== checksum) throw new MigrationChecksumError(migration.id);
        result.skipped.push(migration.id);
        continue;
      }

      await session.query("BEGIN");
      try {
        await session.query(migrationBody(migration.sql));
        await session.query(
          "INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)",
          [migration.id, checksum],
        );
        await session.query("COMMIT");
      } catch (error) {
        // A failed rollback must not hide the migration error that caused it.
        await session.query("ROLLBACK").catch(() => {});
        throw error;
      }
      result.applied.push(migration.id);
    }

    return result;
  } finally {
    await session.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [ADVISORY_LOCK_KEY]);
  }
}

export async function readAppliedMigrations(session: SqlExecutor): Promise<AppliedMigration[]> {
  const result = await session.query<{ id: unknown; checksum: unknown }>(
    "SELECT id, checksum FROM schema_migrations ORDER BY id",
  );
  return result.rows.map((row) => ({ id: String(row.id), checksum: String(row.checksum) }));
}

#!/usr/bin/env node
import { createNodePostgresDatabase } from "../infra/postgres/node-pg-executor.ts";
import { loadMigrations } from "../infra/postgres/node-migration-source.ts";
import { readAppliedMigrations, runMigrations } from "../infra/postgres/migration-runner.ts";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL tanımlı değil. Migration çalıştırılmadı.");
  process.exit(78);
}

const database = createNodePostgresDatabase({ connectionString });
try {
  const migrations = await loadMigrations();
  const result = await database.session((session) => runMigrations(session, migrations));

  for (const id of result.skipped) console.log(`= ${id} (zaten uygulanmış)`);
  for (const id of result.applied) console.log(`+ ${id} uygulandı`);

  const ledger = await readAppliedMigrations(database);
  console.log(`Şema sürümü: ${ledger.at(-1)?.id ?? "yok"} · toplam ${ledger.length} migration`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}

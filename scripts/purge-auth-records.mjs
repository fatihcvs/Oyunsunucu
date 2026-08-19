#!/usr/bin/env node
/**
 * Removes identity records that can no longer be used.
 *
 * Meant to run on a schedule (Railway cron or a platform job). Safe to run at
 * any time and as often as wanted: it only deletes rows that are already dead,
 * and it never touches a rate-limit bucket whose block is still in force.
 */
import { createNodePostgresDatabase } from "../infra/postgres/node-pg-executor.ts";
import { PostgresAuthRepository } from "../infra/postgres/auth-repository.ts";

/** Consumed and revoked rows are kept briefly so support can still explain a recent sign-in. */
const CONSUMED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL tanımlı değil. Temizlik çalıştırılmadı.");
  process.exit(78);
}

const database = createNodePostgresDatabase({ connectionString });
try {
  const repository = new PostgresAuthRepository(database);
  const removed = await repository.purgeExpiredAuthRecords(new Date(), {
    verificationTokenGraceMs: CONSUMED_GRACE_MS,
  });

  console.log(
    `Temizlendi · doğrulama bağlantısı: ${removed.verificationTokens}` +
    ` · oauth state: ${removed.oauthStates}` +
    ` · oran limiti kovası: ${removed.rateLimitBuckets}` +
    ` · oturum: ${removed.sessions}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}

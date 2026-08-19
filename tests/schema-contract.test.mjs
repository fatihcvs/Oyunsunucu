import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { JOB_KINDS } from "../lib/provisioning-contracts.ts";

const MIGRATIONS = new URL("../infra/postgres/migrations/", import.meta.url);

async function migrationSql() {
  const files = (await readdir(MIGRATIONS)).filter((file) => file.endsWith(".sql")).sort();
  const parts = await Promise.all(files.map((file) => readFile(new URL(file, MIGRATIONS), "utf8")));
  return parts.join("\n");
}

/**
 * The database is the last word on what a job may be.
 *
 * A kind added to the union but not to the CHECK passes every unit test — the
 * fakes have no constraints — and then fails on the first real insert. This
 * test is the tripwire for that gap.
 */
test("every job kind in the contract is accepted by the schema", async () => {
  const sql = await migrationSql();
  const checks = [...sql.matchAll(/CHECK \(kind IN \(([^)]*)\)\)/g)];
  assert.ok(checks.length > 0, "kind CHECK kısıtı bulunamadı");

  // The last definition wins: later migrations replace the constraint.
  const allowed = new Set(
    [...checks.at(-1)[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]),
  );

  for (const kind of JOB_KINDS) {
    assert.ok(allowed.has(kind), `şema ${kind} iş türünü kabul etmiyor`);
  }
  for (const kind of allowed) {
    assert.ok(JOB_KINDS.includes(kind), `şema sözleşmede olmayan ${kind} türüne izin veriyor`);
  }
});

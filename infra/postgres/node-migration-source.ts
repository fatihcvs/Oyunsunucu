import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sortMigrations, type Migration } from "./migration-runner.ts";

const MIGRATIONS_DIRECTORY = new URL("./migrations/", import.meta.url);

/** Node-only loader: reads the checked-in `.sql` files as ordered migrations. */
export async function loadMigrations(directory: URL = MIGRATIONS_DIRECTORY): Promise<Migration[]> {
  const path = fileURLToPath(directory);
  const entries = await readdir(path);
  const files = entries.filter((entry) => entry.endsWith(".sql"));

  const migrations = await Promise.all(files.map(async (file): Promise<Migration> => ({
    id: file.replace(/\.sql$/, ""),
    sql: await readFile(new URL(file, directory), "utf8"),
  })));

  return sortMigrations(migrations);
}

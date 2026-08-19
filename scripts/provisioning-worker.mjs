#!/usr/bin/env node
/**
 * Claims provisioning jobs and applies them to the configured provider.
 *
 * Runs as its own process so a slow or failing provider never blocks a web
 * request. Several copies may run at once: the queue hands each job to exactly
 * one of them and re-offers anything a dead worker was holding.
 *
 * Usage:
 *   DATABASE_URL=... GAME_PROVIDER=docker node scripts/provisioning-worker.mjs
 *   ... node scripts/provisioning-worker.mjs --once
 */
import { hostname } from "node:os";
import { createNodePostgresDatabase } from "../infra/postgres/node-pg-executor.ts";
import { PostgresProvisioningRepository } from "../infra/postgres/provisioning-repository.ts";
import { createDockerGameServerProvider } from "../infra/gameservers/docker-provider.ts";
import { createRailwayGameServerProvider } from "../infra/gameservers/railway-provider.ts";
import { createProvisioningWorker } from "../lib/provisioning-worker.ts";
import { createBackupStore } from "../infra/gameservers/volume-backups.ts";
import { createGameConsole } from "../infra/gameservers/console-access.ts";

const IDLE_POLL_MS = 5_000;

function buildProvider() {
  const kind = process.env.GAME_PROVIDER?.trim();
  if (kind === "railway") {
    return createRailwayGameServerProvider({
      apiToken: process.env.RAILWAY_API_TOKEN?.trim() ?? "",
      projectId: process.env.RAILWAY_GAME_PROJECT_ID?.trim() ?? "",
      environmentId: process.env.RAILWAY_GAME_ENVIRONMENT_ID?.trim() ?? "",
      region: process.env.RAILWAY_GAME_REGION?.trim() || undefined,
      minecraftEulaAccepted: process.env.MINECRAFT_EULA_ACCEPTED === "true",
      // The same secret the web service derives console passwords from, so
      // what the worker writes into the container is what the panel later uses.
      consoleSecret: process.env.AUTH_SECRET?.trim() || undefined,
    });
  }
  if (kind !== "docker") return null;

  return createDockerGameServerProvider({
    publicHost: process.env.GAME_PUBLIC_HOST?.trim() || "127.0.0.1",
    // The operator accepts the game's licence for the servers they run; the
    // worker never assumes it.
    minecraftEulaAccepted: process.env.MINECRAFT_EULA_ACCEPTED === "true",
  });
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL tanımlı değil. Worker başlatılmadı.");
  process.exit(78);
}

const provider = buildProvider();
if (!provider) {
  console.error("GAME_PROVIDER tanımlı değil veya desteklenmiyor. Worker başlatılmadı.");
  process.exit(78);
}

const database = createNodePostgresDatabase({ connectionString });
const worker = createProvisioningWorker({
  repository: new PostgresProvisioningRepository(database),
  provider,
  owner: `${hostname()}:${process.pid}`,
  // Both are optional: without them backup jobs fail with a clear reason
  // instead of the worker refusing to start.
  backups: createBackupStore(process.env) ?? undefined,
  console: createGameConsole(process.env) ?? undefined,
  onOperationalError: (error) => console.error("[riftory] iş hatası", error),
});

let running = true;
const once = process.argv.includes("--once");

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[riftory] ${signal} alındı, işlenen iş bitince duracak`);
    running = false;
  });
}

console.log(`[riftory] worker başladı · sağlayıcı ${provider.name}`);
try {
  while (running) {
    // The scheduler runs first: a due restart should join the queue on this
    // tick rather than wait for the queue to drain.
    const fired = await worker.runScheduleOnce();
    if (fired) console.log(`[riftory] zamanlanmış yeniden başlatma sıraya alındı · sunucu ${fired.serverId}`);

    const worked = await worker.runOnce();
    if (once) break;
    // An empty queue must not become a busy loop against the database.
    if (!worked && !fired) await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
  console.log("[riftory] worker durdu");
}

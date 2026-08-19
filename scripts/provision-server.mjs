#!/usr/bin/env node
/**
 * Grants a server to a customer without a purchase behind it.
 *
 * This is the closed-beta path: internal testers and the first invited
 * customers get a server the operator hands out, while payments stay switched
 * off. It queues the same job a paid order would, so the provisioning pipeline
 * being exercised is the production one, not a side door.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/provision-server.mjs --email oyuncu@example.com --name "Test Sunucusu"
 *   ... --game minecraft --software paper --plan mini-2 --reference beta-01
 */
import { createNodePostgresDatabase } from "../infra/postgres/node-pg-executor.ts";
import { PostgresProvisioningRepository } from "../infra/postgres/provisioning-repository.ts";
import { findGameRuntime } from "../infra/gameservers/runtime-catalog.ts";
import { getPlan, isServerDraft, HOSTING_REGIONS } from "../lib/catalog.ts";

function parseArguments(argv) {
  const options = {
    email: "",
    name: "Riftory Sunucusu",
    game: "minecraft",
    software: "paper",
    plan: "mini-2",
    reference: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key in options) options[key] = argv[index + 1] ?? options[key];
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error("DATABASE_URL tanımlı değil.");
  process.exit(78);
}
if (!options.email) {
  console.error("--email gerekli: sunucunun hangi hesaba verileceği belirtilmeli.");
  process.exit(64);
}

const region = HOSTING_REGIONS[0].id;
const specification = {
  gameId: options.game,
  softwareId: options.software,
  planId: options.plan,
  regionId: region,
  serverName: options.name,
};

// The same rules the store applies: an operator must not be able to hand out a
// combination the product cannot host.
if (!isServerDraft({ ...specification, backups: false })) {
  console.error(`Satışa açık olmayan birleşim: ${options.game}/${options.software}/${options.plan}`);
  process.exit(65);
}
const runtime = findGameRuntime(options.game, options.software);
if (!runtime?.image) {
  console.error(`Çalışma ortamı çözülmemiş: ${options.game}/${options.software}`);
  process.exit(65);
}
const plan = getPlan(options.plan);
if (plan.ram * 1024 < runtime.minimumMemoryMb) {
  console.error(`${options.plan} bu çalışma ortamı için yetersiz (en az ${runtime.minimumMemoryMb} MB).`);
  process.exit(65);
}

const database = createNodePostgresDatabase({ connectionString });
try {
  const owner = await database.query(
    "SELECT id::text AS id FROM users WHERE email = $1 AND deleted_at IS NULL AND status = 'active'",
    [options.email.trim().toLocaleLowerCase("en-US")],
  );
  const ownerUserId = owner.rows[0]?.id;
  if (!ownerUserId) {
    console.error(`Kullanıcı bulunamadı: ${options.email}. Önce bu adresle giriş yapılmalı.`);
    process.exit(65);
  }

  const repository = new PostgresProvisioningRepository(database);
  const queued = await repository.enqueueServerSetup({
    orderId: null,
    reference: options.reference || `manual:${ownerUserId}:${options.name}`,
    ownerUserId,
    specification,
    now: new Date(),
  });

  console.log(queued.created ? "sunucu sıraya alındı" : "bu referans için zaten bir sunucu var");
  console.log(`server: ${queued.server.serverId}`);
  console.log(`job:    ${queued.jobId}`);
  console.log(`\nkurulumu başlatmak için: GAME_PROVIDER=docker npm run worker`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}

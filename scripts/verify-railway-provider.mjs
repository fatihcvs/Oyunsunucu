#!/usr/bin/env node
/**
 * Proves the Railway provider against the real API.
 *
 * Creates one game server, waits for its TCP proxy to answer, then removes
 * everything it made. Run it after changing provider credentials or the
 * runtime catalog: a provider that cannot deliver a reachable server is worth
 * discovering here rather than on a customer's first order.
 *
 * Creates billable resources for the duration of the run.
 *
 * Usage:
 *   railway run --service web -- node scripts/verify-railway-provider.mjs \
 *     --project <projectId> --environment <environmentId> --keep-seconds 180
 */
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { createRailwayGameServerProvider } from "../infra/gameservers/railway-provider.ts";
import { findGameRuntime } from "../infra/gameservers/runtime-catalog.ts";
import { getPlan } from "../lib/catalog.ts";

function parseArguments(argv) {
  const options = {
    project: process.env.RAILWAY_GAME_PROJECT_ID ?? "",
    environment: process.env.RAILWAY_GAME_ENVIRONMENT_ID ?? "",
    game: "minecraft",
    software: "paper",
    plan: "mini-2",
    region: process.env.RAILWAY_GAME_REGION ?? "",
    "keep-seconds": "420",
    keep: false,
    lifecycle: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "keep") options.keep = true;
    else if (key === "lifecycle") options.lifecycle = true;
    else if (key in options) options[key] = argv[index + 1] ?? options[key];
  }
  return options;
}

function probeTcp(host, port, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => resolve(false));
  });
}

const options = parseArguments(process.argv.slice(2));
const token = process.env.RAILWAY_API_TOKEN?.trim();

if (!token) {
  console.error("RAILWAY_API_TOKEN yok. `railway run` ile çalıştırın.");
  process.exit(78);
}
if (!options.project || !options.environment) {
  console.error("--project ve --environment gerekli.");
  process.exit(64);
}

const runtime = findGameRuntime(options.game, options.software);
if (!runtime?.image) {
  console.error(`Çalışma ortamı çözülmemiş: ${options.game}/${options.software}`);
  process.exit(65);
}

const provider = createRailwayGameServerProvider({
  apiToken: token,
  projectId: options.project,
  environmentId: options.environment,
  region: options.region || undefined,
  minecraftEulaAccepted: process.env.MINECRAFT_EULA_ACCEPTED === "true",
});

const serverId = randomUUID();
const plan = getPlan(options.plan);
let created = false;

try {
  console.log(`[1/4] sunucu oluşturuluyor · ${options.game}/${options.software} · ${plan.ram} GB`);
  const provisioned = await provider.createServer({
    serverId,
    name: "Railway Dogrulama",
    runtime,
    memoryMb: plan.ram * 1024,
    storageGb: plan.storage,
    regionId: "eu-west",
  });
  created = true;

  console.log(`[2/4] kaynaklar: ${provisioned.resources.map((r) => `${r.kind}`).join(", ")}`);
  if (!provisioned.connection) throw new Error("TCP proxy adresi alınamadı.");
  const { host, port } = provisioned.connection;
  console.log(`      adres: ${host}:${port}`);

  console.log("[3/4] sunucunun açılması bekleniyor");
  const deadline = Date.now() + Number(options["keep-seconds"]) * 1000;
  let reachable = false;
  while (Date.now() < deadline) {
    if (await probeTcp(host, port)) { reachable = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }

  console.log(reachable ? `[4/4] TCP ${host}:${port} yanıt veriyor` : "[4/4] süre içinde yanıt alınamadı");
  process.exitCode = reachable ? 0 : 1;

  if (options.lifecycle) {
    // Stop, start and restart are what the panel's buttons will call. A
    // provider that can create but not control a server is only half built.
    console.log("[+] durdur"); await provider.stopServer(serverId);
    console.log("[+] baslat"); await provider.startServer(serverId);
    console.log("[+] yeniden baslat"); await provider.restartServer(serverId);

    const after = await provider.getConnectionInfo(serverId);
    // The address must survive the cycle: a customer who restarts should not
    // have to hand their friends a new one.
    const kept = after?.host === host && after?.port === port;
    console.log(`[+] adres korundu: ${kept ? "evet" : `HAYIR (${after?.host}:${after?.port})`}`);
    if (!kept) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (created && !options.keep) {
    console.log("temizleniyor…");
    await provider.deleteServer(serverId).catch((error) => {
      // A leaked service keeps costing money, so a failed cleanup must be loud.
      console.error(`TEMİZLİK BAŞARISIZ — servis elle silinmeli: game-${serverId}`, error);
    });
    console.log("silindi");
  } else if (created) {
    console.log(`bırakıldı: game-${serverId}`);
  }
}

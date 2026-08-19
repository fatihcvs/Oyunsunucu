#!/usr/bin/env node
/**
 * Boots one catalog combination under a plan-sized memory limit and proves the
 * claims the store makes about it: it starts, it accepts TCP connections, it
 * shuts down gracefully, the world survives a restart, and a settings change
 * actually reaches the running server without losing data.
 *
 * Usage:
 *   node scripts/certify-game-runtime.mjs --game minecraft --software paper --plan mini-2
 */
import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import { getPlan, HOSTING_PLANS } from "../lib/catalog.ts";
import { findGameRuntime, heapMegabytes } from "../infra/gameservers/runtime-catalog.ts";

const run = promisify(execFile);

const READINESS_TIMEOUT_MS = 420_000;
const STOP_TIMEOUT_SECONDS = 120;
const POLL_INTERVAL_MS = 3_000;
const BUSYBOX_IMAGE = "busybox:1.37";

function parseArguments(argv) {
  const options = { game: "minecraft", software: "paper", plan: "mini-2", port: null, keep: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--keep") options.keep = true;
    else if (flag.startsWith("--")) {
      const key = flag.slice(2);
      if (key in options) options[key] = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

async function docker(args, { allowFailure = false } = {}) {
  try {
    const { stdout, stderr } = await run("docker", args, { maxBuffer: 32 * 1024 * 1024 });
    return `${stdout}${stderr}`;
  } catch (error) {
    if (allowFailure) return "";
    throw new Error(`docker ${args.slice(0, 2).join(" ")} başarısız: ${error.stderr || error.message}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function removeContainer(container) {
  await docker(["rm", "-f", container], { allowFailure: true });
}

/** Failures carry the container's own last words; otherwise cleanup destroys the evidence. */
async function readinessFailure(container, reason) {
  const logs = await docker(["logs", "--tail", "40", container], { allowFailure: true });
  return new Error(`${reason}\n--- son kapsayıcı çıktısı ---\n${logs.trim()}`);
}

/**
 * `startedAt` also bounds the log window. A restart appends to the same log, so
 * scanning the whole file would match the previous boot's readiness line and
 * report a server as ready while it is still loading.
 */
async function waitForReadiness(container, pattern, startedAt) {
  const readiness = new RegExp(pattern);
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  const since = new Date(startedAt - 1_000).toISOString();

  while (Date.now() < deadline) {
    const logs = await docker(["logs", "--since", since, container], { allowFailure: true });
    if (readiness.test(logs)) return Date.now() - startedAt;

    const state = await docker(["inspect", "-f", "{{.State.Status}} {{.State.OOMKilled}}", container]);
    const [status, oomKilled] = state.trim().split(" ");
    if (oomKilled === "true") throw await readinessFailure(container, "Kapsayıcı bellek sınırında OOM ile öldürüldü.");
    if (status === "exited") throw await readinessFailure(container, "Kapsayıcı hazır olmadan çıktı.");
    await sleep(POLL_INTERVAL_MS);
  }

  throw await readinessFailure(container, `Hazır olma deseni ${READINESS_TIMEOUT_MS / 1000} saniyede görülmedi.`);
}

function probeTcp(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 10_000 });
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => resolve(false));
  });
}

async function memorySnapshotMb(container) {
  const stats = await docker(["stats", "--no-stream", "--format", "{{.MemUsage}}", container]);
  const used = stats.trim().split("/")[0]?.trim() ?? "";
  const value = Number.parseFloat(used);
  if (!Number.isFinite(value)) return null;
  if (/GiB/i.test(used)) return Math.round(value * 1024);
  if (/MiB/i.test(used)) return Math.round(value);
  return Math.round(value / 1024);
}

/** Edits the data volume while no server is running, the way provisioning would. */
async function editVolume(volume, mountPath, shellCommand) {
  await docker([
    "run", "--rm", "-v", `${volume}:${mountPath}`, BUSYBOX_IMAGE, "sh", "-c", shellCommand,
  ]);
}

/**
 * Per-game behaviour the harness cannot infer from the catalog.
 *
 * `worldIdentity` must stay identical across a restart. `setting` describes one
 * real, customer-facing option: how the panel would change it and how to read
 * the value back from the running server rather than from our own request.
 */
const GAME_PROFILES = {
  minecraft: {
    environment: (runtime, plan, setting) => [
      "-e", "EULA=TRUE",
      "-e", `TYPE=${runtime.softwareId.toUpperCase()}`,
      "-e", `VERSION=${runtime.gameVersion}`,
      "-e", `MEMORY=${heapMegabytes(plan.ram * 1024)}M`,
      "-e", "ENABLE_RCON=true",
      "-e", "RCON_PASSWORD=riftory-local-test",
      "-e", "ONLINE_MODE=FALSE",
      "-e", "LEVEL=world",
      "-e", `MAX_PLAYERS=${setting}`,
    ],
    worldIdentity: async (container) => {
      const output = await docker(["exec", container, "rcon-cli", "seed"]);
      return output.match(/-?\d+/)?.[0] ?? null;
    },
    setting: {
      label: "max-players",
      initial: "20",
      changed: "12",
      // `list` answers from the live server, so this proves the value took
      // effect rather than merely landing in a file.
      read: async (container) => {
        const output = await docker(["exec", container, "rcon-cli", "list"], { allowFailure: true });
        return output.match(/max of (\d+)/)?.[1] ?? null;
      },
    },
  },

  terraria: {
    // Our image derives every server argument from these, so `-world` and
    // `-worldname` can no longer drift apart and autocreate a second world.
    environment: (runtime, plan, setting) => [
      "-e", "WORLD_NAME=Riftory",
      "-e", `WORLD_DIR=${runtime.dataPath}`,
      "-e", `PORT=${runtime.containerPort}`,
      "-e", `MAXPLAYERS=${setting}`,
    ],
    /**
     * The set of world files, by name.
     *
     * Byte size is deliberately not part of the identity: a graceful shutdown
     * rewrites the world, so an unchanged size would mean the save never ran.
     * What must not change is which worlds exist — the data-loss bug this
     * catches is autocreate silently generating a second world on restart.
     */
    worldIdentity: async (container, runtime) => {
      const output = await docker([
        "exec", container, "sh", "-c", `ls ${runtime.dataPath}/*.wld 2>/dev/null | sort`,
      ], { allowFailure: true });
      return output.trim() || null;
    },
    setting: {
      label: "maxplayers",
      initial: "8",
      changed: "12",
      // Terraria never echoes its configuration, so our entrypoint reports it.
      read: async (container) => {
        const logs = await docker(["logs", container], { allowFailure: true });
        return [...logs.matchAll(/\[riftory\] ayarlar .*maxplayers=(\d+)/g)].at(-1)?.[1] ?? null;
      },
    },
  },

  vintagestory: {
    environment: () => [],
    /**
     * Save databases only. The `-wal` and `-shm` siblings are SQLite's own
     * journal files: they exist while the database is open and disappear on a
     * clean close, so counting them would read a healthy shutdown as data loss.
     */
    worldIdentity: async (container, runtime) => {
      const output = await docker([
        "exec", container, "sh", "-c", `ls ${runtime.dataPath}/Saves/*.vcdbs 2>/dev/null | sort`,
      ], { allowFailure: true });
      return output.trim() || null;
    },
    setting: {
      label: "MaxClients",
      initial: "16",
      changed: "12",
      // Config lives in the data volume, so the change is applied there rather
      // than through the container definition.
      applyToVolume: (value, runtime) => (
        `sed -i 's/"MaxClients": *[0-9]*/"MaxClients": ${value}/' ${runtime.dataPath}/serverconfig.json`
      ),
      read: async (container, runtime) => {
        const output = await docker([
          "exec", container, "sh", "-c",
          `grep -o '"MaxClients": *[0-9]*' ${runtime.dataPath}/serverconfig.json`,
        ], { allowFailure: true });
        return output.match(/(\d+)/)?.[1] ?? null;
      },
    },
  },
};

async function startContainer({ container, volume, runtime, plan, hostPort, settingValue }) {
  const profile = GAME_PROFILES[runtime.gameId];
  await docker([
    "run", "-d",
    "--name", container,
    "--memory", `${plan.ram * 1024}m`,
    "--memory-swap", `${plan.ram * 1024}m`,
    "-p", `${hostPort}:${runtime.containerPort}`,
    "-v", `${volume}:${runtime.dataPath}`,
    ...profile.environment(runtime, plan, settingValue),
    runtime.image,
  ]);
}

async function gracefulStop(container) {
  const startedAt = Date.now();
  await docker(["stop", "--timeout", String(STOP_TIMEOUT_SECONDS), container]);
  const state = await docker(["inspect", "-f", "{{.State.ExitCode}} {{.State.OOMKilled}}", container]);
  const [exitCode, oomKilled] = state.trim().split(" ");

  return {
    seconds: Math.round((Date.now() - startedAt) / 100) / 10,
    exitCode: Number(exitCode),
    oomKilled: oomKilled === "true",
  };
}

async function certify(options) {
  const runtime = findGameRuntime(options.game, options.software);
  if (!runtime) throw new Error(`Katalogda çalışma ortamı yok: ${options.game}/${options.software}`);
  if (!runtime.image) throw new Error(`${options.game}/${options.software} için sabitlenmiş imaj yok.`);

  const profile = GAME_PROFILES[runtime.gameId];
  if (!profile) throw new Error(`${runtime.gameId} için prova profili tanımlı değil.`);

  const plan = getPlan(options.plan);
  if (plan.id !== options.plan) throw new Error(`Bilinmeyen plan: ${options.plan}`);

  const planMemoryMb = plan.ram * 1024;
  if (planMemoryMb < runtime.minimumMemoryMb) {
    throw new Error(
      `${runtime.gameId}/${runtime.softwareId} en az ${runtime.minimumMemoryMb} MB ister; ${plan.id} ${planMemoryMb} MB veriyor.`,
    );
  }

  if (runtime.gameId === "minecraft" && process.env.MINECRAFT_EULA_ACCEPTED !== "true") {
    throw new Error(
      "Minecraft sunucusu Mojang EULA kabulü gerektirir. Operatör onayı için MINECRAFT_EULA_ACCEPTED=true ayarlayın.",
    );
  }

  const container = `riftory-cert-${runtime.gameId}-${runtime.softwareId}-${plan.id}`;
  const volume = `${container}-data`;
  const hostPort = Number(options.port ?? (runtime.containerPort + 12));
  const startArguments = { container, volume, runtime, plan, hostPort };

  const report = {
    game: runtime.gameId,
    software: runtime.softwareId,
    plan: plan.id,
    planMemoryMb,
    heapMb: runtime.gameId === "minecraft" ? heapMegabytes(planMemoryMb) : null,
    image: runtime.image,
  };

  await removeContainer(container);
  await docker(["volume", "rm", "-f", volume], { allowFailure: true });
  await docker(["volume", "create", volume]);

  try {
    console.log(`[1/9] ${container} başlatılıyor (${planMemoryMb} MB sınır)`);
    const bootStartedAt = Date.now();
    await startContainer({ ...startArguments, settingValue: profile.setting.initial });
    report.firstBootSeconds = Math.round(
      await waitForReadiness(container, runtime.readinessPattern, bootStartedAt) / 100,
    ) / 10;
    console.log(`[2/9] İlk açılış ${report.firstBootSeconds} sn`);

    report.tcpReachable = await probeTcp(hostPort);
    report.memoryAfterBootMb = await memorySnapshotMb(container);
    console.log(`[3/9] TCP ${report.tcpReachable ? "açık" : "KAPALI"} · bellek ${report.memoryAfterBootMb} MB`);

    report.worldIdentityBefore = await profile.worldIdentity(container, runtime);
    report.settingBefore = await profile.setting.read(container, runtime);
    await docker(["exec", container, "sh", "-c", `echo riftory-persistence-marker > ${runtime.dataPath}/riftory-marker.txt`]);
    console.log(`[4/9] Dünya: ${report.worldIdentityBefore?.slice(0, 50) ?? "okunamadı"} · ${profile.setting.label}=${report.settingBefore}`);

    const stop = await gracefulStop(container);
    report.gracefulStopSeconds = stop.seconds;
    report.stopExitCode = stop.exitCode;
    report.oomKilled = stop.oomKilled;
    console.log(`[5/9] Graceful kapanış ${stop.seconds} sn · çıkış kodu ${stop.exitCode}`);

    const restartStartedAt = Date.now();
    await docker(["start", container]);
    report.restartSeconds = Math.round(
      await waitForReadiness(container, runtime.readinessPattern, restartStartedAt) / 100,
    ) / 10;
    console.log(`[6/9] Yeniden açılış ${report.restartSeconds} sn`);

    report.worldIdentityAfter = await profile.worldIdentity(container, runtime);
    const marker = await docker(["exec", container, "cat", `${runtime.dataPath}/riftory-marker.txt`], { allowFailure: true });
    report.markerSurvived = marker.includes("riftory-persistence-marker");
    report.worldPreserved = Boolean(report.worldIdentityBefore) &&
      report.worldIdentityBefore === report.worldIdentityAfter;
    console.log(`[7/9] Dünya korundu: ${report.worldPreserved ? "evet" : "HAYIR"}`);

    // A settings change is a redeploy: the container is replaced while the data
    // volume stays, exactly as a panel change would reach a hosted server.
    console.log(`[8/9] Ayar değişikliği ${profile.setting.label}: ${profile.setting.initial} → ${profile.setting.changed}`);
    const settingsStop = await gracefulStop(container);
    report.settingsStopExitCode = settingsStop.exitCode;
    await removeContainer(container);
    if (profile.setting.applyToVolume) {
      await editVolume(volume, runtime.dataPath, profile.setting.applyToVolume(profile.setting.changed, runtime));
    }

    const settingsStartedAt = Date.now();
    await startContainer({ ...startArguments, settingValue: profile.setting.changed });
    report.settingsRestartSeconds = Math.round(
      await waitForReadiness(container, runtime.readinessPattern, settingsStartedAt) / 100,
    ) / 10;

    report.settingAfter = await profile.setting.read(container, runtime);
    report.settingApplied = report.settingAfter === profile.setting.changed;
    const identityAfterSettings = await profile.worldIdentity(container, runtime);
    report.worldSurvivedSettingsChange = identityAfterSettings === report.worldIdentityBefore;
    report.memoryAfterRestartMb = await memorySnapshotMb(container);
    report.peakMemoryMb = Math.max(report.memoryAfterBootMb ?? 0, report.memoryAfterRestartMb ?? 0);
    report.headroomMb = planMemoryMb - report.peakMemoryMb;
    console.log(
      `        ${profile.setting.label}=${report.settingAfter} · dünya ${report.worldSurvivedSettingsChange ? "korundu" : "KAYBOLDU"}`,
    );

    // A SIGKILLed container (137) never got to save its world, so a clean exit
    // code is part of the claim, not a detail.
    report.gracefulStop = report.stopExitCode === 0 && report.settingsStopExitCode === 0;
    report.verdict = report.tcpReachable && report.worldPreserved && report.markerSurvived &&
      report.gracefulStop && report.settingApplied && report.worldSurvivedSettingsChange && !report.oomKilled
      ? "certified"
      : "failed";
    console.log(`[9/9] Sonuç: ${report.verdict}`);

    // A failed run is exactly when the container is worth inspecting.
    if (!options.keep && report.verdict === "certified") {
      await removeContainer(container);
      await docker(["volume", "rm", "-f", volume], { allowFailure: true });
    } else {
      console.error(`Kapsayıcı incelenmek üzere bırakıldı: ${container}`);
    }
    return report;
  } catch (error) {
    console.error(`Kapsayıcı incelenmek üzere bırakıldı: ${container}`);
    throw error;
  }
}

const options = parseArguments(process.argv.slice(2));
if (!HOSTING_PLANS.some((plan) => plan.id === options.plan)) {
  console.error(`Plan bulunamadı: ${options.plan}`);
  process.exit(64);
}

try {
  const report = await certify(options);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verdict === "certified" ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

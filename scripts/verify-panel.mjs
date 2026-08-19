#!/usr/bin/env node
/**
 * Proves the panel against the live deployment.
 *
 * Creates a throwaway account with a real session, grants it a real server,
 * waits for the worker to build it, then drives stop and start through the
 * public HTTP API exactly as the panel's buttons do. Everything it made is
 * removed at the end.
 *
 * The account is created through the same magic-link exchange a customer goes
 * through; only the email delivery step is skipped, because the challenge token
 * is generated here rather than read from an inbox. That keeps the session this
 * test uses indistinguishable from a real one.
 *
 * Creates billable resources for the duration of the run.
 *
 * Usage:
 *   railway run --service web -- node scripts/verify-panel.mjs --base https://<app>
 */
import { createNodePostgresDatabase } from "../infra/postgres/node-pg-executor.ts";
import { PostgresAuthRepository } from "../infra/postgres/auth-repository.ts";
import { PostgresProvisioningRepository } from "../infra/postgres/provisioning-repository.ts";
import { SESSION_COOKIE_NAME, createOpaqueToken } from "../lib/auth-security.ts";
import { findGameRuntime } from "../infra/gameservers/runtime-catalog.ts";

function parseArguments(argv) {
  const options = {
    base: process.env.APP_ORIGIN ?? "",
    game: "minecraft",
    software: "paper",
    plan: "mini-2",
    "wait-seconds": "600",
    keep: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "keep") options.keep = true;
    else if (key in options) options[key] = argv[index + 1] ?? options[key];
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error("DATABASE_URL yok. `railway run` ile çalıştırın.");
  process.exit(78);
}
if (!options.base) {
  console.error("--base gerekli: panelin canlı adresi.");
  process.exit(64);
}

const base = options.base.replace(/\/$/, "");
const runtime = findGameRuntime(options.game, options.software);
if (!runtime?.image) {
  console.error(`Çalışma ortamı çözülmemiş: ${options.game}/${options.software}`);
  process.exit(65);
}

const email = `panel-test-${Date.now()}@riftory.invalid`;
const now = new Date();

const database = createNodePostgresDatabase({ connectionString });
const auth = new PostgresAuthRepository(database);
const provisioning = new PostgresProvisioningRepository(database);

let sessionToken = "";
let userId = "";
let serverId = "";
let failures = 0;

function check(label, passed, detail = "") {
  console.log(`${passed ? "[+]" : "[!]"} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!passed) failures += 1;
}

/** Calls the live API the way the panel's browser code does. */
async function api(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      ...(init.body ? { "content-type": "application/json", origin: base } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

try {
  console.log(`[1/6] test hesabı açılıyor · ${email}`);
  const challenge = await createOpaqueToken();
  const challengeId = await auth.createMagicLinkChallenge({
    purpose: "verify_email",
    email,
    tokenHash: challenge.tokenHash,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    returnTo: "/panel",
    displayName: "Panel Testi",
    consentVersion: "kvkk-iletisim-v1-2026-08-14",
    requestedIp: null,
  });
  await auth.markMagicLinkDelivered(challengeId, now);

  const session = await createOpaqueToken();
  const identity = await auth.exchangeMagicLink({
    challengeTokenHash: challenge.tokenHash,
    sessionTokenHash: session.tokenHash,
    sessionExpiresAt: new Date(now.getTime() + 60 * 60_000),
    now,
    ipAddress: null,
    userAgent: null,
  });
  sessionToken = session.rawToken;
  userId = identity.userId;

  console.log("[2/6] boş panel okunuyor");
  const empty = await api("/api/servers");
  check("oturumlu listeleme 200", empty.status === 200, String(empty.status));
  check("yeni hesapta sunucu yok", Array.isArray(empty.body?.servers) && empty.body.servers.length === 0);

  const anonymous = await fetch(`${base}/api/servers`, { headers: { accept: "application/json" } });
  check("oturumsuz listeleme 401", anonymous.status === 401, String(anonymous.status));

  console.log("[3/6] sunucu sıraya alınıyor");
  const queued = await provisioning.enqueueServerSetup({
    orderId: null,
    reference: `panel-test:${userId}`,
    ownerUserId: userId,
    specification: {
      gameId: options.game,
      softwareId: options.software,
      planId: options.plan,
      regionId: "eu-west",
      serverName: "Panel Testi",
    },
    now: new Date(),
  });
  serverId = queued.server.serverId;

  const queuedView = await api("/api/servers");
  const listed = queuedView.body?.servers?.[0];
  check("panel yeni sunucuyu görüyor", listed?.serverId === serverId);
  check("kurulum sürerken komut sunulmuyor", listed?.availableCommands?.length === 0, listed?.busyWith ?? "");

  console.log("[4/6] worker'ın kurmasını bekliyor");
  const deadline = Date.now() + Number(options["wait-seconds"]) * 1000;
  let live = null;
  while (Date.now() < deadline) {
    const poll = await api("/api/servers");
    const server = poll.body?.servers?.[0];
    if (server?.status === "online" && server.connection) { live = server; break; }
    if (server?.status === "failed") { live = server; break; }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  check("sunucu çevrimiçi", live?.status === "online", live?.status ?? "zaman aşımı");
  check("adres atandı", Boolean(live?.connection), live?.connection ? `${live.connection.host}:${live.connection.port}` : "");
  check("çevrimiçi sunucu durdur ve yeniden başlat sunuyor",
    live?.availableCommands?.join(",") === "durdur,yeniden-baslat", live?.availableCommands?.join(",") ?? "");

  const detail = await api(`/api/servers?serverId=${encodeURIComponent(serverId)}`);
  check("geçmiş okunuyor", detail.status === 200 && Array.isArray(detail.body?.events) && detail.body.events.length > 0,
    `${detail.body?.events?.length ?? 0} kayıt`);

  console.log("[5/6] panel butonları sürülüyor");
  const strangerId = "33333333-3333-4333-8333-333333333333";
  const stranger = await api("/api/servers", {
    method: "POST",
    body: JSON.stringify({ serverId: strangerId, command: "durdur" }),
  });
  check("başkasının sunucusu 404", stranger.status === 404, String(stranger.status));

  const crossSite = await fetch(`${base}/api/servers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://saldirgan.example",
      cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
    },
    body: JSON.stringify({ serverId, command: "durdur" }),
  });
  check("yabancı origin 403", crossSite.status === 403, String(crossSite.status));

  if (live?.status === "online") {
    const stop = await api("/api/servers", { method: "POST", body: JSON.stringify({ serverId, command: "durdur" }) });
    check("durdur sıraya alındı", stop.status === 202, String(stop.status));

    const double = await api("/api/servers", { method: "POST", body: JSON.stringify({ serverId, command: "baslat" }) });
    check("işlem sürerken ikinci komut reddedildi", double.status === 409, String(double.status));

    const stopped = await waitForStatus("suspended", 300);
    check("sunucu durdu", stopped?.status === "suspended", stopped?.status ?? "zaman aşımı");
    check("durdurulmuş sunucu yalnızca başlat sunuyor",
      stopped?.availableCommands?.join(",") === "baslat", stopped?.availableCommands?.join(",") ?? "");

    const start = await api("/api/servers", { method: "POST", body: JSON.stringify({ serverId, command: "baslat" }) });
    check("başlat sıraya alındı", start.status === 202, String(start.status));

    const started = await waitForStatus("online", 300);
    check("sunucu tekrar çevrimiçi", started?.status === "online", started?.status ?? "zaman aşımı");
    check("adres korundu",
      started?.connection?.host === live.connection?.host && started?.connection?.port === live.connection?.port,
      `${started?.connection?.host}:${started?.connection?.port}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failures += 1;
} finally {
  console.log("[6/6] temizleniyor");
  if (serverId && !options.keep) {
    // The provider resources go through the same delete path the worker uses,
    // so a leaked service here would be a real bug, not a test artefact.
    await provisioning.enqueueLifecycleJob({ serverId, ownerUserId: userId, kind: "delete_server", now: new Date() })
      .then(() => waitForStatus("deleted", 300, true))
      .catch((error) => console.error("silme sıraya alınamadı:", error.message));
  }
  if (userId && !options.keep) {
    await database.query("DELETE FROM server_events WHERE server_id = $1::uuid", [serverId]).catch(() => {});
    await database.query("DELETE FROM provisioning_jobs WHERE server_id = $1::uuid", [serverId]).catch(() => {});
    await database.query("DELETE FROM provider_resources WHERE server_id = $1::uuid", [serverId]).catch(() => {});
    await database.query("DELETE FROM servers WHERE id = $1::uuid", [serverId]).catch(() => {});
    await database.query("DELETE FROM auth_sessions WHERE user_id = $1::uuid", [userId]).catch(() => {});
    await database.query("DELETE FROM verification_tokens WHERE user_id = $1::uuid", [userId]).catch(() => {});
    await database.query("DELETE FROM consents WHERE user_id = $1::uuid", [userId]).catch(() => {});
    await database.query("DELETE FROM auth_accounts WHERE user_id = $1::uuid", [userId]).catch(() => {});
    await database.query("DELETE FROM audit_logs WHERE actor_user_id = $1::uuid", [userId]).catch(() => {});
    await database.query("DELETE FROM users WHERE id = $1::uuid", [userId]).catch(() => {});
  }
  await database.close();

  console.log(failures === 0 ? "\nTÜMÜ GEÇTİ" : `\n${failures} DOĞRULAMA BAŞARISIZ`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/** Polls the live panel until the server reaches a state, or time runs out. */
async function waitForStatus(target, seconds, allowMissing = false) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const poll = await api("/api/servers");
    const server = poll.body?.servers?.find((candidate) => candidate.serverId === serverId);
    // A deleted server drops out of the list; that absence is the success.
    if (!server) return allowMissing ? { status: target } : null;
    if (server.status === target && !server.busyWith) return server;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return null;
}

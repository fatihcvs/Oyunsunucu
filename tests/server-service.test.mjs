import assert from "node:assert/strict";
import test from "node:test";
import { createServerService } from "../lib/server-service.ts";
import { canCommandServer, isServerCommand } from "../lib/provisioning-contracts.ts";
import { DEFAULT_SERVER_DRAFT } from "../lib/catalog.ts";

const OWNER = "22222222-2222-4222-8222-222222222222";
const SERVER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "oturum-belirteci";

function ownedServer(overrides = {}) {
  return {
    serverId: SERVER_ID,
    ownerUserId: OWNER,
    status: "online",
    gameId: DEFAULT_SERVER_DRAFT.gameId,
    softwareId: DEFAULT_SERVER_DRAFT.softwareId,
    planId: DEFAULT_SERVER_DRAFT.planId,
    regionId: DEFAULT_SERVER_DRAFT.regionId,
    name: "Test Sunucusu",
    connection: { host: "metro.proxy.rlwy.net", port: 28520 },
    pendingJobKind: null,
    createdAt: "2026-08-15T09:00:00.000Z",
    updatedAt: "2026-08-15T09:05:00.000Z",
    ...overrides,
  };
}

function buildService({ servers = [ownedServer()], session = { userId: OWNER, email: "a@b.c" }, repository = {} } = {}) {
  const enqueued = [];
  const saved = [];
  const service = createServerService({
    auth: { async authenticateSession(token) { return token === TOKEN ? session : null; } },
    servers: {
      async listServersForOwner(ownerUserId) {
        return servers.filter((candidate) => candidate.ownerUserId === ownerUserId);
      },
      async listServerEvents() {
        return [{ kind: "job_succeeded", message: "Sunucun hazır.", occurredAt: "2026-08-15T09:05:00.000Z" }];
      },
      async enqueueLifecycleJob(input) {
        enqueued.push(input);
        return { jobId: "job-1", created: true };
      },
      async saveSettings(input) {
        saved.push(input);
        return { status: "queued", jobId: "job-settings-1" };
      },
      ...repository,
    },
  });
  return { service, enqueued, saved };
}

test("lists the caller's servers with the commands their state allows", async () => {
  const { service } = buildService();

  const { servers } = await service.listServers(TOKEN);
  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0].connection, { host: "metro.proxy.rlwy.net", port: 28520 });
  assert.deepEqual(servers[0].availableCommands, ["durdur", "yeniden-baslat"]);
  // The internal owner id is not part of what the panel receives.
  assert.equal("ownerUserId" in servers[0], false);
});

test("a stopped server offers only start", async () => {
  const { service } = buildService({ servers: [ownedServer({ status: "suspended" })] });

  const { servers } = await service.listServers(TOKEN);
  assert.deepEqual(servers[0].availableCommands, ["baslat"]);
});

test("a server still being set up offers nothing", async () => {
  const { service } = buildService({
    servers: [ownedServer({ status: "requested", connection: null, pendingJobKind: "create_server" })],
  });

  const { servers } = await service.listServers(TOKEN);
  assert.deepEqual(servers[0].availableCommands, []);
  assert.equal(servers[0].busyWith, "create_server");
});

test("a signed-out caller is refused before any database work", async () => {
  const { service } = buildService({
    repository: { async listServersForOwner() { throw new Error("çağrılmamalıydı"); } },
  });

  await assert.rejects(() => service.listServers("yanlis-belirtec"), /giriş yapılmalıdır/);
});

test("queues the job matching the command", async () => {
  const { service, enqueued } = buildService();

  const result = await service.commandServer({ rawToken: TOKEN, serverId: SERVER_ID, command: "yeniden-baslat" });
  assert.equal(result.queued, true);
  assert.equal(enqueued[0].kind, "restart_server");
  assert.equal(enqueued[0].ownerUserId, OWNER);
});

test("refuses a command the server's state cannot carry out", async () => {
  const { service, enqueued } = buildService({ servers: [ownedServer({ status: "suspended" })] });

  await assert.rejects(
    () => service.commandServer({ rawToken: TOKEN, serverId: SERVER_ID, command: "durdur" }),
    /bu işlem yapılamaz/,
  );
  assert.equal(enqueued.length, 0);
});

test("refuses a second command while one is in flight", async () => {
  const { service, enqueued } = buildService({ servers: [ownedServer({ pendingJobKind: "restart_server" })] });

  await assert.rejects(
    () => service.commandServer({ rawToken: TOKEN, serverId: SERVER_ID, command: "durdur" }),
    /bekleyen bir işlem/,
  );
  assert.equal(enqueued.length, 0);
});

test("a stranger's server answers exactly like a missing one", async () => {
  const { service, enqueued } = buildService({ servers: [ownedServer({ ownerUserId: "someone-else" })] });

  await assert.rejects(
    () => service.commandServer({ rawToken: TOKEN, serverId: SERVER_ID, command: "durdur" }),
    /Sunucu bulunamadı/,
  );
  await assert.rejects(() => service.readServer(TOKEN, SERVER_ID), /Sunucu bulunamadı/);
  assert.equal(enqueued.length, 0);
});

test("a database outage is reported as unavailable, not as an empty list", async () => {
  const { service } = buildService({
    repository: { async listServersForOwner() { throw new Error("bağlantı koptu"); } },
  });

  await assert.rejects(() => service.listServers(TOKEN), (error) => {
    assert.equal(error.code, "SERVERS_UNAVAILABLE");
    assert.equal(error.status, 503);
    return true;
  });
});

test("server history carries the customer wording only", async () => {
  const { service } = buildService();

  const { events } = await service.readServer(TOKEN, SERVER_ID);
  assert.equal(events[0].message, "Sunucun hazır.");
  assert.equal("operatorDetail" in events[0], false);
});

test("deletion is not a customer command", () => {
  assert.equal(isServerCommand("sil"), false);
  assert.equal(isServerCommand("delete_server"), false);
  // Nor can any state make one available.
  for (const status of ["online", "suspended", "failed", "deploying"]) {
    assert.equal(canCommandServer(status, "baslat") && status !== "suspended", false);
  }
});

test("the panel receives the editable fields and the current values together", async () => {
  const { service } = buildService({ servers: [ownedServer({ settings: { difficulty: "hard" } })] });

  const { servers } = await service.listServers(TOKEN);
  const server = servers[0];
  assert.equal(server.canEditSettings, true);
  assert.equal(server.settings.difficulty, "hard");
  assert.equal(server.settings.gameMode, "survival");
  assert.ok(server.settingFields.some((field) => field.key === "maxPlayers"));
});

test("settings cannot be edited while a job is in flight", async () => {
  const busy = buildService({ servers: [ownedServer({ pendingJobKind: "restart_server" })] });
  const { servers } = await busy.service.listServers(TOKEN);
  assert.equal(servers[0].canEditSettings, false);

  await assert.rejects(
    () => busy.service.saveSettings({ rawToken: TOKEN, serverId: SERVER_ID, settings: { motd: "x" } }),
    (error) => error.status === 409 && error.code === "SERVER_BUSY",
  );
  assert.equal(busy.saved.length, 0);
});

test("a server mid-setup cannot take settings, because there is nothing to restart", async () => {
  const setting = buildService({ servers: [ownedServer({ status: "provisioning" })] });
  await assert.rejects(
    () => setting.service.saveSettings({ rawToken: TOKEN, serverId: SERVER_ID, settings: { motd: "x" } }),
    (error) => error.status === 409 && error.code === "SETTINGS_NOT_ALLOWED",
  );
  assert.equal(setting.saved.length, 0);
});

test("saved settings are validated before they reach the queue", async () => {
  const { service, saved } = buildService();

  await assert.rejects(
    () => service.saveSettings({ rawToken: TOKEN, serverId: SERVER_ID, settings: { maxPlayers: 500 } }),
    (error) => error.status === 400 && error.code === "INVALID_SETTING",
  );
  await assert.rejects(
    () => service.saveSettings({ rawToken: TOKEN, serverId: SERVER_ID, settings: { nukeTheWorld: true } }),
    (error) => error.status === 400 && error.code === "UNKNOWN_SETTING",
  );
  assert.equal(saved.length, 0);

  const result = await service.saveSettings({
    rawToken: TOKEN,
    serverId: SERVER_ID,
    settings: { motd: "  Riftory  ", difficulty: "hard", pvp: false },
  });
  assert.equal(result.saved, true);
  assert.equal(result.jobId, "job-settings-1");
  assert.equal(saved.length, 1);
  // The queue receives the normalised object, never the raw request body.
  assert.equal(saved[0].settings.motd, "Riftory");
  assert.equal(saved[0].settings.difficulty, "hard");
  assert.equal(saved[0].settings.pvp, false);
  assert.equal(saved[0].settings.gameMode, "survival");
  assert.equal(saved[0].ownerUserId, OWNER);
});

test("a stranger cannot change settings on somebody else's server", async () => {
  const { service, saved } = buildService({
    servers: [ownedServer({ ownerUserId: "33333333-3333-4333-8333-333333333333" })],
  });
  await assert.rejects(
    () => service.saveSettings({ rawToken: TOKEN, serverId: SERVER_ID, settings: { motd: "x" } }),
    (error) => error.status === 404 && error.code === "SERVER_NOT_FOUND",
  );
  assert.equal(saved.length, 0);
});

test("a signed-out caller is refused before any database work", async () => {
  const { service, saved } = buildService();
  await assert.rejects(
    () => service.saveSettings({ rawToken: "yanlış", serverId: SERVER_ID, settings: {} }),
    (error) => error.status === 401,
  );
  assert.equal(saved.length, 0);
});

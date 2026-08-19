import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_LIMIT_PER_SERVER, createBackupService } from "../lib/backup-service.ts";
import { BackupError } from "../infra/gameservers/volume-backups.ts";

const TOKEN = "oturum-belirteci";
const OWNER = "22222222-2222-4222-8222-222222222222";
const SERVER_ID = "11111111-1111-4111-8111-111111111111";

function backup(id, minutesAgo = 0) {
  return {
    id,
    name: `talatim · yedek ${id}`,
    createdAt: new Date(Date.UTC(2026, 7, 19, 12, -minutesAgo)).toISOString(),
    expiresAt: null,
    sizeMb: 120,
  };
}

function panelServer(overrides = {}) {
  return {
    serverId: SERVER_ID,
    name: "talatim",
    status: "online",
    gameId: "minecraft",
    softwareId: "paper",
    planId: "mini-2",
    regionId: "eu-west",
    connection: null,
    busyWith: null,
    availableCommands: [],
    settingFields: [],
    settings: {},
    canEditSettings: true,
    schedule: null,
    scheduleDescription: null,
    createdAt: "2026-08-19T09:00:00.000Z",
    updatedAt: "2026-08-19T09:00:00.000Z",
    ...overrides,
  };
}

function build({ servers = [panelServer()], stored = [backup("b1")], store = {}, session = { userId: OWNER } } = {}) {
  const queued = [];
  const removed = [];
  const service = createBackupService({
    servers: { async listServers() { return { servers }; } },
    auth: { async authenticateSession() { return session; } },
    store: {
      async list() { return stored; },
      async create() { return backup("new"); },
      async remove(input) { removed.push(input); return true; },
      ...store,
    },
    queue: {
      async enqueueLifecycleJob(input) {
        queued.push(input);
        return { jobId: "job-backup-1", created: true };
      },
    },
  });
  return { service, queued, removed };
}

test("taking a backup is queued for the worker, with the owner from the session", async () => {
  const { service, queued } = build();
  const result = await service.createBackup(TOKEN, SERVER_ID);

  assert.equal(result.queued, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "create_backup");
  assert.equal(queued[0].ownerUserId, OWNER);
  assert.equal(queued[0].serverId, SERVER_ID);
});

test("a busy server does not stack a backup behind the work in flight", async () => {
  const { service, queued } = build({ servers: [panelServer({ busyWith: "restart_server" })] });
  await assert.rejects(
    () => service.createBackup(TOKEN, SERVER_ID),
    (error) => error.status === 409 && error.code === "SERVER_BUSY",
  );
  assert.equal(queued.length, 0);
});

test("the cap refuses a new backup rather than quietly deleting an old one", async () => {
  const full = Array.from({ length: BACKUP_LIMIT_PER_SERVER }, (_, index) => backup(`b${index}`, index));
  const { service, queued, removed } = build({ stored: full });

  await assert.rejects(
    () => service.createBackup(TOKEN, SERVER_ID),
    (error) => error.status === 409 && error.code === "BACKUP_LIMIT_REACHED",
  );
  assert.equal(queued.length, 0);
  assert.equal(removed.length, 0, "sınıra ulaşınca eski yedek silinmemeli");
});

test("the list says whether another backup can be taken", async () => {
  const room = await build().service.listBackups(TOKEN, SERVER_ID);
  assert.equal(room.canCreate, true);
  assert.equal(room.limit, BACKUP_LIMIT_PER_SERVER);

  const full = Array.from({ length: BACKUP_LIMIT_PER_SERVER }, (_, index) => backup(`b${index}`, index));
  assert.equal((await build({ stored: full }).service.listBackups(TOKEN, SERVER_ID)).canCreate, false);

  const busy = build({ servers: [panelServer({ busyWith: "create_backup" })] });
  assert.equal((await busy.service.listBackups(TOKEN, SERVER_ID)).canCreate, false);
});

test("a backup id from another server cannot be deleted by guessing it", async () => {
  const { service, removed } = build({ stored: [backup("mine")] });
  await assert.rejects(
    () => service.deleteBackup(TOKEN, SERVER_ID, "somebody-elses-backup"),
    (error) => error.status === 404 && error.code === "BACKUP_NOT_FOUND",
  );
  assert.equal(removed.length, 0);

  const ok = await service.deleteBackup(TOKEN, SERVER_ID, "mine");
  assert.equal(ok.deleted, true);
  assert.equal(removed[0].backupId, "mine");
});

test("a stranger's server answers exactly like a missing one", async () => {
  const { service, queued } = build({ servers: [] });
  for (const call of [
    () => service.listBackups(TOKEN, SERVER_ID),
    () => service.createBackup(TOKEN, SERVER_ID),
    () => service.deleteBackup(TOKEN, SERVER_ID, "b1"),
  ]) {
    await assert.rejects(call, (error) => error.status === 404 && error.code === "SERVER_NOT_FOUND");
  }
  assert.equal(queued.length, 0);
});

test("a provider fault is retryable, a rejected request is not", async () => {
  const outage = build({ store: { async list() { throw new BackupError("list_backups", "geçici", true); } } });
  await assert.rejects(
    () => outage.service.listBackups(TOKEN, SERVER_ID),
    (error) => error.status === 503,
  );

  const refused = build({ store: { async list() { throw new BackupError("list_backups", "not authorized", false); } } });
  await assert.rejects(
    () => refused.service.listBackups(TOKEN, SERVER_ID),
    (error) => error.status === 409,
  );
});

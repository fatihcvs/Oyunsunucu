import assert from "node:assert/strict";
import test from "node:test";
import { BackupError, createRailwayBackupStore } from "../infra/gameservers/volume-backups.ts";

const SERVER_ID = "aa49e3e5-4b00-4bf5-b919-7331de8bc471";
const VOLUME_INSTANCE = "vi-1";

/**
 * A fake Railway that answers each operation by the query it was sent.
 *
 * `statuses` is consumed one call at a time, which is how the polling loop is
 * exercised. The whole query text is recorded so a test can assert which
 * operations actually went over the wire.
 */
function fakeRailway({ backups = [], statuses = ["Complete"], createdOnComplete } = {}) {
  const calls = [];
  let list = [...backups];
  const remaining = [...statuses];

  const send = async (_url, init) => {
    const body = JSON.parse(init.body);
    const query = body.query;
    calls.push(query);

    if (query.includes("volumes {")) {
      return json({
        project: {
          volumes: {
            edges: [{
              node: {
                name: `game-${SERVER_ID}-data`,
                volumeInstances: { edges: [{ node: { id: VOLUME_INSTANCE, environmentId: "env-1" } }] },
              },
            }],
          },
        },
      });
    }
    if (query.includes("volumeInstanceBackupList")) {
      return json({ volumeInstanceBackupList: list });
    }
    if (query.includes("volumeInstanceBackupCreate")) {
      return json({ volumeInstanceBackupCreate: { workflowId: "wf-1" } });
    }
    if (query.includes("volumeInstanceBackupDelete")) {
      list = list.filter((backup) => backup.id !== body.variables.volumeInstanceBackupId);
      return json({ volumeInstanceBackupDelete: { workflowId: "wf-2" } });
    }
    if (query.includes("workflowStatus")) {
      const status = remaining.shift() ?? "Complete";
      if (status === "Complete" && createdOnComplete) list = [createdOnComplete, ...list];
      return json({ workflowStatus: { status, error: status === "Error" ? "disk dolu" : null } });
    }
    throw new Error(`beklenmeyen sorgu: ${query}`);
  };

  const store = createRailwayBackupStore({
    apiToken: "test",
    projectId: "project-1",
    environmentId: "env-1",
    fetch: send,
  });
  return { store, calls };
}

function json(data) {
  return { ok: true, status: 200, async json() { return { data }; } };
}

const EXISTING = { id: "b1", name: "eski", createdAt: "2026-08-19T10:00:00.000Z", expiresAt: null, usedMB: 100 };
const CREATED = { id: "b2", name: "yeni", createdAt: "2026-08-19T12:00:00.000Z", expiresAt: null, usedMB: 120 };

test("creating a backup waits for the provider workflow before reporting success", async () => {
  const { store, calls } = fakeRailway({
    backups: [EXISTING],
    statuses: ["Running", "Complete"],
    createdOnComplete: CREATED,
  });

  const created = await store.create({ serverId: SERVER_ID, name: "yeni" });
  assert.equal(created.id, "b2", "yeni oluşan yedek döndürülmeli");
  // Polled until Complete rather than returning on the first Running.
  assert.equal(calls.filter((call) => call.includes("workflowStatus")).length, 2);
});

test("a workflow that fails becomes a retryable error, not a silent success", async () => {
  const { store } = fakeRailway({ backups: [EXISTING], statuses: ["Error"] });
  await assert.rejects(
    () => store.create({ serverId: SERVER_ID, name: "yeni" }),
    (error) => error instanceof BackupError && error.retryable && /disk dolu/.test(error.message),
  );
});

test("a backup id that was not there before is the one reported", async () => {
  const { store } = fakeRailway({ backups: [EXISTING], statuses: ["Complete"], createdOnComplete: CREATED });
  const created = await store.create({ serverId: SERVER_ID, name: "yeni" });
  assert.notEqual(created.id, EXISTING.id);
});

test("the list is newest first, and an unknown server has no backups", async () => {
  const { store } = fakeRailway({ backups: [EXISTING, CREATED] });
  const listed = await store.list(SERVER_ID);
  assert.deepEqual(listed.map((backup) => backup.id), ["b2", "b1"]);

  const other = await store.list("11111111-1111-4111-8111-111111111111");
  assert.deepEqual(other, []);
});

test("deleting waits for its workflow so the refreshed list is already correct", async () => {
  const { store, calls } = fakeRailway({ backups: [EXISTING, CREATED], statuses: ["Complete"] });
  assert.equal(await store.remove({ serverId: SERVER_ID, backupId: "b1" }), true);
  assert.ok(calls.some((call) => call.includes("workflowStatus")), "silme de iş durumunu beklemeli");

  const listed = await store.list(SERVER_ID);
  assert.deepEqual(listed.map((backup) => backup.id), ["b2"]);
});

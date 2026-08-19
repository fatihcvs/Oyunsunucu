import assert from "node:assert/strict";
import test from "node:test";
import { createProvisioningWorker } from "../lib/provisioning-worker.ts";
import { ProviderError } from "../infra/gameservers/provider.ts";
import { DEFAULT_SERVER_DRAFT } from "../lib/catalog.ts";

const SERVER_ID = "11111111-1111-4111-8111-111111111111";

function server(overrides = {}) {
  return {
    serverId: SERVER_ID,
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    status: "requested",
    gameId: DEFAULT_SERVER_DRAFT.gameId,
    softwareId: DEFAULT_SERVER_DRAFT.softwareId,
    planId: DEFAULT_SERVER_DRAFT.planId,
    regionId: DEFAULT_SERVER_DRAFT.regionId,
    name: "Test Sunucusu",
    ...overrides,
  };
}

class FakeRepository {
  completed = [];
  failed = [];
  resources = [];
  transitions = [];

  constructor(job, record = server()) {
    this.job = job;
    this.record = record;
  }

  async claimJob() {
    const next = this.job;
    this.job = null;
    return next;
  }

  async findServer() { return this.record; }

  async markServerStatus(serverId, from, to) {
    this.transitions.push(`${from}->${to}`);
    return to;
  }

  async recordProviderResource(input) {
    this.resources.push(`${input.resourceKind}:${input.providerResourceId}`);
    return true;
  }

  async completeJob(input) { this.completed.push(input); }

  async failJob(input) {
    this.failed.push(input);
    return { retrying: input.attempts < 5 };
  }
}

class FakeProvider {
  name = "test";
  created = [];
  error = null;

  async createServer(spec) {
    this.created.push(spec);
    if (this.error) throw this.error;
    return {
      resources: [{ kind: "container", id: "c-1" }, { kind: "volume", id: "v-1" }],
      connection: { host: "oyun.example", port: 25565 },
    };
  }

  async startServer() {}
  async stopServer() {}
  async restartServer() {}
  async deleteServer() {}
  async getConnectionInfo() { return null; }
}

function worker(repository, provider = new FakeProvider()) {
  return {
    worker: createProvisioningWorker({ repository, provider, owner: "worker-1" }),
    provider,
  };
}

const createJob = { jobId: "job-1", serverId: SERVER_ID, orderId: "o-1", kind: "create_server", attempts: 1, payload: {} };

test("does nothing when the queue is empty", async () => {
  const repository = new FakeRepository(null);
  assert.equal(await worker(repository).worker.runOnce(), false);
});

test("sizes the server from the plan the customer bought", async () => {
  const repository = new FakeRepository(createJob);
  const { worker: unit, provider } = worker(repository);

  assert.equal(await unit.runOnce(), true);

  // starter-4 is a 4 GB plan with 20 GB of storage.
  assert.equal(provider.created[0].memoryMb, 4096);
  assert.equal(provider.created[0].storageGb, 20);
  assert.equal(provider.created[0].runtime.gameId, "minecraft");
  assert.deepEqual(repository.transitions, ["requested->provisioning", "provisioning->deploying"]);
});

test("records every provider resource before finishing the job", async () => {
  const repository = new FakeRepository(createJob);
  await worker(repository).worker.runOnce();

  // Recorded first: a crash after this point still leaves a cleanup trail.
  assert.deepEqual(repository.resources, ["container:c-1", "volume:v-1"]);
  assert.equal(repository.completed[0].serverStatus, "online");
  assert.deepEqual(repository.completed[0].connection, { host: "oyun.example", port: 25565 });
});

test("marks a server failed when no address comes back", async () => {
  const repository = new FakeRepository(createJob);
  const provider = new FakeProvider();
  provider.createServer = async () => ({ resources: [{ kind: "container", id: "c-2" }], connection: null });

  await createProvisioningWorker({ repository, provider, owner: "w" }).runOnce();

  // A container with no reachable address is not a delivered server.
  assert.equal(repository.completed[0].serverStatus, "failed");
});

test("retries a transient provider failure", async () => {
  const repository = new FakeRepository(createJob);
  const provider = new FakeProvider();
  provider.error = new ProviderError("create_server", "provider 503", true);

  assert.equal(await createProvisioningWorker({ repository, provider, owner: "w" }).runOnce(), true);
  assert.equal(repository.failed[0].attempts, 1);
  assert.match(repository.failed[0].customerMessage, /yeniden deneniyor/);
  assert.match(repository.failed[0].operatorDetail, /503/);
});

test("buries a job that can never succeed instead of retrying it", async () => {
  const repository = new FakeRepository(createJob, server({ softwareId: "tmodloader", gameId: "terraria" }));

  // No pinned image exists for this combination; waiting cannot fix that.
  assert.equal(await worker(repository).worker.runOnce(), false);
  assert.equal(repository.failed[0].attempts, Number.MAX_SAFE_INTEGER);
  assert.match(repository.failed[0].customerMessage, /Destek ekibi/);
});

test("refuses a plan too small for the runtime", async () => {
  const repository = new FakeRepository(createJob, server({ softwareId: "fabric", planId: "mini-2" }));

  assert.equal(await worker(repository).worker.runOnce(), false);
  assert.match(repository.failed[0].operatorDetail, /yetersiz/);
});

test("keeps the customer message free of provider internals", async () => {
  const repository = new FakeRepository(createJob);
  const provider = new FakeProvider();
  provider.error = new Error("connect ECONNREFUSED 10.0.0.5:5432 token=abc123");

  await createProvisioningWorker({ repository, provider, owner: "w" }).runOnce();

  assert.doesNotMatch(repository.failed[0].customerMessage, /ECONNREFUSED|token|10\.0\.0\.5/);
  assert.match(repository.failed[0].operatorDetail, /ECONNREFUSED/);
});

test("the scheduler tick asks the repository for due work and reports what fired", async () => {
  const calls = [];
  const worker = createProvisioningWorker({
    owner: "worker-1",
    provider: { name: "test" },
    repository: {
      async claimDueSchedule(input) {
        calls.push(input);
        return { serverId: "server-1", jobId: "job-1" };
      },
    },
    now: () => new Date("2026-08-20T01:00:00.000Z"),
  });

  const fired = await worker.runScheduleOnce();
  assert.deepEqual(fired, { serverId: "server-1", jobId: "job-1" });
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].nextRunAt, "function");
  // The worker hands its own clock down rather than letting SQL decide "now".
  assert.equal(calls[0].now.toISOString(), "2026-08-20T01:00:00.000Z");
});

test("a scheduler failure is reported but never stops the worker", async () => {
  const seen = [];
  const worker = createProvisioningWorker({
    owner: "worker-1",
    provider: { name: "test" },
    repository: {
      async claimDueSchedule() { throw new Error("veritabanı yok"); },
    },
    onOperationalError: (error) => seen.push(error),
  });

  assert.equal(await worker.runScheduleOnce(), null);
  assert.equal(seen.length, 1);
});

test("a failed side operation does not condemn a server that is still running", async () => {
  const failures = [];
  const worker = createProvisioningWorker({
    owner: "worker-1",
    provider: { name: "test" },
    repository: {
      async claimJob() {
        return { jobId: "job-1", serverId: "server-1", kind: "create_backup", attempts: 4 };
      },
      async findServer() { return null; },
      async failJob(input) {
        failures.push(input);
        return { retrying: false };
      },
    },
  });

  await worker.runOnce();
  assert.equal(failures.length, 1);
  assert.equal(failures[0].breaksServer, false, "yedek hatası sunucuyu bozuk saymamalı");
  assert.match(failures[0].customerMessage, /çalışmaya devam ediyor/);
});

test("a failed setup still condemns the server, because there is nothing running", async () => {
  const failures = [];
  const worker = createProvisioningWorker({
    owner: "worker-1",
    provider: { name: "test" },
    repository: {
      async claimJob() {
        return { jobId: "job-1", serverId: "server-1", kind: "create_server", attempts: 4 };
      },
      async findServer() { return null; },
      async failJob(input) {
        failures.push(input);
        return { retrying: false };
      },
    },
  });

  await worker.runOnce();
  assert.equal(failures[0].breaksServer, true);
  assert.match(failures[0].customerMessage, /Kurulum tamamlanamadı/);
});

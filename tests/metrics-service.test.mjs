import assert from "node:assert/strict";
import test from "node:test";
import { createMetricsService, parsePlayerList } from "../lib/metrics-service.ts";

const TOKEN = "oturum-belirteci";
const SERVER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-19T15:00:00.000Z");

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
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function build({ servers = [panelServer()], metrics, console: gameConsole } = {}) {
  const reads = [];
  const service = createMetricsService({
    servers: { async listServers() { return { servers }; } },
    metrics: {
      async read(input) {
        reads.push(input);
        if (metrics === null) return null;
        if (metrics) return metrics(input);
        return {
          cpu: [{ at: NOW.toISOString(), value: 0.35 }],
          memoryGb: [
            { at: NOW.toISOString(), value: 1.2 },
            { at: NOW.toISOString(), value: 1.9 },
          ],
          providerMemoryLimitGb: 8,
          sampledFrom: input.from.toISOString(),
          sampledTo: input.to.toISOString(),
        };
      },
    },
    console: gameConsole,
    now: () => NOW,
  });
  return { service, reads };
}

test("the list output becomes a player count, names and all", () => {
  const parsed = parsePlayerList("There are 2 of a max of 10 players online: Notch, Jeb_");
  assert.deepEqual(parsed, { online: 2, max: 10, names: ["Notch", "Jeb_"] });

  const empty = parsePlayerList("There are 0 of a max of 10 players online:");
  assert.deepEqual(empty, { online: 0, max: 10, names: [] });
});

test("an unreadable list line costs the count, not the card", () => {
  assert.equal(parsePlayerList("Unknown command"), null);
  assert.equal(parsePlayerList(""), null);
});

test("memory is reported against the plan, never the provider's container limit", async () => {
  const { service } = build();
  const view = await service.readMetrics(TOKEN, SERVER_ID);

  assert.equal(view.planMemoryGb, 2);
  // The 8 GB the provider hands the container is deliberately not surfaced.
  assert.equal("providerMemoryLimitGb" in view, false);
  // 2 GB plan minus the measured off-heap reserve.
  assert.ok(view.heapMemoryGb > 1 && view.heapMemoryGb < 2, `beklenmeyen heap: ${view.heapMemoryGb}`);
  assert.equal(view.memoryGb.length, 2);
  assert.equal(view.cpu[0].value, 0.35);
});

test("usage past what the plan sells is flagged", async () => {
  const under = build();
  assert.equal((await under.service.readMetrics(TOKEN, SERVER_ID)).overPlan, false);

  const over = build({
    metrics: () => ({
      cpu: [],
      memoryGb: [{ at: NOW.toISOString(), value: 2.4 }],
      providerMemoryLimitGb: 8,
      sampledFrom: NOW.toISOString(),
      sampledTo: NOW.toISOString(),
    }),
  });
  assert.equal((await over.service.readMetrics(TOKEN, SERVER_ID)).overPlan, true);
});

test("the window asked for is the last hour, ending now", async () => {
  const { service, reads } = build();
  await service.readMetrics(TOKEN, SERVER_ID);

  assert.equal(reads[0].to.toISOString(), NOW.toISOString());
  assert.equal(reads[0].from.toISOString(), "2026-08-19T14:00:00.000Z");
  assert.equal(reads[0].serverId, SERVER_ID);
});

test("the player count comes from the console, and only while the server runs", async () => {
  const commands = [];
  const gameConsole = {
    async run(input) {
      commands.push(input.command);
      return "There are 3 of a max of 10 players online: a, b, c";
    },
  };

  const online = build({ console: gameConsole });
  const view = await online.service.readMetrics(TOKEN, SERVER_ID);
  assert.deepEqual(commands, ["list"]);
  assert.equal(view.players.online, 3);

  const stopped = build({ servers: [panelServer({ status: "suspended" })], console: gameConsole });
  assert.equal((await stopped.service.readMetrics(TOKEN, SERVER_ID)).players, null);
  assert.equal(commands.length, 1, "durdurulmuş sunucuya komut gönderilmemeli");
});

test("an unreachable console or metrics source still yields a usable view", async () => {
  const { service } = build({
    metrics: null,
    console: { async run() { throw new Error("konsol yok"); } },
  });
  const view = await service.readMetrics(TOKEN, SERVER_ID);

  assert.deepEqual(view.cpu, []);
  assert.deepEqual(view.memoryGb, []);
  assert.equal(view.players, null);
  assert.equal(view.planMemoryGb, 2);
  assert.equal(view.overPlan, false);
});

test("a stranger's server answers exactly like a missing one", async () => {
  const { service, reads } = build({ servers: [] });
  await assert.rejects(
    () => service.readMetrics(TOKEN, SERVER_ID),
    (error) => error.status === 404 && error.code === "SERVER_NOT_FOUND",
  );
  assert.equal(reads.length, 0);
});

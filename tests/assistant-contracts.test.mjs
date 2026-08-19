import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommandProposal,
  buildPlanProposal,
  buildSettingsProposal,
} from "../lib/assistant-contracts.ts";

const SERVER_ID = "11111111-1111-4111-8111-111111111111";

function serverContext(overrides = {}) {
  return {
    serverId: SERVER_ID,
    name: "talatim",
    gameId: "minecraft",
    softwareId: "paper",
    planId: "mini-2",
    regionId: "eu-west",
    status: "online",
    settings: {
      motd: "",
      maxPlayers: 10,
      difficulty: "normal",
      gameMode: "survival",
      pvp: true,
      whitelist: false,
      viewDistance: 10,
    },
    availableCommands: ["durdur", "yeniden-baslat"],
    canEditSettings: true,
    busyWith: null,
    ...overrides,
  };
}

test("a settings proposal changes only the named field and keeps the rest", () => {
  const servers = [serverContext()];
  const result = buildSettingsProposal(servers, { server: "talatim", settings: { difficulty: "hard" } });

  assert.equal(result.ok, true);
  assert.deepEqual(result.proposal.changedKeys, ["difficulty"]);
  assert.equal(result.proposal.settings.difficulty, "hard");
  assert.equal(result.proposal.settings.maxPlayers, 10);
  assert.equal(result.proposal.restarts, true);
});

test("the model cannot exceed the plan's limits through the assistant", () => {
  const servers = [serverContext()];
  const result = buildSettingsProposal(servers, { settings: { maxPlayers: 64 } });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_SETTING");
});

test("an invented setting is refused rather than passed through", () => {
  const servers = [serverContext()];
  const result = buildSettingsProposal(servers, { settings: { opEveryone: true } });

  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_SETTING");
});

test("a server the caller does not have cannot be targeted", () => {
  const servers = [serverContext()];
  for (const reference of ["baskasinin-sunucusu", "22222222-2222-4222-8222-222222222222"]) {
    const result = buildSettingsProposal(servers, { server: reference, settings: { difficulty: "hard" } });
    assert.equal(result.ok, false);
    assert.equal(result.code, "SERVER_NOT_FOUND");
  }
});

test("with several servers an unnamed one is a question, not a guess", () => {
  const servers = [serverContext(), serverContext({ serverId: "other", name: "ikinci" })];
  const result = buildSettingsProposal(servers, { settings: { difficulty: "hard" } });

  assert.equal(result.ok, false);
  assert.equal(result.code, "SERVER_NOT_FOUND");
});

test("\"2x\" resolves to a real catalogue plan with its real price", () => {
  const servers = [serverContext()];
  const result = buildPlanProposal(servers, { multiplier: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.proposal.planId, "starter-4");
  assert.equal(result.proposal.monthlyDifference, 200);
  assert.match(result.proposal.summary, /Başlangıç/);
});

test("a multiplier nothing can satisfy is refused instead of rounded to the top plan", () => {
  const servers = [serverContext({ planId: "pro-12" })];
  const result = buildPlanProposal(servers, { multiplier: 3 });

  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_LARGER_PLAN");
});

test("a downgrade stays refused when it comes through the assistant", () => {
  const servers = [serverContext({ planId: "community-8" })];
  const result = buildPlanProposal(servers, { planId: "mini-2" });

  assert.equal(result.ok, false);
  assert.equal(result.code, "DOWNGRADE_UNSUPPORTED");
});

test("a command the server's state cannot carry out is refused", () => {
  const online = buildCommandProposal([serverContext()], { command: "baslat" });
  assert.equal(online.ok, false);
  assert.equal(online.code, "COMMAND_NOT_ALLOWED");

  const stopped = buildCommandProposal([serverContext({ status: "suspended", availableCommands: ["baslat"] })], {
    command: "baslat",
  });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.proposal.command, "baslat");
});

test("deletion is not reachable through the assistant at all", () => {
  const result = buildCommandProposal([serverContext()], { command: "sil" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_COMMAND");
});

test("a busy server refuses both settings and commands", () => {
  const busy = [serverContext({ busyWith: "restart_server", canEditSettings: false })];

  const settings = buildSettingsProposal(busy, { settings: { difficulty: "hard" } });
  assert.equal(settings.ok, false);
  assert.equal(settings.code, "SETTINGS_NOT_ALLOWED");

  const command = buildCommandProposal(busy, { command: "durdur" });
  assert.equal(command.ok, false);
  assert.equal(command.code, "SERVER_BUSY");
});

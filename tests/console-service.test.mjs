import assert from "node:assert/strict";
import test from "node:test";
import { createConsoleService } from "../lib/console-service.ts";
import { ConsoleError, deriveRconPassword, privateConsoleHost } from "../infra/gameservers/console-access.ts";

const TOKEN = "oturum-belirteci";
const SERVER_ID = "11111111-1111-4111-8111-111111111111";

function panelServer(overrides = {}) {
  return {
    serverId: SERVER_ID,
    name: "talatim",
    status: "online",
    gameId: "minecraft",
    softwareId: "paper",
    planId: "mini-2",
    regionId: "eu-west",
    connection: { host: "proxy.example", port: 25565 },
    busyWith: null,
    availableCommands: ["durdur"],
    settingFields: [],
    settings: {},
    canEditSettings: true,
    createdAt: "2026-08-19T09:00:00.000Z",
    updatedAt: "2026-08-19T09:00:00.000Z",
    ...overrides,
  };
}

function build({ servers = [panelServer()], run } = {}) {
  const sent = [];
  const service = createConsoleService({
    servers: { async listServers() { return { servers }; } },
    console: {
      async run(input) {
        sent.push(input);
        if (run) return run(input);
        return "Komut çalıştı.";
      },
    },
  });
  return { service, sent };
}

test("a typed command reaches the server with the leading slash stripped", async () => {
  const { service, sent } = build();
  const result = await service.runCommand({ rawToken: TOKEN, serverId: SERVER_ID, command: "  /say merhaba  " });

  assert.equal(result.command, "say merhaba");
  assert.equal(result.output, "Komut çalıştı.");
  assert.deepEqual(sent, [{ serverId: SERVER_ID, command: "say merhaba" }]);
});

test("stop and restart are refused so the panel's state stays true", async () => {
  for (const command of ["stop", "STOP", "/restart", "reload confirm"]) {
    const { service, sent } = build();
    await assert.rejects(
      () => service.runCommand({ rawToken: TOKEN, serverId: SERVER_ID, command }),
      (error) => error.status === 400 && error.code === "COMMAND_REFUSED",
    );
    assert.equal(sent.length, 0);
  }
});

test("an empty, oversized or control-laden command never reaches the socket", async () => {
  for (const command of ["", "   ", "x".repeat(301), "say bir\nop kendim", 42]) {
    const { service, sent } = build();
    await assert.rejects(
      () => service.runCommand({ rawToken: TOKEN, serverId: SERVER_ID, command }),
      (error) => error.status === 400 && error.code === "INVALID_COMMAND",
    );
    assert.equal(sent.length, 0);
  }
});

test("player actions build their own command and validate the name", async () => {
  const { service, sent } = build();
  const result = await service.runPlayerAction({
    rawToken: TOKEN, serverId: SERVER_ID, action: "whitelist_add", player: " Oyuncu_1 ",
  });
  assert.equal(result.command, "whitelist add Oyuncu_1");
  assert.equal(sent[0].command, "whitelist add Oyuncu_1");

  for (const player of ["ab", "x".repeat(17), "kötü isim", "oyuncu;op ben", ""]) {
    const attempt = build();
    await assert.rejects(
      () => attempt.service.runPlayerAction({ rawToken: TOKEN, serverId: SERVER_ID, action: "ban", player }),
      (error) => error.status === 400 && error.code === "INVALID_PLAYER",
    );
    assert.equal(attempt.sent.length, 0);
  }
});

test("listing players needs no name, and an unknown action is refused", async () => {
  const { service, sent } = build({ run: () => "There are 2 of a max of 10 players online: a, b" });
  const result = await service.runPlayerAction({ rawToken: TOKEN, serverId: SERVER_ID, action: "list" });
  assert.equal(sent[0].command, "list");
  assert.match(result.output, /2 of a max of 10/);

  const bad = build();
  await assert.rejects(
    () => bad.service.runPlayerAction({ rawToken: TOKEN, serverId: SERVER_ID, action: "deleteWorld", player: "Oyuncu" }),
    (error) => error.status === 400 && error.code === "UNKNOWN_ACTION",
  );
});

test("a stranger's server answers exactly like a missing one", async () => {
  const { service, sent } = build({ servers: [] });
  await assert.rejects(
    () => service.runCommand({ rawToken: TOKEN, serverId: SERVER_ID, command: "list" }),
    (error) => error.status === 404 && error.code === "SERVER_NOT_FOUND",
  );
  assert.equal(sent.length, 0);
});

test("the console is only offered where it exists and while the server runs", async () => {
  const stopped = build({ servers: [panelServer({ status: "suspended" })] });
  await assert.rejects(
    () => stopped.service.runCommand({ rawToken: TOKEN, serverId: SERVER_ID, command: "list" }),
    (error) => error.status === 409 && error.code === "SERVER_NOT_ONLINE",
  );

  const terraria = build({ servers: [panelServer({ gameId: "terraria" })] });
  await assert.rejects(
    () => terraria.service.runCommand({ rawToken: TOKEN, serverId: SERVER_ID, command: "list" }),
    (error) => error.status === 409 && error.code === "CONSOLE_UNSUPPORTED",
  );
});

test("an unreachable console is reported as such, not as a fabricated output", async () => {
  const { service } = build({
    run: () => { throw new ConsoleError("RCON_UNREACHABLE", "Sunucunun konsoluna ulaşılamadı."); },
  });
  await assert.rejects(
    () => service.runCommand({ rawToken: TOKEN, serverId: SERVER_ID, command: "list" }),
    (error) => error.status === 503 && error.code === "RCON_UNREACHABLE",
  );
});

test("the console password is derived per server and never the same twice", async () => {
  const secret = "s".repeat(32);
  const first = await deriveRconPassword(secret, SERVER_ID);
  const second = await deriveRconPassword(secret, "22222222-2222-4222-8222-222222222222");
  const again = await deriveRconPassword(secret, SERVER_ID);

  assert.equal(first, again, "aynı sunucu için deterministik olmalı");
  assert.notEqual(first, second, "sunucular arasında farklı olmalı");
  assert.match(first, /^[A-Za-z0-9_-]{32}$/);
  await assert.rejects(() => deriveRconPassword("kısa", SERVER_ID), TypeError);
});

test("the console address stays on the provider's private network", () => {
  assert.equal(privateConsoleHost(SERVER_ID), `game-${SERVER_ID}.railway.internal`);
});

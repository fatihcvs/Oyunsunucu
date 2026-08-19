import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSettings,
  normalizeStoredSettings,
  playerCeiling,
  settingFields,
  settingGroups,
  settingsToContainerVariables,
  supportsSettings,
  validateSettings,
} from "../lib/server-settings.ts";

const MINI_2 = 2 * 1024;
const PRO_12 = 12 * 1024;

test("the player ceiling follows the plan's measured memory profile", () => {
  assert.equal(playerCeiling(MINI_2), 10);
  assert.equal(playerCeiling(4 * 1024), 20);
  assert.equal(playerCeiling(PRO_12), 100);
  // Below the smallest certified profile the smallest ceiling still applies.
  assert.equal(playerCeiling(512), 10);
});

test("a small plan cannot be told to carry a large plan's player count", () => {
  const field = settingFields("minecraft", MINI_2).find((candidate) => candidate.key === "maxPlayers");
  assert.equal(field.max, 10);

  const rejected = validateSettings("minecraft", MINI_2, { ...defaultSettings("minecraft", MINI_2), maxPlayers: 40 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "INVALID_SETTING");

  const accepted = validateSettings("minecraft", PRO_12, { ...defaultSettings("minecraft", PRO_12), maxPlayers: 40 });
  assert.equal(accepted.ok, true);
});

test("an unknown key is refused instead of silently dropped", () => {
  const result = validateSettings("minecraft", MINI_2, {
    ...defaultSettings("minecraft", MINI_2),
    opEveryone: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_SETTING");
});

test("each field kind refuses the values it cannot mean", () => {
  const base = defaultSettings("minecraft", MINI_2);
  const cases = [
    { ...base, difficulty: "impossible" },
    { ...base, gameMode: "hayatta-kalma" },
    { ...base, opPermissionLevel: "9" },
    { ...base, maxWorldSize: "12" },
    { ...base, resourcePack: "paket.zip" },
    { ...base, resourcePack: "javascript:alert(1)" },
    { ...base, pvp: "yes" },
    { ...base, viewDistance: 32 },
    { ...base, viewDistance: 8.5 },
    { ...base, motd: "x".repeat(60) },
    { ...base, motd: "satır\nkırma" },
  ];
  for (const input of cases) {
    const result = validateSettings("minecraft", MINI_2, input);
    assert.equal(result.ok, false, `kabul edilmemeliydi: ${JSON.stringify(input).slice(0, 60)}`);
  }
});

test("a missing field falls back rather than failing the whole save", () => {
  const result = validateSettings("minecraft", MINI_2, { motd: "Riftory" });
  assert.equal(result.ok, true);
  assert.equal(result.settings.motd, "Riftory");
  assert.equal(result.settings.difficulty, "normal");
  assert.equal(result.settings.maxPlayers, 10);
});

test("stored settings survive one corrupt field", () => {
  const stored = { motd: "Merhaba", difficulty: "hard", maxPlayers: 9_999, pvp: false };
  const normalized = normalizeStoredSettings("minecraft", MINI_2, stored);

  assert.equal(normalized.motd, "Merhaba");
  assert.equal(normalized.difficulty, "hard");
  assert.equal(normalized.pvp, false);
  // The impossible value is replaced by the default, the good ones are kept.
  assert.equal(normalized.maxPlayers, 10);
});

test("garbage in the column still yields a usable settings object", () => {
  for (const stored of [null, "kaput", 42, ["a"]]) {
    const normalized = normalizeStoredSettings("minecraft", MINI_2, stored);
    assert.deepEqual(normalized, defaultSettings("minecraft", MINI_2));
  }
});

test("settings become the container variables the certified runtime reads", () => {
  const variables = settingsToContainerVariables("minecraft", {
    motd: "Riftory beta",
    maxPlayers: 8,
    difficulty: "hard",
    gameMode: "survival",
    pvp: false,
    whitelist: true,
    viewDistance: 12,
  });

  assert.deepEqual(variables, {
    MOTD: "Riftory beta",
    ENABLE_STATUS: "TRUE",
    HIDE_ONLINE_PLAYERS: "FALSE",

    MAX_PLAYERS: "8",
    ENABLE_WHITELIST: "TRUE",
    ENFORCE_WHITELIST: "TRUE",
    ONLINE_MODE: "TRUE",
    OP_PERMISSION_LEVEL: "4",
    PLAYER_IDLE_TIMEOUT: "0",

    DIFFICULTY: "hard",
    MODE: "survival",
    FORCE_GAMEMODE: "FALSE",
    HARDCORE: "FALSE",
    PVP: "FALSE",
    ALLOW_FLIGHT: "FALSE",
    ENABLE_COMMAND_BLOCK: "FALSE",
    ANNOUNCE_PLAYER_ACHIEVEMENTS: "TRUE",

    SPAWN_PROTECTION: "16",
    ALLOW_NETHER: "TRUE",
    SPAWN_MONSTERS: "TRUE",
    SPAWN_ANIMALS: "TRUE",
    SPAWN_NPCS: "TRUE",
    GENERATE_STRUCTURES: "TRUE",
    MAX_WORLD_SIZE: "29999984",

    RESOURCE_PACK: "",
    RESOURCE_PACK_ENFORCE: "FALSE",

    VIEW_DISTANCE: "12",
    SIMULATION_DISTANCE: "10",
    ENTITY_BROADCAST_RANGE_PERCENTAGE: "100",
  });
  // The variables that make the server boot at all are not ours to emit here.
  assert.equal("EULA" in variables, false);
  assert.equal("MEMORY" in variables, false);
});

test("terraria has its own narrow catalogue and vintage story has none yet", () => {
  assert.equal(supportsSettings("terraria"), true);
  assert.equal(supportsSettings("vintagestory"), false);

  const terraria = validateSettings("terraria", MINI_2, { maxPlayers: 20, difficulty: "1" });
  assert.equal(terraria.ok, false);

  const unsupported = validateSettings("vintagestory", MINI_2, {});
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.code, "SETTINGS_UNSUPPORTED");

  assert.deepEqual(
    settingsToContainerVariables("terraria", { maxPlayers: 12, difficulty: "2" }),
    { MAXPLAYERS: "12", DIFFICULTY: "2" },
  );
});

test("an empty welcome line falls back to the server's own name", () => {
  const withName = settingsToContainerVariables("minecraft", { motd: "   " }, "talatim");
  assert.equal(withName.MOTD, "talatim");

  const written = settingsToContainerVariables("minecraft", { motd: "Riftory beta" }, "talatim");
  assert.equal(written.MOTD, "Riftory beta");
});

test("a resource pack is only accepted as an address a client can fetch", () => {
  const base = defaultSettings("minecraft", MINI_2);

  const accepted = validateSettings("minecraft", MINI_2, {
    ...base,
    resourcePack: "  https://cdn.example.com/pack.zip  ",
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.settings.resourcePack, "https://cdn.example.com/pack.zip");

  // An empty address is how a customer removes the pack, so it stays legal.
  assert.equal(validateSettings("minecraft", MINI_2, { ...base, resourcePack: "" }).ok, true);
});

test("a pack cannot be enforced when there is no pack to download", () => {
  const enforcedWithout = settingsToContainerVariables("minecraft", {
    resourcePack: "",
    resourcePackEnforce: true,
  });
  assert.equal(enforcedWithout.RESOURCE_PACK_ENFORCE, "FALSE");

  const enforcedWith = settingsToContainerVariables("minecraft", {
    resourcePack: "https://cdn.example.com/pack.zip",
    resourcePackEnforce: true,
  });
  assert.equal(enforcedWith.RESOURCE_PACK_ENFORCE, "TRUE");
});

test("every field lands in exactly one of the sections the panel draws", () => {
  const groups = settingGroups("minecraft", MINI_2);
  assert.ok(groups.length > 1);

  const grouped = groups.flatMap((group) => group.fields.map((field) => field.key));
  const catalogue = settingFields("minecraft", MINI_2).map((field) => field.key);
  assert.deepEqual([...grouped].sort(), [...catalogue].sort());
  assert.equal(new Set(grouped).size, grouped.length);

  // A section with nothing in it would render as an empty box.
  assert.ok(groups.every((group) => group.fields.length > 0));

  // Terraria uses two of the same sections rather than a catalogue of its own.
  const terraria = settingGroups("terraria", MINI_2);
  assert.deepEqual(terraria.map((group) => group.id), ["oyuncular", "kurallar"]);
  assert.deepEqual(settingGroups("vintagestory", MINI_2), []);
});

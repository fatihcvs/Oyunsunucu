import type { ActiveGameId } from "./catalog.ts";

/**
 * What a customer may change about a running server, per game.
 *
 * The catalogue is deliberately narrow and typed: every field maps to one
 * container variable the certified runtime already understands. Anything not
 * described here cannot be set — a free-form key/value editor would let a
 * customer hand the runtime a value nobody has ever booted.
 */
export type SettingField =
  | { key: string; kind: "text"; label: string; hint: string; maxLength: number; fallback: string }
  | { key: string; kind: "number"; label: string; hint: string; min: number; max: number; fallback: number }
  | { key: string; kind: "choice"; label: string; hint: string; choices: ReadonlyArray<{ value: string; label: string }>; fallback: string }
  | { key: string; kind: "toggle"; label: string; hint: string; fallback: boolean };

export type SettingValue = string | number | boolean;
export type ServerSettings = Record<string, SettingValue>;

/** Player ceilings the certified memory profiles actually carry. */
const PLAYER_CEILING_BY_MEMORY: ReadonlyArray<{ memoryMb: number; players: number }> = [
  { memoryMb: 2_048, players: 10 },
  { memoryMb: 4_096, players: 20 },
  { memoryMb: 6_144, players: 40 },
  { memoryMb: 8_192, players: 60 },
  { memoryMb: 12_288, players: 100 },
];

export function playerCeiling(memoryMb: number) {
  let ceiling = PLAYER_CEILING_BY_MEMORY[0].players;
  for (const step of PLAYER_CEILING_BY_MEMORY) {
    if (memoryMb >= step.memoryMb) ceiling = step.players;
  }
  return ceiling;
}

const MINECRAFT_FIELDS: readonly SettingField[] = [
  {
    key: "motd",
    kind: "text",
    label: "Karşılama mesajı",
    hint: "Sunucu listesinde oyuncuların gördüğü satır.",
    maxLength: 59,
    fallback: "",
  },
  {
    key: "maxPlayers",
    kind: "number",
    label: "Maksimum oyuncu",
    hint: "Üst sınır paketin ölçülmüş bellek profiline bağlıdır.",
    min: 1,
    max: 100,
    fallback: 10,
  },
  {
    key: "difficulty",
    kind: "choice",
    label: "Zorluk",
    hint: "Dünyadaki düşman ve açlık davranışını belirler.",
    choices: [
      { value: "peaceful", label: "Barışçıl" },
      { value: "easy", label: "Kolay" },
      { value: "normal", label: "Normal" },
      { value: "hard", label: "Zor" },
    ],
    fallback: "normal",
  },
  {
    key: "gameMode",
    kind: "choice",
    label: "Oyun modu",
    hint: "Yeni giren oyuncuların başlangıç modu.",
    choices: [
      { value: "survival", label: "Hayatta kalma" },
      { value: "creative", label: "Yaratıcı" },
      { value: "adventure", label: "Macera" },
    ],
    fallback: "survival",
  },
  {
    key: "pvp",
    kind: "toggle",
    label: "Oyuncular birbirine vurabilsin",
    hint: "Kapalıyken oyuncular birbirine hasar veremez.",
    fallback: true,
  },
  {
    key: "whitelist",
    kind: "toggle",
    label: "Beyaz liste",
    hint: "Açıkken yalnızca listeye eklenmiş oyuncular girebilir.",
    fallback: false,
  },
  {
    key: "viewDistance",
    kind: "number",
    label: "Görüş mesafesi",
    hint: "Yüksek değer daha çok bellek ve CPU harcar.",
    min: 4,
    max: 16,
    fallback: 10,
  },
];

const TERRARIA_FIELDS: readonly SettingField[] = [
  {
    key: "maxPlayers",
    kind: "number",
    label: "Maksimum oyuncu",
    hint: "Terraria sunucusu en fazla 16 oyuncu taşır.",
    min: 1,
    max: 16,
    fallback: 8,
  },
  {
    key: "difficulty",
    kind: "choice",
    label: "Dünya zorluğu",
    hint: "Yeni dünya oluşturulurken uygulanır; mevcut dünyayı değiştirmez.",
    choices: [
      { value: "0", label: "Klasik" },
      { value: "1", label: "Uzman" },
      { value: "2", label: "Usta" },
      { value: "3", label: "Yolculuk" },
    ],
    fallback: "0",
  },
];

const FIELDS_BY_GAME: Record<string, readonly SettingField[]> = {
  minecraft: MINECRAFT_FIELDS,
  terraria: TERRARIA_FIELDS,
};

/** The editable fields for this game, with the player ceiling the plan allows. */
export function settingFields(gameId: string, memoryMb: number): readonly SettingField[] {
  const fields = FIELDS_BY_GAME[gameId] ?? [];
  const ceiling = playerCeiling(memoryMb);
  return fields.map((field) => {
    if (field.key !== "maxPlayers" || field.kind !== "number") return field;
    const max = Math.min(field.max, ceiling);
    return { ...field, max, fallback: Math.min(field.fallback, max) };
  });
}

export function supportsSettings(gameId: string) {
  return (FIELDS_BY_GAME[gameId]?.length ?? 0) > 0;
}

export function defaultSettings(gameId: string, memoryMb: number): ServerSettings {
  const settings: ServerSettings = {};
  for (const field of settingFields(gameId, memoryMb)) settings[field.key] = field.fallback;
  return settings;
}

export type SettingsValidation =
  | { ok: true; settings: ServerSettings }
  | { ok: false; code: string; message: string };

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

/**
 * Validates a whole settings object against the game's field catalogue.
 *
 * Unknown keys are refused rather than dropped: silently ignoring a key the
 * caller believed it had set is how a customer ends up thinking whitelist is on
 * when it is not.
 */
export function validateSettings(
  gameId: string,
  memoryMb: number,
  input: unknown,
): SettingsValidation {
  const fields = settingFields(gameId, memoryMb);
  if (fields.length === 0) {
    return { ok: false, code: "SETTINGS_UNSUPPORTED", message: "Bu oyun için ayar yönetimi henüz yok." };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: "INVALID_SETTINGS", message: "Ayarlar bir nesne olmalıdır." };
  }

  const provided = input as Record<string, unknown>;
  const known = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(provided)) {
    if (!known.has(key)) {
      return { ok: false, code: "UNKNOWN_SETTING", message: `Bilinmeyen ayar: ${key}` };
    }
  }

  const settings: ServerSettings = {};
  for (const field of fields) {
    const value = provided[field.key];
    if (value === undefined) {
      settings[field.key] = field.fallback;
      continue;
    }

    if (field.kind === "text") {
      if (typeof value !== "string" || value.length > field.maxLength || hasControlCharacter(value)) {
        return { ok: false, code: "INVALID_SETTING", message: `${field.label} geçersiz.` };
      }
      settings[field.key] = value.trim();
      continue;
    }
    if (field.kind === "number") {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(parsed) || parsed < field.min || parsed > field.max) {
        return {
          ok: false,
          code: "INVALID_SETTING",
          message: `${field.label} ${field.min}-${field.max} aralığında olmalıdır.`,
        };
      }
      settings[field.key] = parsed;
      continue;
    }
    if (field.kind === "choice") {
      if (typeof value !== "string" || !field.choices.some((choice) => choice.value === value)) {
        return { ok: false, code: "INVALID_SETTING", message: `${field.label} geçersiz.` };
      }
      settings[field.key] = value;
      continue;
    }
    if (typeof value !== "boolean") {
      return { ok: false, code: "INVALID_SETTING", message: `${field.label} açık veya kapalı olmalıdır.` };
    }
    settings[field.key] = value;
  }

  return { ok: true, settings };
}

/** Reads whatever the database holds, filling in anything missing or stale. */
export function normalizeStoredSettings(
  gameId: string,
  memoryMb: number,
  stored: unknown,
): ServerSettings {
  const validation = validateSettings(gameId, memoryMb, stored);
  if (validation.ok) return validation.settings;

  const defaults = defaultSettings(gameId, memoryMb);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return defaults;

  // A single bad field must not discard the rest: merge per key instead.
  const merged: ServerSettings = { ...defaults };
  for (const field of settingFields(gameId, memoryMb)) {
    const single = validateSettings(gameId, memoryMb, {
      ...defaults,
      [field.key]: (stored as Record<string, unknown>)[field.key],
    });
    if (single.ok) merged[field.key] = single.settings[field.key];
  }
  return merged;
}

function flag(value: SettingValue) {
  return value ? "TRUE" : "FALSE";
}

/**
 * Turns validated settings into the container variables the runtime reads.
 *
 * This is the only place that knows the image's variable names, so a runtime
 * swap changes one function rather than the panel, the queue and the schema.
 */
export function settingsToContainerVariables(
  gameId: ActiveGameId | string,
  settings: ServerSettings,
  /** Shown in the server list when the customer has not written their own line. */
  fallbackName = "",
): Record<string, string> {
  if (gameId === "minecraft") {
    const motd = String(settings.motd ?? "").trim();
    return {
      MOTD: motd || fallbackName,
      MAX_PLAYERS: String(settings.maxPlayers ?? 10),
      DIFFICULTY: String(settings.difficulty ?? "normal"),
      MODE: String(settings.gameMode ?? "survival"),
      PVP: flag(settings.pvp ?? true),
      ENABLE_WHITELIST: flag(settings.whitelist ?? false),
      ENFORCE_WHITELIST: flag(settings.whitelist ?? false),
      VIEW_DISTANCE: String(settings.viewDistance ?? 10),
    };
  }
  if (gameId === "terraria") {
    return {
      MAXPLAYERS: String(settings.maxPlayers ?? 8),
      DIFFICULTY: String(settings.difficulty ?? "0"),
    };
  }
  return {};
}

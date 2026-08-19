import type { ActiveGameId } from "./catalog.ts";

/**
 * What a customer may change about a running server, per game.
 *
 * The catalogue is deliberately narrow and typed: every field maps to one
 * container variable the certified runtime already understands. Anything not
 * described here cannot be set — a free-form key/value editor would let a
 * customer hand the runtime a value nobody has ever booted.
 *
 * Every field also names the group it belongs to, so the panel can present a
 * long catalogue as a handful of short sections rather than one wall of inputs.
 */
export type SettingField =
  | { key: string; group: SettingGroupId; kind: "text"; label: string; hint: string; maxLength: number; fallback: string; format?: "url" }
  | { key: string; group: SettingGroupId; kind: "number"; label: string; hint: string; min: number; max: number; fallback: number }
  | { key: string; group: SettingGroupId; kind: "choice"; label: string; hint: string; choices: ReadonlyArray<{ value: string; label: string }>; fallback: string }
  | { key: string; group: SettingGroupId; kind: "toggle"; label: string; hint: string; fallback: boolean };

export type SettingValue = string | number | boolean;
export type ServerSettings = Record<string, SettingValue>;

/**
 * The sections the panel shows, in the order it shows them.
 *
 * Ordering follows how often a customer needs the section, not how the game
 * happens to group its own properties file.
 */
export const SETTING_GROUPS = [
  { id: "genel", label: "Genel", hint: "Sunucunun listede nasıl göründüğü." },
  { id: "oyuncular", label: "Oyuncular ve erişim", hint: "Kimler girebilir, kaç kişi olabilir." },
  { id: "kurallar", label: "Oyun kuralları", hint: "Oyunun nasıl oynandığı." },
  { id: "dunya", label: "Dünya", hint: "Doğuş koruması, boyutlar ve canlı üretimi." },
  { id: "kaynak", label: "Kaynak paketi", hint: "Girişte oyunculara önerilen doku paketi." },
  { id: "basarim", label: "Başarım", hint: "Sunucunun ne kadar bellek ve işlemci harcadığı." },
] as const;

export type SettingGroupId = (typeof SETTING_GROUPS)[number]["id"];

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
    group: "genel",
    kind: "text",
    label: "Karşılama mesajı",
    hint: "Sunucu listesinde oyuncuların gördüğü satır.",
    maxLength: 59,
    fallback: "",
  },
  {
    key: "enableStatus",
    group: "genel",
    kind: "toggle",
    label: "Listede durum göster",
    hint: "Kapalıyken sunucu listede çevrimdışı görünür; giriş yine de çalışır.",
    fallback: true,
  },
  {
    key: "hideOnlinePlayers",
    group: "genel",
    kind: "toggle",
    label: "Oyuncu adlarını gizle",
    hint: "Açıkken listede yalnızca oyuncu sayısı görünür, adlar görünmez.",
    fallback: false,
  },

  {
    key: "maxPlayers",
    group: "oyuncular",
    kind: "number",
    label: "Maksimum oyuncu",
    hint: "Üst sınır paketin ölçülmüş bellek profiline bağlıdır.",
    min: 1,
    max: 100,
    fallback: 10,
  },
  {
    key: "whitelist",
    group: "oyuncular",
    kind: "toggle",
    label: "Beyaz liste",
    hint: "Açıkken yalnızca listeye eklenmiş oyuncular girebilir.",
    fallback: false,
  },
  {
    key: "onlineMode",
    group: "oyuncular",
    kind: "toggle",
    label: "Mojang hesabı doğrulaması",
    hint: "Kapatırsan lisanssız istemciler de girer; isim doğrulanmadığı için biri yetkilinin adıyla girebilir.",
    fallback: true,
  },
  {
    key: "opPermissionLevel",
    group: "oyuncular",
    kind: "choice",
    label: "Yetkili seviyesi",
    hint: "Yetkili yaptığın oyuncuların hangi komutlara erişeceğini belirler.",
    choices: [
      { value: "1", label: "1 · Doğuş korumasını aşar" },
      { value: "2", label: "2 · Oyun komutları" },
      { value: "3", label: "3 · Oyuncu atma ve yasaklama" },
      { value: "4", label: "4 · Tüm sunucu komutları" },
    ],
    fallback: "4",
  },
  {
    key: "playerIdleTimeout",
    group: "oyuncular",
    kind: "number",
    label: "Boşta atma süresi (dakika)",
    hint: "0 yazarsan kimse boşta kaldığı için atılmaz.",
    min: 0,
    max: 60,
    fallback: 0,
  },

  {
    key: "difficulty",
    group: "kurallar",
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
    group: "kurallar",
    kind: "choice",
    label: "Oyun modu",
    hint: "Yeni giren oyuncuların başlangıç modu.",
    choices: [
      { value: "survival", label: "Hayatta kalma" },
      { value: "creative", label: "Yaratıcı" },
      { value: "adventure", label: "Macera" },
      { value: "spectator", label: "İzleyici" },
    ],
    fallback: "survival",
  },
  {
    key: "forceGamemode",
    group: "kurallar",
    kind: "toggle",
    label: "Oyun modunu her girişte uygula",
    hint: "Açıkken oyuncu her girdiğinde yukarıdaki moda döner.",
    fallback: false,
  },
  {
    key: "hardcore",
    group: "kurallar",
    kind: "toggle",
    label: "Zorlu mod",
    hint: "Açıkken zorluk her zaman Zor olur ve ölen oyuncu kalıcı olarak izleyiciye düşer.",
    fallback: false,
  },
  {
    key: "pvp",
    group: "kurallar",
    kind: "toggle",
    label: "Oyuncular birbirine vurabilsin",
    hint: "Kapalıyken oyuncular birbirine hasar veremez.",
    fallback: true,
  },
  {
    key: "allowFlight",
    group: "kurallar",
    kind: "toggle",
    label: "Uçmaya izin ver",
    hint: "Uçma sağlayan eklenti veya modlar kullanıyorsan açık olmalı.",
    fallback: false,
  },
  {
    key: "enableCommandBlock",
    group: "kurallar",
    kind: "toggle",
    label: "Komut bloğu",
    hint: "Haritalarda ve mini oyunlarda kullanılan komut bloklarını çalıştırır.",
    fallback: false,
  },
  {
    key: "announceAchievements",
    group: "kurallar",
    kind: "toggle",
    label: "Başarımları duyur",
    hint: "Bir oyuncu başarım aldığında sohbette herkese yazılır.",
    fallback: true,
  },

  {
    key: "spawnProtection",
    group: "dunya",
    kind: "number",
    label: "Doğuş koruma yarıçapı",
    hint: "Doğuş noktası çevresinde yalnızca yetkililerin inşa edebileceği blok yarıçapı; 0 korumayı kapatır.",
    min: 0,
    max: 64,
    fallback: 16,
  },
  {
    key: "allowNether",
    group: "dunya",
    kind: "toggle",
    label: "Nether boyutu",
    hint: "Kapalıyken oyuncular Nether portalını kullanamaz.",
    fallback: true,
  },
  {
    key: "spawnMonsters",
    group: "dunya",
    kind: "toggle",
    label: "Canavarlar doğsun",
    hint: "Kapalıyken yeni düşman canlı üremez; mevcut olanlar kalır.",
    fallback: true,
  },
  {
    key: "spawnAnimals",
    group: "dunya",
    kind: "toggle",
    label: "Hayvanlar doğsun",
    hint: "Kapalıyken yeni hayvan üremez.",
    fallback: true,
  },
  {
    key: "spawnNpcs",
    group: "dunya",
    kind: "toggle",
    label: "Köylüler doğsun",
    hint: "Köylerdeki köylülerin üremesini kontrol eder.",
    fallback: true,
  },
  {
    key: "generateStructures",
    group: "dunya",
    kind: "toggle",
    label: "Yapılar üretilsin",
    hint: "Köy, kale ve tapınak gibi yapılar yalnızca yeni üretilen alanlarda etkilenir.",
    fallback: true,
  },
  {
    key: "maxWorldSize",
    group: "dunya",
    kind: "choice",
    label: "Dünya sınırı",
    hint: "Dar sınır disk kullanımını da düşürür; sınırı sonradan genişletmek dünyayı bozmaz.",
    choices: [
      { value: "1000", label: "1.000 blok" },
      { value: "5000", label: "5.000 blok" },
      { value: "10000", label: "10.000 blok" },
      { value: "50000", label: "50.000 blok" },
      { value: "29999984", label: "Sınırsız (oyunun kendi sınırı)" },
    ],
    fallback: "29999984",
  },

  {
    key: "resourcePack",
    group: "kaynak",
    kind: "text",
    label: "Kaynak paketi adresi",
    hint: "Doğrudan .zip dosyasına giden http veya https adresi. Boş bırakırsan paket önerilmez.",
    maxLength: 240,
    fallback: "",
    format: "url",
  },
  {
    key: "resourcePackEnforce",
    group: "kaynak",
    kind: "toggle",
    label: "Paketi zorunlu tut",
    hint: "Açıkken paketi reddeden oyuncu sunucuya giremez. Adres boşken yok sayılır.",
    fallback: false,
  },

  {
    key: "viewDistance",
    group: "basarim",
    kind: "number",
    label: "Görüş mesafesi",
    hint: "Oyuncunun kaç chunk uzağı gördüğü. Belleği ve işlemciyi en çok artıran ayardır.",
    min: 4,
    max: 16,
    fallback: 10,
  },
  {
    key: "simulationDistance",
    group: "basarim",
    kind: "number",
    label: "Simülasyon mesafesi",
    hint: "Canlıların ve mekanizmaların kaç chunk uzakta çalışmaya devam edeceği.",
    min: 4,
    max: 16,
    fallback: 10,
  },
  {
    key: "entityBroadcastRange",
    group: "basarim",
    kind: "number",
    label: "Canlı görünürlük oranı (%)",
    hint: "Düşük değer, uzaktaki canlıları istemciye göndermeyerek ağ yükünü azaltır.",
    min: 10,
    max: 500,
    fallback: 100,
  },
];

const TERRARIA_FIELDS: readonly SettingField[] = [
  {
    key: "maxPlayers",
    group: "oyuncular",
    kind: "number",
    label: "Maksimum oyuncu",
    hint: "Terraria sunucusu en fazla 16 oyuncu taşır.",
    min: 1,
    max: 16,
    fallback: 8,
  },
  {
    key: "difficulty",
    group: "kurallar",
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

/** The same fields, split into the sections the panel draws. Empty groups drop out. */
export function settingGroups(gameId: string, memoryMb: number) {
  const fields = settingFields(gameId, memoryMb);
  return SETTING_GROUPS
    .map((group) => ({
      id: group.id,
      label: group.label,
      hint: group.hint,
      fields: fields.filter((field) => field.group === group.id),
    }))
    .filter((group) => group.fields.length > 0);
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
 * Accepts only the two schemes a game client will actually fetch.
 *
 * A pack address is handed to every player who joins, so the scheme is checked
 * here rather than left to the client to reject one player at a time.
 */
function isFetchableUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates a whole settings object against the field catalogue for the game.
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
      const trimmed = value.trim();
      if (field.format === "url" && trimmed !== "" && !isFetchableUrl(trimmed)) {
        return {
          ok: false,
          code: "INVALID_SETTING",
          message: `${field.label} http veya https ile başlayan tam bir adres olmalıdır.`,
        };
      }
      settings[field.key] = trimmed;
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
 * This is the only place that knows the image variable names, so a runtime swap
 * changes one function rather than the panel, the queue and the schema.
 *
 * Every variable is written on every save, including the ones left at their
 * default. The image rewrites `server.properties` from its environment at each
 * boot, so a variable we omit would silently keep whatever an earlier save left
 * behind.
 */
export function settingsToContainerVariables(
  gameId: ActiveGameId | string,
  settings: ServerSettings,
  /** Shown in the server list when the customer has not written their own line. */
  fallbackName = "",
): Record<string, string> {
  if (gameId === "minecraft") {
    const motd = String(settings.motd ?? "").trim();
    const resourcePack = String(settings.resourcePack ?? "").trim();
    return {
      MOTD: motd || fallbackName,
      ENABLE_STATUS: flag(settings.enableStatus ?? true),
      HIDE_ONLINE_PLAYERS: flag(settings.hideOnlinePlayers ?? false),

      MAX_PLAYERS: String(settings.maxPlayers ?? 10),
      ENABLE_WHITELIST: flag(settings.whitelist ?? false),
      ENFORCE_WHITELIST: flag(settings.whitelist ?? false),
      ONLINE_MODE: flag(settings.onlineMode ?? true),
      OP_PERMISSION_LEVEL: String(settings.opPermissionLevel ?? "4"),
      PLAYER_IDLE_TIMEOUT: String(settings.playerIdleTimeout ?? 0),

      DIFFICULTY: String(settings.difficulty ?? "normal"),
      MODE: String(settings.gameMode ?? "survival"),
      FORCE_GAMEMODE: flag(settings.forceGamemode ?? false),
      HARDCORE: flag(settings.hardcore ?? false),
      PVP: flag(settings.pvp ?? true),
      ALLOW_FLIGHT: flag(settings.allowFlight ?? false),
      ENABLE_COMMAND_BLOCK: flag(settings.enableCommandBlock ?? false),
      ANNOUNCE_PLAYER_ACHIEVEMENTS: flag(settings.announceAchievements ?? true),

      SPAWN_PROTECTION: String(settings.spawnProtection ?? 16),
      ALLOW_NETHER: flag(settings.allowNether ?? true),
      SPAWN_MONSTERS: flag(settings.spawnMonsters ?? true),
      SPAWN_ANIMALS: flag(settings.spawnAnimals ?? true),
      SPAWN_NPCS: flag(settings.spawnNpcs ?? true),
      GENERATE_STRUCTURES: flag(settings.generateStructures ?? true),
      MAX_WORLD_SIZE: String(settings.maxWorldSize ?? 29_999_984),

      RESOURCE_PACK: resourcePack,
      // Enforcing a pack that was never set would turn every player away at the
      // door for a file the server does not have.
      RESOURCE_PACK_ENFORCE: flag(resourcePack ? settings.resourcePackEnforce ?? false : false),

      VIEW_DISTANCE: String(settings.viewDistance ?? 10),
      SIMULATION_DISTANCE: String(settings.simulationDistance ?? 10),
      ENTITY_BROADCAST_RANGE_PERCENTAGE: String(settings.entityBroadcastRange ?? 100),
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

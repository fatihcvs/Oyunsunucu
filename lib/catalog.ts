export type GameId = "minecraft" | "terraria" | "vintagestory" | "fivem" | "rust" | "valheim";

/**
 * Games we can actually host today.
 *
 * Railway's first-phase networking is TCP only, so a UDP game cannot be sold
 * until the second provider lands in Faz 8 — no matter how ready its runtime is.
 */
export type ActiveGameId = Extract<GameId, "minecraft" | "terraria" | "vintagestory">;

export type GameSoftware = {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  /**
   * Announced but not selectable yet.
   *
   * A software option is only sellable once a pinned runtime image exists for
   * it; listing one without an image would sell a server we cannot create.
   */
  soon?: boolean;
};

export type CatalogGame = {
  id: GameId;
  name: string;
  letter: string;
  color: string;
  tag: "Hazır" | "Beta" | "Yakında";
  desc: string;
  live: boolean;
  protocol: "TCP" | "UDP" | "TCP + UDP";
  software: GameSoftware[];
};

export type HostingPlan = {
  id: string;
  ram: number;
  label: string;
  players: string;
  price: number;
  storage: number;
  cpu: string;
};

export type HostingRegion = {
  id: "eu-west";
  name: string;
  location: string;
  flag: string;
  note: string;
  surcharge: number;
};

export type ServerDraft = {
  gameId: ActiveGameId;
  softwareId: string;
  planId: string;
  regionId: HostingRegion["id"];
  serverName: string;
  backups: boolean;
};

export const GAME_CATALOG: CatalogGame[] = [
  {
    id: "minecraft",
    name: "Minecraft Java",
    letter: "M",
    color: "#73d865",
    tag: "Hazır",
    desc: "Paper, Vanilla, Fabric ve mod platformları.",
    live: true,
    protocol: "TCP",
    software: [
      { id: "paper", name: "Paper", description: "Eklenti desteği ve yüksek performans.", recommended: true },
      { id: "purpur", name: "Purpur", description: "Paper tabanlı, ayar esnekliği yüksek sürüm." },
      { id: "vanilla", name: "Vanilla", description: "Oyunun sade, resmi sunucu deneyimi." },
      { id: "fabric", name: "Fabric", description: "Hafif mod paketleri için esnek kurulum." },
      { id: "spigot", name: "Spigot", description: "Klasik eklenti ekosisteminin referans sunucusu.", soon: true },
      { id: "forge", name: "Forge", description: "Büyük mod paketleri için köklü platform.", soon: true },
      { id: "neoforge", name: "NeoForge", description: "Forge'un güncel çatalı; yeni mod paketleri burada.", soon: true },
      { id: "quilt", name: "Quilt", description: "Fabric uyumlu, topluluk yönetimli mod yükleyici.", soon: true },
    ],
  },
  {
    id: "terraria",
    name: "Terraria",
    letter: "T",
    color: "#5dcde9",
    tag: "Beta",
    desc: "Küçük ekipler, kalıcı dünyalar.",
    live: true,
    protocol: "TCP",
    software: [
      { id: "terraria-vanilla", name: "Vanilla", description: "Klasik Terraria çok oyunculu deneyimi.", recommended: true },
      { id: "tmodloader", name: "tModLoader", description: "Topluluk modları için hazırlanmış kurulum.", soon: true },
    ],
  },
  {
    id: "vintagestory",
    name: "Vintage Story",
    letter: "V",
    color: "#c8a15a",
    tag: "Beta",
    desc: "Hayatta kalma ve inşa, kalıcı dünyalar.",
    live: true,
    protocol: "TCP",
    software: [
      { id: "vintagestory-vanilla", name: "Vanilla", description: "Resmi sunucu; mod desteği sonraki dilimde.", recommended: true },
    ],
  },
  {
    id: "fivem",
    name: "FiveM",
    letter: "F",
    color: "#f29a48",
    tag: "Yakında",
    desc: "Yeni UDP sunucu ağıyla.",
    live: false,
    protocol: "TCP + UDP",
    software: [],
  },
  {
    id: "valheim",
    name: "Valheim",
    letter: "W",
    color: "#7fa9c4",
    tag: "Yakında",
    desc: "Küçük ekipler için Viking dünyası.",
    live: false,
    protocol: "UDP",
    software: [],
  },
  {
    id: "rust",
    name: "Rust",
    letter: "R",
    color: "#d3664a",
    tag: "Yakında",
    desc: "Modlu ve yüksek performanslı.",
    live: false,
    protocol: "UDP",
    software: [],
  },
];

export const ACTIVE_GAMES = GAME_CATALOG.filter(
  (game): game is CatalogGame & { id: ActiveGameId } => game.live,
);

/** Software a customer can actually order today. */
export function sellableSoftware(game: CatalogGame) {
  return game.software.filter((software) => !software.soon);
}

export const HOSTING_PLANS: HostingPlan[] = [
  { id: "mini-2", ram: 2, label: "Mini", players: "1–6 oyuncu", price: 299, storage: 10, cpu: "Paylaşımlı" },
  { id: "starter-4", ram: 4, label: "Başlangıç", players: "6–15 oyuncu", price: 499, storage: 20, cpu: "Paylaşımlı+" },
  { id: "performance-6", ram: 6, label: "Performans", players: "15–30 oyuncu", price: 699, storage: 30, cpu: "Öncelikli" },
  { id: "community-8", ram: 8, label: "Topluluk", players: "30–50 oyuncu", price: 899, storage: 40, cpu: "Öncelikli" },
  { id: "pro-12", ram: 12, label: "Pro", players: "50+ oyuncu", price: 1249, storage: 60, cpu: "Yüksek öncelik" },
];

export const HOSTING_REGIONS: HostingRegion[] = [
  {
    id: "eu-west",
    name: "Avrupa Batı",
    location: "Amsterdam",
    flag: "🇪🇺",
    note: "Railway üzerindeki Türkiye'ye en yakın dağıtım bölgesi",
    surcharge: 0,
  },
];

export const BACKUP_MONTHLY_PRICE = 49;
export const CONFIGURATOR_STORAGE_KEY = "riftory.server-draft.v1";
export const DRAFT_IMPORT_KEY_STORAGE_KEY = "riftory.server-draft.import-key.v1";

/**
 * Stamped on every stored draft so a later catalog change stays traceable.
 * Bump it whenever plans, games or pricing inputs change meaning.
 */
export const CATALOG_VERSION = "catalog-2026-08-v1";

export const DEFAULT_SERVER_DRAFT: ServerDraft = {
  gameId: "minecraft",
  softwareId: "paper",
  planId: "starter-4",
  regionId: "eu-west",
  serverName: "Fatih'in Dünyası",
  backups: true,
};

export function getGame(gameId: GameId) {
  return GAME_CATALOG.find((game) => game.id === gameId) ?? GAME_CATALOG[0];
}

export function getPlan(planId: string) {
  return HOSTING_PLANS.find((plan) => plan.id === planId) ?? HOSTING_PLANS[1];
}

export function getRegion(regionId: string) {
  return HOSTING_REGIONS.find((region) => region.id === regionId) ?? HOSTING_REGIONS[0];
}

export function calculateMonthlyPrice(draft: Pick<ServerDraft, "planId" | "regionId" | "backups">) {
  const plan = getPlan(draft.planId);
  const region = getRegion(draft.regionId);
  return plan.price + region.surcharge + (draft.backups ? BACKUP_MONTHLY_PRICE : 0);
}

export function formatTry(amount: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function isServerDraft(value: unknown): value is ServerDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ServerDraft>;

  // The software must be one this game actually sells: a hand-written draft
  // must not be able to order an option the store does not offer.
  const game = ACTIVE_GAMES.find((candidate) => candidate.id === draft.gameId);
  if (!game || !sellableSoftware(game).some((software) => software.id === draft.softwareId)) {
    return false;
  }

  return (
    HOSTING_PLANS.some((plan) => plan.id === draft.planId) &&
    HOSTING_REGIONS.some((region) => region.id === draft.regionId) &&
    typeof draft.serverName === "string" &&
    typeof draft.backups === "boolean"
  );
}

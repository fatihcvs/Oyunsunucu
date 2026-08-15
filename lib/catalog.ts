export type GameId = "minecraft" | "terraria" | "fivem" | "rust";
export type ActiveGameId = Extract<GameId, "minecraft" | "terraria">;

export type GameSoftware = {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
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
    desc: "Paper, Vanilla ve Fabric.",
    live: true,
    protocol: "TCP",
    software: [
      { id: "paper", name: "Paper", description: "Eklenti desteği ve yüksek performans.", recommended: true },
      { id: "vanilla", name: "Vanilla", description: "Oyunun sade, resmi sunucu deneyimi." },
      { id: "fabric", name: "Fabric", description: "Hafif mod paketleri için esnek kurulum." },
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
      { id: "tmodloader", name: "tModLoader", description: "Topluluk modları için hazırlanmış kurulum." },
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
  return (
    ACTIVE_GAMES.some((game) => game.id === draft.gameId) &&
    typeof draft.softwareId === "string" &&
    HOSTING_PLANS.some((plan) => plan.id === draft.planId) &&
    HOSTING_REGIONS.some((region) => region.id === draft.regionId) &&
    typeof draft.serverName === "string" &&
    typeof draft.backups === "boolean"
  );
}

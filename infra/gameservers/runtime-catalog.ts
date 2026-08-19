import { ACTIVE_GAMES, type ActiveGameId } from "../../lib/catalog.ts";

/**
 * Memory the runtime reserves outside the game heap.
 *
 * Measured on a 2 GB container: a 1536 MB Paper heap produced 1963 MB RSS right
 * after boot, leaving 85 MB before the OOM killer. The JVM's own metaspace,
 * thread stacks, GC structures and direct buffers cost roughly 400 MB at that
 * size and grow with the heap, so the reserve is the larger of a fixed floor
 * and a share of the plan.
 */
export const OFF_HEAP_FLOOR_MB = 768;
export const OFF_HEAP_RATIO = 0.2;

export type RuntimeVerification =
  /** No image chosen yet; the option cannot be sold until one is pinned. */
  | "unresolved"
  /** Declared and reviewed, but never booted under a plan-sized limit. */
  | "declared"
  /** Booted, reachable, world survived a graceful restart under a real limit. */
  | "certified";

export type GameRuntime = {
  gameId: ActiveGameId;
  softwareId: string;
  /** Pinned image reference, or null while the runtime is unresolved. */
  image: string | null;
  /**
   * Pinned game version.
   *
   * Certification found that image and game version must move together: Paper
   * 26.2 refuses to start on the `java21` image, so a floating game version can
   * break a pinned image without any change on our side.
   */
  gameVersion: string;
  containerPort: number;
  protocol: "TCP" | "UDP";
  dataPath: string;
  /** Log line that marks "accepting players", not merely "process started". */
  readinessPattern: string;
  /** Minimum plan RAM this runtime may be offered on, in MB. */
  minimumMemoryMb: number;
  verification: RuntimeVerification;
  notes: string;
};

export const GAME_RUNTIMES: GameRuntime[] = [
  {
    gameId: "minecraft",
    softwareId: "paper",
    image: "itzg/minecraft-server:java25",
    gameVersion: "26.2",
    containerPort: 25565,
    protocol: "TCP",
    dataPath: "/data",
    readinessPattern: 'Done \\([0-9.]+s\\)! For help, type "help"',
    minimumMemoryMb: 2048,
    verification: "certified",
    notes: "TYPE=PAPER; oyun sürümü Java sürümüyle birlikte sabitlenir. 2 GB planında ölçüldü.",
  },
  {
    gameId: "minecraft",
    softwareId: "purpur",
    image: "itzg/minecraft-server:java25",
    gameVersion: "26.2",
    containerPort: 25565,
    protocol: "TCP",
    dataPath: "/data",
    readinessPattern: 'Done \\([0-9.]+s\\)! For help, type "help"',
    minimumMemoryMb: 2048,
    verification: "certified",
    notes: "TYPE=PURPUR; 2 GB planında ayrı ölçüldü, bellek profili Paper'a çok yakın.",
  },
  {
    gameId: "minecraft",
    softwareId: "vanilla",
    image: "itzg/minecraft-server:java25",
    gameVersion: "26.2",
    containerPort: 25565,
    protocol: "TCP",
    dataPath: "/data",
    readinessPattern: 'Done \\([0-9.]+s\\)! For help, type "help"',
    minimumMemoryMb: 2048,
    verification: "certified",
    notes: "TYPE=VANILLA; 2 GB planında ölçüldü, eklenti yüzeyi olmadığı için Paper'dan daha rahat.",
  },
  {
    gameId: "minecraft",
    softwareId: "fabric",
    image: "itzg/minecraft-server:java25",
    gameVersion: "26.2",
    containerPort: 25565,
    protocol: "TCP",
    dataPath: "/data",
    readinessPattern: 'Done \\([0-9.]+s\\)! For help, type "help"',
    minimumMemoryMb: 4096,
    verification: "certified",
    notes: "TYPE=FABRIC; 4 GB planında ölçüldü. Mod paketleri bellek talebini artırdığı için 2 GB planında sunulmaz.",
  },
  {
    gameId: "terraria",
    softwareId: "terraria-vanilla",
    image: "riftory/terraria:vanilla-1.4.4.9-r1",
    gameVersion: "1.4.4.9",
    containerPort: 7777,
    protocol: "TCP",
    dataPath: "/root/.local/share/Terraria/Worlds",
    readinessPattern: "Server started",
    minimumMemoryMb: 2048,
    verification: "certified",
    notes: "infra/gameservers/terraria imajı: SIGTERM'i konsol `exit` komutuna çevirir. Üstteki `ryshe/terraria:latest` TShock'tur, vanilla değildir.",
  },
  {
    gameId: "vintagestory",
    softwareId: "vintagestory-vanilla",
    // The publisher's image has no version tags, so the digest is the pin.
    image: "devidian/vintagestory@sha256:7a5ea3b8aadd2271b17150343c6534a3e6635c31ba84acdef4c8d829e2b6d741",
    gameVersion: "1.22.6",
    containerPort: 42420,
    protocol: "TCP",
    dataPath: "/gamedata/vs",
    readinessPattern: "Dedicated Server now running on Port",
    minimumMemoryMb: 2048,
    verification: "certified",
    notes: "1.20'den beri sunucular varsayılan olarak beyaz liste modundadır; panel bu ayarı açıkça sunmalıdır. Ayarlar veri hacmindeki serverconfig.json dosyasındadır.",
  },
  {
    gameId: "terraria",
    softwareId: "tmodloader",
    image: null,
    gameVersion: "1.4.4.9",
    containerPort: 7777,
    protocol: "TCP",
    dataPath: "/root/.local/share/Terraria/Worlds",
    readinessPattern: "Server started",
    minimumMemoryMb: 4096,
    verification: "unresolved",
    notes: "Sürüm sabitlenmiş bir tModLoader imajı bulunamadı; beta açılmadan önce imaj seçilmeli veya kendi imajımız üretilmelidir.",
  },
];

export function findGameRuntime(gameId: string, softwareId: string) {
  return GAME_RUNTIMES.find(
    (runtime) => runtime.gameId === gameId && runtime.softwareId === softwareId,
  ) ?? null;
}

/** Every live catalog option needs a runtime; this keeps the two lists from drifting. */
export function missingRuntimeCombinations() {
  return ACTIVE_GAMES.flatMap((game) => game.software
    .filter((software) => !findGameRuntime(game.id, software.id))
    .map((software) => `${game.id}/${software.id}`));
}

export function offHeapReserveMegabytes(planMemoryMb: number) {
  return Math.max(OFF_HEAP_FLOOR_MB, Math.round(planMemoryMb * OFF_HEAP_RATIO));
}

export function heapMegabytes(planMemoryMb: number) {
  return planMemoryMb - offHeapReserveMegabytes(planMemoryMb);
}

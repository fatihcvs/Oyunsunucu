import type { ActiveGameId } from "./catalog";

export const SITE_NAME = "Riftory";
export const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://oyun-sunucu.fatihcvs55.chatgpt.site";

export const SITE_DESCRIPTION =
  "Minecraft Java ve Terraria için oyun sunucusu planını oluştur; RAM, yazılım, yedekleme ve Türkçe panel deneyimini tek yerde incele.";

export const GAME_LANDING_PATHS: Record<ActiveGameId, string> = {
  minecraft: "/minecraft-sunucu-kiralama",
  terraria: "/terraria-sunucu-kiralama",
};

export function absoluteUrl(path = "/") {
  return new URL(path, `${SITE_ORIGIN}/`).toString();
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}


import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    { url: absoluteUrl("/"), lastModified, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/minecraft-sunucu-kiralama"), lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/terraria-sunucu-kiralama"), lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/kurulum"), lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: absoluteUrl("/panel"), lastModified, changeFrequency: "monthly", priority: 0.6 },
  ];
}


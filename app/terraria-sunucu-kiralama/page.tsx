import type { Metadata } from "next";
import { GameSeoLanding } from "../_components/game-seo-landing";
import { GAME_SEO_CONTENT } from "@/lib/seo-content";
import { absoluteUrl } from "@/lib/seo";

const content = GAME_SEO_CONTENT.terraria;

export const metadata: Metadata = {
  title: content.metaTitle,
  description: content.metaDescription,
  alternates: { canonical: content.slug },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    url: absoluteUrl(content.slug),
    title: `${content.metaTitle} | Riftory`,
    description: content.metaDescription,
  },
  twitter: {
    card: "summary",
    title: `${content.metaTitle} | Riftory`,
    description: content.metaDescription,
  },
};

export default function TerrariaServerPage() {
  return <GameSeoLanding content={content} />;
}


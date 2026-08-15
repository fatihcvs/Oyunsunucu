import type { Metadata } from "next";
import {
  ACTIVE_GAMES,
  DEFAULT_SERVER_DRAFT,
  HOSTING_PLANS,
  type ServerDraft,
} from "@/lib/catalog";
import { ProductFooter } from "../_components/product-footer";
import { ProductHeader } from "../_components/product-header";
import { Configurator } from "./configurator";

export const metadata: Metadata = {
  title: "Oyun Sunucusu Yapılandırıcı",
  description: "Minecraft Java veya Terraria oyun sunucusu planını oluştur; yazılım, RAM, NVMe depolama, bölge ve günlük yedek seçeneklerini karşılaştır.",
  alternates: { canonical: "/kurulum" },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    url: "/kurulum",
    title: "Oyun Sunucusu Yapılandırıcı | Riftory",
    description: "Minecraft Java veya Terraria için kaynakları ve tahmini beta fiyatını adım adım karşılaştır.",
  },
};

type ConfigurePageProps = {
  searchParams: Promise<{
    game?: string | string[];
    plan?: string | string[];
  }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConfigurePage({ searchParams }: ConfigurePageProps) {
  const query = await searchParams;
  const requestedGame = ACTIVE_GAMES.find((item) => item.id === first(query.game));
  const requestedPlan = HOSTING_PLANS.find((item) => item.id === first(query.plan));
  const initialDraft: ServerDraft = {
    ...DEFAULT_SERVER_DRAFT,
    ...(requestedGame
      ? {
          gameId: requestedGame.id,
          softwareId: requestedGame.software[0]?.id ?? "",
        }
      : {}),
    ...(requestedPlan ? { planId: requestedPlan.id } : {}),
  };

  return (
    <main className="productPage configuratorPage">
      <div className="noise" aria-hidden="true" />
      <ProductHeader active="configure" />
      <Configurator
        initialDraft={initialDraft}
        requestedGameId={requestedGame?.id}
        requestedPlanId={requestedPlan?.id}
      />
      <ProductFooter />
    </main>
  );
}

import type { Metadata } from "next";
import { ProductHeader } from "../_components/product-header";
import { PanelDemo } from "./panel-demo";

export const metadata: Metadata = {
  title: "Oyun Sunucusu Kontrol Paneli Demosu",
  description: "Minecraft ve Terraria sunucuları için tasarlanan Riftory kontrol panelinde konsol, yedek, kaynak takibi ve sunucu ayarlarını deneyin.",
  alternates: { canonical: "/panel" },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    url: "/panel",
    title: "Oyun Sunucusu Kontrol Paneli Demosu | Riftory",
    description: "Konsol, yedekleme, kaynak takibi ve sunucu yönetimi akışlarını çalışan ürün demosunda inceleyin.",
  },
};

export default function PanelPage() {
  return (
    <main className="productPage controlPage">
      <div className="noise" aria-hidden="true" />
      <ProductHeader active="panel" />
      <PanelDemo />
    </main>
  );
}

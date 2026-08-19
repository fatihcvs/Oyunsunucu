import type { Metadata } from "next";
import { ProductFooter } from "../../_components/product-footer";
import { ProductHeader } from "../../_components/product-header";
import { VerifyExperience } from "./verify-experience";

export const metadata: Metadata = {
  title: "Giriş Bağlantısını Doğrula",
  description: "Riftory tek kullanımlık giriş bağlantısı onay adımı.",
  alternates: { canonical: "/giris/dogrula" },
  robots: { index: false, follow: false },
};

type VerifyPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const query = await searchParams;
  const token = Array.isArray(query.token) ? query.token[0] : query.token;

  return (
    <main className="productPage authPage">
      <div className="noise" aria-hidden="true" />
      <ProductHeader active="account" />
      <VerifyExperience token={token ?? ""} />
      <ProductFooter />
    </main>
  );
}

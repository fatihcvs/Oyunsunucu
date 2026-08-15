import type { Metadata } from "next";
import { ProductFooter } from "../_components/product-footer";
import { ProductHeader } from "../_components/product-header";
import { resolveAuthRequest } from "@/lib/auth-contracts";
import { AuthExperience } from "./auth-experience";

export const metadata: Metadata = {
  title: "Giriş ve Hesap Oluşturma",
  description: "Riftory hesap, Discord ve güvenli e-posta giriş deneyimi.",
  alternates: { canonical: "/giris" },
  robots: { index: false, follow: false },
};

type LoginPageProps = {
  searchParams: Promise<{
    mode?: string | string[];
    return_to?: string | string[];
  }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const request = resolveAuthRequest(first(query.mode), first(query.return_to));

  return (
    <main className="productPage authPage">
      <div className="noise" aria-hidden="true" />
      <ProductHeader active="account" />
      <AuthExperience initialMode={request.mode} returnTo={request.returnTo} />
      <ProductFooter />
    </main>
  );
}

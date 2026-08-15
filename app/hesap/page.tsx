import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "../_components/icon";
import { ProductFooter } from "../_components/product-footer";
import { ProductHeader } from "../_components/product-header";
import { AuthReadiness } from "./auth-readiness";

export const metadata: Metadata = {
  title: "Hesap ve Güvenlik Merkezi",
  description: "Riftory hesap, oturum, izin ve sunucu taslağı yönetim alanı.",
  alternates: { canonical: "/hesap" },
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <main className="productPage accountPage">
      <div className="noise" aria-hidden="true" />
      <ProductHeader active="account" />

      <section className="accountShell">
        <header className="accountHero">
          <div>
            <span className="eyebrow"><i /> Faz 2 · Hesap merkezi</span>
            <h1>Hesabın için güvenli temel <em>hazır.</em></h1>
            <p>PostgreSQL deposu ve tek kullanımlık giriş zinciri kod düzeyinde hazır. Canlı Railway bağlantısı ile kimlik sağlayıcısı henüz bağlı olmadığı için bu sayfa kişisel veri göstermiyor.</p>
          </div>
          <div className="accountGate">
            <span><Icon name="lock" size={22} /></span>
            <div><small>OTURUM DURUMU</small><b>Henüz giriş yapılmadı</b><p>Gerçek kullanıcı oturumu oluşturulmadı; örnek profil veya sahte sunucu verisi göstermiyoruz.</p></div>
            <div><Link className="button" href="/giris?return_to=%2Fhesap">Giriş akışını gör <Icon name="arrow" size={17} /></Link><Link href="/giris?mode=register&return_to=%2Fhesap">Hesap oluşturma ön izlemesi</Link></div>
          </div>
        </header>

        <AuthReadiness />

        <section className="accountPrinciples">
          <article><span>01</span><Icon name="lock" size={21} /><h3>Parolasız giriş</h3><p>Discord veya tek kullanımlık e-posta bağlantısı; uygulama parolası tutulmaz.</p></article>
          <article><span>02</span><Icon name="shield" size={21} /><h3>Gizli kaynaklar</h3><p>Başka kullanıcıya ait taslak ve sunucular bulunamadı yanıtıyla kapatılır.</p></article>
          <article><span>03</span><Icon name="refresh" size={21} /><h3>İşlemsel bütünlük</h3><p>Bağlantı tek kez tüketilir; kullanıcı ve oturum aynı veritabanı işlemi içinde oluşur.</p></article>
        </section>
      </section>

      <ProductFooter />
    </main>
  );
}

import Link from "next/link";
import { Icon } from "./icon";

export function ProductHeader({ active }: { active?: "games" | "configure" | "panel" | "account" }) {
  return (
    <header className="productHeader">
      <Link className="brand" href="/" aria-label="Riftory ana sayfa">
        <span className="brandIcon"><i /></span><b>RIFTORY</b>
      </Link>
      <nav aria-label="Ürün menüsü">
        <Link className={active === "games" ? "active" : ""} href="/#oyunlar">Oyunlar</Link>
        <Link className={active === "configure" ? "active" : ""} href="/kurulum">Sunucu kur</Link>
        <Link className={active === "panel" ? "active" : ""} href="/panel">Panel demosu</Link>
        <Link className={active === "account" ? "active" : ""} href="/hesap">Hesap</Link>
      </nav>
      <div className="productHeaderActions">
        <span><i /> Geliştirme sürümü</span>
        {active === "panel" ? (
          <Link className="button small" href="/kurulum">Yeni sunucu <Icon name="plus" size={16} /></Link>
        ) : active === "account" ? (
          <Link className="button small" href="/kurulum">Sunucu kur <Icon name="arrow" size={16} /></Link>
        ) : (
          <Link className="panelShortcut" href="/giris">Giriş yap <Icon name="arrow" size={16} /></Link>
        )}
      </div>
    </header>
  );
}

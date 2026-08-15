import Link from "next/link";

export function ProductFooter() {
  return (
    <footer className="productFooter">
      <span>© 2026 Riftory · Çalışma markası</span>
      <nav aria-label="Alt menü">
        <Link href="/">Ana sayfa</Link>
        <Link href="/minecraft-sunucu-kiralama">Minecraft</Link>
        <Link href="/terraria-sunucu-kiralama">Terraria</Link>
        <Link href="/kurulum">Sunucu kur</Link>
        <Link href="/panel">Panel demosu</Link>
        <Link href="/hesap">Hesap</Link>
      </nav>
      <span><i /> Faz 2 geliştiriliyor</span>
    </footer>
  );
}

import Link from "next/link";
import { Icon } from "./_components/icon";

export default function NotFound() {
  return (
    <main className="notFoundPage">
      <span className="brandIcon big"><i /></span>
      <small>404 · DÜNYA BULUNAMADI</small>
      <h1>Bu sunucu<br />henüz oluşturulmamış.</h1>
      <p>Bağlantıyı kontrol edebilir veya yeni bir oyun sunucusu planı hazırlayabilirsin.</p>
      <Link className="button large" href="/kurulum">Sunucu kur <Icon name="arrow" /></Link>
    </main>
  );
}

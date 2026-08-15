import Link from "next/link";
import { Icon } from "./_components/icon";

// not-found.tsx bir route segmenti olmadığı için `metadata` export'u yok sayılır.
// Bu sayfa layout'un site düzeyi varsayılanlarını devralır: ana sayfaya ait
// başlık veya canonical taşımaz, indekslenmemesi HTTP 404 durumuyla bildirilir.
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

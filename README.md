# Riftory — Oyun Sunucusu Platformu

Riftory, oyuncuların teknik kurulumla uğraşmadan oyun sunucusu seçmesi, satın
alması ve yönetmesi için geliştirilen bir hosting ürünüdür. `Riftory` şu anda
çalışma markasıdır; marka ve alan adı doğrulanmadan hukuki sahiplik iddiası
yoktur.

## Şu an çalışan yüzler

- `/` — pazarlama sitesi ve hızlı fiyat yapılandırıcısı
- `/minecraft-sunucu-kiralama` — Minecraft Java arama niyeti ve paket rehberi
- `/terraria-sunucu-kiralama` — Terraria/tModLoader arama niyeti ve paket rehberi
- `/kurulum` — dört adımlı tam sunucu yapılandırıcısı
- `/panel` — başlat/durdur, konsol, yedek ve ayar etkileşimlerini içeren ürün demosu
- `/giris` — kişisel veri göndermeyen giriş/kayıt deneyimi ön izlemesi
- `/hesap` — kod ve canlı ortam hazırlığını ayrı gösteren güvenlik merkezi
- `/api/auth/status` — secret değeri açığa çıkarmayan, cache'siz kimlik hazırlık durumu

Yapılandırıcı seçimi tarayıcıda yerel taslak olarak saklar ve panel demosuna
aktarır. PostgreSQL kimlik repository'si ve magic-link servis sözleşmesi hazır
olsa da yayın ortamına sürücü ve sağlayıcı anahtarları bağlanmamıştır. Bu nedenle
şu anda hesap, ödeme veya gerçek oyun sunucusu oluşturma işlemi yapılmaz.

## Ürün yol haritası

Tam faz planı, teknik kararlar, doğrulama kapıları ve beta kapsamı
[`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md) dosyasındadır.
Organik keşif hedefleri, içerik kuralları ve yayın kontrol listesi
[`docs/SEO_CONTENT_FOUNDATION.md`](docs/SEO_CONTENT_FOUNDATION.md) dosyasındadır.

## Hedef üretim mimarisi

- Next.js mağaza ve müşteri paneli
- PostgreSQL ana kayıt sistemi
- Ayrı provisioning worker ve kuyruk/outbox modeli
- Sağlayıcıdan bağımsız `GameServerProvider` sözleşmesi
- İlk TCP oyunları için Railway GraphQL API, service, volume ve TCP Proxy
- UDP oyunları için ikinci fazda ayrı altyapı sağlayıcısı

Mevcut yayın, ürün yüzünü hızlıca incelemek için Sites üzerinde çalışır. Ticari
üretim hedefi ve oyun sunucusu otomasyonu Railway odaklıdır.

## Geliştirme komutları

Bulut derleme ajanı (Linux) için:

- `npm run lint` — kaynak denetimi
- `npm run typecheck` — TypeScript ve Worker bağlama sözleşmesi denetimi
- `npm run dev` — yerel geliştirme sunucusu
- `npm run build` — Sites üretim çıktısı ve artifact doğrulaması
- `npm test` — üretim çıktısı ve HTML metadata testi

Kendi bilgisayarında (Windows, macOS, Linux) `:local` ekli karşılıkları kullan:

- `npm run doctor` — Node sürümü ve bağımlılık durumu
- `npm run dev:local` — geliştirme sunucusu
- `npm run build:local` — üretim çıktısı ve artifact doğrulaması
- `npm run test:local` — derleme ve testler
- `npm run lint:local`, `npm run typecheck:local` — denetimler

Eki olmayan komutlar `scripts/*.sh` üzerinden `flock`, GNU `timeout` ve `/proc`
gerektirir; bunlar yalnızca Linux'ta bulunur. `:local` komutları aynı işi
`scripts/local.mjs` ile taşınır biçimde yapar.

Node.js `>=22.13.0` gereklidir. Bilgisayara kurulum adımları
[`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md) dosyasındadır.

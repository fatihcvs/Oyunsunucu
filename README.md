# Riftory — Oyun Sunucusu Platformu

Riftory, oyuncuların teknik kurulumla uğraşmadan oyun sunucusu seçmesi, satın
alması ve yönetmesi için geliştirilen bir hosting ürünüdür. `Riftory` şu anda
çalışma markasıdır; marka ve alan adı doğrulanmadan hukuki sahiplik iddiası
yoktur.

## Katalog kapsamı

Beta kapsamındaki oyunlar Minecraft Java (Paper, Purpur, Vanilla, Fabric),
Terraria (Vanilla) ve Vintage Story'dir. FiveM, Rust ve Valheim UDP kullandığı
için Railway'in ilk faz TCP ağında barındırılamaz ve katalogda "Yakında"
durumundadır.

## Şu an çalışan yüzler

- `/` — pazarlama sitesi ve hızlı fiyat yapılandırıcısı
- `/minecraft-sunucu-kiralama` — Minecraft Java arama niyeti ve paket rehberi
- `/terraria-sunucu-kiralama` — Terraria/tModLoader arama niyeti ve paket rehberi
- `/kurulum` — dört adımlı tam sunucu yapılandırıcısı
- `/panel` — gerçek sunucu durumu, başlat/durdur/yeniden başlat, konsol, zamanlanmış yeniden başlatma ve sunucu ayarları
- `/giris` — magic-link isteğini gerçek uca gönderen giriş/kayıt deneyimi
- `/giris/dogrula` — tek kullanımlık bağlantıyı yalnızca kullanıcı onayıyla tüketen adım
- `/hesap` — kod ve canlı ortam hazırlığını ayrı gösteren güvenlik merkezi
- `/api/auth/status` — secret değeri açığa çıkarmayan, cache'siz kimlik hazırlık durumu
- `/api/auth/email/start` — magic-link isteği; ortam hazır değilse kişisel veriyi okumadan reddeder
- `/api/auth/email/verify` — bağlantıyı tüketir ve `__Host-` oturum çerezini kurar
- `/api/auth/session` — kullanıcının kendi oturum durumu; kimlik değerleri döndürmez
- `/api/auth/session/refresh` — oturumu aynı aile içinde döndürür
- `/api/auth/signout` — tek cihazdan veya tüm cihazlardan çıkış
- `/api/auth/password` — e-posta ve parolayla kayıt/giriş (kapalı betada doğrulama yok)
- `/api/auth/drafts/import` — cihazdaki sunucu taslağını hesaba bir kez taşır
- `/api/auth/discord/start` ve `/api/auth/discord/callback` — PKCE'li Discord girişi
- `/api/orders` — oturum açmış müşteri için sipariş açar; tutarı katalogdan hesaplar
- `/api/payments/webhook` — imzayla doğrulanan, tekrar teslime kapalı ödeme bildirimi
- `/api/health` — veritabanı erişimini de sınayan dağıtım sağlık kontrolü
- `/admin` — üyelik tablosuyla korunan operasyon ve provisioning yönetim yüzü
- `/api/admin` — admin özeti, arama, sunucu komutları, paket yükseltme, elle
  bakiye ekleme, üyelik yönetimi ve başarısız işi kontrollü yeniden deneme
- `/api/admin/session` — yalnızca üyeliği olan hesaba oturum açan admin parola girişi
- `/api/admin/password` — yöneticinin kendi parolasını değiştirmesi
- `/api/assistant` — doğal dil isteğini onaya sunulan bir öneriye çeviren asistan (OpenAI)

Yapılandırıcı seçimi tarayıcıda yerel taslak olarak saklar ve panel demosuna
aktarır. PostgreSQL kimlik repository'si, magic-link servisi, e-posta teslim
adaptörü ve oturum uçları hazır olsa da yayın ortamına PostgreSQL sürücüsü ve
sağlayıcı anahtarları bağlanmamıştır. Kimlik uçları bu durumda açık bir `503`
döndürür; şu anda hesap, ödeme veya gerçek oyun sunucusu oluşturma işlemi
yapılmaz.

## Ürün yol haritası

Tam faz planı, teknik kararlar, doğrulama kapıları ve beta kapsamı
[`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md) dosyasındadır.
Organik keşif hedefleri, içerik kuralları ve yayın kontrol listesi
[`docs/SEO_CONTENT_FOUNDATION.md`](docs/SEO_CONTENT_FOUNDATION.md) dosyasındadır.
Asistanın mimari sınırları, kapalı işlem kümesi ve istem enjeksiyonuna karşı
duruşu [`docs/ASSISTANT.md`](docs/ASSISTANT.md) dosyasındadır.
Katalogdaki oyun/yazılım birleşimlerinin gerçek kapsayıcıda ölçülmüş davranışı
ve hangi iddiaların henüz doğrulanmadığı
[`docs/GAME_RUNTIME_CERTIFICATION.md`](docs/GAME_RUNTIME_CERTIFICATION.md)
dosyasındadır. Sipariş, fiyat dondurma ve ödeme idempotency kuralları
[`docs/ORDER_PAYMENT_FOUNDATION.md`](docs/ORDER_PAYMENT_FOUNDATION.md)
dosyasındadır.

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

- `npm run lint` — kaynak denetimi
- `npm run typecheck` — TypeScript ve Worker bağlama sözleşmesi denetimi
- `npm run dev` — yerel geliştirme sunucusu
- `npm run build` — Sites üretim çıktısı ve artifact doğrulaması
- `npm test` — üretim çıktısı ve HTML metadata testi
- `npm run db:migrate` — `DATABASE_URL` üzerindeki şemayı sürüm kaydıyla günceller
- `npm run db:purge` — süresi geçmiş kimlik kayıtlarını siler (zamanlanmış iş)
- `npm run admin:grant -- --email ... --role owner` — aktif hesaba admin rolü verir
- `npm run serve` — derlenmiş çıktıyı Node süreci olarak servis eder
- `npm run test:integration` — `TEST_DATABASE_URL` varsa gerçek PostgreSQL
  testlerini çalıştırır, yoksa atlar

Railway dağıtımı, ortam değişkenleri ve dağıtım sonrası doğrulama adımları
[`docs/RAILWAY_DEPLOYMENT.md`](docs/RAILWAY_DEPLOYMENT.md) dosyasındadır.

Yönetim paneli rolleri, güvenlik sınırı ve ilk üyelik adımları
[`docs/ADMIN_CONSOLE.md`](docs/ADMIN_CONSOLE.md) dosyasındadır.

Kimlik katmanını gerçek veritabanıyla denemek için tek kullanımlık bir kapsayıcı
yeterlidir; adımlar [`docs/IDENTITY_FOUNDATION.md`](docs/IDENTITY_FOUNDATION.md)
dosyasındadır.

Node.js `>=22.13.0` gereklidir.

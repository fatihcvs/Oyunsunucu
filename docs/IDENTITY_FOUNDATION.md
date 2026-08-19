# Faz 2 Kimlik ve Hesap Temeli

Bu teslim kimlik sisteminin kullanıcı deneyimini, doğrulama ve güvenlik
kurallarını, PostgreSQL veri sözleşmesini ve kalıcı depo/servis katmanını kurar.
Henüz gerçek hesap, e-posta veya Discord oturumu üretmez; canlı uçlar gerekli
ortam değişkenleri veya PostgreSQL sürücü adaptörü yokken açık bir `503` yanıtı
verir.

## Üretim akışı

1. Kullanıcı Discord OAuth veya e-posta bağlantısıyla kimliğini doğrular.
2. Sağlayıcı cevabı yalnızca sunucu tarafında işlenir.
3. Uygulama 256 bit rastgele oturum belirteci üretir; veritabanına yalnızca
   SHA-256 özeti yazılır.
4. Tarayıcıya `Secure`, `HttpOnly`, `SameSite=Lax` çerez verilir.
5. Cihazdaki sunucu taslağı, kullanıcıya ait işlem içinde ve
   `device_import_key` ile yalnızca bir kez aktarılır.
6. Her taslak ve panel sorgusu `owner_user_id = session.user_id` koşulunu
   sunucu tarafında uygular.

## Güvenlik kararları

- Parola saklanmaz; e-posta bağlantısı tek kullanımlık ve 10 dakika süreli olur.
- Ham doğrulama ve oturum belirteçleri hiçbir zaman veritabanına veya loga yazılmaz.
- Yönlendirme yalnızca aynı origin içindeki güvenli göreli yolları kabul eder.
- E-posta/Discord başlangıç ve callback uçları IP + kimlik anahtarına göre oranlanır.
- Oturum yenileme, çıkış, e-posta değişikliği ve kritik sunucu işlemleri denetim
  kaydı üretir.
- İletişim ve KVKK onayları belge sürümüyle saklanır; sonradan üstüne yazılmaz.
- `audit_logs` uygulama rolü için eklemeli günlük olarak kullanılacak; güncelleme
  ve silme yetkileri üretim rolünde verilmeyecek.

## Uygulanan güvenlik çekirdeği

- `lib/auth-security.ts` 256 bit rastgele oturum belirteci üretir ve yalnızca
  SHA-256 özetini kalıcı katmana vermek üzere döndürür.
- Oturum çerezi `__Host-` öneki, `Secure`, `HttpOnly`, `SameSite=Lax`, kök path
  ve 30 günlük azami ömür sözleşmesine sahiptir.
- Süresi dolan veya iptal edilen oturumlar geçersizdir.
- Sahiplik denetimi yabancı ve bulunmayan kaynaklar için aynı 404 sonucunu
  üretir; böylece kaynak kimliği tahmini bilgi sızdırmaz.
- Değişiklik istekleri yalnızca açıkça izin verilen origin listesinden kabul
  edilir.
- Magic link, Discord başlangıç ve callback akışları için kalıcı fixed-window
  oran sınırlama politikaları tanımlıdır; bucket anahtarı uygulama sırrıyla
  HMAC-SHA-256 uygulanarak saklanır ve ham e-posta/IP tutulmaz.
- Cihaz taslağı aktarımı geçerli katalog sözleşmesi, UUID import anahtarı ve
  deterministik payload özeti gerektirir.
- `0002_auth_security.sql` oturum ailesi, oran limiti ve tek-seferlik taslak
  aktarım makbuzlarını ekler. Migration henüz canlı Railway veritabanına
  uygulanmadı.
- `0003_magic_link_flows.sql` güvenli dönüş yolu, kayıt profili ve
  `pending → sent | failed` teslim durumunu ekler. Yalnızca `sent` durumundaki,
  süresi geçmemiş ve iptal edilmemiş bağlantılar tüketilebilir.
- `infra/postgres/auth-repository.ts` sürücüden bağımsız, parametreli SQL
  repository'sidir. Bağlantı tüketimi, kullanıcı doğrulaması, hesap eşlemesi,
  sürümlü onay, oturum ve audit kaydı tek transaction içinde çalışır.
- Repository, e-posta kimliğinde ve oran limiti bucket'ında transaction-scope
  advisory lock kullanır. Taslak aktarımı aynı import anahtarı ve payload özeti
  için idempotenttir; farklı payload tekrarında `409` üretir.
- `lib/auth-service.ts` 10 dakikalık magic-link üretimini, teslim başarısında
  etkinleştirmeyi, teslim hatasında iptali ve 30 günlük oturum değişimini
  yönetir. Ham doğrulama belirteci yalnızca e-posta adaptörüne, ham oturum
  belirteci yalnızca çerez route'una döner.
- `/api/auth/status` yalnızca boolean hazırlık sinyalleri ve eksik değişken
  adlarını döndürür; hiçbir secret değeri açığa çıkarmaz ve yanıtı cache'lemez.
- `/api/auth/email/start` exact-origin ve gövde sınırı uygular. Canlı bağlantı
  yokken kişisel veriyi okumadan `AUTH_NOT_CONFIGURED`; ortam hazır ancak sürücü
  bağlanmamışsa `AUTH_ADAPTER_NOT_BOUND` döndürür. Ortam ve sürücü hazırsa
  isteği magic-link servisine iletir ve `202` ile numaralandırmaya kapalı yanıt
  verir.
- `lib/auth-composition.ts` tek kompozisyon köküdür: ortam eksikse
  `not_configured`, PostgreSQL sürücüsü bağlı değilse `adapter_not_bound`, aksi
  halde `ready` üretir. `infra/postgres/driver-binding.ts` sürücünün bağlanacağı
  tek dosyadır ve bugün bilinçli olarak `null` döndürür.
- `APP_ORIGIN` artık hazırlık koşuludur. Bağlantı ve çerez yalnızca yol/sorgu
  içermeyen HTTPS origin üzerinde üretilebildiği için eksik veya hatalı origin
  `configuration_required` sayılır.
- `infra/email/magic-link-mailer.ts` Resend ve Postmark adaptörlerini
  `fetch` üzerinden uygular; 10 saniyelik zaman aşımı, kapalı açılma/bağlantı
  takibi ve başlık enjeksiyonuna kapalı gönderen doğrulaması içerir. Teslim
  hatası yalnızca sağlayıcı adı ve HTTP durumu taşır; anahtar veya alıcı adresi
  hata metnine girmez.
- `/giris/dogrula` sayfası bağlantıyı otomatik tüketmez. Kullanıcı onayı
  `/api/auth/email/verify` uçuna aynı origin'den `POST` gönderir; böylece
  e-posta tarayıcıları ve ön yükleme yapan istemciler girişi harcayamaz.
- Doğrulama uçları tüketimden önce `magic-link-callback` oran limitini uygular;
  bağlantı tahmini denemeleri hiçbir özet karşılaştırmasına ulaşmadan durur.
- `/api/auth/session` yalnızca kullanıcının kendi görünen adını, e-postasını ve
  oturum bitişini döndürür; oturum, aile ve kullanıcı kimlikleri gövdeye girmez.
  Ölü çerez sunulduğunda tarayıcı çerezi temizlenir.
- `/api/auth/session/refresh` oturumu aynı aile içinde döndürür: eski belirteç
  iptal edilir, yeni belirtecin özeti `rotated_from_session_id` ile bağlanır ve
  denetim kaydı üretilir.
- `/api/auth/signout` `current` ve `all` kapsamlarını destekler; eşleşen oturum
  bulunmasa bile tarayıcı çerezi her durumda temizlenir. Tek oturum iptali de
  artık aynı işlem içinde denetim kaydı yazar.
- `/api/auth/drafts/import` cihazdaki taslağı hesaba taşır. Sahiplik yalnızca
  oturum çerezinden okunur; istek gövdesindeki kullanıcı alanları yok sayılır.
  Cihaz başına üretilen `import_key` sayesinde tekrar çağrılar aynı taslağı
  döndürür (`200`), ilk taşıma `201`, farklı içerikli tekrar `409` verir.
- Discord girişi PKCE (S256) ile çalışır. `code_verifier` yalnızca sunucuda
  `oauth_states` tablosunda durur, tarayıcıya yalnızca `code_challenge` gider.
  `state` tek kullanımlıktır; ham değeri değil SHA-256 özeti saklanır ve
  tüketim tek `UPDATE` ile yapıldığı için eş zamanlı tekrar tüketilemez.
- Discord kimliği yalnızca **doğrulanmış** e-posta ile kabul edilir. Sağlayıcı
  hesabı ile kullanıcı bağı `auth_accounts` üzerinde tutulur ve bu bağ yetkili
  kaynaktır: aynı Discord hesabı sonradan başka bir kullanıcının adresini
  bildirse bile oturum ilk bağlandığı kullanıcı için açılır.
- Discord'un her başarısızlık nedeni (geçersiz state, tüketilmiş state, hatalı
  kod, doğrulanmamış adres, sağlayıcı kesintisi) aynı `DISCORD_SIGN_IN_REJECTED`
  yanıtını üretir; tarayıcı `/giris?discord=rejected` adresine döner.
- `0004_oauth_states.sql` state, PKCE verifier, güvenli dönüş yolu ve süre
  alanlarını ekler.
- **Oturum yeniden kullanım tespiti.** Rotasyonla değiştirilen bir belirteç
  sonradan sunulursa, o değerin kopyalandığı kabul edilir: aynı ailedeki tüm
  canlı oturumlar iptal edilir ve `auth.session.reuse_detected` denetim kaydı
  yazılır. Çalınmış bir çerezi elinde tutmak böylece kazanç sağlamaz. Tespit
  başarısız olursa giriş akışı etkilenmez; hata yalnızca operasyona bildirilir.
- Hesap merkezindeki `SessionKeepalive`, oturumun ömrünün yarısı geçtiğinde
  belirteci döndürür. Rotasyon olmadan yeniden kullanım tespitinin tetikleyeceği
  bir olay da olmazdı.
- `purgeExpiredAuthRecords` süresi geçmiş doğrulama bağlantılarını, tüketilmiş
  OAuth state'lerini, ölü oturumları ve eski oran limiti kovalarını siler.
  Bloke durumdaki bir kova **silinmez**: silmek, engellenen çağırana temiz bir
  hak vermek olurdu. `npm run db:purge` ile zamanlanmış olarak çalıştırılır.

## Yerel PostgreSQL doğrulaması

Railway bağlanmadan önce şema ve eşzamanlılık davranışı yerel bir Docker
PostgreSQL örneğinde doğrulanır. Bu, sürücüden bağımsız repository sözleşmesinin
gerçek bir veritabanında da geçerli olduğunu gösterir.

```bash
docker run -d --name riftory-test-postgres \
  -e POSTGRES_USER=riftory -e POSTGRES_PASSWORD=riftory-local-test \
  -e POSTGRES_DB=riftory -p 55433:5432 postgres:17-alpine

DATABASE_URL=postgresql://riftory:riftory-local-test@127.0.0.1:55433/riftory npm run db:migrate
TEST_DATABASE_URL=postgresql://riftory:riftory-local-test@127.0.0.1:55433/riftory npm run test:integration
```

Bu parola yalnızca tek kullanımlık yerel kapsayıcıya aittir; yayın ortamı
değerleri Railway servis değişkeni olarak girilir ve kaynak koda yazılmaz.
`TEST_DATABASE_URL` tanımlı değilse entegrasyon testleri atlanır, birim testleri
veritabanı olmadan çalışmaya devam eder.

### Migration çalıştırıcısı

- `infra/postgres/migration-runner.ts` sürücüden bağımsızdır ve tek bağlantı
  üzerinde çalışır; `pg_advisory_lock` oturum kapsamlı olduğu için havuzdan
  gelen dağıtık sorgular kabul edilmez.
- Her migration'ın kendi `BEGIN`/`COMMIT` sarmalayıcısı sökülür; şema değişikliği
  ile `schema_migrations` kaydı aynı transaction içinde commit edilir. Böylece
  yarım uygulanmış ama kaydedilmemiş migration oluşmaz.
- Uygulanmış bir dosyanın SHA-256 özeti değişirse çalıştırma
  `MigrationChecksumError` ile durur; sessiz şema kayması engellenir.

### Gerçek veritabanının yakaladığı hata

`exchangeMagicLink` içindeki denetim kaydı `jsonb_build_object('purpose', $5)`
kullanıyordu. PostgreSQL bu parametrenin tipini çıkaramadığı için sorgu `42P18`
hatası veriyor ve magic-link tüketimi tüm transaction'ı geri alıyordu. Sahte
executor'la yazılmış birim testleri bunu göremezdi; `$5::text` dönüşümü eklendi.

## Bağlanacak ortam değişkenleri

- `DATABASE_URL`
- `AUTH_SECRET`
- `APP_ORIGIN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `EMAIL_FROM`
- `RESEND_API_KEY` veya `POSTMARK_SERVER_TOKEN`

Bu değerler kaynak koduna yazılmaz. Railway servis değişkenleri olarak girilir ve
ön izleme/üretim ortamları için ayrı tutulur.

## Sonraki uygulama dilimi

- Railway PostgreSQL bağlantı havuzu ve `driver-binding.ts` içindeki
  `createSqlExecutor` bağlaması (Workers çalışma zamanı için ayrı sürücü;
  `node-pg-executor.ts` yalnızca Node tarafı araçlarındır)
- Yayın veritabanında migration çalıştırma ve gerçek Discord uygulamasıyla
  uçtan uca giriş provası
- Süresi geçmiş `oauth_states`, `verification_tokens` ve `auth_rate_limits`
  kayıtları için temizlik işi

## Faz 2 çıkış kapısı durumu

- Sahiplik/IDOR, CSRF origin, cookie, expiry/revocation ve rate-limit birim
  testleri: **geçiyor**.
- Repository transaction, parameterization, magic-link replay ve idempotent
  taslak aktarım sözleşmeleri: **geçiyor**.
- Magic-link teslim adaptörü, onay/çerez, oturum okuma, rotasyon ve çıkış uçları
  ile bunların birim testleri: **geçiyor**.
- Gerçek PostgreSQL üzerinde migration, tekrar çalıştırma ve checksum koruması:
  **geçiyor** (Docker `postgres:17-alpine`).
- Gerçek PostgreSQL üzerinde eşzamanlılık: aynı bağlantının 8 paralel
  tüketiminde tek oturum, aynı adrese iki farklı bağlantıda tek kimlik, paralel
  oran limiti isteklerinde politika sınırının aşılmaması: **geçiyor**.
- Gerçek PostgreSQL üzerinde taslak aktarımının idempotency, `409` çakışma ve
  kullanıcılar arası izolasyon davranışı: **geçiyor**.
- Gerçek PostgreSQL üzerinde Discord akışı: state'in eş zamanlı altı denemede
  yalnızca bir kez tüketilmesi, süresi geçmiş state'in reddi, aynı Discord
  hesabının tek kimliğe bağlanması, doğrulanmış e-postanın mevcut hesabı
  benimsemesi ve sağlayıcı hesabının sahibi dışındaki bir kullanıcı için oturum
  açılmaması: **geçiyor**.
- Giriş sonrası yerel taslağın gerçek kullanıcı hesabına tek sefer taşındığı
  uçtan uca kanıt: **geçiyor**. Kayıt → magic-link → oturum → aktarım zinciri
  gerçek PostgreSQL üzerinde çalıştırıldı; beş eş zamanlı tekrar aynı taslağı
  döndürdü, değişmiş içerik `409` verdi ve çıkıştan sonra istek `401` oldu.
- Canlı Railway PostgreSQL bağlantısı ve gerçek e-posta/Discord sağlayıcısı:
  **bekliyor**. Faz 2'nin kod tarafındaki tüm kapıları kapandı; kalan tek
  koşul üretim ortamı bilgilerinin bağlanmasıdır.

Bu iki bekleyen kanıt tamamlanmadan Faz 2 kapatılmış veya Faz 3 ödeme akışı
etkinleştirilmiş sayılmaz.

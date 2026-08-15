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
  `pending → sent | failed` teslim durumunu ekler. Tüketim `pending` ve `sent`
  durumlarını kabul eder; teslimi başarısız olan bağlantı `revoked_at` ile
  kapatıldığı için iptal güvencesi korunurken, teslim işareti yazılmadan önce
  tıklanan geçerli bir bağlantı yarışa kurban gitmez.
- Silinmemiş ancak `active` olmayan (örneğin kilitli) bir hesabın adresine gelen
  bağlantı, benzersizlik indeksiyle çakışmak yerine sessizce reddedilir; kimlik
  satırı karar verilmeden önce `FOR UPDATE` ile kilitlenir.
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
  Gövdenin tek kaynağı `publicAuthRuntimeStatus`'tır. Giriş için e-posta veya
  Discord yollarından biri yeterli olduğundan, bir sağlayıcı tamamlandığında
  diğerinin değişkenleri `missing` içinde raporlanmaz.
- `/api/auth/email/start` exact-origin ve gövde sınırı uygular. Canlı bağlantı
  yokken kişisel veriyi okumadan `AUTH_NOT_CONFIGURED`; ortam hazır ancak sürücü
  bağlanmamışsa `AUTH_ADAPTER_NOT_BOUND` döndürür.

## Bağlanacak ortam değişkenleri

- `DATABASE_URL`
- `AUTH_SECRET`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `EMAIL_FROM`
- E-posta sağlayıcısına ait API anahtarı

Bu değerler kaynak koduna yazılmaz. Railway servis değişkenleri olarak girilir ve
ön izleme/üretim ortamları için ayrı tutulur.

## Sonraki uygulama dilimi

- Railway PostgreSQL bağlantı havuzu ve migration çalıştırıcısı
- E-posta sağlayıcısı adaptörü ve magic-link onay/çerez route'u
- Discord OAuth state/PKCE başlangıç ve callback uçları
- Oturum rotasyonu, tek cihazdan ve tüm cihazlardan çıkış route'ları
- Gerçek PostgreSQL üzerinde migration, eşzamanlılık ve taslak aktarım testleri

## Faz 2 çıkış kapısı durumu

- Sahiplik/IDOR, CSRF origin, cookie, expiry/revocation ve rate-limit birim
  testleri: **geçiyor**.
- Repository transaction, parameterization, magic-link replay ve idempotent
  taslak aktarım sözleşmeleri: **geçiyor**.
- Canlı Railway PostgreSQL migration ve gerçek sağlayıcı entegrasyonu:
  **bekliyor**.
- Giriş sonrası yerel taslağın gerçek kullanıcı hesabına tek sefer taşındığı
  entegrasyon kanıtı: **bekliyor**.

Bu iki bekleyen kanıt tamamlanmadan Faz 2 kapatılmış veya Faz 3 ödeme akışı
etkinleştirilmiş sayılmaz.

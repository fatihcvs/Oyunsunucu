# Riftory Yönetim Paneli

`/admin`, kapalı beta operasyonları için ayrı yetkilendirilmiş yönetim yüzüdür.
Müşteri panelinin sahiplik kontrollerini gevşetmez ve yalnızca istemci tarafı bir
bayrağa güvenmez. Her istek önce normal Riftory oturumunu, sonra PostgreSQL'deki
`admin_memberships` kaydını doğrular.

## Operasyon kapsamı

- kullanıcı, sipariş, sunucu ve provisioning işi sayaçları
- sipariş kimliği, sunucu adı veya müşteri e-postasıyla arama
- son siparişler ve canlı sunucu durumları
- operatör hata detayıyla provisioning kuyruğu
- `dead`/`failed` işi advisory lock altında yeniden kuyruğa alma
- her yeniden denemeyi `audit_logs` ve `server_events` içine kaydetme
- doğrulanmış mevcut bir müşteri için elle kapalı-beta sunucusu ayırma
- oyun, runtime, paket ve bölge seçimini canlı katalog sözleşmesine göre doğrulama
- aynı istek kimliğiyle yinelenen kurulumlarda ikinci sunucu açmama
- kapalı beta sunucu sınırı ve açık maliyet onayı
- her sunucu için durumunun izin verdiği yaşam döngüsü komutları:
  başlat, durdur, yeniden başlat ve (yalnızca sahip) sil
- müşteri listesi: hesap durumu, e-posta doğrulaması, sunucu sayısı ve yetki
- denetim kaydının salt-okunur görünümü
- operasyon ekibi yönetimi: mevcut ve doğrulanmış bir hesaba rol verme veya
  yetkiyi kaldırma
- yöneticinin kendi parolasını değiştirmesi
- sunucuyu daha büyük bir pakete taşıma: aylık fiyat farkı gösterilir, değişiklik
  `resize_server` kuyruğuna alınır ve dünya korunur

Elle ayırma bir sipariş veya ödeme kaydı üretmez. Sunucuyu doğrudan sağlayıcıda
açmak yerine mevcut `create_server` iş kuyruğuna bırakır; dolayısıyla sağlayıcı
anahtarı tarayıcıya veya HTTP yanıtına çıkmaz. Yaşam döngüsü komutları da aynı
kuyruğu kullanır: konsol sağlayıcıya doğrudan istek atmaz.

Silme geri alınamaz ve henüz yedek sistemi yoktur; bu yüzden yalnızca `owner`
rolüne açıktır ve arayüzde ayrıca onay ister. İade, abonelik değişikliği ve
müşteri hesabı düzenleme konsolda yoktur — para hareketi ve kimlik değişikliği
ayrı onay akışları gerektirir.

## Roller

| Rol | Okuma | İşi yeniden deneme | Sunucu ayırma | Başlat/durdur | Paket yükseltme | Silme | Üyelik yönetimi |
|---|---:|---:|---:|---:|---:|---:|---:|
| `owner` | evet | evet | evet | evet | evet | evet | evet |
| `operator` | evet | evet | evet | evet | evet | hayır | hayır |
| `support` | evet | hayır | hayır | hayır | hayır | hayır | hayır |

Her yönetici kendi parolasını değiştirebilir; başkasınınkini değiştiremez.

Bir kullanıcının e-posta alan adı veya tarayıcı verisi rol üretmez. Üyelik
silindiği anda admin erişimi de kesilir; normal müşteri hesabı korunur.

## İlk admin üyeliği

Önce migration'ları çalıştırın. Ardından aktif bir Riftory hesabına rol verin.
Varsayılan rol en yüksek sahiplik yetkisi yerine `operator` rolüdür:

```sh
npm run db:migrate
npm run admin:grant -- --email kullanici@example.com --role operator
```

Railway PostgreSQL yalnızca özel ağdaysa komutu Railway bağlamında çalıştırın:

```sh
railway ssh --service web "node scripts/grant-admin.mjs --email kullanici@example.com --role operator"
```

Henüz hesabı olmayan ilk operatör için hesap oluşturma bilinçli ve ayrı bir
bayraktır:

```sh
railway ssh --service web "node scripts/grant-admin.mjs --email kullanici@example.com --role operator --create --display-name Admin"
```

Admin parola girişi için Railway `web` servisinde şu değişkenler bulunmalıdır:

- `ADMIN_LOGIN_EMAIL`: bootstrap edilen normalize e-posta
- `ADMIN_PASSWORD_HASH`: `pbkdf2-sha256$...` biçiminde, rastgele salt içeren özet

Bu iki değişken yalnızca **kurulum (bootstrap) kimlik bilgisidir**. Canlı
doğrulayıcı `admin_memberships.password_hash` sütununda durur:

- Bir hesabın kendi parolası yoksa ve e-postası `ADMIN_LOGIN_EMAIL` ile
  eşleşiyorsa, ortam değişkenindeki özet kabul edilir.
- Hesap panelden parolasını değiştirdiği anda kendi özeti kaydedilir ve ortam
  değişkenindeki kurulum parolası o hesap için çalışmaz olur.
- `ADMIN_LOGIN_EMAIL` dışındaki yöneticiler kurulum parolasını hiçbir zaman
  kullanamaz; parolalarını kendileri belirleyene kadar parola girişi onlara
  kapalıdır.

Parola değişimi `POST /api/admin/password` ile yapılır; mevcut parolayı
doğrulamayı zorunlu tutar, yeni parolanın en az 8 karakter olmasını ister ve
işlemi yapan oturum dışındaki tüm oturumları iptal eder.

Düz metin parola Railway'e, veritabanına, loglara veya kaynak koduna yazılmaz.
Giriş denemeleri PostgreSQL'de kalıcı ve `AUTH_SECRET` ile pepper edilmiş bir
oran sınırlama kovası kullanır; aynı kova parola değişimi için de geçerlidir.
Başarılı giriş normal `auth_sessions` kaydı ve host-only, `HttpOnly`, `Secure`,
`SameSite=Lax` çerezi üretir.

Komut e-postayı çıktıya yazmaz; yalnızca kullanıcı kimliği ve verilen rolü
bildirir. Gizli anahtar kaynak dosyasına veya komut argümanına konmaz.

## HTTP davranışı

- oturum yok: `401 SESSION_REQUIRED`
- oturum var ama üyelik yok: `403 ADMIN_REQUIRED`
- veritabanı/oturum temeli eksik: açık bir `503`
- admin cevapları: `Cache-Control: no-store`
- mutasyon: aynı-origin JSON isteği zorunlu
- eşzamanlı yeniden deneme: job advisory lock ve sunucu başına aktif iş kontrolü
- elle kurulum: doğrulanmış aktif müşteri, UUID istek kimliği ve açık maliyet
  onayı zorunlu
- kapasite: `deleted` olmayan en fazla 10 sunucu; kontrol advisory lock altında
- idempotency: aynı istek kimliği aynı girdilerle mevcut sunucu/işi döndürür,
  farklı girdilerle tekrar kullanılırsa `409` döner
- iz: başarılı elle ayırma hem `audit_logs` hem `server_events` içine yazılır
- yaşam döngüsü komutu: sunucu başına advisory lock, durum kontrolü ve tek
  bekleyen iş kuralı; ikinci komut `409` alır
- silme: yalnızca `owner`; diğer roller `403 ADMIN_OWNER_REQUIRED` alır
- üyelik: yalnızca `owner`; kendi yetkisini ve son sahibi kaldırma `409` döner
- üyelik kaldırıldığında o hesabın tüm oturumları aynı işlemde iptal edilir
- parola değişimi: `401 CURRENT_PASSWORD_REJECTED`, `400 WEAK_PASSWORD`,
  `400 PASSWORD_UNCHANGED` ve oran sınırında `429`
- paket değişikliği: yalnızca yükseltme; küçültme `400 DOWNGRADE_UNSUPPORTED`,
  aynı paket `400 PLAN_UNCHANGED`, uygun olmayan durum `409` döner. Yanıt aylık
  katalog farkını bildirir ve tahsilat yapılmadığını açıkça söyler.

`/admin` sitemap'e eklenmez, `noindex, nofollow` taşır ve `robots.txt` içinde
ayrıca engellenir.

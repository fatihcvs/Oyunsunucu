# Riftory Tam Ürün Faz Planı

## 1. Ürün hedefi ve ilk beta sınırı

Riftory'nin ilk ticari hedefi Nitrado'nun tüm kapsamını kopyalamak değil;
Türkiye'deki oyuncular için iki oyunda güvenilir, sade ve şeffaf bir satın alma
ve yönetim deneyimi çıkarmaktır.

İlk beta kapsamı:

- Minecraft Java: Paper, Purpur, Vanilla ve Fabric (satışta);
  Spigot, Forge, NeoForge ve Quilt beyan edildi, sertifikasyon bekliyor
- Terraria: Vanilla; tModLoader kontrollü beta
- Vintage Story: Vanilla (TCP olduğu için ilk fazda barındırılabiliyor)
- Avrupa Batı / Amsterdam dağıtım bölgesi
- Aylık paket, günlük yedek seçeneği ve manuel yedek
- Sunucu başlatma, durdurma, yeniden başlatma, durum ve temel konsol
- Kapalı beta; ilk aşamada en fazla 10 eş zamanlı müşteri sunucusu

İlk beta dışında:

- FiveM, Rust, Valheim ve diğer UDP ağırlıklı oyunlar
- Bayi/affiliate sistemi
- Mobil uygulama
- Gelişmiş dosya yöneticisi ve SFTP
- Çok bölgeli otomatik failover
- Kurumsal ekip hesapları

## 2. Mimari sınırlar

```text
Müşteri
  ↓
Mağaza + Hesap + Panel (Next.js)
  ↓
PostgreSQL — sipariş, ödeme, sunucu ve denetim kayıtları
  ↓
Provisioning Worker — idempotent işler ve yeniden deneme
  ↓
GameServerProvider sözleşmesi
  ├─ Railway TCP Provider — Minecraft / Terraria
  └─ UDP Provider — FiveM / Rust, sonraki faz
```

Temel kural: Müşteri isteği doğrudan Railway'e çağrı yapmaz. Önce veritabanında
bir iş ve benzersiz idempotency anahtarı oluşur; worker bu işi sahiplenir,
sağlayıcıya uygular ve sonucu tekrar veritabanına yazar.

Planlanan sağlayıcı sözleşmesi:

- `createServer(spec)`
- `getServer(providerId)`
- `startServer(providerId)`
- `stopServer(providerId)`
- `restartServer(providerId)`
- `resizeServer(providerId, resources)`
- `createBackup(providerId)`
- `restoreBackup(providerId, backupId)`
- `deleteServer(providerId)`
- `getConnectionInfo(providerId)`

Bu sınır, Railway maliyeti veya teknik sınırları değiştiğinde müşteri panelini ve
ödeme sistemini yeniden yazmadan ikinci sağlayıcıya geçebilmemizi sağlar.

## 3. Fazlar

### Faz 0 — Ürün kuralları ve teknik temel

Amaç: Kod yazıldıkça değişmeyecek ürün gerçeklerini tek yerde toplamak.

İşler:

- Oyun, yazılım, paket, bölge ve yedekleme tiplerini merkezileştirme
- Tek fiyat hesaplama fonksiyonu ve para biçimlendirme
- Sağlayıcıdan bağımsız sunucu taslağı sözleşmesi
- Railway TCP / UDP sınırının ürün kataloğuna yansıtılması
- Tahmini fiyat ile tahsil edilmiş tutarın farklı alanlar olduğunun belirlenmesi
- Faz planı, kapsam dışı işler ve doğrulama kapıları

Çıkış kapısı:

- Aynı paket ana sayfa, yapılandırıcı ve panelde aynı fiyatı göstermeli.
- Kullanıcıya gerçek olmayan ödeme, alan adı veya aktif sunucu iddiası yapılmamalı.
- Lint ve üretim derlemesi geçmeli.

Durum: **Tamamlandı.**

### Faz 1 — Mağaza, yapılandırıcı ve ürün paneli

Amaç: Satın alma öncesinden yönetime kadar uçtan uca ürün deneyimini doğrulamak.

İşler:

- Dört adımlı oyun sunucusu yapılandırıcısı
- Oyun/yazılım, RAM, depolama, bölge ve yedek seçimi
- Anlık fiyat özeti
- Cihazda otomatik taslak saklama
- Yapılandırmayı panel demosuna aktarma
- Başlat, durdur, yeniden başlat demo durum makinesi
- Etkileşimli konsol, manuel yedek ve ayarlar yüzleri
- Mobil, klavye, erişilebilir etiket ve hata durumları

Çıkış kapısı:

- Ana sayfa → yapılandırıcı → özet → panel akışı kesintisiz çalışmalı.
- Fiyat bütünlüğü, ad doğrulaması ve yerel taslak geri yükleme test edilmeli.
- Mobilde yatay taşma ve engelleyici etkileşim hatası olmamalı.

Durum: **Tamamlandı ve ön izleme sürümü yayınlandı.**

### Faz 1B — Organik keşif ve SEO içerik temeli

Amaç: Beta kapsamındaki ürünleri arayan kullanıcıya, arama motoru ile ürün
deneyimi arasında tutarlı ve güvenilir bir bilgi yolu kurmak.

İşler:

- Ana sayfada oyun sunucusu kategori niyetinin doğal dille açıklanması
- Minecraft Java için ayrı sunucu kiralama ve paket rehberi
- Terraria ve tModLoader için ayrı kontrollü beta rehberi
- Oyun, yazılım, RAM, yedekleme, panel ve fiyat karar sorularının yanıtlanması
- Benzersiz title/description, canonical, Open Graph ve semantik başlık yapısı
- Sitemap, robots ve doğrulanabilir JSON-LD verisi
- Giriş ve hesap sayfalarında `noindex`
- Kesin ping, uptime, teslimat ve DDoS kapasitesi gibi doğrulanmamış iddiaların
  içerik politikasında yasaklanması

Çıkış kapısı:

- Her arama sayfası tek ve belirgin bir H1 ile benzersiz metadata taşımalı.
- Minecraft ve Terraria sayfaları ana sayfa, yapılandırıcı ve panelle karşılıklı
  iç bağlantı kurmalı.
- Sitemap yalnızca indekslenmesi amaçlanan sayfaları içermeli.
- JSON-LD görünür içerikle aynı olmalı; gerçek satış veya ortaklık iddiası
  üretmemeli.
- Mobilde yatay taşma olmamalı; lint, test ve üretim derlemesi geçmeli.

Durum: **Uygulandı; kalıcı alan adı ve Search Console aktivasyonu bekliyor.**

### Faz 2 — Kimlik, hesap ve ana veritabanı

Amaç: Her sipariş ve sunucuyu doğrulanmış bir kullanıcıya bağlamak.

İşler:

- Railway üzerinde PostgreSQL
- Discord OAuth, e-posta bağlantısı ve parola ile giriş
  (kapalı betada parola kaydı e-posta doğrulaması istemiyor; `email_verified_at`
  kaydın açıldığı anı taşır, adresin sahipliğini kanıtlamaz)
- E-posta doğrulama, oturum sonlandırma ve hesap kurtarma
- Kullanıcı, oturum, sunucu taslağı, adres ve onay kayıtları
- Sunucu tarafında sahiplik kontrolü; IDOR koruması
- KVKK açık rıza ve iletişim izni sürümleme
- Denetim kaydı: giriş, ayar değişikliği, kritik işlemler

İlk tablo ailesi:

- `users`, `accounts`, `sessions`, `verification_tokens`
- `server_drafts`, `consents`, `audit_logs`

Çıkış kapısı:

- Bir kullanıcı başka kullanıcının taslak veya panel verisini okuyamamalı.
- Oturum, CSRF, oran sınırlama ve erişim testleri geçmeli.
- Yerel taslak girişten sonra bir kez kullanıcı hesabına taşınmalı.

Durum: **Devam ediyor.** Giriş/kayıt deneyimi, güvenli yönlendirme ve alan
doğrulama kuralları, sürümlü onay sözleşmesi ve ilk PostgreSQL kimlik migration'ı
hazırlandı. İkinci dilimde 256 bit oturum belirteci/özet sözleşmesi, güvenli
çerez, CSRF origin kontrolü, oran sınırlama, IDOR koruması, oturum ailesi ve
tek-seferlik cihaz taslağı aktarımı eklendi. Üçüncü dilimde sürücüden bağımsız
parametreli PostgreSQL repository'si, atomik magic-link → kullanıcı → oturum
işlemi, HMAC'li kalıcı oran limiti, başarısız teslimde token iptali, çalışma
ortamı hazırlık endpoint'i ve güvenli `503` sınırı tamamlandı. Dördüncü dilimde
Resend/Postmark teslim adaptörü, tek kompozisyon kökü, `/giris/dogrula` onay
adımı ve doğrulama, oturum okuma, oturum rotasyonu ile çıkış uçları eklendi.
Beşinci dilimde sürüm tablosu, checksum koruması ve advisory lock içeren
migration çalıştırıcısı yazıldı; şema ve eşzamanlılık davranışı yerel Docker
PostgreSQL örneğinde doğrulandı. Bu doğrulama, sahte executor'ların göremediği
bir denetim kaydı hatasını (`42P18`) ortaya çıkardı ve düzeltildi. Altıncı
dilimde cihaz taslağını hesaba taşıyan uç eklendi ve kayıt → magic-link →
oturum → aktarım zinciri gerçek PostgreSQL üzerinde uçtan uca doğrulandı.

Yedinci dilimde PKCE'li Discord OAuth başlangıç ve callback uçları, tek
kullanımlık `oauth_states` tablosu ve sağlayıcı hesabı eşlemesi eklendi;
davranış gerçek PostgreSQL üzerinde doğrulandı.

Kod tarafındaki çıkış kapıları kapandı. Kapının tamamen kapanması için kalan tek
koşul, Railway PostgreSQL bağlantısı ile e-posta/Discord sağlayıcı bilgilerinin
üretim ortamına girilmesidir.

### Faz 3 — Sipariş, ödeme ve ticari kayıtlar

Amaç: Para hareketini sunucu kurulumundan güvenli biçimde ayırmak.

İşler:

- Değiştirilemez fiyat anlık görüntüsü: ürün, KDV, indirim ve toplam
- `draft → pending_payment → paid → provisioning` sipariş durum makinesi
- Türkiye için ödeme sağlayıcısı adaptörü
- Webhook imza doğrulama, tekrar teslim ve idempotency
- Başarısız ödeme, iade, iptal ve yenileme akışları
- Fatura/fiş için şirket ve muhasebe gereksinimlerinin netleştirilmesi
- Mesafeli satış, ön bilgilendirme ve iade metinlerinin hukuk kontrolü

Tablolar:

- `orders`, `order_items`, `price_snapshots`
- `payments`, `payment_events`, `refunds`, `subscriptions`

Çıkış kapısı:

- Aynı ödeme webhooks'u iki sunucu oluşturmamalı.
- Ödenen tutar sonradan katalog fiyatı değişse de değişmemeli.
- Test ödeme, başarısız ödeme ve iade senaryoları uçtan uca geçmeli.

Durum: **Devam ediyor.** İlk dilimde kuruş bazlı para modeli, KDV dahil fiyattan
vergi ayrıştırma, değiştirilemez fiyat anlık görüntüsü, sipariş durum makinesi ve
idempotent webhook yolu yazıldı. İlk iki çıkış kapısı gerçek PostgreSQL üzerinde
kanıtlandı: aynı webhook 10 kez sırayla ve 6 kez eş zamanlı teslim edildiğinde
yalnızca bir kez uygulandı, ödenen tutar katalog değişse de sabit kaldı.
Üçüncü kapı ödeme sağlayıcısı adaptörü ve HTTP uçları yazılmadan kapanmaz.
Ayrıntılar [`docs/ORDER_PAYMENT_FOUNDATION.md`](ORDER_PAYMENT_FOUNDATION.md)
dosyasındadır.

### Faz 4 — Railway provisioning kontrol düzlemi

Amaç: Ödenmiş bir siparişi güvenli ve gözlemlenebilir biçimde gerçek kaynağa çevirmek.

İşler:

- Railway GraphQL istemcisi ve dar kapsamlı workspace/project token
- Docker imajından service oluşturma
- Oyun değişkenleri, kaynak sınırı, bölge ve başlangıç komutu
- Tek volume oluşturma ve doğru mount path
- TCP Proxy oluşturma ve gerçek hostname/port kaydı
- İş kuyruğu/outbox, lease, exponential backoff ve dead-letter durumu
- Yarım kalan kurulumlar için telafi/temizlik adımları
- Periyodik reconciliation: veritabanı ile Railway gerçeğini karşılaştırma

Sunucu durum makinesi:

`requested → provisioning → deploying → online | failed → suspended → deleting → deleted`

Tablolar:

- `servers`, `provider_resources`, `provisioning_jobs`
- `server_events`, `operation_locks`

Çıkış kapısı:

- Aynı iş 10 kez çalıştırılsa da tek provider kaynağı oluşmalı.
- Her hata kullanıcıya anlaşılır durum, operatöre teknik kayıt bırakmalı.
- Oluşturma sırasında hata olursa sahipsiz service/volume kalmamalı.

Durum: **Devam ediyor.** Kuyruk, kira (lease), üstel geri çekilme, dead-letter ve
sunucu durum makinesi yazıldı; worker döngüsü ile sağlayıcıdan bağımsız
`GameServerProvider` sözleşmesi hazır. İlk iki çıkış kapısı kanıtlandı: aynı
ödenmiş sipariş 10 kez ve 6 eş zamanlı uygulandığında tek sunucu ve tek iş
oluştu, üç worker aynı işi çekemedi, müşteri mesajı ile teknik ayrıntı ayrı
saklandı. Worker, sağlayıcının bildirdiği her kaynağı işi tamamlamadan **önce**
kaydeder, böylece yarım kalan kurulum temizlenebilir bir iz bırakır.

İki sağlayıcı yazıldı ve ikisi de gerçek kaynak oluşturarak doğrulandı:
`docker` adaptörü yerelde bir Minecraft sunucusu kurdu ve TCP portu yanıt verdi;
`railway` adaptörü Railway'de servis, volume ve TCP proxy oluşturdu, adres yanıt
verdi ve kaynaklar silindi. Kalan iş: worker'ın kalıcı bir yerde çalışması,
başlatma/durdurma/silme yollarının canlıda doğrulanması ve reconciliation.

### Faz 5 — Gerçek oyun çalışma ortamları

Amaç: İlk iki oyunu veri kaybetmeden ve tekrarlanabilir biçimde çalıştırmak.

İşler:

- Sürümü sabitlenmiş Minecraft ve Terraria Docker imajları
- EULA ve oyun lisansı gereksinimleri
- Non-root süreç, salt-okunur imaj katmanı ve yazılabilir veri volume'u
- Graceful shutdown, dünya kaydı ve bozulma koruması
- Sağlık kontrolü ve hazır/çevrimiçi ayrımı
- Railway volume yedekleri ve oyun-içi güvenli kayıt koordinasyonu
- Minecraft için SRV kaydı stratejisi; Terraria için hostname + port gösterimi
- Güncelleme öncesi otomatik yedek ve geri dönüş

Çıkış kapısı:

- Kurulum, yeniden dağıtım ve yeniden başlatma sonrası dünya korunmalı.
- Zorla kapanma, dolu disk ve başarısız güncelleme testleri yapılmalı.
- Yedekten geri dönüş gerçek oyun istemcisiyle doğrulanmalı.

Durum: **Ön prova yapıldı.** Faz 4 sırası beklenmeden, katalog iddialarının
gerçekliğini ölçmek için yerel Docker üzerinde sertifikasyon provası
çalıştırıldı: `scripts/certify-game-runtime.mjs` bir birleşimi planın RAM
sınırıyla başlatır, hazır olma süresini ve belleği ölçer, TCP erişimini dener,
graceful kapatıp yeniden başlatır ve dünya kimliğinin korunduğunu doğrular.
Minecraft/Paper 2 GB ve 4 GB planlarında sertifikalandı. Terraria için prova,
üstteki imajın `SIGTERM` ile kapanmadığını ortaya çıkardı; `SIGTERM`'i konsol
`exit` komutuna çeviren kendi imajımız yazıldı ve Terraria/Vanilla da
sertifikalandı. Bulgular ve doğrulanmamış iddialar
[`docs/GAME_RUNTIME_CERTIFICATION.md`](GAME_RUNTIME_CERTIFICATION.md)
dosyasındadır. Bu prova çıkış kapısını kapatmaz; zorla kapanma, dolu disk,
güncelleme ve yedekten dönüş senaryoları hâlâ bekliyor.

### Faz 6 — Gerçek müşteri paneli ve operasyon

Amaç: Faz 1'deki panel demosunu canlı verilere bağlamak.

Durum: **ikinci dilim tamamlandı; canlı doğrulaması bekliyor.** Panel artık müşterinin gerçek sunucularını
gösteriyor ve başlat/durdur/yeniden başlat komutlarını kuyruğa veriyor.
Sunucusu olmayan veya girmemiş ziyaretçi demoyu görüyor; ribbon hangi durumda
olduğunu açıkça söylüyor. Müşteri artık sunucusunun karşılama mesajını, oyuncu sınırını, zorluğunu, oyun
modunu, PvP ve beyaz liste durumunu panelden değiştirebiliyor; değişiklik
doğrulanıp veritabanına yazılıyor ve aynı kuyruk üzerinden sağlayıcıya
uygulanıyor. Konsol, yedek ve kaynak grafikleri canlı panelde
**gösterilmiyor** — kurulmadıkları için iddia da edilmiyorlar. Yönetici paneli
doğrulanmış müşteriye, ödeme/sipariş uydurmadan, mevcut worker kuyruğu üzerinden
elle kapalı-beta sunucusu ayırabiliyor.

İşler:

- [x] Gerçek durum ve bağlantı bilgileri (`GET /api/servers`)
- [x] Başlat/durdur/yeniden başlat için kilitli operasyon işleri
      (`POST /api/servers`, sunucu başına advisory lock)
- [x] Kullanıcıya görünür olay geçmişi (operatör detayı sızdırılmadan)
- [ ] Gerçek kaynak (CPU/RAM/oyuncu) ölçümleri
- [x] RCON üzerinden konsol ve temel oyuncu yönetimi: komut kutusu ve tek tıklık
      beyaz liste / op / kick / ban işlemleri. Konsol parolası saklanmaz,
      `AUTH_SECRET`'ten sunucu başına türetilir; bağlantı yalnızca sağlayıcının
      özel ağı üzerindedir ve RCON portu hiçbir proxy ile dışarı açılmaz.
      `stop`, `restart` ve `reload` panelden reddedilir: durum makinesinin
      arkasından sunucuyu durdurmak paneli yanlış gösterir.
- [ ] Yedek listeleme, oluşturma ve onaylı geri yükleme
- [x] Sunucu ayarları: oyun bazlı ayar sözleşmesi, panelden düzenleme ve
      ayarı sağlayıcıya uygulayan kuyruk işi (`apply_settings`)
- [x] Paket yükseltme: katalog kurallı yükseltme, aylık fiyat farkının gösterilmesi,
      `resize_server` kuyruk işi ve dünyanın korunması. Küçültme bilinçli olarak
      kapalı: disk küçültmek canlı dünyayı riske atar. Tahsilat yoktur; ödeme
      sağlayıcısı Faz 3'te bağlanana kadar yükseltme operatör işlemidir.
- [x] Elle bakiye: operatör kuruş bazlı mağaza kredisi ekler/düşer, her hareket
      `balance_entries` içine yazılır ve istek kimliği tekrarı engeller
- [ ] Bildirimler: kurulum, başarısızlık, yedek, ödeme, kaynak sınırı
- [x] Yönetici paneli ilk dilimi: rol tabanlı erişim, operasyon özeti,
      sipariş/sunucu/iş arama ve başarısız işi yeniden deneme
- [x] Yönetici panelinden sunucu kurulumu: müşteri, oyun/runtime, paket ve bölge
      seçimi; açık maliyet onayı, 10 sunucu beta sınırı, idempotent istek ve
      denetim kaydıyla `create_server` kuyruğuna alma
- [x] Yönetici paneli ikinci dilimi: sunucu başına yaşam döngüsü komutları
      (başlat/durdur/yeniden başlat, sahip rolünde silme), müşteri listesi,
      salt-okunur denetim kaydı, operasyon ekibi üyeliği yönetimi ve
      yöneticinin kendi parolasını değiştirmesi
- [ ] İade ve abonelik değişikliği: para hareketi olduğu için ayrı onay akışı
- [ ] Destek talebi
- [ ] Sunucu silme: geri alınamaz olduğu ve yedek sistemi olmadığı için
      müşteriye açılmadı, operatör işi olarak duruyor

Çıkış kapısı:

- [x] Çift tıklama veya eş zamanlı komutlar durum bozulmasına yol açmamalı.
      Bekleyen iş varken ikinci komut 409 alıyor; veritabanı tarafında
      `pg_advisory_xact_lock` ikinci işi engelliyor.
- [ ] Kritik işlemler yeniden kimlik doğrulama ve açık onay gerektirmeli.
      Bugün kritik işlem panelde yok; silme açıldığında gerekecek.
- [x] Destek ekibi müşterinin şifresine veya gizli token'ına ihtiyaç duymamalı.
      Olay geçmişi müşteri metni ve operatör detayını ayrı tutuyor.

Uçtan uca ölçüm (`scripts/verify-panel.mjs`, gerçek Railway sağlayıcısı):
hesap → boş panel → sunucu kuruldu (`sakura.proxy.rlwy.net:37445`) → durdur →
başlat → adres korundu → silindi. 14 doğrulamanın 14'ü geçti; başkasının
sunucusu 404, yabancı origin 403, işlem sürerken ikinci komut 409.

### Faz 7 — Güvenlik, maliyet korumaları ve kapalı beta

Amaç: İlk gerçek müşteriyi kontrollü riskle kabul etmek.

İşler:

- Railway hard usage limit ve günlük maliyet uyarıları
- Sipariş başına tahmini marj ve gerçek sağlayıcı maliyeti
- Sahipsiz kaynak, başarısız yedek ve uzun provisioning alarmı
- Gizli anahtar rotasyonu, webhook secret ve erişim matrisi
- Abuse/DDoS prosedürü, rate limit ve yasaklı kullanım politikası
- Sağlık sayfası, hata izleme, yapılandırılmış log ve metrikler
- KVKK, gizlilik, kullanım, iptal/iade ve ön bilgilendirme metinleri
- 3 iç kullanıcı → 10 kapalı beta müşterisi → kontrollü açılış

Çıkış kapısı:

- Kurulum hatası, ödeme tekrarı, provider kesintisi ve yedek geri dönüş tatbikatı.
- Bir sunucunun beklenenden fazla harcaması otomatik uyarı üretmeli.
- Kritik açık kalmamalı; yüksek riskli bulgu için yazılı kabul olmamalı.

### Faz 8 — UDP sağlayıcısı ve oyun kataloğu genişletme

Amaç: Railway TCP sınırını ürün çekirdeğini değiştirmeden aşmak.

İşler:

- UDP destekli VPS/bare-metal sağlayıcısı seçimi
- Pterodactyl veya özel node agent değerlendirmesi
- FiveM ve Rust imajları, port/firewall ve DDoS profilleri
- İstanbul veya Türkiye'ye yakın ikinci lokasyon
- Sağlayıcı seçimi: oyun, bölge, kapasite ve maliyete göre routing
- Taşıma: yedek → yeni sağlayıcı → doğrulama → DNS/bağlantı değişimi

Çıkış kapısı:

- TCP sağlayıcısı kapalıyken UDP sağlayıcısındaki sunucular etkilenmemeli.
- Sağlayıcı değişimi ödeme, sipariş ve panel veri modelini değiştirmemeli.
- Her yeni oyun için bağımsız yük, ağ, yedek ve güncelleme sertifikasyonu yapılmalı.

### Faz 9 — Nitrado ölçeği: kapasite, yerleştirme ve kendi kendine iyileşme

Amaç: Onlarca müşteri sunucusunu tek tek elle takip etmeden, öngörülebilir
maliyet ve kesintisiz kapasiteyle taşımak.

Bugünkü sınır dürüstçe şudur: kapalı beta 10 sunucuyla sınırlı, kapasite tek bir
sayaçla korunuyor, sağlayıcı seçimi sabit ve bir sunucu bozulduğunda düzeltme
operatör işi. Nitrado ölçeği bu üç varsayımın hepsini kaldırmayı gerektirir.

İşler:

- Kapasite modeli: bölge ve sağlayıcı başına toplam CPU/RAM/disk envanteri,
  ayrılmış (reserved) ve gerçekten kullanılan kaynak ayrımı
- Yerleştirme (placement) kararı: yeni sunucu hangi bölgeye ve hangi sağlayıcıya
  düşecek — oyun, plan, doluluk ve maliyete göre tek bir saf fonksiyon
- Aşırı satış (overcommit) politikası ve sert tavan: bir müşterinin sunucusu
  başka müşterinin kaynağını yiyemez
- Reconciliation döngüsü: veritabanı ile sağlayıcı gerçeğini periyodik
  karşılaştırma; sahipsiz servis, sahipsiz volume ve kaybolmuş proxy tespiti
- Kendi kendine iyileşme: çökmüş konteyner için sınırlı otomatik yeniden
  başlatma, tekrar eden hata için otomatik askıya alma ve operatör alarmı
- Kaynak ölçümü: sunucu başına CPU/RAM/oyuncu telemetrisi, panelde grafik ve
  plan yükseltme önerisi için veri
- Toplu işlemler: birden çok sunucuya sıralı, kilit korumalı bakım komutu
- Kapalı beta sınırının kaldırılması ve yerine gerçek kapasite kontrolü

Çıkış kapısı:

- 50 eş zamanlı sunucu simülasyonunda yerleştirme kararı hiçbir bölgeyi
  kapasitesinin üzerine çıkarmamalı.
- Reconciliation, elle bozulmuş bir durumu (silinmiş servis, kaybolan proxy)
  operatöre bildirmeli ve veritabanını gerçekle hizalamalı.
- Otomatik yeniden başlatma bir hata döngüsüne girmemeli; üst sınırda askıya
  alıp alarm üretmeli.
- Bir sunucunun ölçülen kaynağı ile faturalanan planı panelde tutarlı olmalı.

### Faz 10 — Riftory Asistanı: doğal dil ile sunucu yönetimi

Durum: **İlk dilim tamamlandı.** Kapalı niyet kümesi, katalog doğrulaması, öneri
→ onay → mevcut uçlar zinciri ve panel arayüzü yazıldı; ayrıntılar
[`docs/ASSISTANT.md`](ASSISTANT.md) dosyasındadır. Kalan: konuşma geçmişi
(şu an her mesaj bağımsız), sorun giderme yanıtları için olay geçmişinin
bağlama alınması, oran sınırlama ve maliyet tavanı, asistan işlemlerinin
`audit_logs` içine ayrıca işaretlenmesi.

Amaç: "Sunucuyu 2x'e al", "zorluğu zor yap", "arkadaşlarım giremiyor" gibi
cümleleri, panelin zaten yapabildiği güvenli işlemlere çevirmek.

Temel mimari kural: **asistan yeni bir yetki değildir.** Modelin ürettiği hiçbir
şey doğrudan sağlayıcıya, veritabanına veya iş kuyruğuna gitmez. Asistan yalnızca
niyeti mevcut sözleşmelere çevirir; çeviriyi kullanıcı onaylar; onaylanan istek
normal servis katmanından, normal doğrulama ve idempotency kurallarıyla geçer.
Bu sayede asistan yanlış anlasa bile yapabileceği en kötü şey, kullanıcının
reddedeceği bir öneri üretmektir.

İşler:

- [x] Niyet sözleşmesi: modelin döndürebileceği kapalı işlem kümesi
  (`change_settings`, `change_plan`, `run_command`, `answer`) ve her birinin şeması
- [x] Araç (tool) tanımları: her işlem mevcut servis fonksiyonuna birebir bağlanır;
  model serbest metin SQL, kabuk komutu veya sağlayıcı çağrısı üretemez
- [x] Onay adımı: her öneri "ne değişecek, aylık maliyeti nasıl etkileyecek,
  sunucu yeniden başlayacak mı" bilgisiyle gösterilir
- [x] Bağlam: yalnızca kullanıcının kendi sunucuları ve ayarları; başka
  müşterinin verisi bağlama girmez (olay geçmişi henüz bağlama alınmadı)
- [x] "2x" gibi göreli ifadelerin katalogdan çözülmesi: mevcut paket → yeterli
  en küçük paket, fiyat farkı ve veri koruma garantisi
- Sorun giderme yanıtları: bağlanamama, whitelist, sürüm uyuşmazlığı ve dolu
  sunucu durumları için olay geçmişine dayalı açıklama
- Oran sınırlama, maliyet tavanı ve denetim kaydı: her asistan önerisi ve her
  onaylanan işlem `audit_logs` içine yazılır
- Model sağlayıcısı `AssistantModel` arayüzünün arkasındadır; ilk dilim OpenAI
  (`gpt-5.6-terra`) ile çalışır ve sağlayıcı değişimi tek bir adaptörü etkiler
- [x] Kırmızı çizgiler: silme, iade, ödeme ve üyelik işlemleri asistana kapalıdır

Çıkış kapısı:

- Asistanın ürettiği hiçbir işlem, kullanıcının panelden zaten yapamayacağı bir
  şeyi yapamamalı; yetki kontrolü servis katmanında aynı kalmalı.
- Onaysız hiçbir değişiklik uygulanmamalı; onay ekranı gerçek maliyet ve kesinti
  süresini göstermeli.
- Model erişilemez veya anlamsız cevap verdiğinde panel normal çalışmaya devam
  etmeli; asistan bir bağımlılık değil, bir kolaylık katmanı olmalı.
- İstem enjeksiyonu denemesi (sunucu adı veya MOTD içine gömülü talimat)
  yetkisiz bir işlem üretmemeli.

## 4. Test stratejisi

Her faz bitmeden aşağıdaki katmanlardan ilgili olanlar geçer:

- Birim: fiyat, durum geçişi, idempotency ve erişim kuralları
- Sözleşme: Railway ve ödeme adaptörlerinin kayıtlı cevapları
- Entegrasyon: PostgreSQL + worker + sahte sağlayıcı
- Uçtan uca: kayıt → ödeme → kurulum → panel → iptal
- Dayanıklılık: timeout, tekrar teslim, kısmi hata ve yeniden başlatma
- Güvenlik: sahiplik, oran sınırlama, webhook imzası, secret sızıntısı
- Görsel: mobil/masaüstü, klavye, taşma ve erişilebilir adlar

Bir fazın kodu tamamlanmış sayılması, tek başına sonraki faza geçme sebebi değildir;
çıkış kapısı kanıtları da kaydedilir.

## 5. Tahmini süre

Tek geliştirici + yoğun yapay zekâ desteğiyle gerçekçi aralık:

- Faz 0–1: yaklaşık 1 hafta
- Faz 2–3: 2–3 hafta
- Faz 4–5: 3–4 hafta
- Faz 6–7: 2–3 hafta
- İlk güvenilir kapalı beta: toplam 8–11 hafta
- Faz 8: sağlayıcı ve oyun sertifikasyonuna göre ayrıca 3–6 hafta
- Faz 9 (ölçek): 3–5 hafta; kapasite ve reconciliation gerçek yükle ölçülür
- Faz 10 (asistan): 2–3 hafta; niyet kümesi dar tutulduğu sürece

Bu süreler ödeme sağlayıcısı/şirket hesabı, Railway erişimi ve alan adı hazırsa
geçerlidir. Nitrado ölçeği değil, güvenilir ilk ticari beta hedeflenmektedir.

## 6. Kullanıcıdan daha sonra gerekecek girdiler

Kodlama şimdiden devam eder; ancak ilgili fazlara gelmeden önce şu kararlar gerekir:

- Kesin marka ve satın alınmış alan adı
- Railway workspace ve dar kapsamlı API token
- Şirket/fatura bilgileri ve ödeme sağlayıcısı hesabı
- Destek e-posta adresi
- İade ve beta kapasite politikası

Bu girdiler gelene kadar entegrasyonlar sahte adaptörlerle geliştirilir; hiçbir gizli
anahtar kaynak koduna yazılmaz.

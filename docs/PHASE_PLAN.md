# Riftory Tam Ürün Faz Planı

## 1. Ürün hedefi ve ilk beta sınırı

Riftory'nin ilk ticari hedefi Nitrado'nun tüm kapsamını kopyalamak değil;
Türkiye'deki oyuncular için iki oyunda güvenilir, sade ve şeffaf bir satın alma
ve yönetim deneyimi çıkarmaktır.

İlk beta kapsamı:

- Minecraft Java: Paper, Vanilla ve Fabric
- Terraria: Vanilla; tModLoader kontrollü beta
- Avrupa Batı / Amsterdam dağıtım bölgesi
- Aylık paket, günlük yedek seçeneği ve manuel yedek
- Sunucu başlatma, durdurma, yeniden başlatma, durum ve temel konsol
- Kapalı beta; ilk aşamada en fazla 10 eş zamanlı müşteri sunucusu

İlk beta dışında:

- FiveM, Rust ve diğer UDP ağırlıklı oyunlar
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
- Discord OAuth ve e-posta ile güvenli giriş
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
ortamı hazırlık endpoint'i ve güvenli `503` sınırı tamamlandı. Canlı hesap
açılması; Railway PostgreSQL sürücüsü, migration çalıştırıcısı ve Discord/e-posta
sağlayıcısı bilgileri bağlandıktan sonra etkinleştirilecek. Çıkış kapısı henüz
kapanmadı.

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

### Faz 6 — Gerçek müşteri paneli ve operasyon

Amaç: Faz 1'deki panel demosunu canlı verilere bağlamak.

İşler:

- Gerçek durum, kaynak ve bağlantı bilgileri
- Başlat/durdur/yeniden başlat için kilitli operasyon işleri
- RCON üzerinden konsol ve temel oyuncu yönetimi
- Yedek listeleme, oluşturma ve onaylı geri yükleme
- Paket yükseltme; fiyat farkı ve veri koruma
- Bildirimler: kurulum, başarısızlık, yedek, ödeme, kaynak sınırı
- Yönetici paneli: sipariş arama, işi yeniden deneme, askıya alma
- Destek talebi ve kullanıcıya görünür olay geçmişi

Çıkış kapısı:

- Çift tıklama veya eş zamanlı komutlar durum bozulmasına yol açmamalı.
- Kritik işlemler yeniden kimlik doğrulama ve açık onay gerektirmeli.
- Destek ekibi müşterinin şifresine veya gizli token'ına ihtiyaç duymamalı.

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

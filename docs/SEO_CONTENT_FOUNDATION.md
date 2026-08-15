# Riftory SEO ve İçerik Temeli

## Amaç

Riftory'nin organik aramadaki ilk hedefi çok sayıda oyun adıyla trafik toplamak
değil; beta kapsamındaki iki ürün için doğru arama niyetini eksiksiz
yanıtlamaktır:

- `oyun sunucusu kiralama`
- `minecraft sunucu kiralama`, `minecraft server hosting`
- `terraria sunucu kiralama`, `tmodloader hosting`
- Bu sorguların paket, RAM, panel, yedekleme, mod ve eklenti alt niyetleri

Ana sayfa kategori niyetini, oyun açılış sayfaları ise oyun bazlı karar niyetini
karşılar. Yapılandırıcı ve panel sayfaları kullanıcının ürün deneyimine geçişini
sağlar.

## Araştırma özeti

Türkiye'deki oyun sunucusu sayfalarında tekrar eden karar başlıkları şunlardır:

- kurulum süresi ve teslimat
- düşük gecikme ve lokasyon
- DDoS koruması ve çalışma süresi
- RAM, CPU ve NVMe kaynakları
- panel, konsol, dosya ve yedekleme
- mod, eklenti ve oyun sürümü desteği
- fiyat, ek ücret ve destek kanalı

Rakiplerde kesin teslimat süresi, çalışma süresi yüzdesi, koruma kapasitesi ve
"sınırsız" kaynak gibi doğrulanması gereken iddialar yaygın. Riftory bu
ifadeleri altyapı ölçümleri ve sözleşme olmadan kullanmaz. İçerik; bugün çalışan
ürün ön izlemesi ile planlanan canlı hizmeti açıkça ayırır.

Google Search Central yönlendirmesine göre her sayfa için açıklayıcı ve benzersiz
başlık/açıklama, DOM içinde erişilebilir metin, semantik HTML, anlaşılır iç
bağlantılar, sitemap ve sayfada görünen içerikle uyumlu yapılandırılmış veri
kullanılır. Anahtar kelime tekrarına değil, kullanıcı sorusunu tam yanıtlama
kalitesine öncelik verilir.

Araştırma kaynakları:

- Google Search Central — SEO Guide for Web Developers
- Google Search Central — Influencing Title Links
- Google Search Central — Organization Structured Data
- Google Search Central — Sitemaps
- Türkiye pazar örnekleri — Oyundc, Weridata, MinecraftSunucu.com ve Phoenix Sunucum ürün sayfaları

## Uygulanan bilgi mimarisi

### Ana sayfa

- H1 ve giriş metni kategori niyetini doğal biçimde açıklar.
- Minecraft ve Terraria kartları ayrıntılı oyun sayfalarına bağlanır.
- Ürün kapsamı, panel, yapılandırıcı ve SSS metinleri beta gerçekleriyle uyumludur.
- `Organization` ve `WebSite` JSON-LD verisi yalnızca doğrulanabilir alanları içerir.

### Minecraft açılış sayfası

- Paper, Vanilla ve Fabric arasındaki seçim
- 2–12 GB RAM ve 10–60 GB NVMe paketleri
- oyuncu sayısı ile gerçek kaynak ihtiyacı arasındaki fark
- panel, konsol, yedekleme ve sürüm yönetimi
- beta teslimatının henüz kapalı olduğu açık uyarısı

### Terraria açılış sayfası

- Vanilla ile tModLoader kapsamının ayrılması
- dünya, mod ve oyuncu sayısının kaynak ihtiyacına etkisi
- kalıcı depolama ve yedekleme yaklaşımı
- kontrollü beta ve satış durumu uyarısı

### Teknik keşif

- `/robots.txt`
- `/sitemap.xml`
- benzersiz sayfa başlığı ve meta açıklaması
- canonical URL'ler
- Open Graph ve Twitter özet alanları
- `WebPage`, `Service` ve `BreadcrumbList` JSON-LD
- giriş ve hesap yüzlerinde `noindex`

## İçerik kuralları

1. "Anında kurulum", çalışma süresi yüzdesi, kesin ping, DDoS kapasitesi veya
   destek yanıt süresi ölçüm ve sözleşme olmadan yazılmaz.
2. Tahmini oyuncu sayısı garanti gibi sunulmaz; mod, eklenti, dünya ve ayarların
   kapasiteyi değiştirebildiği belirtilir.
3. Tahmini beta fiyatı ile tahsil edilmiş fiyat ayrılır.
4. Planlanan özelliklerde gelecek zaman veya "planlanıyor" ifadesi kullanılır.
5. Aynı anahtar kelime cümle akışını bozacak biçimde tekrarlanmaz.
6. Oyun üreticileriyle resmi ortaklık veya marka sahipliği ima edilmez.
7. Her sayfa tek bir ana arama niyetine ve kullanıcının gerçek karar sorularına
   odaklanır.

## Canlı alan adı açılış kontrolü

SEO teknik temeli hazırdır; arama motoruna resmi gönderim aşağıdaki üretim
adımları tamamlandığında yapılmalıdır:

- Riftory marka ve alan adı doğrulaması
- `NEXT_PUBLIC_SITE_URL` değerinin kalıcı HTTPS alan adına çevrilmesi
- yasal sayfalar ve gerçek işletme iletişim bilgilerinin yayınlanması
- ödeme, teslimat, iade ve destek iddialarının hukuk/operasyon kontrolü
- Google Search Console site doğrulaması ve sitemap gönderimi
- Rich Results Test ile JSON-LD, URL Inspection ile render kontrolü
- gerçek kullanıcı Core Web Vitals ve arama sorgularının izlenmesi


# Faz 3 Sipariş ve Ödeme Temeli

Bu teslim para hareketinin veri modelini, fiyatın nasıl dondurulduğunu ve
sipariş durum makinesini kurar. Henüz gerçek bir ödeme alınmaz: sağlayıcı
adaptörü ve HTTP uçları sonraki dilimdedir.

## Para nasıl tutuluyor

Tutarlar **kuruş cinsinden tam sayı** olarak saklanır. Kayan noktalı sayı bir
para tutarını tam gösteremez ve buradaki bir yuvarlama kayması doğrudan paradır.

Katalog fiyatları **KDV dahil** kabul edilir: sayfada görünen 299 TL müşterinin
ödediği tutardır, vergi bu tutarın içinden ayrıştırılır. Türkiye'de tüketiciye
gösterilen fiyatın okunuşu budur.

> **Onay bekleyen varsayım:** Fiyatların KDV dahil olduğu ve oranın %20 olduğu
> varsayılmıştır. Şirket tarafı net fiyat üzerinden çalışacaksa değişecek tek
> yer `lib/order-contracts.ts` içindeki `VAT_RATE_BASIS_POINTS` ve
> `splitVatInclusive` fonksiyonudur.

Ayrıştırma toplamdan geriye doğru yapıldığı için net ve vergi her zaman
gösterilen tutara geri toplanır; testler bunu kuruş kaybı olmadan doğrular.

## Fiyat anlık görüntüsü

`createPriceSnapshot(draft)` müşterinin gördüğü kataloğu dondurur: satır
kalemleri, ara toplam, KDV, toplam ve sipariş edilen yapılandırmanın tamamı.
Satışa kapalı bir birleşim için `null` döner, yani yapılandırıcının reddedeceği
bir seçim için sipariş açılamaz.

Anlık görüntü sipariş satırıyla **aynı transaction içinde** yazılır; müşterinin
gördüğü fiyat olmadan bir sipariş var olamaz. Katalog sonradan değişse bile
sipariş ve ödeme tutarları değişmez — bu, Faz 3 çıkış kapılarından biridir ve
gerçek PostgreSQL üzerinde doğrulanmıştır.

## Durum makinesi

```text
draft ──▶ pending_payment ──▶ paid ──▶ provisioning ──▶ active
  │             │   ▲          │                          │
  │             ▼   │          ▼                          ▼
  └──▶ cancelled  failed    refunded ◀────────────────────┘
```

Listelenmeyen her geçiş reddedilir. Ödenmiş bir sipariş **hiçbir zaman** ödeme
beklemeye geri dönemez; `cancelled` ve `refunded` uçtur. Başarısız bir ödeme
yeniden denenebilir ve sipariş ödeme beklemeye döner.

`transitionOrder` beklenen mevcut durumu da ister: sipariş artık o durumda
değilse hiçbir şey değişmez ve `null` döner. Böylece eş zamanlı iki istek
birbirinin üstüne yazamaz.

## Webhook idempotency

Ödeme sağlayıcıları webhook'ları tekrar teslim eder. `payment_events` tablosundaki
`(provider, provider_event_id)` benzersizliği bu tekrarı **etkisiz** hale getirir:
ikinci teslim hiçbir şey eklemez ve `applied: false` döner. Çağıran bu yanıtı
gördüğünde ikinci kez iş başlatmaz.

Gerçek PostgreSQL üzerinde kanıtlananlar:

- Aynı webhook **10 kez sırayla** teslim edildiğinde yalnızca bir kez uygulandı;
  tek ödeme kaydı ve tek olay kaydı oluştu.
- Aynı webhook **6 kez eş zamanlı** teslim edildiğinde de sonuç aynı kaldı.
- Sipariş toplamıyla eşleşmeyen bir tutar `PaymentAmountMismatchError` ile
  reddedildi; sipariş ödeme bekler durumda kaldı ve hiç ödeme kaydı yazılmadı.

## Tablolar

- `orders` — sahip, durum, dondurulmuş toplam/ara toplam/KDV, katalog sürümü
- `order_items` — satır kalemleri; `amount = unit × quantity` kısıtıyla
- `price_snapshots` — sipariş başına tek satır, müşterinin gördüğü katalog
- `payments` — `(provider, provider_payment_id)` benzersiz
- `payment_events` — `(provider, provider_event_id)` benzersiz; idempotency anahtarı
- `refunds` — `(payment_id, provider_refund_id)` benzersiz

Veritabanı kısıtları iş kurallarını da taşır: `orders_total_is_sum` toplamın ara
toplam ile KDV'nin tam toplamı olmasını zorunlu kılar, yani tutarsız bir sipariş
satırı yazılamaz.

## Sağlayıcı sözleşmesi

`infra/payments/provider.ts` sağlayıcıdan bağımsızdır: `createCheckout`,
`verifyWebhook`, `refund`. Bu dosyanın üstündeki hiçbir katman hangi işlemcinin
kullanıldığını bilmez, böylece sağlayıcı değişimi durum makinesine, şemaya veya
panele dokunmaz.

Bugün yalnızca **sahte sağlayıcı** vardır ve açıkça seçilmesi gerekir:
`PAYMENT_PROVIDER=fake` ile en az 32 karakterlik `PAYMENT_WEBHOOK_SECRET`
girilmeden mağaza sipariş alamaz. Yarım yapılandırılmış bir dağıtım dükkân gibi
görünmez.

Sahte sağlayıcı para hareket ettirmez ama **gerçek imza şemasıyla** çalışır, bu
yüzden test edilen doğrulama yolu üretimde çalışacak olanın aynısıdır. Kendi
başına "ödeme oldu" demez; webhook yalnızca operatör veya test gönderdiğinde
gelir.

## Webhook imzası

İmza, gövdenin **ham baytları** üzerinden HMAC-SHA256'dır ve zaman damgası
imzalanan materyalin içindedir.

- Karşılaştırma sabit zamanlıdır. Basit bir `===` ilk farklı baytta döner ve bu
  zaman farkı geçerli bir imzayı karakter karakter kurtarmaya yeter.
- Zaman damgası imzanın içinde olduğu için, yakalanmış bir gövdenin damgasını
  tazeymiş gibi göstermek imzayı bozar.
- 5 dakikadan eski teslimler reddedilir.
- JSON yeniden serileştirilmez: ayrıştırıp yeniden kodlamak imzanın kapsadığı
  baytları değiştirir. Testler bunu ayrıca doğrular.

`/api/payments/webhook` ucunda **origin kontrolü ve oturum yoktur** — çağıran
bir sunucudur, tarayıcı değil. Kimlik doğrulaması imzadır. Tekrar teslim `200`
ve `applied: false` ile yanıtlanır; sağlayıcılar 2xx dışında yeniden dener ve
tekrarlanan bir olay hata değildir.

## Sipariş açma

`/api/orders` oturum açmış müşteri için sipariş oluşturur. Gövde yalnızca
**yapılandırmayı** taşır; tutar bu tarafta katalogdan hesaplanır, yani istemci
ne ödeyeceğini seçemez. Sipariş okuma sahibine kapalıdır: yabancı bir sipariş,
olmayan bir siparişle aynı `404` yanıtını alır.

## Faz 3 çıkış kapısı durumu

- Aynı ödeme webhook'unun iki kez uygulanmaması: **geçiyor** (sıralı ve eş
  zamanlı teslimlerle).
- Ödenen tutarın sonradan katalog fiyatı değişse de değişmemesi: **geçiyor**.
- Test ödeme ve başarısız ödeme senaryolarının uçtan uca geçmesi: **geçiyor**.
  Oturum açmış müşteri → sipariş → ödeme bildirimi → `paid` zinciri ve başarısız
  ödemenin ardından yeniden deneme gerçek PostgreSQL üzerinde çalıştırıldı.
- İade senaryosunun uçtan uca geçmesi: **bekliyor**. `refunds` tablosu ve
  sağlayıcı `refund()` sözleşmesi hazır; iadeyi tetikleyen akış yazılmadı.
- Gerçek bir ödeme sağlayıcısıyla test ödemesi: **bekliyor**. Şirket/fatura
  bilgileri ve sağlayıcı hesabı gerekir.

## Sonraki dilim

- İade ve iptal akışları (`refunds` tablosunu kullanan servis yolu)
- Gerçek sağlayıcı adaptörü — sahte adaptörün yerine geçer, üstündeki hiçbir
  katman değişmez
- Sipariş listesi ve hesap merkezinde sipariş görünümü
- Fatura/fiş gereksinimleri ve mesafeli satış metinleri (şirket girdisi gerekir)

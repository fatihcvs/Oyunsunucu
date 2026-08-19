# Railway Dağıtımı

Bu belge Riftory'nin Railway'e nasıl çıkarıldığını, hangi değerlerin girilmesi
gerektiğini ve neyin doğrulanacağını anlatır. Amaç, ilk dağıtımın sürpriz
üretmemesidir.

## Mimari

```text
Railway projesi
├─ web            → bu depo, Dockerfile ile derlenir
├─ postgres       → Railway managed PostgreSQL
└─ oyun sunucuları → Faz 4'te sağlayıcı worker'ı tarafından oluşturulur
```

Derleme Workers biçiminde bir modül üretir; `scripts/serve.mjs` bunu düz bir Node
http sunucusuyla servis eder. Böylece aynı çıktı hem edge çalışma zamanında hem
Railway kapsayıcısında çalışır. Statik dosyalar, Cloudflare'in yaptığı gibi,
worker'a ulaşmadan önce diskten servis edilir.

## Mevcut dağıtım

| | |
|---|---|
| Proje | `riftory` (`a4765426-faf2-431a-aadf-f79a4e0c1202`) |
| Servisler | `web`, `Postgres` |
| Adres | https://web-production-796ebb.up.railway.app |

Kurulum tekrar edilebilir: [`scripts/railway-setup.mjs`](../scripts/railway-setup.mjs)
proje, veritabanı, servis, alan adı ve gizli olmayan değişkenleri **idempotent**
biçimde hazırlar. İki kez çalıştırmak ikinci bir proje veya veritabanı üretmez.

```sh
node scripts/railway-setup.mjs --project riftory          # kur veya onar
node scripts/railway-setup.mjs --project riftory --check  # yalnızca eksikleri raporla
railway up --service web --detach
```

Script üçüncü taraf kimlik bilgilerini **uydurmaz**. E-posta ve Discord
anahtarları girilmediğinde bunları eksik olarak raporlar; sahte bir değer
yazmak, sağlık kontrolünün ürünün sahip olmadığı bir yeteneği iddia etmesine
yol açardı.

### İlk kurulumda çıkan iki tuzak

- **Yükleme boyutu.** `railway up` dizini olduğu gibi yükler; `node_modules` ve
  `dist` ile 324 MB'a çıkıp reddedildi. [`.railwayignore`](../.railwayignore)
  bunu 1,6 MB'a indirir. Ancak `.openai/hosting.json` **hariç tutulmamalıdır**:
  `vite.config.ts` onu import eder ve derleme çöker.
- **Port.** Railway `PORT` değişkenini kendi verir (8080). Alan adının hedef
  portu buna eşit olmalıdır, yoksa 502 alırsınız:
  `railway domain update <domain> --service web --port 8080`.

## Servis kurulumu

1. Railway projesinde **PostgreSQL** eklentisini oluştur.
2. Bu depoyu **web** servisi olarak bağla. `railway.json` builder'ı `DOCKERFILE`
   ve sağlık kontrol yolunu `/api/health` olarak ayarlar; ayrıca yapılandırma
   gerekmez.
3. Web servisine bir **public domain** ver. `APP_ORIGIN` bu adres olmalıdır.

## Ortam değişkenleri

Web servisine girilecek değerler. Hiçbiri kaynak koda yazılmaz.

| Değişken | Zorunlu | Not |
|---|---|---|
| `DATABASE_URL` | evet | Railway PostgreSQL referansı: `${{Postgres.DATABASE_URL}}` |
| `AUTH_SECRET` | evet | En az 32 bayt rastgele değer (`openssl rand -base64 48`) |
| `APP_ORIGIN` | evet | Yol/sorgu içermeyen HTTPS origin, ör. `https://riftory.up.railway.app` |
| `EMAIL_FROM` | e-posta girişi için | `Riftory <hello@alanadi>` biçimi kabul edilir |
| `RESEND_API_KEY` | e-posta girişi için | Alternatif: `POSTMARK_SERVER_TOKEN` |
| `DISCORD_CLIENT_ID` | Discord girişi için | |
| `DISCORD_CLIENT_SECRET` | Discord girişi için | |
| `PAYMENT_PROVIDER` | sipariş almak için | Bugün yalnızca `fake` desteklenir |
| `PAYMENT_WEBHOOK_SECRET` | sipariş almak için | En az 32 karakter; webhook imzasını doğrular |
| `DATABASE_SSL` | hayır | `require` (varsayılan), `verify` veya `disable` — aşağıya bakın |
| `NEXT_PUBLIC_SITE_URL` | hayır | Kanonik URL'ler için; verilmezse varsayılan origin kullanılır |

E-posta ve Discord blokları bağımsızdır: yalnızca biri girildiğinde o yöntem
çalışır, diğeri açık bir `503 AUTH_NOT_CONFIGURED` döndürür. İkisi de yoksa
kimlik uçlarının tamamı `503` verir ve site yalnızca vitrin olarak çalışır.

Discord uygulamasında **redirect URI** tam olarak şu olmalıdır:
`<APP_ORIGIN>/api/auth/discord/callback`

### Veritabanı TLS modu

| Değer | Anlamı | Ne zaman |
|---|---|---|
| `require` (varsayılan) | Şifreler, sertifikayı doğrulamaz | Yönetilen proxy üzerinden bağlanırken |
| `verify` | Şifreler ve sertifika zincirini doğrular | Sağlayıcı doğrulanabilir zincir sunuyorsa **tercih edilen** |
| `disable` | TLS yok | Yalnızca sağlayıcının özel ağı içinde |

Varsayılanın doğrulama yapmaması bilinçlidir: yönetilen PostgreSQL proxy'leri
çoğu zaman genel bir kök tarafından imzalanmamış sertifika sunar ve `verify`
bağlantıyı reddeder. Railway'de özel ağ kullanıyorsanız `disable`, genel proxy
kullanıyorsanız zinciri doğrulayabildiğiniz anda `verify` seçin.

## Dağıtım sırası

Kapsayıcı önce migration'ları çalıştırır, sonra sunucuyu açar:

```sh
node scripts/migrate.mjs && node scripts/serve.mjs
```

Migration çalıştırıcısı PostgreSQL advisory lock alır; aynı anda başlayan birden
fazla replika her migration'ı yine tek kez uygular. Uygulanmış bir dosyanın
içeriği değişmişse çalıştırma `MigrationChecksumError` ile durur ve dağıtım
başarısız olur — bu kasıtlıdır, sessiz şema kayması olmaz.

## Dağıtım sonrası doğrulama

```sh
curl -s https://<domain>/api/health
curl -s https://<domain>/api/auth/status
```

Beklenen:

- `/api/health` → `{"status":"ok","database":true,...}`
- `/api/auth/status` → `"live": true` ve `"postgresAdapter": true`

`status` yanıtı hiçbir secret değeri içermez; yalnızca boolean hazırlık
sinyalleri ve eksik değişken adlarını döndürür.

Ardından sırayla:

1. `/giris` sayfasından bir e-posta gir; gelen kutusunda bağlantıyı gör.
2. Bağlantıyı aç, `/giris/dogrula` sayfasında onayla; `/hesap` sayfasına
   yönlendirilmelisin.
3. `/kurulum` üzerinden bir taslak oluştur, giriş yap ve `/hesap` sayfasında
   taslağın hesaba taşındığı bildirimini gör.
4. Discord bağlıysa `/api/auth/discord/start` üzerinden aynı turu tekrarla.

### Panel canlı mı

```sh
curl -s https://<domain>/api/servers
```

Beklenen: `401 SESSION_REQUIRED`. **`503 PANEL_NOT_CONFIGURED` gelirse**
`DATABASE_URL`, `AUTH_SECRET` veya `APP_ORIGIN` eksiktir — panel bu üçünden
başka bir şey istemez. Giriş yöntemi (e-posta ya da Discord) kurulu olmasa bile
panel çalışır: mevcut bir oturumu doğrulamak gönderim sağlayıcısı gerektirmez,
ve tersi kapalı betada müşteriyi kendi sunucusundan ederdi.

Uçtan uca ölçüm için, gerçek bir oyun sunucusu kurup silen ve panel
butonlarını HTTP üzerinden süren doğrulayıcı:

```sh
node scripts/verify-panel.mjs --base http://localhost:3000
```

`DATABASE_URL` ve çalışan bir worker ister; ücretli kaynak yaratır ve sonunda
kendi yarattığı her şeyi siler. Doğruladıkları: oturumsuz 401, boş panel,
kurulum sürerken komut sunulmaması, adres atanması, durdur/başlat, işlem
sürerken ikinci komutun 409 alması, başkasının sunucusunda 404, yabancı
origin'de 403 ve durdur-başlat sonrası adresin korunması.

## Zamanlanmış temizlik

Kimlik tabloları yalnızca büyür: her giriş denemesi bir doğrulama bağlantısı,
her Discord yönlendirmesi bir state, her istek bir oran limiti kovası yazar.
Süresi geçmiş kayıtlar değer taşımaz ama e-posta adresi taşır.

```sh
npm run db:purge
```

Railway'de günlük bir cron servisi olarak çalıştırın. İş her an ve istenildiği
kadar sık çalışabilir: yalnızca ölü satırları siler ve bloke durumdaki bir oran
limiti kovasına dokunmaz.

## Geri alma

Railway'de önceki dağıtıma dönmek uygulamayı geri alır ancak **migration'ları
geri almaz**. Migration'lar ileri yönlüdür: bir sürüm geri alınacaksa şema
değişikliğinin eski kodla da çalışması gerekir. Bu nedenle sütun silme veya
yeniden adlandırma iki adıma bölünmelidir (önce yazmayı kes, sonraki sürümde
kaldır).

## Oyun sunucusu kurulumu

Sunucular `provisioning_jobs` kuyruğundan kurulur; worker ayrı bir süreçtir.

```sh
DATABASE_URL=... GAME_PROVIDER=railway \
RAILWAY_API_TOKEN=... RAILWAY_GAME_PROJECT_ID=... RAILWAY_GAME_ENVIRONMENT_ID=... \
MINECRAFT_EULA_ACCEPTED=true npm run worker
```

| Değişken | Not |
|---|---|
| `GAME_PROVIDER` | `railway` veya `docker` |
| `RAILWAY_API_TOKEN` | Hesap token'ı; `Bearer` ile gönderilir |
| `RAILWAY_GAME_PROJECT_ID` | Oyun servislerinin oluşacağı proje |
| `RAILWAY_GAME_ENVIRONMENT_ID` | Ortam kimliği |
| `RAILWAY_GAME_REGION` | İsteğe bağlı, ör. `europe-west4` |
| `MINECRAFT_EULA_ACCEPTED` | Operatör Mojang EULA'sını kabul etmeden Minecraft kurulmaz |

Sağlayıcı yapılandırmasını gerçek API'ye karşı doğrulamak için:

```sh
railway run --service web -- node scripts/verify-railway-provider.mjs --project <id> --environment <id>
```

Bir sunucu oluşturur, TCP adresinin yanıt verdiğini doğrular ve **sildiği**
için geride ücret üreten kaynak bırakmaz. Temizlik başarısız olursa servis adını
yüksek sesle bildirir; sızan bir servis para harcamaya devam eder.

### Bulgu: TCP proxy public şemada görünmüyor

Railway'in public GraphQL şemasında `tcpProxyCreate` **introspection ile
listelenmiyor** — yalnızca `tcpProxyDelete` görünüyor. Domain mutation'larının
tamamı HTTP içindir ve oyun protokolünü taşımaz.

Mutation aslında **var ve çağrılabiliyor**; sahte kimliklerle denendiğinde
"Not Authorized" döndü, "böyle bir alan yok" değil. Adaptör buna dayanır.
Şema tarafında beklenmedik bir kırılma olursa ilk bakılacak yer burasıdır;
alternatif yol `railway tcp-proxy create` komutudur.

Ayrıca Railway proxy adresini sonunda nokta olan tam nitelikli ad olarak döndürür
(`zephyr.proxy.rlwy.net.`). Müşteri bu adresi oyun istemcisine yazacağı için
nokta kırpılır.

### Bulgu: `deploymentRestart` müşterinin yeniden başlattığı durumda çalışmaz

`deploymentRestart` "Deployment is not restartable" döndürüyor — ve tam olarak
müşterinin yeniden başlatma isteyeceği durumda: servis uyutulmuşsa veya geçiş
hâlindeyse. Yeniden başlatma bu yüzden **uyut + uyandır** olarak uygulandı;
ikisi de doğrulanmış işlemlerdir ve birlikte oyun çalışma zamanının beklediği
dur-sonra-başla davranışını verir.

Canlıda ölçülen tam döngü: kur → TCP yanıt → durdur → başlat → yeniden başlat →
**adres korundu** → sil. Adresin korunması ürün açısından kritik: yeniden
başlatan bir müşteri arkadaşlarına yeni adres dağıtmak zorunda kalmamalı.

### Bulgu: volume silme ertelenir, servis silme volume'ü kapsamaz

İki ayrı davranış, ikisi de ilk denemede yanlış anlaşılabilir:

- **`serviceDelete` volume'ü silmez.** Yalnızca servisi silmek, müşterinin dünya
  verisini tutan ve ücret üretmeye devam eden ayrık (detached) bir volume
  bırakır. Adaptör bu yüzden **önce volume'leri, sonra servisi** siler; sıra
  böyle olduğu için volume silme başarısız olursa servis ayakta kalır ve iş
  yeniden denenebilir — depolama kaybolmuş bir servisin arkasında öksüz kalmaz.
- **`volumeDelete` anında silmez.** `true` döner ve volume yaklaşık **iki gün**
  boyunca listede `Deletes on: <tarih>` bilgisiyle durmaya devam eder. Bu bir
  hata değil, kazara silmeye karşı bir koruma penceresidir.

Pratik sonucu: temizliği doğrularken volume'ün listeden **hemen** kaybolmasını
beklemeyin; silme zamanlanmışsa iş tamamlanmıştır. Faz 7'deki sahipsiz kaynak
alarmı da bu pencereyi hesaba katmalı, yoksa her silmede yanlış alarm üretir.

## Oyun sunucusu imajları

`docs/GAME_RUNTIME_CERTIFICATION.md` içindeki sertifikalı çalışma ortamlarından
üçü genel registry'den çekilebilir. **Terraria imajı ise bu depodan üretiliyor**
(`infra/gameservers/terraria`) ve şu anda yalnızca yerel makinede mevcut.

Railway bu imajı çekemez. Faz 4'te oyun sunucusu oluşturma açılmadan önce
seçeneklerden biri gereklidir:

- imajı bir registry'ye (GHCR veya Docker Hub) yayınlamak ve
  `runtime-catalog.ts` içindeki referansı digest ile sabitlemek, ya da
- Railway servisini `infra/gameservers/terraria` dizininden derletmek.

Bu yapılmadan Terraria satışa açılmamalıdır; katalogdaki diğer oyunlar
etkilenmez.

## Kapanış davranışı

Railway bir örneği değiştirirken `SIGTERM` gönderir. Kapsayıcı bu sinyali
sunucuya iletir, yeni bağlantı kabul etmeyi bırakır ve süren istekleri
tamamlar. `CMD` içindeki `exec` bunun için zorunludur: `exec` olmadan kabuk PID 1
olarak kalır, sinyali Node'a iletmez ve her yeniden dağıtım `SIGKILL` ile biter.

Bu yerelde ölçüldü: `exec` yokken kapanış 30,4 saniye sürüp çıkış kodu 137
veriyordu; `exec` ile kapanış anında ve çıkış kodu 0.

## Güvenlik kararları

Yayın öncesi yapılan incelemede düzeltilenler ve verilen kararlar:

- **İstemci adresi yalnızca proxy'nin eklediği hop'tan okunur.**
  `X-Forwarded-For` soldan sağa büyür ve solundaki her şey çağıranın yazdığıdır.
  En sağdaki değer alınmasaydı, başlığı döndüren biri her istekte yeni bir oran
  limiti kovası alabilir ve `inet` sütununa istediği metni yazdırabilirdi.
  Adres biçiminde olmayan değerler düşürülür; tanınmayan çağıranlar tek bir
  ortak kovayı paylaşır.
- **CSRF origin kontrolü yalnızca `APP_ORIGIN`'e güvenir.** İsteğin kendi
  origin'i `Host` başlığından türer; onu kabul etmek isteğin kendi kendini
  doğrulamasına izin verirdi. İstekten türeyen origin sadece `APP_ORIGIN`
  tanımlı değilken, yerel geliştirme için kullanılır.
- **Statik dosya yolları derleme çıktısının dışına çıkamaz.** Yüzde kodlaması
  bozuk yollar ve NUL baytı içeren adlar 404 döner, 500 değil.
- **Her yanıt taban güvenlik başlıklarını taşır:** `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` ve
  `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` içeren bir CSP.
  HTTPS üzerinden gelen isteklere ayrıca `Strict-Transport-Security` eklenir.
- **Tam `script-src` CSP'si henüz yok.** Çerçeve satır içi hydration script'i ve
  font stili üretiyor; katı bir script politikası istek başına nonce gerektirir
  ve bugün sayfayı bozar. Açık bir eksik olarak kayıtlıdır.
- **Veritabanı erişilemezken kimlik uçları `503 AUTH_UNAVAILABLE` döner**, ham
  bir `500` değil; kesinti tekrar denenebilir bir hata olarak görünür.
- **Bağımlılık taraması temiz.** `sharp` üzerinden gelen dört yüksek önem
  dereceli libvips açığı `next` 16.3.1 yükseltmesiyle kapatıldı;
  `npm audit --omit=dev` sıfır bulgu veriyor.

## Bilinen sınırlar

- Görsel optimizasyonu Cloudflare Images'a bağlıdır. Node çalışma zamanında
  görseller **dönüştürülmeden** servis edilir; yanıt `X-Riftory-Image:
  passthrough` başlığını taşır. Doğru görüntü, optimize edilmemiş boyut.
- Vintage Story satışa açık olmasına rağmen arama açılış sayfası yoktur.
  Ana sayfada listelenir ve yapılandırıcıdan seçilebilir; yalnızca kendi SEO
  sayfası eksiktir.
- **Panel canlıda uçtan uca doğrulanmadı.** Zincirin tamamı (oturum → HTTP →
  kuyruk → worker → gerçek Railway sağlayıcısı) yerel uygulama ve yerel
  veritabanıyla, ama **gerçek Railway sağlayıcısıyla** ölçüldü ve geçti.
  Dağıtılmış kapsayıcının kendisinde yalnızca uç noktanın doğru yanıt verdiği
  (`401 SESSION_REQUIRED`) doğrulandı. Aradaki fark yalnızca hangi makinenin
  isteği karşıladığıdır; imaj ve kod aynıdır. Tam canlı ölçüm, Railway
  ağının dışından production veritabanına erişim gerektirdiği için
  yapılmadı — veritabanını internete açmamak bilinçli bir tercihtir.
- **Railway Postgres'in public adresi yoktur.** Migration ve operasyon
  komutları `railway run` ile, yani Railway ağı içinden çalıştırılır.

## Konsol (RCON) için ortam gereksinimi

Panel konsolu, sunucu başına konsol parolasını `AUTH_SECRET`'ten türetir. Bu
yüzden **hem `web` hem `worker`** aynı `AUTH_SECRET` değerini görmelidir:
worker parolayı oyun kapsayıcısına yazar, web onu doğrulayarak bağlanır. Değerler
ayrışırsa konsol `RCON_AUTH_REJECTED` döner.

Tek kaynakta tutmak için worker'da Railway servis referansı kullanılır:

```sh
railway variables --service worker --set 'AUTH_SECRET=${{web.AUTH_SECRET}}'
```

İki operasyonel tuzak ölçüldü (2026-08-19):

- `--skip-deploys` ile eklenen bir değişken **çalışan kapsayıcıya girmez**;
  servis yeniden dağıtılana kadar eski ortamla çalışmaya devam eder.
- `railway redeploy` bu ortamda sessizce hiçbir şey yapmadan çıkabilir. Değişkenin
  gerçekten uygulandığını doğrulamanın güvenilir yolu `railway up --service <ad>`
  ile yeniden dağıtmak ve ardından hedef serviste değişkeni aramaktır:
  `railway variables --service game-<serverId> --kv | grep RCON`.

Konsol parolası yalnızca sunucu değişkenleri yeniden yazıldığında yerleşir; bu da
bir ayar kaydı (`apply_settings`) veya paket değişikliği ile olur. Konsol var
olmadan kurulmuş sunucular için panelden bir ayar kaydetmek yeterlidir.

## Yedekleme için token yetkisi

Panelin yedek alma özelliği Railway'in volume anlık görüntülerini kullanır.
Mevcut `RAILWAY_API_TOKEN` bu iş için **yeterli değildir**: 2026-08-19'da ölçüldü,

- `volumeInstanceBackupList` → çalışıyor (okuma)
- `volumeInstanceBackupCreate` → `Not Authorized` (yazma)

Yani token yedekleri listeleyebiliyor ama oluşturamıyor. Yedek alma özelliğinin
çalışması için Railway'de volume yönetim yetkisi olan bir token gerekir; bu,
hesap/takım kapsamlı bir token demektir.

Token değiştirildikten sonra `web` **ve** `worker` servislerinin yeniden
dağıtılması gerekir (bkz. yukarıdaki değişken yayılımı notu).

Yetki yokken davranış bilinçlidir: yedek işi **bir kez** dener ve başarısız olur,
sunucu `online` kalır, dünya kaydetmeye devam eder. Yetki hatası tekrarda
düzelmeyeceği için beş kez denenmez.

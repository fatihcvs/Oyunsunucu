# Oyun Çalışma Ortamı Sertifikasyonu

Bu belge, katalogda satılan her oyun/yazılım/plan birleşiminin gerçek bir
kapsayıcıda ölçülmüş davranışını kaydeder. Amaç, mağazadaki iddiaların
doğrulanmamış varsayıma dayanmamasıdır.

Ölçüm aracı: [`scripts/certify-game-runtime.mjs`](../scripts/certify-game-runtime.mjs).
Çalışma ortamı tanımları: [`infra/gameservers/runtime-catalog.ts`](../infra/gameservers/runtime-catalog.ts).

```bash
MINECRAFT_EULA_ACCEPTED=true \
  node scripts/certify-game-runtime.mjs --game minecraft --software paper --plan mini-2
```

Script dokuz adımda ilerler: kapsayıcıyı planın RAM sınırıyla başlatır, hazır
olma süresini ölçer, TCP bağlantısını dener, dünya kimliğini ve etkin ayarı
okur, veri hacmine işaret dosyası yazar, `SIGTERM` ile graceful kapatır, yeniden
başlatır ve dünya kimliğinin değişmediğini doğrular. Son adımda **ayar
değişikliği** yapar: kapsayıcıyı durdurup siler, veri hacmini koruyarak değişmiş
ayarla yeniden oluşturur — yani bir Railway yeniden dağıtımının yaptığını yapar.

Ayarın uygulandığı, isteğimizden değil **çalışan sunucudan** okunur: Minecraft'ta
RCON `list` çıktısındaki oyuncu sınırı, Terraria'da giriş noktamızın bastığı
etkin ayar satırı, Vintage Story'de veri hacmindeki `serverconfig.json`.

Yedi koşulun tümü sağlanmazsa sonuç `failed` olur: TCP erişilebilir, dünya
korunmuş, işaret dosyası hayatta, iki kapanışın da çıkış kodu 0, ayar
uygulanmış, ayar değişikliğinden sonra dünya yerinde, OOM yok.

## Sertifikasyon durumu

| Oyun / yazılım | Durum | Kanıt |
|---|---|---|
| minecraft / paper | **certified** | 2 GB ve 4 GB planlarında ölçüldü |
| minecraft / purpur | **certified** | 2 GB planında ayrı ölçüldü |
| minecraft / vanilla | **certified** | 2 GB planında ayrı ölçüldü |
| minecraft / fabric | **certified** | 4 GB planında ölçüldü |
| terraria / terraria-vanilla | **certified** | 2 GB'de ölçüldü; kendi kapatma sarmalayıcımızla |
| terraria / tmodloader | **unresolved · satışa kapalı** | İmaj bulunamadı; katalogda `soon` işaretli |
| vintagestory / vintagestory-vanilla | **certified** | 2 GB'de ölçüldü; ayar değişikliği dahil |

Katalogdaki FiveM, Rust ve Valheim "Yakında" durumundadır ve çalışma ortamı
tanımı taşımaz: üçü de UDP kullanır, Railway'in ilk faz ağı ise yalnızca TCP
proxy verir. Bunlar Faz 8'de ikinci sağlayıcıyla açılacaktır.
`tests/game-runtime-catalog.test.mjs` bir oyunun UDP protokolüyle canlı
işaretlenmesini engeller.

`infra/gameservers/runtime-catalog.ts` içindeki `verification` alanı bu tabloyla
aynı olmak zorundadır; `tests/game-runtime-catalog.test.mjs` bunu denetler.

## Minecraft Java · Paper 26.2 · `itzg/minecraft-server:java25`

| Ölçüm | `mini-2` (2 GB) | `starter-4` (4 GB) |
|---|---|---|
| JVM heap sınırı | 1280 MB | 3277 MB |
| İlk açılış (dünya üretimi dahil) | 36,8–36,9 sn | 37,0 sn |
| TCP 25565 erişimi | açık | açık |
| Açılış sonrası bellek | 1779–1830 MB | 2998 MB |
| Kalan pay | 218–269 MB | 1098 MB |
| Graceful kapanış | 1,0–1,1 sn (çıkış 0) | 1,2 sn (çıkış 0) |
| Yeniden açılış | 20,2 sn | 20,2 sn |
| Dünya seed'i korundu | evet | evet |
| Veri hacmi işareti korundu | evet | evet |
| Ayar değişikliği `max-players` 20 → 12 | uygulandı, dünya korundu | — |
| OOM | hayır | hayır |

Sonuç: her iki plan da **certified**. Dünya, graceful kapatma ve yeniden
başlatma sonrasında aynı seed ile yüklendi; veri hacmi kayıpsız kaldı. Ayar
değişikliği sonrası RCON `list` çıktısı yeni sınırı bildirdi, yani ayar dosyaya
değil çalışan sunucuya ulaştı.

2 GB planındaki kalan pay ölçümlerde 269 MB, 218 MB ve (Purpur'da) 283 MB çıktı.
Bu, planın çalıştığını ama **en dar plan** olduğunu gösteriyor: eklenti veya
yüksek oyuncu sayısı bu payı tüketebilir, bu yüzden 2 GB eklentili kurulumlar
için önerilmez.

Aynı imajı paylaşan diğer üç sunucu yazılımı ayrı ayrı ölçüldü. Hepsinde
kapanış çıkış kodu 0, dünya korundu ve `max-players` 20 → 12 değişikliği
çalışan sunucudan doğrulandı:

| Yazılım | Plan | İlk açılış | Açılış belleği | Kalan pay | Yeniden açılış |
|---|---|---|---|---|---|
| Purpur | 2 GB | 40,1 sn | 1765 MB | 283 MB | 30,1 sn |
| Vanilla | 2 GB | 26,9 sn | 1364 MB | 684 MB | 13,6 sn |
| Fabric | 4 GB | 27,0 sn | 2077 MB | 2019 MB | 16,9 sn |

Vanilla'nın payı Paper'ınkinin iki katından fazla: eklenti çatısı olmadığı için
2 GB planında en rahat çalışan seçenek o. Fabric 4 GB'de geniş pay bırakıyor,
ancak bu ölçüm **mod yüklenmemiş** bir sunucuya aittir; mod paketleri bu payı
hızla tüketir.

## Terraria · Vanilla 1.4.4.9 · `riftory/terraria:vanilla-1.4.4.9-r1`

| Ölçüm | Üstteki imaj, ilk ölçüm | Dünya adı düzeltilmiş | **Kendi imajımız** |
|---|---|---|---|
| İlk açılış (dünya üretimi dahil) | 24,8 sn | 24,6 sn | 24,8 sn |
| TCP 7777 erişimi | açık | açık | açık |
| Açılış sonrası bellek | 689 MB | 709 MB | 701 MB |
| Kalan pay | 1359 MB | 1339 MB | 1347 MB |
| Graceful kapanış | **120,5 sn · çıkış 137** | **120,5 sn · çıkış 137** | **1,4–1,5 sn · çıkış 0** |
| Yeniden açılış | 21,4 sn (yeni dünya üretti) | 3,8 sn (yükledi) | 3,8 sn (yükledi) |
| Dünya korundu | **hayır** (`Riftory2.wld` oluştu) | evet | evet |
| Ayar değişikliği `maxplayers` 8 → 12 | — | — | uygulandı, dünya korundu |

Sonuç: `riftory/terraria:vanilla-1.4.4.9-r1` ile **certified**. Kapanış zorla
öldürmeden, dünya kaydedilerek 1,4 saniyede tamamlanıyor; yeniden başlatmada
sunucu mevcut dünyayı yüklüyor ve ikinci bir dünya üretmiyor.

## Vintage Story · 1.22.6 · `devidian/vintagestory@sha256:7a5ea3b8…`

| Ölçüm | `mini-2` (2 GB) |
|---|---|
| İlk açılış (dünya üretimi dahil) | 26,9 sn |
| TCP 42420 erişimi | açık |
| Açılış sonrası bellek | 1177 MB |
| Kalan pay | 871 MB |
| Graceful kapanış | 1,5 sn · çıkış 0 |
| Yeniden açılış | 17,0 sn |
| Dünya korundu | evet (`default.vcdbs`) |
| Ayar değişikliği `MaxClients` 16 → 12 | uygulandı, dünya korundu |

Sonuç: **certified**. Sunucu `SIGTERM`'i kendisi doğru işliyor, ayrı bir
sarmalayıcı gerekmedi.

İki ürün notu: yayıncının imaj deposunda sürüm etiketi yok, bu yüzden imaj
**digest ile** sabitlendi — etiketten daha güçlü bir bağdır. Ayrıca 1.20'den
beri Vintage Story sunucuları varsayılan olarak **beyaz liste** modundadır;
panel bu ayarı açıkça sunmazsa müşteri kendi sunucusuna giremez.

## Bulgular

### 1. İmaj etiketi ile oyun sürümü birlikte sabitlenmelidir

İlk deneme `itzg/minecraft-server:java21` ile yapıldı ve kapsayıcı açılmadan
çıktı: Paper 26.2 çalışmak için Java 25 istiyor. İmaj etiketi sabitken oyun
sürümünün serbest bırakılması, bizim tarafımızda hiçbir değişiklik olmadan
ürünü kırabilir. Bu nedenle `GameRuntime` artık `image` ile birlikte
`gameVersion` da taşıyor ve ikisi birlikte güncellenir.

### 2. Heap, kapsayıcı sınırına yakın verilemez

İlk ölçümde heap kapsayıcı sınırının %75'i (2 GB planda 1536 MB) idi ve açılış
sonrası bellek 1963 MB'a çıktı: OOM'a **85 MB** kalmıştı. JVM'in metaspace,
iş parçacığı yığınları, GC yapıları ve doğrudan tamponları bu boyutta ~400 MB
tutuyor. Rezerv `max(768 MB, sınırın %20'si)` olarak yeniden tanımlandı; 2 GB
planda kalan pay 269 MB'a çıktı.

Bu, sipariş anında heap hesaplayan tek bir fonksiyonun neden gerekli olduğunu da
gösteriyor: `heapMegabytes()` dışında elle heap ayarı yapılmamalıdır.

### 3. `latest` etiketi ürünün iddiasını değiştirebiliyor

`ryshe/terraria:latest` vanilla Terraria değil, **TShock** sunucusudur.
Katalogdaki "Vanilla — klasik Terraria çok oyunculu deneyimi" iddiasını
karşılamaz. Vanilla girdisi `ryshe/terraria:vanilla-1.4.4.9` etiketine
sabitlendi ve testler artık hiçbir çalışma ortamının `latest` kullanmasına izin
vermiyor.

### 4. tModLoader satışa açıktı ama hiç imajı yoktu

`ryshe/terraria` deposunda tModLoader etiketi bulunmuyor; topluluk imajı
`jacobsmile/tmodloader1.4` yalnızca `latest` yayınlıyor. Bu birleşim
`unresolved` olarak işaretlendi: kontrollü beta açılmadan önce ya sürümü
sabitlenmiş bir imaj seçilmeli ya da kendi imajımız üretilmelidir.

Son turda daha ağır bir tarafı ortaya çıktı: çalışma ortamı çözülmemiş olmasına
rağmen **tModLoader yapılandırıcıda seçilebiliyordu**. Katalog, oluşturulması
imkânsız bir sunucu için sipariş alabilirdi. `GameSoftware` artık bir `soon`
işareti taşıyor; `sellableSoftware()` bu seçenekleri listelerden çıkarıyor ve
`isServerDraft()` böyle bir taslağı reddediyor — elle yazılmış bir taslak bile
satışa kapalı bir yazılımı sipariş edemez. `tests/game-runtime-catalog.test.mjs`
sipariş edilebilen her birleşimin çözülmüş bir imajı olmasını zorunlu kılıyor.

### 5. Terraria `SIGTERM` ile kapanmıyor · kendi imajımızla çözüldü

`docker stop` Terraria sunucusunu düzgün kapatamadı: 120 saniyelik süre doldu ve
kapsayıcı **çıkış kodu 137** ile `SIGKILL` aldı. Vanilla Terraria dünyayı yalnızca
konsola `exit` yazıldığında kaydeder; `SIGTERM` yakalanmıyor.

Üretimdeki anlamı ağırdır: her durdurma, yeniden başlatma ve yeniden dağıtım
zorla kapatma olur. Kaydedilmemiş oyun ilerlemesi kaybolur ve yazma sırasında
kesilen bir dünya dosyası bozulabilir. Terraria satışa açılmadan önce sunucuyu
`SIGTERM` aldığında stdin'e `exit` gönderen bir denetleyiciyle sarmalamak veya
bunu yapan bir imaj kullanmak zorunludur.

Bu bulgu, panelin "durdur" düğmesinin de saf bir kapsayıcı durdurma olamayacağını
gösteriyor: Faz 6'daki durdurma işi, oyuna özgü kapatma yolunu çağırmalıdır.

Çözüm [`infra/gameservers/terraria`](../infra/gameservers/terraria) altındadır:
üstteki imajın sunucu ikilisi korunur, giriş noktası değiştirilir. Yeni giriş
noktası sunucunun stdin'ini adlandırılmış bir boru üzerinden açık tutar,
`SIGTERM` yakalandığında konsola `exit` yazar ve kayıt bitene kadar bekler.
Süre aşılırsa süreç sonlandırılır; sessizce beklemeye devam edilmez. Sunucu
argümanları da bu giriş noktasında üretildiği için `-world` ile `-worldname`
artık ayrışamaz (bkz. 6. bulgu).

### 6. Yanlış dünya adı sessizce yeni dünya üretiyor · **çözüldü**

İlk denemede sunucuya `-world .../riftory.wld -worldname Riftory` verildi.
Terraria dünyayı `-worldname` değerine göre `Riftory.wld` olarak oluşturdu;
yeniden başlatmada `riftory.wld` bulunamadı ve `-autocreate` **ikinci bir dünya**
(`Riftory2.wld`) üretti. Oyuncunun dünyası kaybolmuş olurdu; kapsayıcı ise
sağlıklı görünüyordu.

Kural: `-world` yolu, `-worldname` değerinin ürettiği dosyanın tam adı olmalıdır.
İki değer eşitlendiğinde dünya yeniden başlatmada korundu ve ikinci dünya
üretilmedi. Yeniden açılış süresi de 21,4 sn'den 3,8 sn'ye düştü: sunucu artık
dünya üretmiyor, mevcut dünyayı yüklüyor. Bu süre farkı, sessiz veri kaybını
yakalayan ucuz bir sinyaldir.

Daha güvenlisi, sunucu taslağı oluşturulurken dünya dosyasının bir kez üretilip
sonraki açılışlarda `-autocreate` verilmemesidir.

Bu bulgu sağlık kontrolünün de tanımını değiştiriyor: Faz 5 sağlık kontrolü
"süreç ayakta" değil, "beklenen dünya yüklendi" demelidir.

### 7. Kapatma sarmalayıcısının kendi taşıyıcı ortamı da doğrulanmalı

Sarmalayıcının ilk sürümü sunucunun stdin'ini `sleep infinity > boru &` ile açık
tutuyordu. Bu imajın kabuğu dash ve `sleep infinity` desteklenmiyor: yardımcı
süreç anında öldü, borunun yazma ucu kapandı ve `SIGTERM` geldiğinde konsola
`exit` yazılamadı. Kapanış 120,5 sn'den 0,5 sn'ye indi ama çıkış kodu 143 kaldı,
yani sunucu yine kayıtsız öldürüldü.

Boru artık yardımcı süreç olmadan, betiğin kendi dosya tanımlayıcısıyla
(`exec 3<> boru`) açık tutuluyor. Ders: taşıyıcı imajın kabuğu ve araç seti,
sarmalayıcının davranışının parçasıdır ve varsayılamaz.

### 8. Kaydeden bir sunucuda bayt eşitliği kalıcılık ölçütü değildir

Sarmalayıcı çalıştıktan sonra dünya dosyası 2.876.323 bayttan 2.876.095 bayta
düştü ve ölçüm "dünya korunmadı" dedi. Aslında bu, kaydın **çalıştığının**
kanıtıydı: Terraria kapanırken dünyayı yeniden yazıyor. Bayt eşitliği beklemek,
başarılı kaydı başarısızlık olarak raporlamak demekti.

Terraria için dünya kimliği artık `*.wld` dosyalarının **adları**dır. Değişmemesi
gereken şey dosyanın içeriği değil, hangi dünyaların var olduğudur; asıl
yakalanmak istenen hata da zaten `autocreate`'in ikinci bir dünya üretmesiydi.

### 9. Ölçüm aracının kendi eseri kanıta karışmamalı

İlk Terraria ölçümünde dünya kimliği, veri hacmine yazdığımız kalıcılık işaret
dosyasını da içeriyordu; işaret yeniden başlatmadan sonra listeye eklendiği için
dünya "değişmiş" göründü. Kimlik artık yalnızca `*.wld` dosyalarını okuyor.
Sertifikasyon aracının ürettiği yan etkiler ölçtüğü değerin parçası olmamalıdır.

### 10. Ayar değişikliği yeniden dağıtımdır, dosya düzenlemesi değil

Prova ayar değişikliğini kapsayıcıyı silip veri hacmini koruyarak yeniden
oluşturarak yapıyor; çünkü Railway'de bir servis değişkenini değiştirmek de
tam olarak bunu yapar. Bu model iki şeyi aynı anda sınıyor: ayarın çalışan
sunucuya ulaşması ve verinin kapsayıcı ömründen bağımsız yaşaması.

Ayarın uygulandığı, gönderdiğimiz değere bakılarak değil sunucudan okunarak
doğrulanıyor. Üç oyunun üç ayrı yolu var ve bu, panelin tek bir "ayarları kaydet"
soyutlamasının altında üç farklı mekanizma barındıracağını gösteriyor:

| Oyun | Ayar nerede | Nasıl okunuyor |
|---|---|---|
| Minecraft | kapsayıcı değişkeni → `server.properties` | RCON `list` çıktısı |
| Terraria | kapsayıcı değişkeni → sunucu argümanı | giriş noktamızın bastığı ayar satırı |
| Vintage Story | veri hacmindeki `serverconfig.json` | dosyadan okuma |

Vintage Story'nin ayarı veri hacminde durduğu için değişiklik, sunucu kapalıyken
tek kullanımlık bir kapsayıcıyla uygulanıyor. Sunucu çalışırken düzenlense
kapanışta üzerine yazılabilirdi.

## Doğrulanmamış kalan iddialar

Aşağıdakiler bu provada **ölçülmedi**; mağaza metinlerinde kesin iddia olarak
kullanılmamalıdır:

- Plan başına oyuncu sayısı aralıkları (`1–6`, `6–15`, …). Ölçümler boş
  sunucuya aittir; gerçek oyuncu yükü, chunk üretimi ve eklenti etkisi
  içermez.
- Disk kotaları (10–60 GB) ve yedekleme süreleri.
- Amsterdam bölgesine ait gecikme değerleri.
- Zorla kapatma (`SIGKILL`), dolu disk ve başarısız güncelleme senaryoları.
  Faz 5 çıkış kapısı bunları ayrıca ister.
- Gerçek oyun istemcisiyle bağlanma. Prova yalnızca ham TCP el sıkışması yapar;
  Terraria sunucusu bu ham bağlantıda `gpath.c:115` iddia hatası bastı. Zararsız
  görünüyor ancak istemciyle doğrulanana kadar "bağlanılabilir" denemez.
- Dünyanın **içeriğinin** korunması. Prova hangi dünyaların var olduğunu ve
  Minecraft'ta seed'i doğrular; oyuncu tarafından yapılmış bir değişikliğin
  yeniden başlatmadan sonra durduğunu göstermez. Bunun için gerçek istemciyle
  yapılan bir tur gerekir.
- Minecraft Vanilla ve Fabric ölçümleri. Aynı imajı paylaşsalar da farklı sunucu
  yazılımıdır; katalogda satılmadan önce ayrı ölçülmelidir.

## Beyan edilmiş, henüz ölçülmemiş çalışma ortamları

2026-08-19'da katalog dört Minecraft sunucu yazılımıyla genişletildi. Hepsi
`verification: "declared"` durumundadır: imaj ve sürüm sabitlenmiştir, minimum
bellek beyan edilmiştir, ancak **hiçbiri plan sınırı altında açılıp
ölçülmemiştir**. Bu yüzden katalogda `soon: true` taşırlar ve satılamazlar.

| Yazılım | `TYPE` | Beyan edilen minimum | Ölçülmesi gereken |
|---|---|---:|---|
| Spigot | `SPIGOT` | 2 GB | Kendi derlemesini yaptığı için ilk açılış süresi |
| Forge | `FORGE` | 4 GB | Sürüm uyumu ve mod yükü altında bellek |
| NeoForge | `NEOFORGE` | 4 GB | Yeni Minecraft sürümünde platform hazır mı |
| Quilt | `QUILT` | 2 GB | Fabric'e yakın davranıp davranmadığı |

Kural testle korunmaktadır: `tests/game-runtime-catalog.test.mjs` içindeki
"nothing is sellable until a certification run has measured it" testi, satışa
açık her birleşimin `certified` olmasını zorunlu tutar. Bir yazılımın `soon`
bayrağını ölçmeden kaldırmak testi kırar.

### Sertifikasyon nasıl yapılır

Docker Desktop açıkken, her birleşim için ayrı ayrı:

```sh
MINECRAFT_EULA_ACCEPTED=true node scripts/certify-game-runtime.mjs --game minecraft --software spigot --plan mini-2
MINECRAFT_EULA_ACCEPTED=true node scripts/certify-game-runtime.mjs --game minecraft --software quilt --plan mini-2
MINECRAFT_EULA_ACCEPTED=true node scripts/certify-game-runtime.mjs --game minecraft --software forge --plan starter-4
MINECRAFT_EULA_ACCEPTED=true node scripts/certify-game-runtime.mjs --game minecraft --software neoforge --plan starter-4
```

Forge ve NeoForge, beyan edilen minimumları 4 GB olduğu için `starter-4` planıyla
ölçülür; daha küçük bir planla çalıştırmak beyanla çelişir.

Prova geçen bir birleşim için iki dosya birlikte güncellenir:
`infra/gameservers/runtime-catalog.ts` içinde `verification: "certified"` ve
ölçülen değerlerle `notes`, `lib/catalog.ts` içinde ise `soon` bayrağının
kaldırılması. Prova başarısız olursa kapsayıcı incelenmek üzere bırakılır ve
katalog olduğu gibi kalır.

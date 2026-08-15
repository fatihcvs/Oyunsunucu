# Yerel Kurulum — Projeyi Kendi Bilgisayarında Çalıştırma

Bu rehber, Riftory'yi bulut oturumundan kendi bilgisayarına taşımak içindir.
Örnekler `D:` diskini varsayar; başka bir sürücü kullanacaksan yolları değiştir.

## Gereksinimler

| Araç | Sürüm | Kurulum |
| --- | --- | --- |
| Node.js | `>=22.13.0` | `winget install OpenJS.NodeJS.LTS` |
| Git | herhangi | `winget install Git.Git` |

Kod düzenleyici olarak VS Code önerilir: `winget install Microsoft.VisualStudioCode`

## Hızlı kurulum (Windows)

PowerShell'i **yönetici olarak değil**, normal kullanıcı olarak aç ve şu tek
komutu çalıştır. Betiği doğrudan GitHub'dan indirip çalıştırır; Git ve Node.js
eksikse kurulumlarını önerir, depoyu `D:\Riftory` klasörüne klonlar ve
bağımlılıkları yükler:

```powershell
irm https://raw.githubusercontent.com/fatihcvs/Oyunsunucu/main/scripts/windows-setup.ps1 -OutFile "$env:TEMP\riftory-setup.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\riftory-setup.ps1"
```

> Betik `main` dalına birleşmeden önce indirme adresindeki `main` yerine ilgili
> dal adını yaz, örneğin `.../Oyunsunucu/claude/project-setup-computer-ue3n42/scripts/windows-setup.ps1`.

Farklı bir klasör veya dal istersen:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:TEMP\riftory-setup.ps1" -Path D:\Projeler\Riftory -Branch claude/project-setup-computer-ue3n42
```

Betik bittiğinde kurulum doğrulanmış olur ve sonraki komutlar ekrana yazılır.

## Elle kurulum

Betiği kullanmak istemezsen adımlar şunlar:

```powershell
# 1. Hedef klasöre geç
cd D:\

# 2. Depoyu klonla
git clone https://github.com/fatihcvs/Oyunsunucu.git Riftory
cd D:\Riftory

# 3. Uzun dosya yolu desteğini aç (Windows 260 karakter sınırı)
git config --global core.longpaths true

# 4. Bağımlılıkları kur
npm ci

# 5. Kurulumu doğrula
npm run doctor
```

macOS ve Linux'ta aynı adımlar `git clone` + `npm ci` ile geçerlidir; yol
ayırıcıları dışında fark yoktur.

## Komutlar

Depoda iki komut takımı var. `:local` ekli olanlar kendi bilgisayarın için,
eki olmayanlar bulut derleme ajanı için.

| Yerel komut | Ne yapar |
| --- | --- |
| `npm run dev:local` | Geliştirme sunucusu — http://localhost:5173 |
| `npm run build:local` | Üretim çıktısı üretir ve artifact'ı doğrular |
| `npm run start:local` | Derlenmiş çıktıyı çalıştırır |
| `npm run test:local` | Derleme + `tests/` altındaki testler |
| `npm run typecheck:local` | TypeScript denetimi |
| `npm run lint:local` | ESLint denetimi |
| `npm run doctor` | Node sürümü ve bağımlılık durumunu raporlar |

### Neden ayrı komutlar var?

Eki olmayan komutlar (`npm run build`, `npm run lint`, `npm run install:ci`)
`scripts/*.sh` dosyalarını çağırır. Bu betikler bilinçli olarak Linux'a
özgüdür: `install-ci.sh` `flock` ve `/proc` üzerinden eşzamanlı kurulum
tespiti yapar, `build-verified.sh` GNU `timeout` ile derlemeyi sınırlar.
Windows'ta bunların hiçbiri yok, ayrıca `npm run dev` içindeki
`WRANGLER_LOG_PATH=... vite` biçimi `cmd.exe` altında çalışmaz.

`:local` komutları `scripts/local.mjs` üzerinden aynı ikilileri (`vite`,
`vinext`, `eslint`, `tsc`) doğrudan Node ile çalıştırır ve `vite.config.ts`'in
beklediği proje-yerel Wrangler/Miniflare yollarını ayarlar. Sonuç aynı, taşınır
biçimde.

## Günlük akış

```powershell
cd D:\Riftory

# En son değişiklikleri al
git pull origin main

# Bağımlılıklar değiştiyse
npm ci

# Geliştirmeye başla
npm run dev:local
```

Değişiklik gönderirken:

```powershell
git checkout -b ozellik/kisa-aciklama
git add .
git commit -m "Kısa ve açıklayıcı mesaj"
git push -u origin ozellik/kisa-aciklama
```

İlk `git push` sırasında GitHub kimlik doğrulaması istenir. Git for Windows ile
gelen Credential Manager tarayıcıda oturum açmanı ister; bir kez onayladıktan
sonra kimlik bilgisi Windows Kimlik Bilgisi Yöneticisi'nde saklanır.

## Claude Code'u yerelde kullanma

Bulut oturumu yerine kendi makinenden devam etmek için:

```powershell
npm install -g @anthropic-ai/claude-code
cd D:\Riftory
claude
```

İlk çalıştırmada tarayıcı üzerinden Anthropic hesabınla oturum açarsın.

## Sorun giderme

**`npm ci` sırasında `EPERM` veya kilit hatası**
Antivirüs `node_modules` yazımını engelliyor olabilir. `D:\Riftory` klasörünü
gerçek zamanlı taramadan muaf tut veya kurulumu tekrar dene.

**`node : terim tanınmıyor`**
Node.js kurulumdan sonra PATH'e eklendi ama açık PowerShell penceresi eski
PATH'i taşıyor. Pencereyi kapatıp yeniden aç.

**`ExecutionPolicy` hatası**
Betiği `powershell -ExecutionPolicy Bypass -File ...` biçiminde çalıştır; bu
yalnızca o çalıştırma için geçerlidir, sistem politikasını değiştirmez.

**Port 5173 kullanımda**
`npm run dev:local -- --port 5174` ile farklı bir port ver.

**`fatal: unable to access ... SSL certificate problem`**
Kurumsal ağ/proxy arkasındaysan Git'in sistem sertifika deposunu kullanmasını
sağla: `git config --global http.sslBackend schannel`

## Ortam değişkenleri

Uygulama yapılandırması `.env` dosyalarına aittir ve `.gitignore` ile depo
dışında tutulur. Şu an kimlik ve ödeme sağlayıcı anahtarları bağlanmadığı için
yerel geliştirme ek bir `.env` dosyası gerektirmez; pazarlama sayfaları,
yapılandırıcı ve panel demosu anahtar olmadan çalışır.

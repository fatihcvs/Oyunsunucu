<#
.SYNOPSIS
    Riftory oyun sunucusu projesini bir Windows makinesine kurar.

.DESCRIPTION
    Git ve Node.js on kosullarini dogrular, depoyu hedef diske klonlar (varsa
    gunceller), bagimliliklari kurar ve gelistirme sunucusunun calistigini
    dogrular.

    Konsol mesajlari Turkce karakter icermez: Windows PowerShell 5.1 BOM'suz
    UTF-8 dosyalari sistem kod sayfasiyla okur ve aksanli harfleri bozar.

.PARAMETER Path
    Projenin kurulacagi klasor. Varsayilan: D:\Riftory

.PARAMETER Branch
    Kullanilacak git dali. Varsayilan: main

.PARAMETER AutoInstall
    Eksik on kosullari winget ile sormadan kurar.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows-setup.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows-setup.ps1 -Path D:\Projeler\Riftory -Branch claude/project-setup-computer-ue3n42
#>
[CmdletBinding()]
param(
    [string]$Path = 'D:\Riftory',
    [string]$Branch = 'main',
    [switch]$AutoInstall
)

$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/fatihcvs/Oyunsunucu.git'
$MinimumNode = [version]'22.13.0'

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

function Test-Command {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget {
    param([string]$PackageId, [string]$Label)

    if (-not (Test-Command 'winget')) {
        throw "$Label kurulu degil ve winget bulunamadi. $Label paketini elle kurup betigi tekrar calistirin."
    }

    if (-not $AutoInstall) {
        $answer = Read-Host "$Label kurulu degil. winget ile simdi kurulsun mu? [E/h]"
        if ($answer -and $answer -notmatch '^[EeYy]') {
            throw "$Label kurulumu iptal edildi."
        }
    }

    Write-Warn "$Label kuruluyor (winget install $PackageId)..."
    winget install --id $PackageId --exact --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "$Label kurulumu basarisiz oldu (winget cikis kodu $LASTEXITCODE)."
    }

    # winget PATH'i mevcut oturuma yansitmaz; makine ve kullanici PATH'ini birlestir.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

# --- 1. On kosullar --------------------------------------------------------

Write-Step 'On kosullar dogrulaniyor'

if (-not (Test-Command 'git')) {
    Install-WithWinget -PackageId 'Git.Git' -Label 'Git'
    if (-not (Test-Command 'git')) {
        throw 'Git kuruldu ama bu oturumda bulunamadi. PowerShell penceresini kapatip betigi tekrar calistirin.'
    }
}
Write-Ok "git      : $((git --version) -replace 'git version ', '')"

$nodeOk = $false
if (Test-Command 'node') {
    $nodeVersion = [version](((node --version) -replace '^v', '') -split '-')[0]
    $nodeOk = $nodeVersion -ge $MinimumNode
    if (-not $nodeOk) {
        Write-Warn "Node.js $nodeVersion kurulu, en az $MinimumNode gerekli."
    }
}
if (-not $nodeOk) {
    Install-WithWinget -PackageId 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS'
    if (-not (Test-Command 'node')) {
        throw 'Node.js kuruldu ama bu oturumda bulunamadi. PowerShell penceresini kapatip betigi tekrar calistirin.'
    }
    $nodeVersion = [version](((node --version) -replace '^v', '') -split '-')[0]
    if ($nodeVersion -lt $MinimumNode) {
        throw "Node.js $nodeVersion kuruldu ama en az $MinimumNode gerekli."
    }
}
Write-Ok "node     : $nodeVersion"
Write-Ok "npm      : $(npm --version)"

# Uzun bagimlilik yollari Windows'un 260 karakter sinirini asabiliyor.
git config --global core.longpaths true | Out-Null

# --- 2. Hedef klasor -------------------------------------------------------

Write-Step "Hedef klasor hazirlaniyor: $Path"

$driveRoot = [System.IO.Path]::GetPathRoot($Path)
if (-not (Test-Path $driveRoot)) {
    throw "$driveRoot surucusu bulunamadi. -Path ile mevcut bir surucu belirtin (ornek: -Path C:\Riftory)."
}

$gitDir = Join-Path $Path '.git'
if (Test-Path $gitDir) {
    Write-Ok 'Mevcut kopya bulundu, guncelleniyor.'
    Push-Location $Path
    try {
        git remote set-url origin $RepoUrl
        git fetch origin $Branch
        git checkout $Branch
        git pull --ff-only origin $Branch
    } finally {
        Pop-Location
    }
} else {
    if ((Test-Path $Path) -and (Get-ChildItem -Force $Path | Select-Object -First 1)) {
        throw "$Path zaten var ve bos degil. Bos bir klasor secin veya icerigini tasiyin."
    }
    Write-Ok "Depo klonlaniyor: $RepoUrl"
    git clone --branch $Branch $RepoUrl $Path
}

Set-Location $Path
Write-Ok "Aktif dal: $(git rev-parse --abbrev-ref HEAD)"

# --- 3. Bagimliliklar ------------------------------------------------------

Write-Step 'Bagimliliklar kuruluyor (npm ci)'

# install:ci Linux'a ozgu flock/timeout araclarini istiyor; Windows'ta dogrudan
# npm ci ayni package-lock.json'u kullanir.
npm ci
if ($LASTEXITCODE -ne 0) {
    throw "npm ci basarisiz oldu (cikis kodu $LASTEXITCODE)."
}
Write-Ok 'Bagimliliklar kuruldu.'

# --- 4. Dogrulama ----------------------------------------------------------

Write-Step 'Kurulum dogrulaniyor'

# doctor betigi yalnizca capraz platform komutlarini iceren dallarda bulunur.
$packageScripts = (Get-Content (Join-Path $Path 'package.json') -Raw | ConvertFrom-Json).scripts
if ($packageScripts.PSObject.Properties.Name -contains 'doctor') {
    npm run doctor
    if ($LASTEXITCODE -ne 0) {
        throw "Dogrulama basarisiz oldu (cikis kodu $LASTEXITCODE)."
    }
} else {
    Write-Warn "Bu dalda 'doctor' betigi yok; dogrulama atlandi."
}

# --- 5. Sonraki adimlar ----------------------------------------------------

Write-Host ''
Write-Host 'Kurulum tamamlandi.' -ForegroundColor Green
Write-Host ''
Write-Host "  Proje klasoru : $Path"
Write-Host ''
Write-Host '  Gelistirme sunucusu :  npm run dev:local     -> http://localhost:5173'
Write-Host '  Uretim derlemesi    :  npm run build:local'
Write-Host '  Testler             :  npm run test:local'
Write-Host '  Tip denetimi        :  npm run typecheck:local'
Write-Host '  Kaynak denetimi     :  npm run lint:local'
Write-Host ''
Write-Host '  Ayrintili rehber    :  docs/LOCAL_SETUP.md'
Write-Host ''

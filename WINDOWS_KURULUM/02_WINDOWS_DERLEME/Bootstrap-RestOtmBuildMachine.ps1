# REST_OTM Windows derleme makinesi - tek seferlik otomatik kurulum
# Bu script'i cift tikladiginda (Bootstrap-RestOtmBuildMachine.bat uzerinden)
# tum gerekli programlari otomatik kurar ve gerekli klasorleri/dosyalari hazirlar.

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Yonetici izni isteniyor, bir UAC penceresi acilacak..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

$ErrorActionPreference = 'Stop'

function Update-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " REST_OTM Windows derleme makinesi kuruluyor" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$packages = @(
    'Git.Git',
    'OpenJS.NodeJS.LTS',
    'Microsoft.PowerShell',
    'Rustlang.Rustup',
    'Microsoft.DotNet.SDK.8',
    'GitHub.cli'
)

foreach ($pkg in $packages) {
    Write-Host "`n>>> Kuruluyor: $pkg" -ForegroundColor Yellow
    winget install --id $pkg -e --source winget --silent --accept-package-agreements --accept-source-agreements
}

Write-Host "`n>>> Kuruluyor: Visual Studio Build Tools (buyuk indirme, sabirli ol)" -ForegroundColor Yellow
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --accept-package-agreements --accept-source-agreements --override "--add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --passive --wait"

Update-SessionPath

Write-Host "`n>>> Son ayarlar yapiliyor (corepack, rust, wix)" -ForegroundColor Yellow
corepack enable
rustup default stable-msvc
dotnet tool install --global wix

Update-SessionPath

Write-Host "`n>>> Klasorler hazirlaniyor" -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path C:\GuvenliGirdiler | Out-Null
New-Item -ItemType Directory -Force -Path C:\rest-otm-build | Out-Null

Write-Host "`n>>> Node.js resmi ZIP indiriliyor" -ForegroundColor Yellow
$index = Invoke-RestMethod https://nodejs.org/dist/index.json
$latest22 = $index | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1
$nodeVersion = $latest22.version
Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-x64.zip" -OutFile "C:\GuvenliGirdiler\node-$nodeVersion-win-x64.zip"
Write-Host "Indirildi: node-$nodeVersion-win-x64.zip" -ForegroundColor Green

Write-Host "`n>>> Kontrol" -ForegroundColor Yellow
git --version
node --version
pwsh --version
rustc --version
cargo --version
dotnet --version
wix --version
gh --version

Write-Host "`n=====================================================" -ForegroundColor Green
Write-Host " OTOMATIK KURULUM TAMAMLANDI" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "Elle yapman gereken 4 sey kaldi:"
Write-Host "1) gh auth login                       (GitHub'a giris yap)"
Write-Host "2) cd C:\rest-otm-build; gh repo clone umitcancinar/REST_OTM_LOCAL ."
Write-Host "3) PostgreSQL ZIP'ini indir: https://www.enterprisedb.com/download-postgresql-binaries -> C:\GuvenliGirdiler'e koy"
Write-Host "4) Self-signed sertifika + iki .pem dosyasi (Claude ile devam et)"
Write-Host ""
Read-Host "Kapatmak icin Enter'a bas"

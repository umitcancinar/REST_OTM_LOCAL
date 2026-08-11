[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SetupPath,

    [Parameter(Mandatory = $true)]
    [switch]$CleanWindowsVm,

    [Parameter(Mandatory = $true)]
    [switch]$RebootCompleted
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $IsWindows) { throw 'Kabul testi yalniz Windows uzerinde calisir.' }
if (-not $CleanWindowsVm) { throw 'Aday daha once REST_OTM kurulmamis temiz Windows VM uzerinde test edilmelidir.' }
if (-not $RebootCompleted) { throw 'Kurulumdan sonra Windows yeniden baslatilmadan kabul verilemez.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$setup = (Resolve-Path -LiteralPath $SetupPath -ErrorAction Stop).Path
if ([IO.Path]::GetFileName($setup) -notmatch '^RESTOTM-Setup-(\d+\.\d+\.\d+)-x64\.exe$') {
    throw 'Setup dosya adi canonical degil.'
}
$version = $Matches[1]
$signature = Get-AuthenticodeSignature -LiteralPath $setup
if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
    throw 'Setup Authenticode imzasi gecerli degil.'
}

& (Join-Path $repoRoot 'packaging\windows\scripts\Test-RestOtmInstallation.ps1')
if (-not $?) { throw 'Canonical kurulum testi basarisiz.' }

foreach ($endpoint in @(
    'http://127.0.0.1:4100/api/health',
    'http://127.0.0.1:8787/activate',
    'http://127.0.0.1:8787/garson'
)) {
    $response = Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0 -ErrorAction Stop
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
        throw "Yerel endpoint sagliksiz: $endpoint status=$($response.StatusCode)"
    }
}

$customerRoot = Join-Path $repoRoot 'WINDOWS_KURULUM\01_MUSTERIYE_VERILECEK'
$destination = Join-Path $customerRoot ([IO.Path]::GetFileName($setup))
if (Test-Path -LiteralPath $destination) { throw "Musteri dosyasi zaten var; uzerine yazilmadi: $destination" }
Copy-Item -LiteralPath $setup -Destination $destination

$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($destination))" | Set-Content -LiteralPath "$destination.sha256" -Encoding ASCII
$reportPath = Join-Path $customerRoot ("KABUL-RAPORU-$Version.json")
[ordered]@{
    schemaVersion = 1
    productVersion = $version
    setupFile = [IO.Path]::GetFileName($destination)
    sha256 = $hash
    authenticodeStatus = [string]$signature.Status
    signer = [string]$signature.SignerCertificate.Subject
    cleanWindowsVmConfirmed = $true
    rebootCompleted = $true
    os = [Environment]::OSVersion.VersionString
    acceptedAtUtc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding UTF8

$runtimeConfig = Get-Content -LiteralPath (Join-Path $env:ProgramData 'RESTOTM\config\runtime.json') -Raw | ConvertFrom-Json
$apiChild = $runtimeConfig.children | Where-Object name -eq 'local-api' | Select-Object -First 1
$hostname = [string]$apiChild.environment.LOCAL_LAN_HOSTNAME
$lanAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction Stop |
    Where-Object { -not $_.IPAddress.StartsWith('127.') -and -not $_.IPAddress.StartsWith('169.254.') } |
    Select-Object -ExpandProperty IPAddress -Unique)
$networkGuide = @(
    'REST_OTM YEREL AG GIRIS ADRESLERI'
    '================================'
    ''
    "Ana bilgisayar: http://127.0.0.1:8787"
    "Yonetim (ayni Wi-Fi): http://$hostname`:8787"
    "Garson (ayni Wi-Fi): http://$hostname`:8787/garson"
    "Menu (ayni Wi-Fi): http://$hostname`:8787/menu"
    ''
    'IP yedek adresleri:'
    ($lanAddresses | ForEach-Object { "- http://$_`:8787  | Garson: http://$_`:8787/garson" })
    ''
    'Telefon/tablet ana bilgisayarla ayni Wi-Fi aginda olmalidir.'
) -join [Environment]::NewLine
$networkGuide | Set-Content -LiteralPath (Join-Path $customerRoot 'YEREL-AG-GIRIS-ADRESLERI.txt') -Encoding UTF8

Write-Host "MUSTERI TESLIMI HAZIR: $customerRoot" -ForegroundColor Green
Write-Host 'Musteriye yalniz 01_MUSTERIYE_VERILECEK klasorunu verin.' -ForegroundColor Green

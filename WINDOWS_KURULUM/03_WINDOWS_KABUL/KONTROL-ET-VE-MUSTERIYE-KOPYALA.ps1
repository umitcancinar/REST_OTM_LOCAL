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

$candidateSupportTools = foreach ($supportToolName in @(
    'Get-RestOtmAccessAddresses.ps1',
    'Get-RestOtmDiagnosticBundle.ps1',
    'Repair-RestOtmHost.ps1'
)) {
    $candidateToolPath = Join-Path (Split-Path -Parent $setup) $supportToolName
    if (-not (Test-Path -LiteralPath $candidateToolPath -PathType Leaf)) {
        throw "Imzali destek araci aday klasorunde yok: $candidateToolPath"
    }
    $toolSignature = Get-AuthenticodeSignature -LiteralPath $candidateToolPath
    if ($toolSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
        $toolSignature.SignerCertificate.Thumbprint -ne $signature.SignerCertificate.Thumbprint) {
        throw "Destek araci setup ile ayni yayinci tarafindan imzalanmamis: $candidateToolPath"
    }
    [pscustomobject]@{ Name = $supportToolName; Source = $candidateToolPath }
}

& (Join-Path $repoRoot 'packaging\windows\scripts\Test-RestOtmInstallation.ps1')
if (-not $?) { throw 'Canonical kurulum testi basarisiz.' }

$repairTool = $candidateSupportTools | Where-Object Name -eq 'Repair-RestOtmHost.ps1' | Select-Object -First 1
$repairToolPath = [string]$repairTool.Source
& $repairToolPath
if (-not $?) { throw 'Imzali guvenli onarim kabul testi basarisiz.' }
& (Join-Path $repoRoot 'packaging\windows\scripts\Test-RestOtmInstallation.ps1')
if (-not $?) { throw 'Onarim sonrasi canonical kurulum testi basarisiz.' }

$addressTool = $candidateSupportTools | Where-Object Name -eq 'Get-RestOtmAccessAddresses.ps1' | Select-Object -First 1
$addressToolPath = [string]$addressTool.Source
& $addressToolPath
if (-not $?) { throw 'Kurulu makine adres araci kabul testi basarisiz.' }

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

$verifiedSupportTools = foreach ($candidateTool in $candidateSupportTools) {
    $supportDestination = Join-Path $customerRoot $candidateTool.Name
    if (Test-Path -LiteralPath $supportDestination) {
        throw "Musteri destek araci zaten var; uzerine yazilmadi: $supportDestination"
    }
    [pscustomobject]@{ Source = $candidateTool.Source; Destination = $supportDestination }
}

# Butun imzalar ve hedefler dogrulanmadan musteri klasorune tek dosya bile
# kopyalanmaz. Boylece yarim/karisik bir teslim paketi olusmaz.
Copy-Item -LiteralPath $setup -Destination $destination
foreach ($tool in $verifiedSupportTools) {
    Copy-Item -LiteralPath $tool.Source -Destination $tool.Destination
}

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

Write-Host "MUSTERI TESLIMI HAZIR: $customerRoot" -ForegroundColor Green
Write-Host 'Musteriye yalniz 01_MUSTERIYE_VERILECEK klasorunu verin.' -ForegroundColor Green

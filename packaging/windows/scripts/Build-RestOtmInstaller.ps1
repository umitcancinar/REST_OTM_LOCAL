[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PayloadRoot,

    [Parameter(Mandatory = $true)]
    [string]$CertificateThumbprint,

    [Parameter(Mandatory = $true)]
    [string]$LicenseServerUrl,

    [string]$TimestampUrl = 'https://timestamp.digicert.com',
    [string]$OutputRoot = (Join-Path (Split-Path -Path $PSScriptRoot -Parent) 'build')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'RestOtm.Windows.Common.psm1') -Force
Assert-RestOtmWindows

$payload = Get-RestOtmFullPath -Path $PayloadRoot
$manifestPath = Join-Path $payload 'artifact-manifest.json'
$contractPath = Join-Path $payload 'installer-contract.json'

$manifest = Assert-RestOtmArtifactManifest `
    -ArtifactRoot $payload `
    -ManifestPath $manifestPath `
    -RequireAuthenticode

$licenseUri = [Uri]$LicenseServerUrl
if ($licenseUri.Scheme -ne 'https' -or
    -not [string]::IsNullOrWhiteSpace($licenseUri.UserInfo) -or
    -not [string]::IsNullOrWhiteSpace($licenseUri.Query) -or
    -not [string]::IsNullOrWhiteSpace($licenseUri.Fragment)) {
    throw 'Lisans control-plane adresi query/credential icermeyen mutlak HTTPS URL olmali.'
}

if ([string]$manifest.productVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw 'MSI productVersion tam olarak major.minor.patch biciminde olmalidir.'
}
$contract = Assert-RestOtmInstallerContract `
    -ContractPath $contractPath `
    -RequireProductionReady
Assert-RestOtmArtifactContractAlignment -Manifest $manifest -Contract $contract

$bootstrapExecutable = Join-Path $payload $contract.bootstrap_executable_relative_path
if (-not (Test-Path -LiteralPath $bootstrapExecutable -PathType Leaf)) {
    throw 'Native installer bootstrap executable canonical artifact yolunda bulunamadi.'
}
& $bootstrapExecutable $contract.native_bootstrap.verification_command '--contract' $contractPath
if ($LASTEXITCODE -ne 0) {
    throw "Native bootstrap production contract capability probe basarisiz (exit=$LASTEXITCODE)."
}

$forbiddenFiles = Get-ChildItem -LiteralPath $payload -Recurse -File |
    Where-Object {
        $_.Extension -in @('.pdb', '.map', '.ts', '.tsx') -or
        $_.Name -match '^\.env($|\.)'
    }
if ($forbiddenFiles) {
    throw ('Release payload kaynak, source-map veya env dosyasi iceriyor: ' + (($forbiddenFiles.FullName) -join ', '))
}

$wix = Get-Command wix.exe -ErrorAction SilentlyContinue
if ($null -eq $wix) { $wix = Get-Command wix -ErrorAction SilentlyContinue }
if ($null -eq $wix) {
    throw 'WiX Toolset v4 CLI bulunamadi. Global/CI arac zinciri sabitlenmeden installer uretilmez.'
}
$wixVersionText = (& $wix.Source --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $wixVersionText -notmatch '^4\.') {
    throw "WiX Toolset v4 gerekiyor. Bulunan: $wixVersionText"
}

$signTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if ($null -eq $signTool) {
    throw 'Windows SDK signtool.exe bulunamadi; imzasiz MSI/EXE uretilmez.'
}

$timestampUri = [Uri]$TimestampUrl
if ($timestampUri.Scheme -ne 'https') {
    throw 'Timestamp sunucusu HTTPS olmali.'
}

$thumbprint = $CertificateThumbprint.Replace(' ', '').ToUpperInvariant()
$certificate = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My |
    Where-Object Thumbprint -eq $thumbprint |
    Select-Object -First 1
if ($null -eq $certificate -or -not $certificate.HasPrivateKey -or $certificate.NotAfter -le [DateTime]::UtcNow) {
    throw 'Gecerli private key iceren kod imzalama sertifikasi bulunamadi.'
}
$codeSigningEku = $certificate.EnhancedKeyUsageList |
    Where-Object ObjectId -eq '1.3.6.1.5.5.7.3.3'
if (-not $codeSigningEku) {
    throw 'Sertifika Code Signing EKU (1.3.6.1.5.5.7.3.3) icermiyor.'
}

$versionOutput = Join-Path (Get-RestOtmFullPath -Path $OutputRoot) ([string]$manifest.productVersion)
if (Test-Path -LiteralPath $versionOutput) {
    throw "Ayni surum cikti klasoru zaten var; uzerine yazilmadi: $versionOutput"
}
New-Item -ItemType Directory -Path $versionOutput | Out-Null

$wixRoot = Join-Path (Split-Path -Path $PSScriptRoot -Parent) 'wix'
$msiPath = Join-Path $versionOutput ("RESTOTM-Runtime-$($manifest.productVersion)-x64.msi")
$bundlePath = Join-Path $versionOutput ("RESTOTM-Setup-$($manifest.productVersion)-x64.exe")
$productSource = Join-Path $wixRoot 'Product.wxs'
$bundleSource = Join-Path $wixRoot 'Bundle.wxs'

& $wix.Source build $productSource `
    -arch x64 `
    -ext WixToolset.Util.wixext `
    -ext WixToolset.Firewall.wixext `
    -d "PayloadDir=$payload" `
    -d "ProductVersion=$($manifest.productVersion)" `
    -d "LicenseServerUrl=$($licenseUri.AbsoluteUri.TrimEnd('/'))" `
    -o $msiPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $msiPath -PathType Leaf)) {
    throw 'WiX MSI derlemesi basarisiz.'
}

& $signTool.Source sign /sha1 $thumbprint /fd SHA256 /tr $timestampUri.AbsoluteUri /td SHA256 $msiPath
if ($LASTEXITCODE -ne 0) { throw 'MSI Authenticode imzalanamadi.' }

& $wix.Source build $bundleSource `
    -arch x64 `
    -ext WixToolset.BootstrapperApplications.wixext `
    -d "MsiPath=$msiPath" `
    -d "ProductVersion=$($manifest.productVersion)" `
    -o $bundlePath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
    throw 'WiX Burn bundle derlemesi basarisiz.'
}

& $signTool.Source sign /sha1 $thumbprint /fd SHA256 /tr $timestampUri.AbsoluteUri /td SHA256 $bundlePath
if ($LASTEXITCODE -ne 0) { throw 'Burn bundle Authenticode imzalanamadi.' }

foreach ($signedOutput in @($msiPath, $bundlePath)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $signedOutput
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
        throw "Installer imzasi build sonunda dogrulanamadi: $signedOutput"
    }
}

[pscustomobject]@{
    Passed = $true
    ProductVersion = $manifest.productVersion
    Msi = $msiPath
    Bundle = $bundlePath
    CertificateThumbprint = $thumbprint
}

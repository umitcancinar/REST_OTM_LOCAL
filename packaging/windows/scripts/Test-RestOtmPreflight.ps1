[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,

    [Parameter(Mandatory = $true)]
    [string]$ArtifactManifestPath,

    [string]$InstallRoot = (Join-Path $env:ProgramFiles 'RESTOTM'),
    [string]$ProgramDataRoot = (Join-Path $env:ProgramData 'RESTOTM'),
    [string]$BackupRoot = (Join-Path $env:ProgramData 'RESTOTM\backups'),
    [string]$ExternalBackupRoot,

    [Parameter(Mandatory = $true)]
    [string]$LicenseServerUrl,
    [int]$MinimumFreeSpaceGb = 10,
    [switch]$SkipCloudConnectivityCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'RestOtm.Windows.Common.psm1') -Force

Assert-RestOtmAdministrator

if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'RESTOTM yalnizca 64-bit Windows 11 destekler.'
}
if ([Environment]::OSVersion.Version.Build -lt 22000) {
    throw "Windows 11 (build 22000+) gerekiyor. Bulunan build: $([Environment]::OSVersion.Version.Build)"
}

$normalizedInstallRoot = Assert-RestOtmAllowedPath -Path $InstallRoot -AllowedRoots @($env:ProgramFiles)
$normalizedProgramDataRoot = Assert-RestOtmAllowedPath -Path $ProgramDataRoot -AllowedRoots @($env:ProgramData)
$normalizedBackupRoot = Assert-RestOtmAllowedPath -Path $BackupRoot -AllowedRoots @($env:ProgramData)

$dataRoot = Join-Path $normalizedProgramDataRoot 'data'
if ($normalizedBackupRoot.StartsWith(($dataRoot + '\'), [StringComparison]::OrdinalIgnoreCase) -or
    $normalizedBackupRoot.Equals($dataRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Yedek klasoru canli veri klasorunun icinde olamaz.'
}

if (-not [string]::IsNullOrWhiteSpace($ExternalBackupRoot)) {
    $externalFullPath = Get-RestOtmFullPath -Path $ExternalBackupRoot
    $externalDriveRoot = [IO.Path]::GetPathRoot($externalFullPath)
    Assert-RestOtmAllowedPath -Path $externalFullPath -AllowedRoots @($externalDriveRoot) | Out-Null
    if ($externalFullPath.StartsWith(($normalizedProgramDataRoot + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Harici yedek hedefi ProgramData disinda olmalidir.'
    }
}

$ports = [ordered]@{
    PostgreSql = 55432
    LocalApi = 4100
    AdminUi = 3100
    WaiterUi = 3200
    PrintAgent = 4300
    LanGateway = 8787
}
$duplicates = $ports.Values | Group-Object | Where-Object Count -gt 1
if ($duplicates) {
    throw 'Runtime portlari benzersiz olmali.'
}
foreach ($entry in $ports.GetEnumerator()) {
    Assert-RestOtmPort -Port $entry.Value -Name $entry.Key
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $entry.Value -ErrorAction SilentlyContinue
    if ($listeners) {
        throw "$($entry.Key) portu zaten kullanimda: $($entry.Value)"
    }
}

$systemDrive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($normalizedProgramDataRoot).TrimEnd('\').TrimEnd(':'))
if ($systemDrive.Free -lt ($MinimumFreeSpaceGb * 1GB)) {
    throw "En az $MinimumFreeSpaceGb GB bos alan gerekiyor. Bos alan: $([Math]::Round($systemDrive.Free / 1GB, 2)) GB"
}

$programDataVolume = Get-Volume -DriveLetter ([IO.Path]::GetPathRoot($normalizedProgramDataRoot).Substring(0, 1))
if ($programDataVolume.FileSystem -ne 'NTFS') {
    throw "Canli PostgreSQL verisi NTFS uzerinde olmali. Bulunan: $($programDataVolume.FileSystem)"
}

$privateProfile = Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Private'
if (-not $privateProfile) {
    throw 'Garson LAN erisimi icin en az bir etkin ag profili Private olmali. Public profilde kural acilmaz.'
}

$licenseUri = [Uri]$LicenseServerUrl
if ($licenseUri.Scheme -ne 'https' -or -not [string]::IsNullOrWhiteSpace($licenseUri.UserInfo)) {
    throw 'Lisans sunucusu mutlak HTTPS URL olmali ve URL icinde kimlik bilgisi bulunmamalidir.'
}

if (-not $SkipCloudConnectivityCheck) {
    try {
        $probeUrl = [Uri]::new($licenseUri, '/health')
        Invoke-WebRequest -Uri $probeUrl -Method Get -UseBasicParsing -TimeoutSec 15 | Out-Null
    }
    catch {
        throw "Lisans sunucusu erisim kontrolu basarisiz: $($_.Exception.Message)"
    }
}

$manifest = Assert-RestOtmArtifactManifest `
    -ArtifactRoot $ArtifactRoot `
    -ManifestPath $ArtifactManifestPath `
    -RequireAuthenticode

$artifact = Get-RestOtmFullPath -Path $ArtifactRoot
$contractPath = Join-Path $artifact 'installer-contract.json'
$contract = Assert-RestOtmInstallerContract `
    -ContractPath $contractPath `
    -RequireProductionReady
Assert-RestOtmArtifactContractAlignment -Manifest $manifest -Contract $contract

$bootstrapExecutable = Join-Path $artifact $contract.bootstrap_executable_relative_path
if (-not (Test-Path -LiteralPath $bootstrapExecutable -PathType Leaf)) {
    throw 'Native installer bootstrap executable canonical artifact yolunda bulunamadi.'
}
& $bootstrapExecutable $contract.native_bootstrap.verification_command '--contract' $contractPath
if ($LASTEXITCODE -ne 0) {
    throw "Native bootstrap production contract capability probe basarisiz (exit=$LASTEXITCODE)."
}

[pscustomobject]@{
    Passed = $true
    ProductVersion = $manifest.productVersion
    InstallRoot = $normalizedInstallRoot
    ProgramDataRoot = $normalizedProgramDataRoot
    BackupRoot = $normalizedBackupRoot
    ExternalBackupRoot = $ExternalBackupRoot
    Ports = $ports
    CheckedAtUtc = [DateTime]::UtcNow.ToString('o')
}

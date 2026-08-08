[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstalledArtifactManifestPath,

    [string]$InstallRoot = (Join-Path $env:ProgramFiles 'RESTOTM'),
    [string]$ProgramDataRoot = (Join-Path $env:ProgramData 'RESTOTM'),
    [string]$BackupRoot = (Join-Path $env:ProgramData 'RESTOTM\backups'),
    [string]$ExternalBackupRoot,

    [Parameter(Mandatory = $true)]
    [string]$LicenseServerUrl,
    [switch]$SkipCloudConnectivityCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'RestOtm.Windows.Common.psm1') -Force

Assert-RestOtmAdministrator
$install = Assert-RestOtmAllowedPath -Path $InstallRoot -AllowedRoots @($env:ProgramFiles)
$runtimeExecutable = Join-Path $install 'bin\restotm-runtime-service.exe'

if (-not (Test-Path -LiteralPath $runtimeExecutable -PathType Leaf)) {
    throw "Runtime service binary eksik; kaynak veya sahte artifact ile kurulum yapilmaz: $runtimeExecutable"
}

Assert-RestOtmArtifactManifest `
    -ArtifactRoot $install `
    -ManifestPath $InstalledArtifactManifestPath `
    -RequireAuthenticode | Out-Null

$runtimeSignature = Get-AuthenticodeSignature -LiteralPath $runtimeExecutable
if ($runtimeSignature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
    throw "Runtime service Authenticode imzasi gecersiz: $($runtimeSignature.Status)"
}

& (Join-Path $PSScriptRoot 'Test-RestOtmPreflight.ps1') `
    -ArtifactRoot $install `
    -ArtifactManifestPath $InstalledArtifactManifestPath `
    -InstallRoot $install `
    -ProgramDataRoot $ProgramDataRoot `
    -BackupRoot $BackupRoot `
    -ExternalBackupRoot $ExternalBackupRoot `
    -LicenseServerUrl $LicenseServerUrl `
    -SkipCloudConnectivityCheck:$SkipCloudConnectivityCheck | Out-Null

if ($PSCmdlet.ShouldProcess($ProgramDataRoot, 'RESTOTM host yapilandirmasini uygula')) {
    & (Join-Path $PSScriptRoot 'New-RestOtmRuntimeConfiguration.ps1') `
        -InstallRoot $install `
        -ProgramDataRoot $ProgramDataRoot `
        -BackupRoot $BackupRoot `
        -ExternalBackupRoot $ExternalBackupRoot `
        -LicenseServerUrl $LicenseServerUrl | Out-Null

    Set-RestOtmDirectoryAcl -Path $install -ReadOnlyForUsers

    $service = Get-Service -Name 'RESTOTMRuntime' -ErrorAction SilentlyContinue
    if ($null -eq $service) {
        throw 'RESTOTMRuntime Windows servisi MSI tarafindan kaydedilmemis. Elle veya sahte servis olusturulmaz.'
    }

    $serviceDetails = Get-CimInstance Win32_Service -Filter "Name='RESTOTMRuntime'"
    if ($null -eq $serviceDetails -or
        -not ([string]$serviceDetails.PathName).StartsWith(('"' + $runtimeExecutable + '"'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'RESTOTMRuntime servis binary yolu beklenen Program Files hedefiyle eslesmiyor.'
    }

    & sc.exe config RESTOTMRuntime 'start=' 'delayed-auto' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Servis delayed-auto yapilandirilamadi.' }
    & sc.exe failure RESTOTMRuntime 'reset=' '86400' 'actions=' 'restart/15000/restart/30000/restart/60000' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Servis failure recovery yapilandirilamadi.' }
    & sc.exe failureflag RESTOTMRuntime 1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Servis non-crash failure recovery etkinlestirilemedi.' }

    $firewallName = 'RESTOTM LAN Gateway (Private LocalSubnet)'
    $existingRule = Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
    if ($null -eq $existingRule) {
        New-NetFirewallRule `
            -DisplayName $firewallName `
            -Group 'RESTOTM' `
            -Direction Inbound `
            -Action Allow `
            -Enabled True `
            -Profile Private `
            -Program $runtimeExecutable `
            -Protocol TCP `
            -LocalPort 8787 `
            -RemoteAddress LocalSubnet | Out-Null
    }
    else {
        $portFilter = $existingRule | Get-NetFirewallPortFilter
        $addressFilter = $existingRule | Get-NetFirewallAddressFilter
        $applicationFilter = $existingRule | Get-NetFirewallApplicationFilter
        $isExpected = $existingRule.Enabled -eq 'True' -and
            $existingRule.Direction -eq 'Inbound' -and
            $existingRule.Action -eq 'Allow' -and
            ([string]$existingRule.Profile) -eq 'Private' -and
            $portFilter.Protocol -eq 'TCP' -and
            ([string]$portFilter.LocalPort) -eq '8787' -and
            ([string]$addressFilter.RemoteAddress) -eq 'LocalSubnet' -and
            ([string]$applicationFilter.Program).Equals($runtimeExecutable, [StringComparison]::OrdinalIgnoreCase)
        if (-not $isExpected) {
            throw 'Mevcut RESTOTM firewall kurali beklenen dar kapsamla eslesmiyor; MSI Repair uygulanmali.'
        }
    }

    $unexpectedRules = Get-NetFirewallRule -Group 'RESTOTM' -ErrorAction SilentlyContinue |
        Where-Object DisplayName -ne $firewallName
    if ($unexpectedRules) {
        throw 'RESTOTM grubunda beklenmeyen firewall kurali bulundu. PostgreSQL ve ic servis portlari LAN acilamaz.'
    }

    if ((Get-Service -Name 'RESTOTMRuntime').Status -ne 'Running') {
        Start-Service -Name 'RESTOTMRuntime'
    }
}

& (Join-Path $PSScriptRoot 'Test-RestOtmInstallation.ps1') `
    -InstallRoot $install `
    -ProgramDataRoot $ProgramDataRoot

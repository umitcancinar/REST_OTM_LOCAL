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

$installedManifest = Assert-RestOtmArtifactManifest `
    -ArtifactRoot $install `
    -ManifestPath $InstalledArtifactManifestPath `
    -RequireAuthenticode

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
        -LicenseServerUrl $LicenseServerUrl `
        -ProductVersion ([string]$installedManifest.productVersion) | Out-Null

    # Browser clients consume the product over the LAN gateway; interactive
    # Windows users never need direct read access to the signed payload.
    Set-RestOtmDirectoryAcl -Path $install

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
    & sc.exe sidtype RESTOTMRuntime restricted | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Servis restricted SID modu uygulanamadi.' }
    & sc.exe preshutdown RESTOTMRuntime 120000 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Servis guvenli PostgreSQL kapanis suresi uygulanamadi.' }

    $firewallContracts = @(
        [ordered]@{
            Name = 'RESTOTM LAN Gateway (Private LocalSubnet)'
            Direction = 'Inbound'
            Protocol = 'TCP'
            LocalPort = '8787'
            RemotePort = 'Any'
        },
        [ordered]@{
            Name = 'RESTOTM mDNS Inbound (Private LocalSubnet)'
            Direction = 'Inbound'
            Protocol = 'UDP'
            LocalPort = '5353'
            RemotePort = '5353'
        },
        [ordered]@{
            Name = 'RESTOTM mDNS Outbound (Private LocalSubnet)'
            Direction = 'Outbound'
            Protocol = 'UDP'
            LocalPort = '5353'
            RemotePort = '5353'
        }
    )
    foreach ($contract in $firewallContracts) {
        $existingRule = Get-NetFirewallRule -DisplayName $contract.Name -ErrorAction SilentlyContinue
        if ($null -eq $existingRule) {
            New-NetFirewallRule `
                -DisplayName $contract.Name `
                -Group 'RESTOTM' `
                -Direction $contract.Direction `
                -Action Allow `
                -Enabled True `
                -Profile Private `
                -Protocol $contract.Protocol `
                -LocalPort $contract.LocalPort `
                -RemotePort $contract.RemotePort `
                -RemoteAddress LocalSubnet | Out-Null
        }
        else {
            $portFilter = $existingRule | Get-NetFirewallPortFilter
            $addressFilter = $existingRule | Get-NetFirewallAddressFilter
            $isExpected = $existingRule.Enabled -eq 'True' -and
                ([string]$existingRule.Direction) -eq $contract.Direction -and
                $existingRule.Action -eq 'Allow' -and
                ([string]$existingRule.Profile) -eq 'Private' -and
                ([string]$portFilter.Protocol) -eq $contract.Protocol -and
                ([string]$portFilter.LocalPort) -eq $contract.LocalPort -and
                ([string]$portFilter.RemotePort) -eq $contract.RemotePort -and
                ([string]$addressFilter.RemoteAddress) -eq 'LocalSubnet'
            if (-not $isExpected) {
                throw "Mevcut RESTOTM firewall kurali dar contract ile eslesmiyor: $($contract.Name)"
            }
        }
    }

    $allowedFirewallNames = @($firewallContracts | ForEach-Object { $_.Name })
    $unexpectedRules = Get-NetFirewallRule -Group 'RESTOTM' -ErrorAction SilentlyContinue |
        Where-Object DisplayName -notin $allowedFirewallNames
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

[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:ProgramFiles 'RESTOTM'),
    [string]$ProgramDataRoot = (Join-Path $env:ProgramData 'RESTOTM')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'RestOtm.Windows.Common.psm1') -Force
Assert-RestOtmAdministrator

$install = Assert-RestOtmAllowedPath -Path $InstallRoot -AllowedRoots @($env:ProgramFiles)
$programData = Assert-RestOtmAllowedPath -Path $ProgramDataRoot -AllowedRoots @($env:ProgramData)
$runtimeConfigPath = Join-Path $programData 'config\runtime.json'
$secretConfigPath = Join-Path $programData 'config\secrets.json'

if (-not (Test-Path -LiteralPath $runtimeConfigPath -PathType Leaf)) {
    throw "Runtime config bulunamadi: $runtimeConfigPath"
}
if (-not (Test-Path -LiteralPath $secretConfigPath -PathType Leaf)) {
    throw "Secret config bulunamadi: $secretConfigPath"
}

$runtimeConfig = Get-Content -LiteralPath $runtimeConfigPath -Raw | ConvertFrom-Json
$secretConfig = Get-Content -LiteralPath $secretConfigPath -Raw | ConvertFrom-Json
if ($runtimeConfig.schemaVersion -ne 1 -or $runtimeConfig.runtimeMode -ne 'local') {
    throw 'Runtime config schema veya runtimeMode gecersiz.'
}
if ($runtimeConfig.network.postgres.host -ne '127.0.0.1' -or $runtimeConfig.network.postgres.port -ne 55432) {
    throw 'PostgreSQL yalnizca 127.0.0.1:55432 olmali.'
}
if ($runtimeConfig.network.gateway.host -ne '0.0.0.0' -or $runtimeConfig.network.gateway.port -ne 8787) {
    throw 'LAN gateway 0.0.0.0:8787 yapilandirmasi eksik.'
}

$secretProperties = @(
    'databasePassword',
    'internalApiToken',
    'printAgentSecret',
    'jwtAccessSecret',
    'jwtRefreshSecret',
    'backupEncryptionKey',
    'gatewayControlSecret'
)
foreach ($propertyName in $secretProperties) {
    $value = [string]$secretConfig.$propertyName
    if (-not $value.StartsWith('dpapi-local-machine-v1:', [StringComparison]::Ordinal)) {
        throw "Secret DPAPI ile korunmuyor: $propertyName"
    }
}

if ([string]$runtimeConfig.paths.backups -eq [string]$runtimeConfig.paths.postgresData -or
    ([string]$runtimeConfig.paths.backups).StartsWith(([string]$runtimeConfig.paths.postgresData + '\'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Yedek yolu canli PostgreSQL veri yolundan ayrilmamis.'
}

$service = Get-CimInstance Win32_Service -Filter "Name='RESTOTMRuntime'"
if ($null -eq $service -or $service.StartMode -ne 'Auto' -or $service.State -ne 'Running') {
    throw 'RESTOTMRuntime servisi calisir ve otomatik baslar durumda degil.'
}
$delayedAutoStart = Get-ItemPropertyValue `
    -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\RESTOTMRuntime' `
    -Name 'DelayedAutoStart' `
    -ErrorAction Stop
if ($delayedAutoStart -ne 1) {
    throw 'RESTOTMRuntime delayed auto start etkin degil.'
}

$recovery = (& sc.exe qfailure RESTOTMRuntime | Out-String)
if ($LASTEXITCODE -ne 0 -or $recovery -notmatch 'RESTART') {
    throw 'RESTOTMRuntime recovery/restart politikasi dogrulanamadi.'
}

$internalPorts = @(55432, 4100, 3100, 3200, 4300)
foreach ($port in $internalPorts) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        if (@('127.0.0.1', '::1') -notcontains [string]$listener.LocalAddress) {
            throw "Ic servis portu LAN'a acik: $($listener.LocalAddress):$port"
        }
    }
}

$gatewayListeners = Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue
if (-not $gatewayListeners) {
    throw 'LAN gateway 8787 portunda dinlemiyor.'
}

$firewallName = 'RESTOTM LAN Gateway (Private LocalSubnet)'
$firewallRule = Get-NetFirewallRule -DisplayName $firewallName -ErrorAction Stop
$addressFilter = $firewallRule | Get-NetFirewallAddressFilter
$portFilter = $firewallRule | Get-NetFirewallPortFilter
if (([string]$firewallRule.Profile) -ne 'Private' -or
    ([string]$addressFilter.RemoteAddress) -ne 'LocalSubnet' -or
    ([string]$portFilter.LocalPort) -ne '8787') {
    throw 'Firewall yalnizca Private + LocalSubnet + TCP/8787 olmali.'
}

[pscustomobject]@{
    Passed = $true
    Service = $service.Name
    ServiceState = $service.State
    Gateway = 'http://<LAN-IP>:8787'
    InstallRoot = $install
    ProgramDataRoot = $programData
    CheckedAtUtc = [DateTime]::UtcNow.ToString('o')
}

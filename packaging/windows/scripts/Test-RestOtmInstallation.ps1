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
$bootstrapReceiptPath = Join-Path $programData 'config\bootstrap-receipt.json'

foreach ($requiredFile in @($runtimeConfigPath, $secretConfigPath, $bootstrapReceiptPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Canonical bootstrap dosyasi bulunamadi: $requiredFile"
    }
}

$runtimeConfig = Get-Content -LiteralPath $runtimeConfigPath -Raw | ConvertFrom-Json
$secretConfig = Get-Content -LiteralPath $secretConfigPath -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath $bootstrapReceiptPath -Raw | ConvertFrom-Json

if ($runtimeConfig.schema_version -ne 1 -or
    [string]::IsNullOrWhiteSpace([string]$runtimeConfig.installation_id) -or
    $runtimeConfig.install_root -ne $install -or
    $runtimeConfig.program_data_root -ne $programData -or
    $runtimeConfig.secret_store -ne $secretConfigPath -or
    $runtimeConfig.bootstrap_receipt -ne $bootstrapReceiptPath) {
    throw 'Runtime config canonical path/installation contract ile uyusmuyor.'
}

$expectedEndpoints = [ordered]@{
    postgres = @('127.0.0.1', 55432)
    api = @('127.0.0.1', 4100)
    admin = @('127.0.0.1', 3100)
    waiter = @('127.0.0.1', 3200)
    print_agent = @('127.0.0.1', 4300)
}
foreach ($entry in $expectedEndpoints.GetEnumerator()) {
    $endpoint = $runtimeConfig.network.PSObject.Properties[[string]$entry.Key].Value
    if ($null -eq $endpoint -or $endpoint.host -ne $entry.Value[0] -or $endpoint.port -ne $entry.Value[1]) {
        throw "Canonical loopback endpoint gecersiz: $($entry.Key)"
    }
}
if ($runtimeConfig.network.gateway.host -ne '0.0.0.0' -or
    $runtimeConfig.network.gateway.port -ne 8787 -or
    $runtimeConfig.network.gateway.firewall_profile -ne 'Private' -or
    $runtimeConfig.network.gateway.remote_scope -ne 'LocalSubnet') {
    throw 'LAN gateway canonical 0.0.0.0:8787 Private/LocalSubnet contract ile uyusmuyor.'
}

$expectedChildren = [ordered]@{
    postgres = @()
    'local-api' = @('postgres')
    'admin-ui' = @('local-api')
    'waiter-ui' = @('local-api')
    'print-agent' = @('local-api')
    'lan-gateway' = @('local-api', 'admin-ui', 'waiter-ui')
}
if ($runtimeConfig.children.Count -ne $expectedChildren.Count) {
    throw 'Canonical child process sayisi gecersiz.'
}
$childIndex = 0
foreach ($entry in $expectedChildren.GetEnumerator()) {
    $child = $runtimeConfig.children[$childIndex]
    if ($child.name -ne $entry.Key -or
        ($child.depends_on | ConvertTo-Json -Compress) -ne ($entry.Value | ConvertTo-Json -Compress) -or
        -not ([string]$child.executable).StartsWith(($install + '\'), [StringComparison]::OrdinalIgnoreCase) -or
        -not ([string]$child.working_directory).StartsWith(($install + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Canonical child/dependency/path contract gecersiz: $($entry.Key)"
    }
    $childIndex++
}

$apiChild = $runtimeConfig.children | Where-Object name -eq 'local-api' | Select-Object -First 1
$postgresChild = $runtimeConfig.children | Where-Object name -eq 'postgres' | Select-Object -First 1
if ($apiChild.environment.BIND_HOST -ne '127.0.0.1' -or
    $apiChild.environment.PORT -ne '4100' -or
    $apiChild.file_environment.LOCAL_LICENSE_PUBLIC_KEY -ne (Join-Path $install 'config\license-public-key.pem') -or
    $apiChild.secret_environment.DATABASE_URL -ne 'databaseUrl' -or
    $apiChild.shutdown.type -ne 'http' -or
    $apiChild.shutdown.token_secret -ne 'internalApiToken') {
    throw 'Local API canonical env/file/secret/shutdown contract gecersiz.'
}
$postgresData = [string]$postgresChild.arguments[1]
$backupPath = [string]$apiChild.environment.LOCAL_BACKUP_DIR
if ($backupPath.Equals($postgresData, [StringComparison]::OrdinalIgnoreCase) -or
    $backupPath.StartsWith(($postgresData + '\'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Yedek yolu canli PostgreSQL veri yolundan ayrilmamis.'
}

if ($secretConfig.schema_version -ne 1 -or
    $secretConfig.protection -ne 'dpapi-local-machine-v1' -or
    $null -eq $secretConfig.values) {
    throw 'Canonical secret store envelope gecersiz.'
}
$secretProperties = @(
    'databaseUrl',
    'internalApiToken',
    'printAgentSecret',
    'jwtAccessSecret',
    'jwtRefreshSecret',
    'backupEncryptionKey',
    'gatewayControlSecret'
)
foreach ($propertyName in $secretProperties) {
    $property = $secretConfig.values.PSObject.Properties[$propertyName]
    if ($null -eq $property -or
        -not ([string]$property.Value).StartsWith('dpapi-local-machine-v1:', [StringComparison]::Ordinal)) {
        throw "Secret DPAPI LocalMachine envelope ile korunmuyor: $propertyName"
    }
}

$runtimeHash = (Get-FileHash -LiteralPath $runtimeConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
$secretHash = (Get-FileHash -LiteralPath $secretConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($receipt.schema_version -ne 1 -or
    $receipt.installation_id -ne $runtimeConfig.installation_id -or
    $receipt.acl_policy_version -ne 'restotm-windows-acl-v1' -or
    [string]$receipt.config_sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$receipt.secret_store_sha256 -notmatch '^[a-f0-9]{64}$' -or
    $receipt.config_sha256 -ne $runtimeHash -or
    $receipt.secret_store_sha256 -ne $secretHash) {
    throw 'Bootstrap receipt installation/config/secret/ACL policy bagini dogrulamiyor.'
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
    CanonicalSchema = 'restotm-windows-host-v1'
    Service = $service.Name
    ServiceState = $service.State
    Gateway = 'http://<LAN-IP>:8787'
    InstallRoot = $install
    ProgramDataRoot = $programData
    CheckedAtUtc = [DateTime]::UtcNow.ToString('o')
}

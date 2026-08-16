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
    menu = @('127.0.0.1', 3300)
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
    'menu-ui' = @('local-api')
    'print-agent' = @('local-api')
    'lan-gateway' = @('local-api', 'admin-ui', 'waiter-ui', 'menu-ui')
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
$menuChild = $runtimeConfig.children | Where-Object name -eq 'menu-ui' | Select-Object -First 1
$gatewayChild = $runtimeConfig.children | Where-Object name -eq 'lan-gateway' | Select-Object -First 1
if ($apiChild.environment.BIND_HOST -ne '127.0.0.1' -or
    $apiChild.environment.PORT -ne '4100' -or
    $apiChild.file_environment.LOCAL_LICENSE_PUBLIC_KEY -ne (Join-Path $install 'config\license-public-key.pem') -or
    $apiChild.secret_environment.DATABASE_URL -ne 'databaseUrl' -or
    $apiChild.secret_environment.TABLE_QR_SIGNING_SECRET -ne 'tableQrSigningSecret' -or
    [string]::IsNullOrWhiteSpace([string]$apiChild.environment.LOCAL_LAN_HOSTNAME) -or
    $apiChild.shutdown.type -ne 'http' -or
    $apiChild.shutdown.token_secret -ne 'internalApiToken') {
    throw 'Local API canonical env/file/secret/shutdown contract gecersiz.'
}
if ($menuChild.environment.PORT -ne '3300' -or
    $menuChild.environment.CLOUD_MENU_API_URL -notmatch '^https://[^?#]+/api$') {
    throw 'Menu child loopback port/cloud HTTPS projection contract gecersiz.'
}
if ($gatewayChild.environment.GATEWAY_MENU_TARGET -ne 'http://127.0.0.1:3300' -or
    [string]::IsNullOrWhiteSpace([string]$gatewayChild.environment.GATEWAY_ALLOWED_HOSTS)) {
    throw 'Gateway menu upstream/allowed-host contract gecersiz.'
}
$postgresData = [string]$postgresChild.arguments[1]
$backupPath = [string]$apiChild.environment.LOCAL_BACKUP_DIR
if ($postgresChild.shutdown.type -ne 'postgres' -or
    $postgresChild.shutdown.pg_ctl_path -ne (Join-Path $install 'postgres\bin\pg_ctl.exe') -or
    $postgresChild.shutdown.data_directory -ne $postgresData -or
    $postgresChild.shutdown.grace_ms -lt 5000) {
    throw 'PostgreSQL guvenli pg_ctl kapanis contract gecersiz.'
}
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
    'gatewayControlSecret',
    'tableQrSigningSecret'
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
# Servisin kendi SID'i olmali (1 = unrestricted): dosya ACL politikasi
# NT SERVICE\RESTOTMRuntime uzerine kuruludur. 3 (write-restricted) calisma
# zamaniyla uyumsuz oldugu icin kullanilmaz; yalitim, yonetici olmayan servis
# hesabi ve dar ACL'lerle saglanir.
$serviceSidType = Get-ItemPropertyValue `
    -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\RESTOTMRuntime' `
    -Name 'ServiceSidType' `
    -ErrorAction Stop
if ($serviceSidType -ne 1) {
    throw 'RESTOTMRuntime servis SID politikasi dogrulanamadi.'
}
$preshutdownTimeout = Get-ItemPropertyValue `
    -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\RESTOTMRuntime' `
    -Name 'PreshutdownTimeout' `
    -ErrorAction Stop
if ($preshutdownTimeout -lt 120000) {
    throw 'RESTOTMRuntime PostgreSQL icin yeterli preshutdown suresine sahip degil.'
}

$internalPorts = @(55432, 4100, 3100, 3200, 3300, 4300)
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

$firewallContracts = @(
    [ordered]@{ Name = 'RESTOTM LAN Gateway (Private LocalSubnet)'; Direction = 'Inbound'; Protocol = 'TCP'; LocalPort = '8787'; RemotePort = 'Any' },
    [ordered]@{ Name = 'RESTOTM mDNS Inbound (Private LocalSubnet)'; Direction = 'Inbound'; Protocol = 'UDP'; LocalPort = '5353'; RemotePort = '5353' },
    [ordered]@{ Name = 'RESTOTM mDNS Outbound (Private LocalSubnet)'; Direction = 'Outbound'; Protocol = 'UDP'; LocalPort = '5353'; RemotePort = '5353' }
)
foreach ($contract in $firewallContracts) {
    $firewallRule = Get-NetFirewallRule -DisplayName $contract.Name -ErrorAction Stop
    $addressFilter = $firewallRule | Get-NetFirewallAddressFilter
    $portFilter = $firewallRule | Get-NetFirewallPortFilter
    if (([string]$firewallRule.Profile) -ne 'Private' -or
        ([string]$firewallRule.Direction) -ne $contract.Direction -or
        ([string]$firewallRule.Action) -ne 'Allow' -or
        ([string]$addressFilter.RemoteAddress) -ne 'LocalSubnet' -or
        ([string]$portFilter.Protocol) -ne $contract.Protocol -or
        ([string]$portFilter.LocalPort) -ne $contract.LocalPort -or
        ([string]$portFilter.RemotePort) -ne $contract.RemotePort) {
        throw "Firewall dar Private/LocalSubnet contract ile uyusmuyor: $($contract.Name)"
    }
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

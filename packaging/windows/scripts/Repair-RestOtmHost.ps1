[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'REST_OTM guvenli onarim icin dosyaya sag tiklayip Yonetici olarak PowerShell ile calistirin.'
}

$installRoot = Join-Path $env:ProgramFiles 'RESTOTM'
$programDataRoot = Join-Path $env:ProgramData 'RESTOTM'
$configPath = Join-Path $programDataRoot 'config\runtime.json'
$secretPath = Join-Path $programDataRoot 'config\secrets.json'
$receiptPath = Join-Path $programDataRoot 'config\bootstrap-receipt.json'
$bootstrap = Join-Path $installRoot 'bin\restotm-installer-bootstrap.exe'

foreach ($required in @($configPath, $secretPath, $receiptPath, $bootstrap)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Onarim durduruldu; zorunlu imzali kurulum parcasi eksik: $required"
    }
}

$signature = Get-AuthenticodeSignature -LiteralPath $bootstrap
if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
    throw 'Onarim durduruldu; native bootstrap Authenticode imzasi gecersiz.'
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
$configHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
$secretHash = (Get-FileHash -LiteralPath $secretPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($config.schema_version -ne 1 -or
    $config.install_root -ne $installRoot -or
    $config.program_data_root -ne $programDataRoot -or
    $receipt.installation_id -ne $config.installation_id -or
    $receipt.config_sha256 -ne $configHash -or
    $receipt.secret_store_sha256 -ne $secretHash) {
    throw 'Onarim durduruldu; config/secret/bootstrap receipt butunlugu bozuk. Dosyalari elle degistirmeyin.'
}

$api = $config.children | Where-Object name -eq 'local-api' | Select-Object -First 1
$licenseServerUrl = [string]$api.environment.LOCAL_LICENSE_SERVER_URL
$productVersion = [string]$api.environment.APP_VERSION
if ($licenseServerUrl -notmatch '^https://[^\s?#@]+$' -or $productVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Onarim durduruldu; imzali kurulum URL/surum contract gecersiz.'
}

$service = Get-Service -Name 'RESTOTMRuntime' -ErrorAction Stop
$serviceDetails = Get-CimInstance Win32_Service -Filter "Name='RESTOTMRuntime'"
$expectedBinaryPrefix = '"' + (Join-Path $installRoot 'bin\restotm-runtime-service.exe') + '"'
if ($null -eq $serviceDetails -or
    -not ([string]$serviceDetails.PathName).StartsWith($expectedBinaryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Onarim durduruldu; Windows servis yolu imzali REST_OTM konumuyla eslesmiyor.'
}

try {
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name 'RESTOTMRuntime' -Force
        (Get-Service -Name 'RESTOTMRuntime').WaitForStatus('Stopped', [TimeSpan]::FromMinutes(2))
    }

    & $bootstrap 'provision' `
        '--install-root' $installRoot `
        '--program-data-root' $programDataRoot `
        '--license-server-url' $licenseServerUrl `
        '--product-version' $productVersion `
        '--postgres-port' ([string]$config.network.postgres.port) `
        '--api-port' ([string]$config.network.api.port) `
        '--admin-port' ([string]$config.network.admin.port) `
        '--waiter-port' ([string]$config.network.waiter.port) `
        '--menu-port' ([string]$config.network.menu.port) `
        '--print-port' ([string]$config.network.print_agent.port) `
        '--gateway-port' ([string]$config.network.gateway.port)
    if ($LASTEXITCODE -ne 0) { throw "Native butunluk/ACL onarimi basarisiz (exit=$LASTEXITCODE)." }

    & sc.exe config RESTOTMRuntime 'start=' 'delayed-auto' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Servis otomatik baslatma contract onarilamadi.' }
    & sc.exe failure RESTOTMRuntime 'reset=' '86400' 'actions=' 'restart/15000/restart/30000/restart/60000' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Servis recovery contract onarilamadi.' }
    & sc.exe failureflag RESTOTMRuntime 1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Servis failure flag onarilamadi.' }
    & sc.exe sidtype RESTOTMRuntime restricted | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Restricted service SID onarilamadi.' }
    & sc.exe preshutdown RESTOTMRuntime 120000 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Guvenli PostgreSQL kapanis suresi onarilamadi.' }

    Get-NetFirewallRule -Group 'RESTOTM' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName 'RESTOTM LAN Gateway (Private LocalSubnet)' -Group 'RESTOTM' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort 8787 -RemoteAddress LocalSubnet | Out-Null
    New-NetFirewallRule -DisplayName 'RESTOTM mDNS Inbound (Private LocalSubnet)' -Group 'RESTOTM' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol UDP -LocalPort 5353 -RemotePort 5353 -RemoteAddress LocalSubnet | Out-Null
    New-NetFirewallRule -DisplayName 'RESTOTM mDNS Outbound (Private LocalSubnet)' -Group 'RESTOTM' -Direction Outbound -Action Allow -Enabled True -Profile Private -Protocol UDP -LocalPort 5353 -RemotePort 5353 -RemoteAddress LocalSubnet | Out-Null

    Start-Service -Name 'RESTOTMRuntime'
    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    $healthPath = Join-Path $programDataRoot 'runtime\health.json'
    $healthy = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 2
        if ((Get-Service -Name 'RESTOTMRuntime').Status -ne 'Running' -or
            -not (Test-Path -LiteralPath $healthPath -PathType Leaf)) { continue }
        try {
            $health = Get-Content -LiteralPath $healthPath -Raw | ConvertFrom-Json
            if ($health.installation_id -eq $config.installation_id -and $health.overall -eq 'healthy') {
                $healthy = $true
                break
            }
        } catch { }
    }
    if (-not $healthy) {
        throw 'Servis onarildi ancak 5 dakika icinde tum alt servisler saglikli olmadi.'
    }
} catch {
    $failedService = Get-Service -Name 'RESTOTMRuntime' -ErrorAction SilentlyContinue
    if ($null -ne $failedService -and $failedService.Status -eq 'Stopped') {
        Start-Service -Name 'RESTOTMRuntime' -ErrorAction SilentlyContinue
    }
    throw
}

Write-Host 'REST_OTM ONARIM TAMAMLANDI. Servis, ACL, firewall ve alt servis sagligi dogrulandi.' -ForegroundColor Green

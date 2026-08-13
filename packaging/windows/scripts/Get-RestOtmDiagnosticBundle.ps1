[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'REST_OTM tani paketi icin dosyaya sag tiklayip Yonetici olarak PowerShell ile calistirin.'
}

$programDataRoot = Join-Path $env:ProgramData 'RESTOTM'
$installRoot = Join-Path $env:ProgramFiles 'RESTOTM'
$desktop = [Environment]::GetFolderPath('Desktop')
$stamp = [DateTime]::Now.ToString('yyyyMMdd-HHmmss')
$workRoot = Join-Path $env:TEMP ("RESTOTM-Diagnostic-" + [Guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $desktop "RESTOTM-TANI-$stamp.zip"

function Protect-RestOtmDiagnosticText {
    param([AllowEmptyString()][string]$Text)

    $value = $Text
    $value = $value -replace '(?i)\bRSTO(?:-[A-Z0-9]{4}){3,}\b', '<license-key>'
    $value = $value -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '<email>'
    $value = $value -replace '(?i)postgres(?:ql)?://[^\s"''<>]+', '<database-url>'
    $value = $value -replace '(?i)(authorization|cookie|password|secret|token)(\s*[=:]\s*)[^\s,;}]+', '$1$2<redacted>'
    $value = $value -replace '(?i)Bearer\s+[A-Za-z0-9._~+/-]+=*', 'Bearer <redacted>'
    $value = $value -replace '\b[A-Fa-f0-9]{96,}\b', '<long-secret-redacted>'
    return $value
}

function Write-RestOtmDiagnosticFile {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowEmptyString()][string]$Content
    )
    $safeName = [IO.Path]::GetFileName($Name)
    Protect-RestOtmDiagnosticText -Text $Content |
        Set-Content -LiteralPath (Join-Path $workRoot $safeName) -Encoding UTF8
}

if (Test-Path -LiteralPath $archivePath) {
    throw "Tani paketi zaten var; uzerine yazilmadi: $archivePath"
}
New-Item -ItemType Directory -Path $workRoot | Out-Null

try {
    $service = Get-CimInstance Win32_Service -Filter "Name='RESTOTMRuntime'" -ErrorAction SilentlyContinue
    $serviceRecovery = (& sc.exe qfailure RESTOTMRuntime 2>&1 | Out-String)
    $serviceSid = (& sc.exe qsidtype RESTOTMRuntime 2>&1 | Out-String)
    Write-RestOtmDiagnosticFile '01-service.txt' (($service | Select-Object Name, State, StartMode, Status, PathName, ProcessId | Format-List | Out-String) + $serviceRecovery + $serviceSid)

    $healthPath = Join-Path $programDataRoot 'runtime\health.json'
    if (Test-Path -LiteralPath $healthPath -PathType Leaf) {
        Write-RestOtmDiagnosticFile '02-health.json' (Get-Content -LiteralPath $healthPath -Raw)
    }

    $configPath = Join-Path $programDataRoot 'config\runtime.json'
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        $summary = [ordered]@{
            schemaVersion = $config.schema_version
            installationId = $config.installation_id
            appVersion = (($config.children | Where-Object name -eq 'local-api' | Select-Object -First 1).environment.APP_VERSION)
            network = $config.network
            children = @($config.children | ForEach-Object {
                [ordered]@{ name = $_.name; dependsOn = $_.depends_on; essential = $_.essential; shutdownType = $_.shutdown.type }
            })
            configSha256 = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        Write-RestOtmDiagnosticFile '03-runtime-summary.json' ($summary | ConvertTo-Json -Depth 8)
    }

    $ports = foreach ($port in @(55432, 4100, 3100, 3200, 3300, 4300, 8787)) {
        Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
            Select-Object LocalAddress, LocalPort, OwningProcess
    }
    Write-RestOtmDiagnosticFile '04-listening-ports.txt' ($ports | Format-Table -AutoSize | Out-String)

    $firewall = Get-NetFirewallRule -Group 'RESTOTM' -ErrorAction SilentlyContinue | ForEach-Object {
        $rule = $_
        $port = $rule | Get-NetFirewallPortFilter
        $address = $rule | Get-NetFirewallAddressFilter
        [pscustomobject]@{
            Name = $rule.DisplayName
            Enabled = $rule.Enabled
            Profile = $rule.Profile
            Direction = $rule.Direction
            Action = $rule.Action
            Protocol = $port.Protocol
            LocalPort = $port.LocalPort
            RemotePort = $port.RemotePort
            RemoteAddress = $address.RemoteAddress
        }
    }
    Write-RestOtmDiagnosticFile '05-firewall.txt' ($firewall | Format-Table -AutoSize | Out-String)

    $driveLetter = [IO.Path]::GetPathRoot($programDataRoot).TrimEnd('\').TrimEnd(':')
    $drive = Get-Volume -DriveLetter $driveLetter -ErrorAction SilentlyContinue
    $freeBytes = if ($null -ne $drive) { $drive.SizeRemaining } else { $null }
    $totalBytes = if ($null -ne $drive) { $drive.Size } else { $null }
    $system = [ordered]@{
        collectedAtUtc = [DateTime]::UtcNow.ToString('o')
        windows = [Environment]::OSVersion.VersionString
        machine = $env:COMPUTERNAME
        freeBytes = $freeBytes
        totalBytes = $totalBytes
        networkProfiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object Name, InterfaceAlias, NetworkCategory, IPv4Connectivity)
    }
    Write-RestOtmDiagnosticFile '06-system.json' ($system | ConvertTo-Json -Depth 6)

    $criticalFiles = @(
        (Join-Path $installRoot 'bin\restotm-runtime-service.exe'),
        (Join-Path $installRoot 'bin\restotm-installer-bootstrap.exe'),
        (Join-Path $installRoot 'postgres\bin\postgres.exe'),
        (Join-Path $installRoot 'postgres\bin\pg_ctl.exe'),
        $configPath,
        (Join-Path $programDataRoot 'config\bootstrap-receipt.json')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
    Write-RestOtmDiagnosticFile '07-critical-hashes.txt' ($criticalFiles | Get-FileHash -Algorithm SHA256 | Format-Table -AutoSize | Out-String)
    $aclText = foreach ($aclRoot in @($installRoot, $programDataRoot)) {
        "===== $aclRoot ====="
        & icacls.exe $aclRoot 2>&1
    }
    Write-RestOtmDiagnosticFile '08-acl.txt' ($aclText | Out-String)

    $events = try {
        Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = [DateTime]::Now.AddDays(-2) } -ErrorAction Stop |
            Where-Object { $_.Message -match 'RESTOTMRuntime' } |
            Select-Object -First 200 TimeCreated, Id, LevelDisplayName, ProviderName, Message
    } catch { @() }
    Write-RestOtmDiagnosticFile '09-windows-events.txt' ($events | Format-List | Out-String)

    $logRoot = Join-Path $programDataRoot 'logs'
    $recentLogs = if (Test-Path -LiteralPath $logRoot -PathType Container) {
        @(Get-ChildItem -LiteralPath $logRoot -File -Filter 'runtime-host.ndjson*' |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 3)
    } else { @() }
    $logText = foreach ($log in $recentLogs) {
        "===== $($log.Name) ====="
        Get-Content -LiteralPath $log.FullName -Tail 1500 -ErrorAction SilentlyContinue
    }
    Write-RestOtmDiagnosticFile '10-recent-runtime-logs.txt' ($logText | Out-String)

    Compress-Archive -Path (Join-Path $workRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal
} finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
}

Write-Host "TANI PAKETI HAZIR: $archivePath" -ForegroundColor Green
Write-Host 'Bu ZIP secret, lisans anahtari, e-posta ve veritabani parolasini bilerek ayiklar.' -ForegroundColor Green

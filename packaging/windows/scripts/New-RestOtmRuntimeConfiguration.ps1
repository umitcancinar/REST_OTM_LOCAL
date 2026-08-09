[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$InstallRoot = (Join-Path $env:ProgramFiles 'RESTOTM'),
    [string]$ProgramDataRoot = (Join-Path $env:ProgramData 'RESTOTM'),
    [string]$BackupRoot = (Join-Path $env:ProgramData 'RESTOTM\backups'),
    [string]$ExternalBackupRoot,

    [Parameter(Mandatory = $true)]
    [string]$LicenseServerUrl,

    [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')]
    [string]$ProductVersion = '1.0.0',

    [switch]$RotateSecrets
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'RestOtm.Windows.Common.psm1') -Force
Assert-RestOtmAdministrator

if ($RotateSecrets) {
    throw 'Secret rotasyonu DB rol parolasi ve calisan child surecleriyle atomik koordine edilmeden yapilamaz.'
}

$install = Assert-RestOtmAllowedPath -Path $InstallRoot -AllowedRoots @($env:ProgramFiles)
$programData = Assert-RestOtmAllowedPath -Path $ProgramDataRoot -AllowedRoots @($env:ProgramData)
$backup = Assert-RestOtmAllowedPath -Path $BackupRoot -AllowedRoots @($env:ProgramData)
$configRoot = Join-Path $programData 'config'
$dataRoot = Join-Path $programData 'data'
$logRoot = Join-Path $programData 'logs'
$runtimeRoot = Join-Path $programData 'runtime'
$runtimeConfigPath = Join-Path $configRoot 'runtime.json'
$secretConfigPath = Join-Path $configRoot 'secrets.json'
$bootstrapReceiptPath = Join-Path $configRoot 'bootstrap-receipt.json'
$printAgentDataRoot = Join-Path $dataRoot 'print-agent'
$updateDataRoot = Join-Path $dataRoot 'update'
$backupReplicaRoot = Join-Path $programData 'backup-replica'

if ($backup.Equals($dataRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $backup.StartsWith(($dataRoot + '\'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Yedek klasoru canli veri klasorunun icinde olamaz.'
}

$externalBackup = $null
if (-not [string]::IsNullOrWhiteSpace($ExternalBackupRoot)) {
    $externalBackup = Get-RestOtmFullPath -Path $ExternalBackupRoot
    $externalDriveRoot = [IO.Path]::GetPathRoot($externalBackup)
    Assert-RestOtmAllowedPath -Path $externalBackup -AllowedRoots @($externalDriveRoot) | Out-Null
    if ($externalBackup.StartsWith(($programData + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Harici yedek hedefi ProgramData disinda olmalidir.'
    }
    $backupReplicaRoot = $externalBackup
}
$backupReplicaPolicy = if ($null -ne $externalBackup) { 'require-separate' } else { 'warn' }

$licenseUri = [Uri]$LicenseServerUrl
if ($licenseUri.Scheme -ne 'https' -or
    -not [string]::IsNullOrWhiteSpace($licenseUri.UserInfo) -or
    -not [string]::IsNullOrWhiteSpace($licenseUri.Query) -or
    -not [string]::IsNullOrWhiteSpace($licenseUri.Fragment)) {
    throw 'Lisans sunucusu query/credential icermeyen mutlak HTTPS URL olmali.'
}

$directories = @(
    $configRoot,
    $dataRoot,
    (Join-Path $dataRoot 'postgres'),
    (Join-Path $dataRoot 'uploads'),
    (Join-Path $dataRoot 'license'),
    $updateDataRoot,
    $printAgentDataRoot,
    $logRoot,
    $runtimeRoot,
    $backup,
    $backupReplicaRoot
)

if ($PSCmdlet.ShouldProcess($programData, 'Canonical RESTOTM runtime config, secret store ve receipt olustur')) {
    foreach ($directory in $directories) {
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }
    }

    Set-RestOtmDirectoryAcl -Path $configRoot
    Set-RestOtmDirectoryAcl -Path $dataRoot
    Set-RestOtmDirectoryAcl -Path $logRoot
    Set-RestOtmDirectoryAcl -Path $runtimeRoot
    Set-RestOtmDirectoryAcl -Path $backup
    Set-RestOtmDirectoryAcl -Path $backupReplicaRoot

    $installationId = [Guid]::NewGuid().ToString('D')
    if (Test-Path -LiteralPath $runtimeConfigPath -PathType Leaf) {
        $existingRuntime = Get-Content -LiteralPath $runtimeConfigPath -Raw | ConvertFrom-Json
        $installationProperty = $existingRuntime.PSObject.Properties['installation_id']
        if ($null -eq $installationProperty -or
            [string]::IsNullOrWhiteSpace([string]$installationProperty.Value)) {
            throw 'Legacy/uyumsuz runtime.json bulundu; otomatik uzerine yazma reddedildi.'
        }
        $installationId = [string]$installationProperty.Value
    }

    if (-not (Test-Path -LiteralPath $secretConfigPath -PathType Leaf)) {
        $databasePassword = New-RestOtmRandomSecret -ByteCount 48
        $databaseUrl = "postgresql://restotm_runtime:$databasePassword@127.0.0.1:55432/restotm_local?schema=public"
        $secretValues = [ordered]@{
            databaseUrl = Protect-RestOtmMachineSecret $databaseUrl
            internalApiToken = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 48)
            printAgentSecret = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 48)
            jwtAccessSecret = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 64)
            jwtRefreshSecret = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 64)
            backupEncryptionKey = Protect-RestOtmMachineSecret (New-RestOtmCanonicalBase64Secret -ByteCount 32)
            gatewayControlSecret = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 48)
            tableQrSigningSecret = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 48)
        }
        $secretStore = [ordered]@{
            schema_version = 1
            protection = 'dpapi-local-machine-v1'
            values = $secretValues
        }
        Write-RestOtmAtomicUtf8File `
            -Path $secretConfigPath `
            -Content ($secretStore | ConvertTo-Json -Depth 5)
        $databasePassword = $null
        $databaseUrl = $null
    }
    else {
        $existingSecrets = Get-Content -LiteralPath $secretConfigPath -Raw | ConvertFrom-Json
        if ($existingSecrets.schema_version -ne 1 -or
            $existingSecrets.protection -ne 'dpapi-local-machine-v1' -or
            $null -eq $existingSecrets.values) {
            throw 'Legacy/uyumsuz secrets.json bulundu; otomatik donusum ve secret kaybi reddedildi.'
        }
        foreach ($requiredSecret in @(
            'databaseUrl',
            'internalApiToken',
            'printAgentSecret',
            'jwtAccessSecret',
            'jwtRefreshSecret',
            'backupEncryptionKey',
            'gatewayControlSecret',
            'tableQrSigningSecret'
        )) {
            $secretProperty = $existingSecrets.values.PSObject.Properties[$requiredSecret]
            if ($null -eq $secretProperty -or
                -not ([string]$secretProperty.Value).StartsWith('dpapi-local-machine-v1:', [StringComparison]::Ordinal)) {
                throw "Canonical DPAPI secret eksik veya gecersiz: $requiredSecret"
            }
        }
    }

    $emptyEnvironment = [ordered]@{}
    $localLanHostname = "restotm-$($installationId.Replace('-', '').Substring(0, 8)).local"
    $runtimeConfig = [ordered]@{
        schema_version = 1
        installation_id = $installationId
        install_root = $install
        program_data_root = $programData
        secret_store = $secretConfigPath
        bootstrap_receipt = $bootstrapReceiptPath
        health_file = (Join-Path $runtimeRoot 'health.json')
        log_directory = $logRoot
        network = [ordered]@{
            postgres = [ordered]@{ host = '127.0.0.1'; port = 55432 }
            api = [ordered]@{ host = '127.0.0.1'; port = 4100 }
            admin = [ordered]@{ host = '127.0.0.1'; port = 3100 }
            waiter = [ordered]@{ host = '127.0.0.1'; port = 3200 }
            menu = [ordered]@{ host = '127.0.0.1'; port = 3300 }
            print_agent = [ordered]@{ host = '127.0.0.1'; port = 4300 }
            gateway = [ordered]@{
                host = '0.0.0.0'
                port = 8787
                firewall_profile = 'Private'
                remote_scope = 'LocalSubnet'
            }
        }
        restart_policy = [ordered]@{
            initial_delay_ms = 1000
            maximum_delay_ms = 60000
            stable_reset_ms = 120000
            crash_window_ms = 600000
            maximum_crashes_in_window = 5
            crash_loop_quarantine_ms = 300000
        }
        children = @(
            [ordered]@{
                name = 'postgres'
                executable = (Join-Path $install 'postgres\bin\postgres.exe')
                working_directory = (Join-Path $install 'postgres\bin')
                arguments = @('-D', (Join-Path $dataRoot 'postgres'), '-p', '55432', '-h', '127.0.0.1')
                environment = $emptyEnvironment
                file_environment = $emptyEnvironment
                secret_environment = $emptyEnvironment
                depends_on = @()
                essential = $true
                shutdown = [ordered]@{ type = 'terminate'; grace_ms = 30000 }
            },
            [ordered]@{
                name = 'local-api'
                executable = (Join-Path $install 'api\restotm-api.exe')
                working_directory = (Join-Path $install 'api')
                arguments = @()
                environment = [ordered]@{
                    NODE_ENV = 'production'
                    APP_VERSION = $ProductVersion
                    RUNTIME_MODE = 'local'
                    BIND_HOST = '127.0.0.1'
                    PORT = '4100'
                    LOCAL_LICENSE_SERVER_URL = $licenseUri.AbsoluteUri.TrimEnd('/')
                    LOCAL_LICENSE_DATA_DIR = (Join-Path $dataRoot 'license')
                    LOCAL_LAN_HOSTNAME = $localLanHostname
                    LOCAL_UPDATE_MANIFEST_URL = "$($licenseUri.AbsoluteUri.TrimEnd('/'))/api/updates/v1/manifest"
                    LOCAL_UPDATE_DATA_DIR = $updateDataRoot
                    LOCAL_UPDATE_CHANNEL = 'stable'
                    LOCAL_UPDATE_DATABASE_SCHEMA_VERSION = '1'
                    LOCAL_UPDATE_ALLOWED_ORIGINS = $licenseUri.AbsoluteUri.TrimEnd('/')
                    LOCAL_POSTGRES_DATA_DIR = (Join-Path $dataRoot 'postgres')
                    LOCAL_BACKUP_DIR = $backup
                    LOCAL_BACKUP_EXTERNAL_DIR = $backupReplicaRoot
                    LOCAL_BACKUP_EXTERNAL_VOLUME_POLICY = $backupReplicaPolicy
                    LOCAL_BACKUP_KEY_ID = "restotm-$installationId"
                    PG_DUMP_PATH = (Join-Path $install 'postgres\bin\pg_dump.exe')
                    PG_RESTORE_PATH = (Join-Path $install 'postgres\bin\pg_restore.exe')
                    BACKUP_RETENTION_DAILY = '30'
                    BACKUP_RETENTION_WEEKLY = '12'
                    BACKUP_RETENTION_MONTHLY = '12'
                    BACKUP_EXTERNAL_RETENTION_DAILY = '90'
                    BACKUP_EXTERNAL_RETENTION_WEEKLY = '26'
                    BACKUP_EXTERNAL_RETENTION_MONTHLY = '24'
                    BACKUP_RESTORE_VERIFICATION_INTERVAL_MS = '604800000'
                    BACKUP_RESTORE_VERIFICATION_RETRY_MS = '21600000'
                }
                file_environment = [ordered]@{
                    LOCAL_LICENSE_PUBLIC_KEY = (Join-Path $install 'config\license-public-key.pem')
                    LOCAL_UPDATE_PUBLIC_KEY = (Join-Path $install 'config\update-public-key.pem')
                }
                secret_environment = [ordered]@{
                    DATABASE_URL = 'databaseUrl'
                    JWT_ACCESS_SECRET = 'jwtAccessSecret'
                    JWT_REFRESH_SECRET = 'jwtRefreshSecret'
                    PRINT_AGENT_SECRET = 'printAgentSecret'
                    LOCAL_BACKUP_KEY_BASE64 = 'backupEncryptionKey'
                    TABLE_QR_SIGNING_SECRET = 'tableQrSigningSecret'
                }
                depends_on = @('postgres')
                essential = $true
                shutdown = [ordered]@{
                    type = 'http'
                    port = 4100
                    path = '/internal/runtime/shutdown'
                    token_secret = 'internalApiToken'
                    grace_ms = 30000
                }
            },
            [ordered]@{
                name = 'admin-ui'
                executable = (Join-Path $install 'admin\restotm-admin.exe')
                working_directory = (Join-Path $install 'admin')
                arguments = @()
                environment = [ordered]@{ NODE_ENV = 'production'; HOSTNAME = '127.0.0.1'; PORT = '3100' }
                file_environment = $emptyEnvironment
                secret_environment = $emptyEnvironment
                depends_on = @('local-api')
                essential = $true
                shutdown = [ordered]@{ type = 'terminate'; grace_ms = 5000 }
            },
            [ordered]@{
                name = 'waiter-ui'
                executable = (Join-Path $install 'waiter\restotm-waiter.exe')
                working_directory = (Join-Path $install 'waiter')
                arguments = @()
                environment = [ordered]@{ NODE_ENV = 'production'; HOSTNAME = '127.0.0.1'; PORT = '3200' }
                file_environment = $emptyEnvironment
                secret_environment = $emptyEnvironment
                depends_on = @('local-api')
                essential = $true
                shutdown = [ordered]@{ type = 'terminate'; grace_ms = 5000 }
            },
            [ordered]@{
                name = 'menu-ui'
                executable = (Join-Path $install 'menu\restotm-menu.exe')
                working_directory = (Join-Path $install 'menu')
                arguments = @()
                environment = [ordered]@{
                    NODE_ENV = 'production'
                    HOSTNAME = '127.0.0.1'
                    PORT = '3300'
                    CLOUD_MENU_API_URL = "$($licenseUri.AbsoluteUri.TrimEnd('/'))/api"
                }
                file_environment = $emptyEnvironment
                secret_environment = $emptyEnvironment
                depends_on = @('local-api')
                essential = $true
                shutdown = [ordered]@{ type = 'terminate'; grace_ms = 5000 }
            },
            [ordered]@{
                name = 'print-agent'
                executable = (Join-Path $install 'print-agent\restotm-print-agent.exe')
                working_directory = (Join-Path $install 'print-agent')
                arguments = @()
                environment = [ordered]@{
                    NODE_ENV = 'production'
                    PRINT_AGENT_WS_URL = 'http://127.0.0.1:4100'
                    PRINT_AGENT_DATA_DIR = $printAgentDataRoot
                }
                file_environment = $emptyEnvironment
                secret_environment = [ordered]@{ PRINT_AGENT_SECRET = 'printAgentSecret' }
                depends_on = @('local-api')
                essential = $false
                shutdown = [ordered]@{ type = 'terminate'; grace_ms = 5000 }
            },
            [ordered]@{
                name = 'lan-gateway'
                executable = (Join-Path $install 'gateway\restotm-lan-gateway.exe')
                working_directory = (Join-Path $install 'gateway')
                arguments = @()
                environment = [ordered]@{
                    NODE_ENV = 'production'
                    GATEWAY_BIND_HOST = '0.0.0.0'
                    GATEWAY_PORT = '8787'
                    GATEWAY_ALLOWED_HOSTS = $localLanHostname
                    GATEWAY_API_TARGET = 'http://127.0.0.1:4100'
                    GATEWAY_ADMIN_TARGET = 'http://127.0.0.1:3100'
                    GATEWAY_WAITER_TARGET = 'http://127.0.0.1:3200'
                    GATEWAY_MENU_TARGET = 'http://127.0.0.1:3300'
                }
                file_environment = $emptyEnvironment
                secret_environment = [ordered]@{ GATEWAY_CONTROL_SECRET = 'gatewayControlSecret' }
                depends_on = @('local-api', 'admin-ui', 'waiter-ui', 'menu-ui')
                essential = $true
                shutdown = [ordered]@{ type = 'terminate'; grace_ms = 5000 }
            }
        )
    }

    Write-RestOtmAtomicUtf8File `
        -Path $runtimeConfigPath `
        -Content ($runtimeConfig | ConvertTo-Json -Depth 10)

    $receipt = [ordered]@{
        schema_version = 1
        installation_id = $installationId
        config_sha256 = (Get-FileHash -LiteralPath $runtimeConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
        secret_store_sha256 = (Get-FileHash -LiteralPath $secretConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
        acl_policy_version = 'restotm-windows-acl-v1'
        completed_at_unix_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    Write-RestOtmAtomicUtf8File `
        -Path $bootstrapReceiptPath `
        -Content ($receipt | ConvertTo-Json -Depth 4)
    Set-RestOtmDirectoryAcl -Path $configRoot
}

[pscustomobject]@{
    RuntimeConfigPath = $runtimeConfigPath
    SecretConfigPath = $secretConfigPath
    BootstrapReceiptPath = $bootstrapReceiptPath
    SecretsRotated = $false
    BackupRoot = $backup
    ExternalBackupRoot = $externalBackup
    CanonicalSchema = 'restotm-windows-host-v1'
}

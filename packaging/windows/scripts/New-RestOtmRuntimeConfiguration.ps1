[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$InstallRoot = (Join-Path $env:ProgramFiles 'RESTOTM'),
    [string]$ProgramDataRoot = (Join-Path $env:ProgramData 'RESTOTM'),
    [string]$BackupRoot = (Join-Path $env:ProgramData 'RESTOTM\backups'),
    [string]$ExternalBackupRoot,

    [Parameter(Mandatory = $true)]
    [string]$LicenseServerUrl,
    [switch]$RotateSecrets
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'RestOtm.Windows.Common.psm1') -Force

Assert-RestOtmAdministrator

$install = Assert-RestOtmAllowedPath -Path $InstallRoot -AllowedRoots @($env:ProgramFiles)
$programData = Assert-RestOtmAllowedPath -Path $ProgramDataRoot -AllowedRoots @($env:ProgramData)
$backup = Assert-RestOtmAllowedPath -Path $BackupRoot -AllowedRoots @($env:ProgramData)
$configRoot = Join-Path $programData 'config'
$dataRoot = Join-Path $programData 'data'
$logRoot = Join-Path $programData 'logs'
$runtimeRoot = Join-Path $programData 'runtime'
$runtimeConfigPath = Join-Path $configRoot 'runtime.json'
$secretConfigPath = Join-Path $configRoot 'secrets.json'

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
}

$licenseUri = [Uri]$LicenseServerUrl
if ($licenseUri.Scheme -ne 'https' -or -not [string]::IsNullOrWhiteSpace($licenseUri.UserInfo)) {
    throw 'Lisans sunucusu mutlak HTTPS URL olmali ve URL icinde kimlik bilgisi bulunmamalidir.'
}

$directories = @(
    $configRoot,
    $dataRoot,
    (Join-Path $dataRoot 'postgres'),
    (Join-Path $dataRoot 'uploads'),
    (Join-Path $dataRoot 'license'),
    $logRoot,
    $runtimeRoot,
    $backup
)
if ($null -ne $externalBackup) {
    $directories += $externalBackup
}

if ($PSCmdlet.ShouldProcess($programData, 'RESTOTM runtime klasorlerini ve yapilandirmasini olustur')) {
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
    if ($null -ne $externalBackup) {
        Set-RestOtmDirectoryAcl -Path $externalBackup
    }

    $installationId = [Guid]::NewGuid().ToString('D')
    if (Test-Path -LiteralPath $runtimeConfigPath -PathType Leaf) {
        $existingRuntime = Get-Content -LiteralPath $runtimeConfigPath -Raw | ConvertFrom-Json
        if (-not [string]::IsNullOrWhiteSpace($existingRuntime.installationId)) {
            $installationId = [string]$existingRuntime.installationId
        }
    }

    if ($RotateSecrets -or -not (Test-Path -LiteralPath $secretConfigPath -PathType Leaf)) {
        $secrets = [ordered]@{
            schemaVersion = 1
            protection = 'dpapi-local-machine-v1'
            generatedAtUtc = [DateTime]::UtcNow.ToString('o')
            databasePassword = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 48)
            internalApiToken = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 48)
            printAgentSecret = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 48)
            jwtAccessSecret = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 64)
            jwtRefreshSecret = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 64)
            backupEncryptionKey = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 64)
            gatewayControlSecret = Protect-RestOtmMachineSecret (New-RestOtmRandomSecret -ByteCount 48)
        }
        Write-RestOtmAtomicUtf8File -Path $secretConfigPath -Content ($secrets | ConvertTo-Json -Depth 4)
    }

    $runtimeConfig = [ordered]@{
        schemaVersion = 1
        installationId = $installationId
        runtimeMode = 'local'
        generatedAtUtc = [DateTime]::UtcNow.ToString('o')
        paths = [ordered]@{
            installRoot = $install
            programDataRoot = $programData
            configRoot = $configRoot
            secretConfig = $secretConfigPath
            postgresData = (Join-Path $dataRoot 'postgres')
            uploads = (Join-Path $dataRoot 'uploads')
            logs = $logRoot
            runtime = $runtimeRoot
            backups = $backup
            externalBackups = $externalBackup
            licenseData = (Join-Path $dataRoot 'license')
        }
        network = [ordered]@{
            postgres = [ordered]@{ host = '127.0.0.1'; port = 55432 }
            api = [ordered]@{ host = '127.0.0.1'; port = 4100 }
            admin = [ordered]@{ host = '127.0.0.1'; port = 3100 }
            waiter = [ordered]@{ host = '127.0.0.1'; port = 3200 }
            printAgent = [ordered]@{ host = '127.0.0.1'; port = 4300 }
            gateway = [ordered]@{ host = '0.0.0.0'; port = 8787; allowedScope = 'LocalSubnet'; firewallProfile = 'Private' }
        }
        database = [ordered]@{
            engine = 'postgresql'
            name = 'restotm_local'
            user = 'restotm_runtime'
            sslMode = 'disable'
        }
        license = [ordered]@{
            serverUrl = $licenseUri.AbsoluteUri.TrimEnd('/')
            publicKeyPath = (Join-Path $install 'config\license-public-key.pem')
            heartbeatMinutes = 60
            startupValidationRequired = $true
            signedLeaseRequired = $true
            localPrivateKeyAllowed = $false
        }
        backupPolicy = [ordered]@{
            daily = $true
            localRetentionDays = 30
            externalRetentionDays = 90
            verifyAfterWrite = $true
            encryption = 'aes-256-gcm'
            externalTargetRequiredForProduction = $true
            restoreDrillIntervalDays = 30
        }
        childProcessEnvironment = [ordered]@{
            RUNTIME_MODE = 'local'
            NODE_ENV = 'production'
            BIND_HOST = '127.0.0.1'
            PORT = '4100'
            LOCAL_LICENSE_DATA_DIR = (Join-Path $dataRoot 'license')
            LOCAL_POSTGRES_DATA_DIR = (Join-Path $dataRoot 'postgres')
            LOCAL_BACKUP_DIR = $backup
            PG_DUMP_PATH = (Join-Path $install 'postgres\bin\pg_dump.exe')
            BACKUP_RETENTION_DAILY = '30'
            BACKUP_RETENTION_WEEKLY = '12'
            BACKUP_RETENTION_MONTHLY = '12'
        }
    }
    Write-RestOtmAtomicUtf8File -Path $runtimeConfigPath -Content ($runtimeConfig | ConvertTo-Json -Depth 8)
    Set-RestOtmDirectoryAcl -Path $configRoot
}

[pscustomobject]@{
    RuntimeConfigPath = $runtimeConfigPath
    SecretConfigPath = $secretConfigPath
    SecretsRotated = [bool]$RotateSecrets
    BackupRoot = $backup
    ExternalBackupRoot = $externalBackup
}

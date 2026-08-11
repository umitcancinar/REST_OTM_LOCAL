Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-RestOtmWindows {
    [CmdletBinding()]
    param()

    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Bu betik yalnizca Windows uzerinde calistirilabilir.'
    }
}

function Assert-RestOtmAdministrator {
    [CmdletBinding()]
    param()

    Assert-RestOtmWindows
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'RESTOTM kurulum islemleri yukseltilmis (Yonetici) PowerShell gerektirir.'
    }
}

function Get-RestOtmFullPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'Bos dosya yolu kabul edilmez.'
    }

    $fullPath = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path))
    $pathRoot = [IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.Equals($pathRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return $pathRoot
    }
    return $fullPath.TrimEnd('\')
}

function Assert-RestOtmAllowedPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string[]]$AllowedRoots,

        [switch]$AllowRoot
    )

    $candidate = Get-RestOtmFullPath -Path $Path
    $comparison = [StringComparison]::OrdinalIgnoreCase
    $allowed = $false

    foreach ($rootPath in $AllowedRoots) {
        $root = Get-RestOtmFullPath -Path $rootPath
        if ($AllowRoot -and $candidate.Equals($root, $comparison)) {
            $allowed = $true
            break
        }

        $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if ($candidate.StartsWith($prefix, $comparison)) {
            $allowed = $true
            break
        }
    }

    if (-not $allowed) {
        throw "Izin verilmeyen hedef yol: $candidate"
    }

    $current = $candidate
    while (-not [string]::IsNullOrWhiteSpace($current)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Reparse point/symlink iceren hedef yol reddedildi: $current"
            }
        }

        $parent = Split-Path -Path $current -Parent
        if ($parent -eq $current) {
            break
        }
        $current = $parent
    }

    return $candidate
}

function Assert-RestOtmPort {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($Port -lt 1024 -or $Port -gt 65535) {
        throw "$Name portu 1024-65535 araliginda olmalidir: $Port"
    }
}

function New-RestOtmRandomSecret {
    [CmdletBinding()]
    param(
        [ValidateRange(32, 128)]
        [int]$ByteCount = 48
    )

    $bytes = New-Object byte[] $ByteCount
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-RestOtmCanonicalBase64Secret {
    [CmdletBinding()]
    param(
        [ValidateRange(32, 128)]
        [int]$ByteCount = 32
    )

    $bytes = New-Object byte[] $ByteCount
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    }
    finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        $generator.Dispose()
    }
}

function Protect-RestOtmMachineSecret {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$PlainText
    )

    Assert-RestOtmWindows
    Add-Type -AssemblyName System.Security
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($PlainText)
    $entropy = [Text.Encoding]::UTF8.GetBytes('RESTOTM/runtime-secrets/v1')
    try {
        $protected = [Security.Cryptography.ProtectedData]::Protect(
            $plainBytes,
            $entropy,
            [Security.Cryptography.DataProtectionScope]::LocalMachine
        )
        return 'dpapi-local-machine-v1:' + [Convert]::ToBase64String($protected)
    }
    finally {
        [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
}

function Write-RestOtmAtomicUtf8File {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $directory = Split-Path -Path $Path -Parent
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $temporaryPath = Join-Path $directory ('.restotm-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporaryPath, $Content, $encoding)

    try {
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            [IO.File]::Replace($temporaryPath, $Path, $null)
        }
        else {
            [IO.File]::Move($temporaryPath, $Path)
        }
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Assert-RestOtmArtifactManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ArtifactRoot,

        [Parameter(Mandatory = $true)]
        [string]$ManifestPath,

        [switch]$RequireAuthenticode
    )

    Assert-RestOtmWindows
    $root = Get-RestOtmFullPath -Path $ArtifactRoot
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "Release artifact klasoru bulunamadi: $root"
    }
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "Artifact manifesti bulunamadi: $ManifestPath"
    }

    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace($manifest.productVersion)) {
        throw 'Artifact manifest schemaVersion=1 ve productVersion icermelidir.'
    }
    if ($null -eq $manifest.files -or $manifest.files.Count -eq 0) {
        throw 'Artifact manifestinde en az bir dosya bulunmalidir.'
    }

    $requiredRoles = @(
        'runtime-service',
        'postgres-server',
        'postgres-client',
        'local-api',
        'admin-ui',
        'waiter-ui',
        'print-agent',
        'lan-gateway',
        'installer-bootstrap',
        'license-public-key'
    )
    $seenRoles = @{}

    foreach ($file in $manifest.files) {
        $relativePath = [string]$file.relativePath
        if ([string]::IsNullOrWhiteSpace($relativePath) -or [IO.Path]::IsPathRooted($relativePath)) {
            throw "Gecersiz artifact relativePath: $relativePath"
        }
        if (($relativePath -split '[\\/]') -contains '..') {
            throw "Ust klasore cikan artifact yolu reddedildi: $relativePath"
        }
        if ([string]$file.sha256 -notmatch '^[a-fA-F0-9]{64}$') {
            throw "Gecersiz SHA-256: $relativePath"
        }

        $absolutePath = Get-RestOtmFullPath -Path (Join-Path $root $relativePath)
        $rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
        if (-not $absolutePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Artifact kokunun disina cikan yol reddedildi: $relativePath"
        }
        if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
            throw "Artifact dosyasi eksik: $relativePath"
        }

        $actualHash = (Get-FileHash -LiteralPath $absolutePath -Algorithm SHA256).Hash
        if (-not $actualHash.Equals([string]$file.sha256, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Artifact hash uyusmazligi: $relativePath"
        }

        $extension = [IO.Path]::GetExtension($absolutePath)
        $knownPeExtension = @('.exe', '.dll', '.msi', '.node') -contains $extension.ToLowerInvariant()
        if ($knownPeExtension -and $file.authenticodeRequired -ne $true) {
            throw "PE dosyasi authenticodeRequired=true olmali: $relativePath"
        }
        if ($RequireAuthenticode -and ($knownPeExtension -or $file.authenticodeRequired -eq $true)) {
            if ($file.authenticodeRequired -ne $true) {
                throw "PE dosyasi authenticodeRequired=true olmali: $relativePath"
            }
            $signature = Get-AuthenticodeSignature -LiteralPath $absolutePath
            if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
                throw "Gecerli Authenticode imzasi yok ($($signature.Status)): $relativePath"
            }
        }

        $seenRoles[[string]$file.role] = $true
    }

    foreach ($role in $requiredRoles) {
        if (-not $seenRoles.ContainsKey($role)) {
            throw "Zorunlu artifact rolu eksik: $role"
        }
    }

    return $manifest
}

function Assert-RestOtmInstallerContract {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContractPath,

        [switch]$RequireProductionReady
    )

    if (-not (Test-Path -LiteralPath $ContractPath -PathType Leaf)) {
        throw "Installer contract bulunamadi: $ContractPath"
    }

    $contract = Get-Content -LiteralPath $ContractPath -Raw | ConvertFrom-Json
    $requiredScalars = [ordered]@{
        schema_version = 1
        canonical_runtime_schema = 'restotm-windows-host-v1'
        service_name = 'RESTOTMRuntime'
        bootstrap_executable_relative_path = 'bin/restotm-installer-bootstrap.exe'
        runtime_config_relative_path = 'config/runtime.json'
        secret_store_relative_path = 'config/secrets.json'
        bootstrap_receipt_relative_path = 'config/bootstrap-receipt.json'
        acl_policy_version = 'restotm-windows-acl-v1'
        first_run_provisioning = $true
        uninstall_preserves_customer_data = $true
        license_public_key_relative_path = 'config/license-public-key.pem'
        update_public_key_relative_path = 'config/update-public-key.pem'
    }
    foreach ($entry in $requiredScalars.GetEnumerator()) {
        $property = $contract.PSObject.Properties[[string]$entry.Key]
        if ($null -eq $property -or $property.Value -ne $entry.Value) {
            throw "Installer contract alani gecersiz: $($entry.Key)"
        }
    }

    if ($null -eq $contract.native_bootstrap -or
        $contract.native_bootstrap.verification_command -ne 'verify-production-contract') {
        throw 'Native bootstrap capability contract eksik.'
    }
    if ($RequireProductionReady -and $contract.native_bootstrap.production_ready -ne $true) {
        throw 'Native bootstrap production_ready=true degil; installer/preflight basarili sayilamaz.'
    }

    if ($contract.secrets.schema_version -ne 1 -or
        $contract.secrets.generated_per_installation -ne $true -or
        $contract.secrets.protection -ne 'dpapi-local-machine-v1') {
        throw 'Secret store contract gecersiz.'
    }
    $requiredSecrets = @(
        'databaseUrl',
        'internalApiToken',
        'printAgentSecret',
        'jwtAccessSecret',
        'jwtRefreshSecret',
        'backupEncryptionKey',
        'gatewayControlSecret',
        'tableQrSigningSecret'
    )
    if (($contract.secrets.required_values | ConvertTo-Json -Compress) -ne
        ($requiredSecrets | ConvertTo-Json -Compress)) {
        throw 'Secret values map isimleri veya sirasi canonical contract ile uyusmuyor.'
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
        $endpoint = $contract.network.PSObject.Properties[[string]$entry.Key].Value
        if ($null -eq $endpoint -or
            $endpoint.host -ne $entry.Value[0] -or
            $endpoint.port -ne $entry.Value[1]) {
            throw "Network contract endpoint gecersiz: $($entry.Key)"
        }
    }
    if ($contract.network.gateway.host -ne '0.0.0.0' -or
        $contract.network.gateway.port -ne 8787 -or
        $contract.network.gateway.firewall_profile -ne 'Private' -or
        $contract.network.gateway.remote_scope -ne 'LocalSubnet') {
        throw 'Gateway contract yalnizca 0.0.0.0:8787 Private/LocalSubnet olabilir.'
    }

    $expectedChildren = @(
        [ordered]@{ name = 'postgres'; role = 'postgres-server'; relative_executable = 'postgres/bin/postgres.exe'; relative_working_directory = 'postgres/bin'; depends_on = @() },
        [ordered]@{ name = 'local-api'; role = 'local-api'; relative_executable = 'api/restotm-api.exe'; relative_working_directory = 'api'; depends_on = @('postgres') },
        [ordered]@{ name = 'admin-ui'; role = 'admin-ui'; relative_executable = 'admin/restotm-admin.exe'; relative_working_directory = 'admin'; depends_on = @('local-api') },
        [ordered]@{ name = 'waiter-ui'; role = 'waiter-ui'; relative_executable = 'waiter/restotm-waiter.exe'; relative_working_directory = 'waiter'; depends_on = @('local-api') },
        [ordered]@{ name = 'menu-ui'; role = 'menu-ui'; relative_executable = 'menu/restotm-menu.exe'; relative_working_directory = 'menu'; depends_on = @('local-api') },
        [ordered]@{ name = 'print-agent'; role = 'print-agent'; relative_executable = 'print-agent/restotm-print-agent.exe'; relative_working_directory = 'print-agent'; depends_on = @('local-api') },
        [ordered]@{ name = 'lan-gateway'; role = 'lan-gateway'; relative_executable = 'gateway/restotm-lan-gateway.exe'; relative_working_directory = 'gateway'; depends_on = @('local-api', 'admin-ui', 'waiter-ui', 'menu-ui') }
    )
    if ($contract.children.Count -ne $expectedChildren.Count) {
        throw 'Canonical child process sayisi gecersiz.'
    }
    for ($index = 0; $index -lt $expectedChildren.Count; $index++) {
        $actual = $contract.children[$index]
        $expected = $expectedChildren[$index]
        foreach ($field in @('name', 'role', 'relative_executable', 'relative_working_directory')) {
            if ($actual.$field -ne $expected[$field]) {
                throw "Canonical child contract gecersiz: index=$index field=$field"
            }
        }
        if (($actual.depends_on | ConvertTo-Json -Compress) -ne
            ($expected.depends_on | ConvertTo-Json -Compress)) {
            throw "Canonical child dependency contract gecersiz: $($actual.name)"
        }
    }

    return $contract
}

function Assert-RestOtmArtifactContractAlignment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Manifest,

        [Parameter(Mandatory = $true)]
        [object]$Contract
    )

    $expectedRolePaths = [ordered]@{
        'runtime-service' = 'bin/restotm-runtime-service.exe'
        'installer-bootstrap' = [string]$Contract.bootstrap_executable_relative_path
        'postgres-server' = 'postgres/bin/postgres.exe'
        'postgres-client' = 'postgres/bin/pg_dump.exe'
        'postgres-restore' = 'postgres/bin/pg_restore.exe'
        'node-runtime' = 'runtime/node.exe'
        'local-api' = 'api/restotm-api.exe'
        'admin-ui' = 'admin/restotm-admin.exe'
        'waiter-ui' = 'waiter/restotm-waiter.exe'
        'menu-ui' = 'menu/restotm-menu.exe'
        'print-agent' = 'print-agent/restotm-print-agent.exe'
        'lan-gateway' = 'gateway/restotm-lan-gateway.exe'
        'license-public-key' = [string]$Contract.license_public_key_relative_path
        'update-public-key' = [string]$Contract.update_public_key_relative_path
    }
    foreach ($entry in $expectedRolePaths.GetEnumerator()) {
        $matches = @($Manifest.files | Where-Object role -eq $entry.Key)
        if ($matches.Count -ne 1 -or
            ([string]$matches[0].relativePath).Replace('\', '/') -ne $entry.Value) {
            throw "Artifact role/path canonical contract ile uyusmuyor: $($entry.Key)"
        }
    }
}

function Set-RestOtmDirectoryAcl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [switch]$ReadOnlyForUsers
    )

    Assert-RestOtmAdministrator
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "ACL uygulanacak klasor yok: $Path"
    }

    & icacls.exe $Path '/inheritance:r' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "ACL inheritance kapatilamadi: $Path" }
    & icacls.exe $Path '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "SYSTEM/Administrators ACL uygulanamadi: $Path" }

    if ($ReadOnlyForUsers) {
        & icacls.exe $Path '/grant:r' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Users read-only ACL uygulanamadi: $Path" }
    }
}

Export-ModuleMember -Function @(
    'Assert-RestOtmWindows',
    'Assert-RestOtmAdministrator',
    'Get-RestOtmFullPath',
    'Assert-RestOtmAllowedPath',
    'Assert-RestOtmPort',
    'New-RestOtmRandomSecret',
    'New-RestOtmCanonicalBase64Secret',
    'Protect-RestOtmMachineSecret',
    'Write-RestOtmAtomicUtf8File',
    'Assert-RestOtmArtifactManifest',
    'Assert-RestOtmInstallerContract',
    'Assert-RestOtmArtifactContractAlignment',
    'Set-RestOtmDirectoryAcl'
)

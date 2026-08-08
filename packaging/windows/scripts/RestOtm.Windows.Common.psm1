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
        if ($RequireAuthenticode -and @('.exe', '.dll', '.msi') -contains $extension.ToLowerInvariant()) {
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
    'Protect-RestOtmMachineSecret',
    'Write-RestOtmAtomicUtf8File',
    'Assert-RestOtmArtifactManifest',
    'Set-RestOtmDirectoryAcl'
)

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$CertificateThumbprint,

    [Parameter(Mandatory = $true)]
    [string]$NodeWindowsX64Zip,

    [Parameter(Mandatory = $true)]
    [string]$PostgreSqlWindowsX64Zip,

    [Parameter(Mandatory = $true)]
    [string]$LicensePublicKey,

    [Parameter(Mandatory = $true)]
    [string]$UpdatePublicKey,

    [string]$ControlApiUrl = 'https://rest-otm-control-api.onrender.com',
    [string]$TimestampUrl = 'https://timestamp.digicert.com'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $IsWindows) { throw 'Bu script yalniz gercek Windows x64 makinede calisir.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 zorunludur.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$buildRoot = Join-Path $repoRoot 'build'
$inputRoot = Join-Path $buildRoot 'windows-input'
$deployRoot = Join-Path $buildRoot 'api-runtime-deploy'
$payloadRoot = Join-Path $buildRoot ("windows-payload\$Version")
$candidateRoot = Join-Path $repoRoot 'WINDOWS_KURULUM\04_ADAY_CIKTISI'
$candidateVersionRoot = Join-Path $candidateRoot $Version

function Require-File([string]$Path, [string]$Label) {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) { throw "$Label dosya degil: $Path" }
    return $resolved.Path
}

function Require-Command([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) { throw "Zorunlu arac bulunamadi: $Name" }
    return $command.Source
}

function Run([string]$Command, [string[]]$Arguments) {
    Write-Host "`n>>> $Command $($Arguments -join ' ')" -ForegroundColor Cyan
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Komut basarisiz (exit=$LASTEXITCODE): $Command" }
}

function Sign-And-Verify([string]$FilePath, [string]$SignTool, [string]$Thumbprint) {
    Run $SignTool @('sign', '/sha1', $Thumbprint, '/fd', 'SHA256', '/tr', $TimestampUrl, '/td', 'SHA256', $FilePath)
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
        throw "Authenticode imzasi dogrulanamadi: $FilePath"
    }
}

# Payload denetimi imzayi uzantiya gore degil, PE (MZ) basligina gore arar.
# Ayni olcutu kullanmak icin dosyanin ilk iki baytina bakariz.
function Test-IsPeFile([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $header = New-Object byte[] 2
        if ($stream.Read($header, 0, 2) -ne 2) { return $false }
        return ($header[0] -eq 0x4D -and $header[1] -eq 0x5A)
    } finally {
        $stream.Dispose()
    }
}

function Get-UnsignedPeFile([string[]]$Roots) {
    foreach ($root in $Roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File -Force) {
            if (-not (Test-IsPeFile $file.FullName)) { continue }
            if ((Get-AuthenticodeSignature -LiteralPath $file.FullName).Status -ne
                [Management.Automation.SignatureStatus]::Valid) {
                $file.FullName
            }
        }
    }
}

$nodeZip = Require-File $NodeWindowsX64Zip 'Node.js ZIP'
$postgresZip = Require-File $PostgreSqlWindowsX64Zip 'PostgreSQL ZIP'
$licenseKey = Require-File $LicensePublicKey 'Lisans public key'
$updateKey = Require-File $UpdatePublicKey 'Update public key'
$corepack = Require-Command 'corepack.cmd'
$cargo = Require-Command 'cargo.exe'
$signTool = Require-Command 'signtool.exe'
[void](Require-Command 'wix.exe')

$thumbprint = $CertificateThumbprint.Replace(' ', '').ToUpperInvariant()
$certificate = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My |
    Where-Object Thumbprint -eq $thumbprint |
    Select-Object -First 1
if ($null -eq $certificate -or -not $certificate.HasPrivateKey -or $certificate.NotAfter -le [DateTime]::UtcNow) {
    throw 'Gecerli private key iceren Code Signing sertifikasi Windows Certificate Store icinde bulunamadi.'
}

foreach ($mustNotExist in @($inputRoot, $deployRoot, $payloadRoot, $candidateVersionRoot)) {
    if (Test-Path -LiteralPath $mustNotExist) {
        throw "Guvenlik icin var olan cikti uzerine yazilmadi. Once inceleyip elle arsivleyin: $mustNotExist"
    }
}

$extractRoot = Join-Path $buildRoot ("windows-extract-$Version")
if (Test-Path -LiteralPath $extractRoot) { throw "Gecici cikti zaten var: $extractRoot" }
New-Item -ItemType Directory -Path $extractRoot, $inputRoot | Out-Null

try {
    $nodeExtract = Join-Path $extractRoot 'node'
    $postgresExtract = Join-Path $extractRoot 'postgres'
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtract
    Expand-Archive -LiteralPath $postgresZip -DestinationPath $postgresExtract

    $nodeCandidates = @(Get-ChildItem -LiteralPath $nodeExtract -Recurse -File -Filter node.exe)
    $postgresCandidates = @(Get-ChildItem -LiteralPath $postgresExtract -Recurse -File -Filter postgres.exe |
        Where-Object { $_.Directory.Name -eq 'bin' })
    if ($nodeCandidates.Count -ne 1) { throw 'Node ZIP icinde tam bir node.exe bulunmali.' }
    if ($postgresCandidates.Count -ne 1) { throw 'PostgreSQL ZIP icinde tam bir bin\postgres.exe bulunmali.' }
    $postgresRoot = Split-Path -Parent $postgresCandidates[0].Directory.FullName

    New-Item -ItemType Directory -Path (Join-Path $inputRoot 'runtime'), (Join-Path $inputRoot 'config') | Out-Null
    Copy-Item -LiteralPath $nodeCandidates[0].FullName -Destination (Join-Path $inputRoot 'runtime\node.exe')
    Copy-Item -LiteralPath $postgresRoot -Destination (Join-Path $inputRoot 'postgres') -Recurse

    # Resmi PostgreSQL dagitimi gomulu sunucu icin gereksiz agirlik tasir:
    # pgAdmin GUI, StackBuilder, dokumantasyon, eklenti derlemek icin C basliklari
    # ve PGXS build altyapisi. Bunlar calisma zamaninda kullanilmaz; PGXS ayrica
    # payload'a giremeyen 'test' bilesenli yollar icerir. Sunucunun ihtiyaci olan
    # bin, lib ve share korunur.
    $stagedPostgres = Join-Path $inputRoot 'postgres'
    foreach ($prunable in @('pgAdmin 4', 'StackBuilder', 'doc', 'include', 'lib\pgxs', 'symbols')) {
        $prunePath = Join-Path $stagedPostgres $prunable
        if (Test-Path -LiteralPath $prunePath) {
            Remove-Item -LiteralPath $prunePath -Recurse -Force
        }
    }
    foreach ($required in @('bin\postgres.exe', 'bin\initdb.exe', 'bin\pg_ctl.exe', 'bin\pg_dump.exe',
                            'bin\pg_restore.exe', 'bin\libpq.dll', 'share\postgresql.conf.sample')) {
        if (-not (Test-Path -LiteralPath (Join-Path $stagedPostgres $required) -PathType Leaf)) {
            throw "PostgreSQL runtime sadelestirmesi zorunlu dosyayi kaybetti: $required"
        }
    }

    Copy-Item -LiteralPath $licenseKey -Destination (Join-Path $inputRoot 'config\license-public-key.pem')
    Copy-Item -LiteralPath $updateKey -Destination (Join-Path $inputRoot 'config\update-public-key.pem')

    Push-Location $repoRoot
    try {
        $env:DATABASE_URL = 'postgresql://restotm_build:unused@127.0.0.1:5432/restotm_build?schema=public'
        $env:NEXT_PUBLIC_API_URL = '/api'
        $env:MENU_BASE_PATH = '/menu'
        Run $corepack @('pnpm', 'install', '--frozen-lockfile')
        Run $corepack @('pnpm', '--filter', '@rest-otm/receipt-core', 'build')
        Run $corepack @('pnpm', '--filter', '@rest-otm/admin', 'build')
        Run $corepack @('pnpm', '--filter', '@rest-otm/waiter', 'build')
        Run $corepack @('pnpm', '--filter', '@rest-otm/menu', 'build')
        Run $corepack @('pnpm', '--filter', '@rest-otm/print-agent', 'build')
        Run $corepack @('pnpm', '--filter', '@rest-otm/gateway', 'build')
        Run $corepack @('pnpm', 'run', 'release:build:api')
        Run $corepack @('pnpm', '--config.node-linker=hoisted', '--filter', '@rest-otm/api', 'deploy', '--prod', '--frozen-lockfile', $deployRoot)
        Push-Location $deployRoot
        try { Run $corepack @('pnpm', 'exec', 'prisma', 'generate', '--schema', 'prisma/schema.prisma') }
        finally { Pop-Location }
        Run (Require-Command 'node.exe') @(
            'scripts/release/bundle-api-npm-runtime.mjs',
            '--deploy-root', $deployRoot,
            '--stage-root', (Join-Path $buildRoot 'stage\local')
        )
        Run $corepack @('pnpm', 'run', 'test:release')
        Run $corepack @('pnpm', 'run', 'test:windows')
        & (Join-Path $repoRoot 'packaging\windows\scripts\Test-RestOtmPowerShellSyntax.ps1')
        if (-not $?) { throw 'PowerShell parser testi basarisiz.' }
        & (Join-Path $repoRoot 'packaging\windows\scripts\Test-RestOtmCanonicalContract.ps1')
        if (-not $?) { throw 'Windows canonical contract testi basarisiz.' }
        Run $cargo @('generate-lockfile', '--manifest-path', 'runtime/windows-host/Cargo.toml')
        Run $cargo @('check', '--manifest-path', 'runtime/windows-host/Cargo.toml', '--all-targets', '--locked')
        Run $cargo @('test', '--manifest-path', 'runtime/windows-host/Cargo.toml', '--all-targets', '--locked')
        Run $cargo @('build', '--manifest-path', 'runtime/windows-host/Cargo.toml', '--release', '--locked')
    } finally {
        Pop-Location
    }

    # pnpm workspace'inde Next standalone ciktisi paketlerin gercek kopyasini
    # node_modules\.pnpm altina koyar ama ust seviye adlari depo klasorune
    # symlink birakir. Payload closure'i symlink kabul etmez; her bagi kendi
    # yerel .pnpm kopyasiyla degistirip agaci kendi kendine yeter hale getiririz.
    foreach ($appName in @('admin', 'waiter', 'menu')) {
        $standalone = Join-Path $repoRoot "apps\$appName\.next\standalone"
        if (-not (Test-Path -LiteralPath $standalone)) { continue }
        $storeMarker = '\node_modules\.pnpm\'
        for ($pass = 0; $pass -lt 10; $pass++) {
            $links = @(Get-ChildItem -LiteralPath $standalone -Recurse -Force -ErrorAction SilentlyContinue |
                Where-Object { $_.LinkType })
            if ($links.Count -eq 0) { break }
            foreach ($link in $links) {
                $target = @($link.Target)[0]
                $source = $null
                $markerIndex = $target.IndexOf($storeMarker, [StringComparison]::OrdinalIgnoreCase)
                if ($markerIndex -ge 0) {
                    $localCopy = Join-Path $standalone ('node_modules\.pnpm\' +
                        $target.Substring($markerIndex + $storeMarker.Length))
                    if (Test-Path -LiteralPath $localCopy) { $source = $localCopy }
                }
                if ($null -eq $source) {
                    if (-not (Test-Path -LiteralPath $target)) {
                        throw "Next standalone symlink hedefi cozulemedi: $($link.FullName)"
                    }
                    $source = $target
                }
                # Yalniz reparse point silinir; hedef icerige dokunulmaz.
                if ($link.PSIsContainer) { [System.IO.Directory]::Delete($link.FullName) }
                else { [System.IO.File]::Delete($link.FullName) }
                Copy-Item -LiteralPath $source -Destination $link.FullName -Recurse -Force
            }
        }
        $remainingLinks = @(Get-ChildItem -LiteralPath $standalone -Recurse -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.LinkType })
        if ($remainingLinks.Count -gt 0) {
            throw "Next standalone agacinda cozulemeyen symlink kaldi: apps\$appName"
        }

        # Baglar cozuldukten sonra .pnpm deposu ust seviye paketlerin birebir
        # kopyasidir: paketi gereksiz buyutur ve icindeki uzun surum klasoru
        # adlari MAX_PATH (260) sinirini asan yollar uretip MSI derlemesini
        # kirar. Silmeden once her depo paketinin ust seviyede gercek karsiligi
        # oldugunu dogrulariz; biri bile eksikse fail-closed dururuz.
        $moduleRoot = Join-Path $standalone 'node_modules'
        $pnpmStore = Join-Path $moduleRoot '.pnpm'
        if (Test-Path -LiteralPath $pnpmStore) {
            foreach ($storeEntry in Get-ChildItem -LiteralPath $pnpmStore -Directory -Force) {
                if ($storeEntry.Name -eq 'node_modules') { continue }
                $versionIndex = if ($storeEntry.Name.StartsWith('@')) {
                    $storeEntry.Name.IndexOf('@', 1)
                } else {
                    $storeEntry.Name.IndexOf('@')
                }
                if ($versionIndex -le 0) { continue }
                $packageName = $storeEntry.Name.Substring(0, $versionIndex).Replace('+', '\')
                if (-not (Test-Path -LiteralPath (Join-Path $moduleRoot $packageName) -PathType Container)) {
                    throw "pnpm deposu silinemez; ust seviyede karsiligi yok: $packageName (apps\$appName)"
                }
            }
            Remove-Item -LiteralPath $pnpmStore -Recurse -Force
        }
    }

    # Next.js standalone ciktisi ucuncu taraf node_modules'u oldugu gibi tasir ve
    # bu paketler yayinlanmis dosyalarinda sourceMappingURL yorumu birakir.
    # Payload denetimi bunlari reddeder. API runtime closure'inda ayni temizligi
    # bundle-api-npm-runtime.mjs yapar; Next agaclarina da ayni kurali uygulariz:
    # artik .map dosyasi kalmaz, kalan metin dosyalarindaki isaret silinir.
    $sourceMapMarker = [regex]'(?m)(?://[#@]|/\*[#@])\s*sourceMappingURL\s*=.*?(?:\*/)?\s*$'
    $sanitizeTrees = @()
    foreach ($appName in @('admin', 'waiter', 'menu')) {
        foreach ($treeName in @('.next\standalone', '.next\static', 'public')) {
            $sanitizeTrees += (Join-Path $repoRoot "apps\$appName\$treeName")
        }
    }
    # receipt-core bir workspace kutuphanesidir; package.json'i dist\index.d.ts'e
    # isaret ettigi icin tip tanimi uretmek zorunda. Payload ise tip tanimi kabul
    # etmez. Bu noktada tum derlemeler ve testler bittigi icin kopyayi burada
    # sadelestirmek guvenlidir.
    $sanitizeTrees += (Join-Path $repoRoot 'packages\receipt-core\dist')
    $sanitizeTrees += (Join-Path $repoRoot 'apps\print-agent\dist')
    $sanitizeTrees += (Join-Path $repoRoot 'apps\gateway\dist')

    foreach ($tree in $sanitizeTrees) {
        if (-not (Test-Path -LiteralPath $tree)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $tree -Recurse -File -Force) {
            if ($file.Extension -match '^\.(?:map|ts|tsx)$') {
                Remove-Item -LiteralPath $file.FullName -Force
                continue
            }
            $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
            if ($bytes.Length -eq 0 -or [Array]::IndexOf($bytes, [byte]0) -ge 0) { continue }
            $text = [System.Text.Encoding]::UTF8.GetString($bytes)
            if (-not $sourceMapMarker.IsMatch($text)) { continue }
            [System.IO.File]::WriteAllBytes(
                $file.FullName,
                [System.Text.Encoding]::UTF8.GetBytes($sourceMapMarker.Replace($text, ''))
            )
        }
    }

    $rustRelease = Join-Path $repoRoot 'runtime\windows-host\target\release'
    $serviceSource = Join-Path $rustRelease 'restotm-runtime-service.exe'
    $bootstrapSource = Join-Path $rustRelease 'restotm-installer-bootstrap.exe'
    $launcherSource = Join-Path $rustRelease 'restotm-child-launcher.exe'
    foreach ($native in @($serviceSource, $bootstrapSource, $launcherSource)) {
        if (-not (Test-Path -LiteralPath $native -PathType Leaf)) { throw "Rust PE eksik: $native" }
    }

    $nativeDestinations = [ordered]@{
        'bin\restotm-runtime-service.exe' = $serviceSource
        'bin\restotm-installer-bootstrap.exe' = $bootstrapSource
        'api\restotm-api.exe' = $launcherSource
        'admin\restotm-admin.exe' = $launcherSource
        'waiter\restotm-waiter.exe' = $launcherSource
        'menu\restotm-menu.exe' = $launcherSource
        'print-agent\restotm-print-agent.exe' = $launcherSource
        'gateway\restotm-lan-gateway.exe' = $launcherSource
    }
    foreach ($entry in $nativeDestinations.GetEnumerator()) {
        $destination = Join-Path $inputRoot $entry.Key
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $entry.Value -Destination $destination
        Sign-And-Verify $destination $signTool $thumbprint
    }

    # Payload denetimi PE basligi tasiyan her dosyada gecerli Authenticode imzasi
    # arar. PostgreSQL dagitimi ile Prisma/Node native eklentileri imzasiz gelir;
    # bu ikilileri musteriye biz dagittigimiz icin yayimci sertifikamizla
    # imzalariz. Saticinin kendi gecerli imzasini tasiyan dosyalara dokunulmaz ve
    # denetim hicbir sekilde gevsetilmez.
    $payloadSourceRoots = @(
        (Join-Path $inputRoot 'postgres'),
        (Join-Path $buildRoot 'stage\local'),
        (Join-Path $repoRoot 'apps\admin\.next'),
        (Join-Path $repoRoot 'apps\admin\public'),
        (Join-Path $repoRoot 'apps\waiter\.next'),
        (Join-Path $repoRoot 'apps\waiter\public'),
        (Join-Path $repoRoot 'apps\menu\.next'),
        (Join-Path $repoRoot 'apps\menu\public'),
        (Join-Path $repoRoot 'apps\gateway\dist'),
        (Join-Path $repoRoot 'apps\print-agent\dist'),
        (Join-Path $repoRoot 'packages\receipt-core\dist')
    )
    $unsignedThirdPartyPe = @(Get-UnsignedPeFile $payloadSourceRoots)
    if ($unsignedThirdPartyPe.Count -gt 0) {
        Write-Host "`n>>> Imzasiz ucuncu taraf PE dosyalari imzalaniyor: $($unsignedThirdPartyPe.Count)" -ForegroundColor Cyan
        $batchSize = 40
        for ($index = 0; $index -lt $unsignedThirdPartyPe.Count; $index += $batchSize) {
            $last = [Math]::Min($index + $batchSize - 1, $unsignedThirdPartyPe.Count - 1)
            $batch = @($unsignedThirdPartyPe[$index..$last])
            Run $signTool (@('sign', '/sha1', $thumbprint, '/fd', 'SHA256', '/tr', $TimestampUrl, '/td', 'SHA256') + $batch)
        }
        foreach ($pePath in $unsignedThirdPartyPe) {
            $signature = Get-AuthenticodeSignature -LiteralPath $pePath
            if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
                throw "Authenticode imzasi dogrulanamadi: $pePath"
            }
        }
    }

    # production_ready burada yalniz derlenmis native helper'in capability
    # probe'unu acar. Musteri teslimi ayrica temiz-VM kabul scriptine baglidir.
    $contract = Get-Content -LiteralPath (Join-Path $repoRoot 'packaging\windows\installer-contract.example.json') -Raw | ConvertFrom-Json
    $contract.native_bootstrap.production_ready = $true
    $contract | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $inputRoot 'installer-contract.json') -Encoding UTF8

    Push-Location $repoRoot
    try {
        Run (Require-Command 'node.exe') @(
            'scripts/release/assemble-windows-payload.mjs',
            '--version', $Version,
            '--out', $payloadRoot
        )
        & (Join-Path $repoRoot 'packaging\windows\scripts\Build-RestOtmInstaller.ps1') `
            -PayloadRoot $payloadRoot `
            -CertificateThumbprint $thumbprint `
            -LicenseServerUrl $ControlApiUrl `
            -TimestampUrl $TimestampUrl `
            -OutputRoot $candidateRoot
        if (-not $?) { throw 'Windows installer build basarisiz.' }
    } finally {
        Pop-Location
    }

    $bundle = Join-Path $candidateVersionRoot ("RESTOTM-Setup-$Version-x64.exe")
    if (-not (Test-Path -LiteralPath $bundle -PathType Leaf)) { throw "Imzali aday setup eksik: $bundle" }
    foreach ($supportTool in @(
        'Find-RestOtmNetworkDevices.ps1',
        'Get-RestOtmAccessAddresses.ps1',
        'Get-RestOtmDiagnosticBundle.ps1',
        'Repair-RestOtmHost.ps1'
    )) {
        $sourceTool = Join-Path $repoRoot "packaging\windows\scripts\$supportTool"
        $destinationTool = Join-Path $candidateVersionRoot $supportTool
        Copy-Item -LiteralPath $sourceTool -Destination $destinationTool
        $toolSignature = Set-AuthenticodeSignature `
            -LiteralPath $destinationTool `
            -Certificate $certificate `
            -TimestampServer $TimestampUrl `
            -HashAlgorithm SHA256
        if ($toolSignature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
            throw "Destek araci Authenticode imzalanamadi: $destinationTool status=$($toolSignature.Status)"
        }
    }
    $hash = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([IO.Path]::GetFileName($bundle))" | Set-Content -LiteralPath "$bundle.sha256" -Encoding ASCII
    Write-Host "`nADAY HAZIR: $bundle" -ForegroundColor Green
    Write-Host 'HENUZ MUSTERIYE VERMEYIN. Temiz Windows VM kabul adimini calistirin.' -ForegroundColor Yellow
} finally {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
}

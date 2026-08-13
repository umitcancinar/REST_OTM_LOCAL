#Requires -Version 7.0
#Requires -RunAsAdministrator

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $IsWindows) { throw 'Bu arac yalniz Windows uzerinde calisir.' }

function Test-PrivateIpv4([string]$Address) {
    $parts = $Address.Split('.')
    if ($parts.Count -ne 4) { return $false }
    $values = [int[]]::new(4)
    for ($index = 0; $index -lt 4; $index += 1) {
        $parsed = 0
        if (-not [int]::TryParse($parts[$index], [ref]$parsed) -or $parsed -lt 0 -or $parsed -gt 255) {
            return $false
        }
        $values[$index] = $parsed
    }
    return $values[0] -eq 10 -or
        ($values[0] -eq 172 -and $values[1] -ge 16 -and $values[1] -le 31) -or
        ($values[0] -eq 192 -and $values[1] -eq 168)
}

function ConvertTo-Ipv4Number([string]$Address) {
    $bytes = [Net.IPAddress]::Parse($Address).GetAddressBytes()
    if ($bytes.Count -ne 4) { throw "IPv4 adresi gecersiz: $Address" }
    return [uint64]$bytes[0] * 16777216 +
        [uint64]$bytes[1] * 65536 +
        [uint64]$bytes[2] * 256 +
        [uint64]$bytes[3]
}

function ConvertFrom-Ipv4Number([uint64]$Value) {
    return '{0}.{1}.{2}.{3}' -f @(
        [math]::Floor($Value / 16777216) % 256,
        [math]::Floor($Value / 65536) % 256,
        [math]::Floor($Value / 256) % 256,
        $Value % 256
    )
}

$privateInterfaceIndexes = @(Get-NetConnectionProfile -ErrorAction Stop |
    Where-Object NetworkCategory -eq 'Private' |
    Select-Object -ExpandProperty InterfaceIndex -Unique)
if ($privateInterfaceIndexes.Count -eq 0) {
    throw 'Ozel (Private) Windows ag profili bulunamadi. Ayarlar > Ag ve Internet icinden restoran agini Ozel yapin.'
}

$localAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction Stop |
    Where-Object {
        $privateInterfaceIndexes -contains $_.InterfaceIndex -and
        (Test-PrivateIpv4 ([string]$_.IPAddress))
    })
if ($localAddresses.Count -eq 0) {
    throw 'Ozel agda kullanilabilir private IPv4 adresi bulunamadi.'
}
$localAddressNumbers = @($localAddresses | ForEach-Object {
    ConvertTo-Ipv4Number ([string]$_.IPAddress)
})

$targets = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($localAddress in $localAddresses) {
    $prefix = [math]::Max([int]$localAddress.PrefixLength, 24)
    if ($prefix -ge 31) { continue }
    $addressNumber = ConvertTo-Ipv4Number ([string]$localAddress.IPAddress)
    $blockSize = [uint64][math]::Pow(2, 32 - $prefix)
    $network = [uint64]([math]::Floor($addressNumber / $blockSize) * $blockSize)
    $broadcast = $network + $blockSize - 1
    for ($candidate = $network + 1; $candidate -lt $broadcast; $candidate += 1) {
        if ($localAddressNumbers -contains $candidate) { continue }
        [void]$targets.Add((ConvertFrom-Ipv4Number $candidate))
        if ($targets.Count -ge 1024) { break }
    }
    if ($targets.Count -ge 1024) { break }
}
if ($targets.Count -eq 0) { throw 'Taranabilir yerel ag adresi bulunamadi.' }

Write-Host "Ayni agdaki $($targets.Count) adres termal yazici portu 9100 icin taraniyor..." -ForegroundColor Cyan
$timeoutMs = 400
$printerCandidates = @($targets | ForEach-Object -Parallel {
    $ipAddress = [string]$_
    $client = [Net.Sockets.TcpClient]::new()
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        $connect = $client.ConnectAsync($ipAddress, 9100)
        if ($connect.Wait($using:timeoutMs) -and $client.Connected) {
            [pscustomobject]@{
                IPAddress = $ipAddress
                Port = 9100
                LatencyMs = [math]::Max(1, $timer.ElapsedMilliseconds)
            }
        }
    } catch {
        # Kapali port ve ulasilamayan cihaz normal tarama sonucudur.
    } finally {
        $timer.Stop()
        $client.Dispose()
    }
} -ThrottleLimit 64 | Sort-Object { [version]$_.IPAddress })

# TCP denemeleri Windows neighbor tablosunu gunceller. MAC adreslerini
# musteri raporuna koymadan, yalniz taranan private hedeflerde gorulen IP'leri
# listeleriz. Telefonlar uyku/client-isolation nedeniyle burada gorunmeyebilir;
# garson girisi bu listeye bagli degildir.
$targetLookup = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($target in $targets) { [void]$targetLookup.Add($target) }
$visibleDevices = @(Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $targetLookup.Contains([string]$_.IPAddress) -and
        ([string]$_.State) -in @('Reachable', 'Stale', 'Delay', 'Probe', 'Permanent')
    } |
    Select-Object -ExpandProperty IPAddress -Unique |
    Sort-Object { [version]$_ })

$lines = @(
    'REST_OTM AG VE YAZICI TARAMASI'
    '=============================='
    ''
    "Tarama zamani: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))"
    "Kontrol edilen adres: $($targets.Count)"
    ''
    'TERMAL YAZICI ADAYLARI (RAW 9100 ACIK)'
    '--------------------------------------'
)
if ($printerCandidates.Count -eq 0) {
    $lines += '- Bulunamadi. Yazici acik, ayni switch/Wi-Fi aginda ve RAW 9100 etkin olmali.'
} else {
    foreach ($printer in $printerCandidates) {
        $lines += "- $($printer.IPAddress):$($printer.Port)  ($($printer.LatencyMs) ms)"
    }
}
$lines += @('', 'AGDA GORULEN DIGER CIHAZ IP ADRESLERI', '-----------------------------------')
if ($visibleDevices.Count -eq 0) {
    $lines += '- Gorulen baska cihaz yok.'
} else {
    foreach ($address in $visibleDevices) { $lines += "- $address" }
}
$lines += @(
    ''
    'Not: Garson telefonunu bulmak gerekmez. Telefon RESTOTM adresine girince'
    'ana bilgisayar baglantinin geldigi yerel IP adresini otomatik gorur.'
)

$desktop = [Environment]::GetFolderPath('Desktop')
$outputPath = Join-Path $desktop 'RESTOTM-AG-VE-YAZICI-TARAMASI.txt'
$lines -join [Environment]::NewLine | Set-Content -LiteralPath $outputPath -Encoding UTF8
Write-Host ($lines -join [Environment]::NewLine) -ForegroundColor Green
Write-Host "`nTarama raporu masaustune yazildi: $outputPath" -ForegroundColor Cyan

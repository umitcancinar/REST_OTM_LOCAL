#Requires -Version 7.0
#Requires -RunAsAdministrator

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsWindows) { throw 'Bu arac yalniz Windows uzerinde calisir.' }

$configPath = Join-Path $env:ProgramData 'RESTOTM\config\runtime.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "RESTOTM kurulum bilgisi bulunamadi: $configPath"
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$apiChild = @($config.children | Where-Object name -eq 'local-api')
if ($apiChild.Count -ne 1) { throw 'RESTOTM local-api yapilandirmasi gecersiz.' }
$hostname = [string]$apiChild[0].environment.LOCAL_LAN_HOSTNAME
if ($hostname -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$') {
    throw 'RESTOTM yerel hostname bilgisi gecersiz.'
}

function Test-PrivateIpv4([string]$Address) {
    $octets = $Address.Split('.')
    if ($octets.Count -ne 4) { return $false }
    $values = [int[]]::new(4)
    for ($index = 0; $index -lt 4; $index += 1) {
        $parsed = 0
        if (-not [int]::TryParse($octets[$index], [ref]$parsed) -or $parsed -lt 0 -or $parsed -gt 255) {
            return $false
        }
        $values[$index] = $parsed
    }
    return $values[0] -eq 10 -or
        ($values[0] -eq 172 -and $values[1] -ge 16 -and $values[1] -le 31) -or
        ($values[0] -eq 192 -and $values[1] -eq 168)
}

$lanAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction Stop |
    Where-Object { Test-PrivateIpv4 ([string]$_.IPAddress) } |
    Select-Object -ExpandProperty IPAddress -Unique |
    Sort-Object)

$lines = @(
    'REST_OTM YEREL AG GIRIS ADRESLERI'
    '================================'
    ''
    'Ana bilgisayarda:'
    '- http://127.0.0.1:8787'
    ''
    'Ayni Wi-Fi agindaki telefon ve tabletlerde:'
    "- Yonetim: http://$hostname`:8787"
    "- Garson:   http://$hostname`:8787/garson"
    "- Menu:     http://$hostname`:8787/menu"
)
if ($lanAddresses.Count -gt 0) {
    $lines += @('', 'Yerel IP yedek adresleri:')
    foreach ($address in $lanAddresses) {
        $lines += "- Yonetim: http://$address`:8787"
        $lines += "  Garson:   http://$address`:8787/garson"
    }
}
$lines += @(
    ''
    'Telefon/tablet ana bilgisayarla ayni Wi-Fi aginda olmalidir.'
    'Windows ag profili Ozel (Private) olmalidir.'
)

$desktop = [Environment]::GetFolderPath('Desktop')
$outputPath = Join-Path $desktop 'RESTOTM-GIRIS-ADRESLERI.txt'
$lines -join [Environment]::NewLine |
    Set-Content -LiteralPath $outputPath -Encoding UTF8

Write-Host ($lines -join [Environment]::NewLine) -ForegroundColor Green
Write-Host "`nAdres dosyasi masaustune yazildi: $outputPath" -ForegroundColor Cyan

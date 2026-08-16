[CmdletBinding()]
param(
    [string]$InstallerContractPath = (Join-Path (Split-Path -Path $PSScriptRoot -Parent) 'installer-contract.example.json'),
    [string]$HostConfigPath = (Join-Path (Split-Path -Path (Split-Path -Path $PSScriptRoot -Parent) -Parent) '..\runtime\windows-host\config.example.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'RestOtm.Windows.Common.psm1') -Force
$contract = Assert-RestOtmInstallerContract -ContractPath $InstallerContractPath

if (-not (Test-Path -LiteralPath $HostConfigPath -PathType Leaf)) {
    throw "Rust host config example bulunamadi: $HostConfigPath"
}
$rusthost = Get-Content -LiteralPath $HostConfigPath -Raw | ConvertFrom-Json
if ($rusthost.schema_version -ne $contract.schema_version -or
    ($rusthost.network | ConvertTo-Json -Depth 6 -Compress) -ne
    ($contract.network | ConvertTo-Json -Depth 6 -Compress)) {
    throw 'Installer ve Rust host network/schema contractlari drift etti.'
}

$hostTopology = @($rusthost.children | ForEach-Object {
    [ordered]@{ name = $_.name; depends_on = @($_.depends_on) }
})
$installerTopology = @($contract.children | ForEach-Object {
    [ordered]@{ name = $_.name; depends_on = @($_.depends_on) }
})
if (($hostTopology | ConvertTo-Json -Depth 5 -Compress) -ne
    ($installerTopology | ConvertTo-Json -Depth 5 -Compress)) {
    throw 'Installer ve Rust host child dependency contractlari drift etti.'
}

if ($contract.native_bootstrap.production_ready -ne $false) {
    throw 'Example contract release artifact degildir; production_ready=false kalmalidir.'
}

[pscustomobject]@{
    Passed = $true
    CanonicalSchema = $contract.canonical_runtime_schema
    ChildCount = $rusthost.children.Count
    ProductionReady = $contract.native_bootstrap.production_ready
}

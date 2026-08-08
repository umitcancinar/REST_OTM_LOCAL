[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packagingRoot = Split-Path -Path $PSScriptRoot -Parent
$powershellFiles = Get-ChildItem -LiteralPath $packagingRoot -Recurse -File |
    Where-Object Extension -in @('.ps1', '.psm1')

if (-not $powershellFiles) {
    throw 'Dogrulanacak PowerShell dosyasi bulunamadi.'
}

$failures = New-Object Collections.Generic.List[string]
foreach ($file in $powershellFiles) {
    $tokens = $null
    $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile(
        $file.FullName,
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null

    foreach ($parseError in $parseErrors) {
        $failures.Add("$($file.FullName):$($parseError.Extent.StartLineNumber) $($parseError.Message)")
    }
}

if ($failures.Count -gt 0) {
    throw ("PowerShell syntax hatalari:`n" + ($failures -join "`n"))
}

[pscustomobject]@{
    Passed = $true
    ParsedFiles = $powershellFiles.Count
}

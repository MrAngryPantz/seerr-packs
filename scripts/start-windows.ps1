param(
    [Parameter(Mandatory = $true)][string]$ConfigDirectory,
    [int]$Port = 5056
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:NODE_ENV = 'production'
$env:CONFIG_DIRECTORY = [System.IO.Path]::GetFullPath($ConfigDirectory)
$env:PORT = "$Port"
New-Item -ItemType Directory -Path $env:CONFIG_DIRECTORY -Force | Out-Null
& node dist/index.js
exit $LASTEXITCODE

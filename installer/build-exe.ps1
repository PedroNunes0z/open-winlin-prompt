# Compila o instalador .exe (nativo, com o pacote embutido como recurso).
# Uso: powershell -ExecutionPolicy Bypass -File installer/build-exe.ps1 -Pacote open-winlin-prompt.zip
param(
    [string]$Pacote = 'open-winlin-prompt.zip',
    [string]$Saida  = 'open-winlin-prompt-setup.exe'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Pacote)) { throw "Pacote nao encontrado: $Pacote" }

$csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $csc) { throw 'csc.exe (.NET Framework) nao encontrado.' }

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'Installer.cs'
$manifest = Join-Path $PSScriptRoot 'app.manifest'
$pacotePath = (Resolve-Path -LiteralPath $Pacote).Path
$saidaPath = Join-Path $root $Saida

$cscArgs = @(
    '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+',
    "/out:$saidaPath",
    "/resource:$pacotePath,payload.zip",
    '/r:System.IO.Compression.dll',
    '/r:System.IO.Compression.FileSystem.dll',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll'
)
if (Test-Path $manifest) { $cscArgs += "/win32manifest:$manifest" }
$cscArgs += $source

& $csc @cscArgs

if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o instalador (csc exit $LASTEXITCODE)." }

$info = Get-Item $saidaPath
Write-Host ("Instalador gerado: {0} ({1:N0} bytes)" -f $info.Name, $info.Length)

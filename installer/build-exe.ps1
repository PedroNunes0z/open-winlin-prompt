# Compila o instalador .exe (bootstrapper) com o pacote embutido.
# Uso: powershell -ExecutionPolicy Bypass -File installer/build-exe.ps1 -Pacote open-winlin-prompt.zip
param(
    [string]$Pacote = 'open-winlin-prompt.zip',
    [string]$Saida  = 'open-winlin-prompt-setup.exe'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Pacote)) { throw "Pacote não encontrado: $Pacote" }

$csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $csc) { throw 'csc.exe (.NET Framework) não encontrado.' }

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'Bootstrap.cs'
$pacotePath = (Resolve-Path -LiteralPath $Pacote).Path
$saidaPath = Join-Path $root $Saida

& $csc /nologo /target:winexe /platform:anycpu /optimize+ `
    "/out:$saidaPath" `
    "/resource:$pacotePath,payload.zip" `
    /r:System.IO.Compression.FileSystem.dll `
    /r:System.Windows.Forms.dll `
    $source

if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o instalador (csc exit $LASTEXITCODE)." }

$info = Get-Item $saidaPath
Write-Host ("Instalador gerado: {0} ({1:N0} bytes)" -f $info.Name, $info.Length)

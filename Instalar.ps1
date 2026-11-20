# Open Winlin Prompt — Instalador
# Uso: duplo clique em "Instalar.cmd" ou:
#   powershell -ExecutionPolicy Bypass -File Instalar.ps1
#
# O que faz:
#   1. Cria/substitui a pasta C:\Program Files\open-winlin-prompt e clona o repositório
#   2. Instala dependências e compila o programa (npm)
#   3. Detecta o Ollama; se não estiver instalado, oferece a instalação
#   4. Oferece baixar o modelo de IA local (qwen2.5-coder:1.5b)
#   5. Oferece criar um atalho na área de trabalho

$ErrorActionPreference = 'Continue'
$RepoUrl   = 'https://github.com/PedroNunes0z/open-winlin-prompt.git'
$TargetDir = 'C:\Program Files\open-winlin-prompt'
$Model     = 'qwen2.5-coder:1.5b'

function Test-Admin {
    ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsRole]::Administrator)
}

function Ask([string]$Question) {
    $answer = Read-Host "$Question (S/n)"
    return ($answer -eq '' -or $answer -match '^(s|sim|y|yes)$')
}

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Ensure-Tool([string]$Name, [string]$WingetId) {
    if (Get-Command $Name -ErrorAction SilentlyContinue) { return $true }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host "  'winget' não encontrado. Instale o $Name manualmente e rode de novo."
        return $false
    }
    Write-Host "  Instalando $Name via winget..."
    winget install --id $WingetId -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Fail([string]$Message) {
    Write-Host "ERRO: $Message" -ForegroundColor Red
    Read-Host 'Pressione Enter para sair'
    exit 1
}

# ---------------- elevar para administrador (precisa para Program Files) ----------------
if (-not (Test-Admin)) {
    Write-Host 'Elevando para administrador...'
    Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Host '=================================================='
Write-Host '  Open Winlin Prompt — Instalador'
Write-Host '=================================================='

# ---------------- 1. pasta + clone (substitui se existir) ----------------
Write-Host "`n[1/5] Preparando pasta e clonando o repositório..."
if (Test-Path $TargetDir) {
    Write-Host '  Instalação anterior encontrada — substituindo...'
    Remove-Item $TargetDir -Recurse -Force
}
if (-not (Ensure-Tool 'git' 'Git.Git')) { Fail 'Git é necessário para clonar o repositório.' }
git clone $RepoUrl $TargetDir
if ($LASTEXITCODE -ne 0) { Fail 'Falha ao clonar o repositório.' }

# ---------------- 2. dependências + build ----------------
Write-Host "`n[2/5] Instalando dependências e compilando..."
if (-not (Ensure-Tool 'node' 'OpenJS.NodeJS.LTS')) { Fail 'Node.js é necessário para compilar o programa.' }
Refresh-Path
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm não encontrado após instalar o Node.js. Feche e abra o terminal de novo.' }
Push-Location $TargetDir
npm ci
if ($LASTEXITCODE -ne 0) { npm install }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'Falha ao compilar o programa.' }
Pop-Location

# ---------------- 3. Ollama ----------------
Write-Host "`n[3/5] Verificando o Ollama..."
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
    Write-Host '  Ollama não encontrado.'
    if (Ask '  Instalar o Ollama agora (ollama.com)?') {
        Invoke-RestMethod -Uri 'https://ollama.com/install.ps1' | Invoke-Expression
        Refresh-Path
        $ollama = Get-Command ollama -ErrorAction SilentlyContinue
    }
}
if ($ollama) {
    Write-Host '  Ollama encontrado.'
    # garante que o servidor está rodando
    try {
        Invoke-RestMethod 'http://localhost:11434/api/version' -TimeoutSec 3 | Out-Null
    } catch {
        Write-Host '  Iniciando o servidor do Ollama...'
        Start-Process $ollama.Source -ArgumentList 'serve' -WindowStyle Hidden
        Start-Sleep -Seconds 4
    }
} else {
    Write-Host '  Ollama não instalado — as sugestões de IA ficarão indisponíveis.' -ForegroundColor Yellow
}

# ---------------- 4. modelo de IA ----------------
Write-Host "`n[4/5] Verificando o modelo de IA..."
if ($ollama) {
    $list = & $ollama.Source list 2>$null
    $hasModel = [bool]($list -match [regex]::Escape($Model))
    if ($hasModel) {
        Write-Host "  Modelo $Model já está no computador."
    } elseif (Ask "  Baixar o modelo $Model agora (~986 MB)?") {
        Write-Host '  Baixando (pode levar alguns minutos)...'
        & $ollama.Source pull $Model
        if ($LASTEXITCODE -ne 0) { Write-Host '  Aviso: falha ao baixar o modelo. Você pode tentar de novo no app.' -ForegroundColor Yellow }
    }
}

# ---------------- 5. atalho na área de trabalho ----------------
Write-Host "`n[5/5] Atalho na área de trabalho..."
if (Ask '  Criar o atalho "Open Winlin Prompt" na área de trabalho?') {
    $shell = New-Object -ComObject WScript.Shell
    $linkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Open Winlin Prompt.lnk'
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = Join-Path $TargetDir 'Abrir Open Winlin Prompt.cmd'
    $link.WorkingDirectory = $TargetDir
    $link.Description = 'Open Winlin Prompt'
    $link.Save()
    Write-Host "  Atalho criado: $linkPath"
}

Write-Host ''
Write-Host '==================================================' -ForegroundColor Green
Write-Host '  Instalação concluída!' -ForegroundColor Green
Write-Host "  Programa em: $TargetDir"
Write-Host '  Dica: se o app não reconhecer o Ollama, execute o'
Write-Host '  "Configurar Ollama.cmd" da pasta do programa.'
Write-Host '=================================================='
Read-Host 'Pressione Enter para sair'

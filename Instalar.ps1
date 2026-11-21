# Open Winlin Prompt — Instalador (interface gráfica)
# Uso: duplo clique em "Instalar.cmd" ou:
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File Instalar.ps1
#
# O que faz:
#   1. Substitui a pasta %LOCALAPPDATA%\Programs\open-winlin-prompt e clona o repositório
#      (sem necessidade de administrador — mesmo padrão do Ollama/VS Code)
#   2. Instala dependências e compila o programa (npm)
#   3. Detecta o Ollama; se não estiver instalado, instala (ollama.com)
#   4. Baixa o modelo de IA local (qwen2.5-coder:1.5b)
#   5. Cria atalho na área de trabalho
# As etapas 3–5 podem ser desligadas nas opções da janela.

$ErrorActionPreference = 'Continue'
$RepoUrl   = 'https://github.com/PedroNunes0z/open-winlin-prompt.git'
$TargetDir = "$env:LOCALAPPDATA\Programs\open-winlin-prompt"
$Model     = 'qwen2.5-coder:1.5b'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:cancelled = $false
$script:currentProc = $null
$script:ui = @{}

# ---------------------------------------------------------------- helpers
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Add-Log([string]$Line) {
    $form = $script:ui['form']
    if (-not $form) { Write-Host $Line; return }
    if ($form.InvokeRequired) {
        $form.BeginInvoke([Action[string]]{ param($s) $box = $script:ui['logBox']; $box.AppendText($s + [Environment]::NewLine); $box.SelectionStart = $box.Text.Length; $box.ScrollToCaret() }, @($Line))
        return
    }
    $logBox = $script:ui['logBox']
    $logBox.AppendText($Line + "`n")
    $logBox.SelectionStart = $logBox.Text.Length
    $logBox.ScrollToCaret()
}

function Set-Status([string]$Text) {
    $status = $script:ui['statusLabel']
    if (-not $status) { return }
    if ($status.InvokeRequired) { $status.Invoke([Action[string]]{ param($s) $script:ui['statusLabel'].Text = $s }, $Text); return }
    $status.Text = $Text
}

function Set-Progress([int]$Percent) {
    $bar = $script:ui['progressBar']
    if (-not $bar) { return }
    if ($bar.InvokeRequired) { $bar.Invoke([Action[int]]{ param($p) $script:ui['progressBar'].Value = [Math]::Min(100, [Math]::Max(0, $p)) }, $Percent); return }
    $bar.Value = [Math]::Min(100, [Math]::Max(0, $Percent))
}

function Throw-IfCancelled {
    if ($script:cancelled) { throw 'Instalação cancelada pelo usuário.' }
}

# executa um processo externo enviando toda a saída para o log
function Run-Step($Exe, $Arguments, $WorkDir = '') {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    if ($Exe -match '\.(cmd|bat)$') {
        $psi.FileName = "$env:SystemDirectory\cmd.exe"
        $psi.Arguments = '/c ""' + $Exe + '" ' + $Arguments + '"'
    } else {
        $psi.FileName = $Exe
        $psi.Arguments = $Arguments
    }
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    if ($WorkDir) { $psi.WorkingDirectory = $WorkDir }
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    $p.add_OutputDataReceived({ param($sender, $e) if ($e.Data) { Add-Log $e.Data } })
    $p.add_ErrorDataReceived({ param($sender, $e) if ($e.Data) { Add-Log $e.Data } })
    $script:currentProc = $p
    $null = $p.Start()
    $p.BeginOutputReadLine()
    $p.BeginErrorReadLine()
    $p.WaitForExit()
    try { $p.CancelOutputRead() } catch {}
    try { $p.CancelErrorRead() } catch {}
    $script:currentProc = $null
    return $p.ExitCode
}

# executa e captura a saída (para verificações rápidas)
function Run-Capture($Exe, $Arguments, $WorkDir = '') {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = $Arguments
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    if ($WorkDir) { $psi.WorkingDirectory = $WorkDir }
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    $null = $p.Start()
    $out = $p.StandardOutput.ReadToEndAsync()
    $err = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Out = $out.Result; Err = $err.Result }
}

function Ensure-Tool([string]$Name, [string]$WingetId) {
    if (Get-Command $Name -ErrorAction SilentlyContinue) { return $true }
    Add-Log "$Name não encontrado — instalando via winget..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Add-Log "ERRO: winget não encontrado. Instale o $Name manualmente e rode de novo."
        return $false
    }
    $code = Run-Step 'winget' "install --id $WingetId -e --accept-source-agreements --accept-package-agreements"
    Refresh-Path
    return ($code -eq 0 -and [bool](Get-Command $Name -ErrorAction SilentlyContinue))
}

function Get-OllamaExe {
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $wellKnown = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $wellKnown) { return $wellKnown }
    return $null
}

# ---------------------------------------------------------------- instalação
function Install-All([bool]$installOllama, [bool]$downloadModel, [bool]$makeShortcut) {
    try {
        # ---- 1. pasta + clone (substitui se existir)
        Set-Status 'Etapa 1/5 — preparando pasta e clonando...'
        Set-Progress 5
        Throw-IfCancelled
        if (Test-Path $TargetDir) {
            Add-Log 'Instalação anterior encontrada — substituindo...'
            Remove-Item $TargetDir -Recurse -Force
        }
        if (-not (Ensure-Tool 'git' 'Git.Git')) { throw 'Git é necessário para clonar o repositório.' }
        Throw-IfCancelled
        $git = (Get-Command git).Source
        if ((Run-Step $git "clone $RepoUrl `"$TargetDir`"") -ne 0) { throw 'Falha ao clonar o repositório.' }
        Set-Progress 25

        # ---- 2. dependências + build
        Set-Status 'Etapa 2/5 — instalando dependências e compilando...'
        Throw-IfCancelled
        if (-not (Ensure-Tool 'node' 'OpenJS.NodeJS.LTS')) { throw 'Node.js é necessário para compilar o programa.' }
        Refresh-Path
        $npm = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $npm) { throw 'npm não encontrado após instalar o Node.js. Feche e abra de novo.' }
        if ((Run-Step $npm.Source 'ci' $TargetDir) -ne 0) {
            Add-Log 'npm ci falhou — tentado npm install...'
            if ((Run-Step $npm.Source 'install' $TargetDir) -ne 0) { throw 'Falha ao instalar dependências.' }
        }
        Throw-IfCancelled
        if ((Run-Step $npm.Source 'run build' $TargetDir) -ne 0) { throw 'Falha ao compilar o programa.' }
        Set-Progress 50

        # ---- 3. Ollama
        Set-Status 'Etapa 3/5 — verificando o Ollama...'
        Throw-IfCancelled
        $ollamaExe = Get-OllamaExe
        if (-not $ollamaExe) {
            if ($installOllama) {
                Add-Log 'Ollama não encontrado — instalando (ollama.com)...'
                Invoke-RestMethod -Uri 'https://ollama.com/install.ps1' | Invoke-Expression
                Refresh-Path
                $ollamaExe = Get-OllamaExe
            } else {
                Add-Log 'Ollama não encontrado (opção de instalação desligada).'
            }
        }
        if ($ollamaExe) {
            Add-Log 'Ollama encontrado.'
            try {
                Invoke-RestMethod 'http://localhost:11434/api/version' -TimeoutSec 3 | Out-Null
            } catch {
                Add-Log 'Iniciando o servidor do Ollama...'
                Start-Process $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden
                Start-Sleep -Seconds 4
            }
        } else {
            Add-Log 'AVISO: Ollama não instalado — as sugestões de IA ficarão indisponíveis.'
        }
        Set-Progress 70

        # ---- 4. modelo
        Set-Status 'Etapa 4/5 — verificando o modelo de IA...'
        Throw-IfCancelled
        if ($ollamaExe) {
            $list = Run-Capture $ollamaExe 'list'
            $hasModel = $list.Out -match [regex]::Escape($Model)
            if ($hasModel) {
                Add-Log "Modelo $Model já está no computador."
            } elseif ($downloadModel) {
                Add-Log "Baixando o modelo $Model (pode levar alguns minutos)..."
                if ((Run-Step $ollamaExe "pull $Model") -ne 0) {
                    Add-Log 'AVISO: falha ao baixar o modelo. Tente de novo pelo app.'
                }
            } else {
                Add-Log 'Modelo não encontrado (opção de download desligada).'
            }
        }
        Set-Progress 90

        # ---- 5. atalho
        Set-Status 'Etapa 5/5 — atalho na área de trabalho...'
        Throw-IfCancelled
        if ($makeShortcut) {
            $shell = New-Object -ComObject WScript.Shell
            $linkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Open Winlin Prompt.lnk'
            $link = $shell.CreateShortcut($linkPath)
            $link.TargetPath = Join-Path $TargetDir 'Abrir Open Winlin Prompt.cmd'
            $link.WorkingDirectory = $TargetDir
            $link.Description = 'Open Winlin Prompt'
            $link.Save()
            Add-Log "Atalho criado: $linkPath"
        }
        Set-Progress 100
        Set-Status 'Instalação concluída!'
        Add-Log ''
        Add-Log '=================================================='
        Add-Log '  Instalação concluída!'
        Add-Log "  Programa em: $TargetDir"
        Add-Log '  Dica: se o app não reconhecer o Ollama, execute o'
        Add-Log '  "Configurar Ollama.cmd" da pasta do programa.'
        Add-Log '=================================================='
    } catch {
        Add-Log "ERRO: $($_.Exception.Message)"
        Set-Status 'Falha na instalação. Veja o log acima.'
    } finally {
        $form = $script:ui['form']
        if ($form) {
            $form.BeginInvoke([Action]{
                $script:ui['installBtn'].Enabled = $false
                $script:ui['cancelBtn'].Enabled = $false
                $script:ui['closeBtn'].Text = 'Fechar'
            })
        }
    }
}

# ---------------------------------------------------------------- janela
$script:ui['form'] = New-Object System.Windows.Forms.Form
$form = $script:ui['form']
$form.Text = 'Instalador — Open Winlin Prompt'
$form.Size = New-Object System.Drawing.Size(560, 560)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(32, 32, 32)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Open Winlin Prompt'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::White
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(16, 14)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Instalador'
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(180, 180, 180)
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(16, 44)
$form.Controls.Add($subtitle)

$options = New-Object System.Windows.Forms.GroupBox
$options.Text = 'Opções'
$options.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 220)
$options.BackColor = $form.BackColor
$options.Location = New-Object System.Drawing.Point(16, 70)
$options.Size = New-Object System.Drawing.Size(512, 110)
$form.Controls.Add($options)

function New-Check([string]$Text, [int]$Y) {
    $box = New-Object System.Windows.Forms.CheckBox
    $box.Text = $Text
    $box.Checked = $true
    $box.AutoSize = $true
    $box.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 220)
    $box.BackColor = $form.BackColor
    $box.Location = New-Object System.Drawing.Point(12, $Y)
    $options.Controls.Add($box)
    return $box
}

$script:ui['chkOllama'] = New-Check 'Instalar o Ollama (se ainda não estiver instalado)' 22
$script:ui['chkModel'] = New-Check "Baixar o modelo de IA ($Model, ~986 MB)" 52
$script:ui['chkShortcut'] = New-Check 'Criar atalho na área de trabalho' 82

$script:ui['statusLabel'] = New-Object System.Windows.Forms.Label
$status = $script:ui['statusLabel']
$status.Text = 'Pronto para instalar.'
$status.ForeColor = [System.Drawing.Color]::FromArgb(180, 220, 180)
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(16, 192)
$form.Controls.Add($status)

$script:ui['progressBar'] = New-Object System.Windows.Forms.ProgressBar
$bar = $script:ui['progressBar']
$bar.Location = New-Object System.Drawing.Point(16, 216)
$bar.Size = New-Object System.Drawing.Size(512, 18)
$bar.Minimum = 0
$bar.Maximum = 100
$form.Controls.Add($bar)

$script:ui['logBox'] = New-Object System.Windows.Forms.TextBox
$log = $script:ui['logBox']
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$log.Location = New-Object System.Drawing.Point(16, 244)
$log.Size = New-Object System.Drawing.Size(512, 230)
$log.Font = New-Object System.Drawing.Font('Consolas', 9)
$log.BackColor = [System.Drawing.Color]::FromArgb(20, 20, 20)
$log.ForeColor = [System.Drawing.Color]::FromArgb(210, 210, 210)
$form.Controls.Add($log)

$script:ui['installBtn'] = New-Object System.Windows.Forms.Button
$install = $script:ui['installBtn']
$install.Text = 'Instalar'
$install.Location = New-Object System.Drawing.Point(16, 486)
$install.Size = New-Object System.Drawing.Size(120, 32)
$install.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$install.BackColor = [System.Drawing.Color]::FromArgb(15, 108, 189)
$install.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($install)

$script:ui['cancelBtn'] = New-Object System.Windows.Forms.Button
$cancel = $script:ui['cancelBtn']
$cancel.Text = 'Cancelar'
$cancel.Location = New-Object System.Drawing.Point(308, 486)
$cancel.Size = New-Object System.Drawing.Size(110, 32)
$cancel.Enabled = $false
$form.Controls.Add($cancel)

$script:ui['closeBtn'] = New-Object System.Windows.Forms.Button
$close = $script:ui['closeBtn']
$close.Text = 'Fechar'
$close.Location = New-Object System.Drawing.Point(428, 486)
$close.Size = New-Object System.Drawing.Size(100, 32)
$form.Controls.Add($close)

$install.Add_Click({
    $optOllama = $script:ui['chkOllama'].Checked
    $optModel = $script:ui['chkModel'].Checked
    $optShortcut = $script:ui['chkShortcut'].Checked
    $script:cancelled = $false
    $script:ui['installBtn'].Enabled = $false
    $script:ui['cancelBtn'].Enabled = $true
    $script:ui['chkOllama'].Enabled = $false
    $script:ui['chkModel'].Enabled = $false
    $script:ui['chkShortcut'].Enabled = $false
    $script:ui['statusLabel'].Text = 'Instalando...'
    $task = [System.Threading.Tasks.Task]::Run([Action]{ Install-All -installOllama $optOllama -downloadModel $optModel -makeShortcut $optShortcut })
})

$cancel.Add_Click({
    $script:cancelled = $true
    Add-Log 'Cancelando...'
    if ($script:currentProc -and -not $script:currentProc.HasExited) {
        try { $script:currentProc.Kill() } catch {}
    }
})

$close.Add_Click({ $form.Close() })

$form.Add_FormClosing({
    $script:cancelled = $true
    if ($script:currentProc -and -not $script:currentProc.HasExited) {
        try { $script:currentProc.Kill() } catch {}
    }
})

[void]$form.ShowDialog()

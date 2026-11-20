# Open Winlin Prompt — Configuração automática da IA local (Ollama)
# Faz tudo sozinho: libera o Ollama para o app, reinicia o Ollama e baixa o modelo.
# Janela de progresso com Cancelar (e o X fecha/cancela).
# Uso: duplo clique em "Configurar Ollama.cmd" ou:  powershell -ExecutionPolicy Bypass -File scripts\configurar-ollama.ps1

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Model      = 'qwen2.5-coder:1.5b'
$OllamaUrl  = 'http://localhost:11434'
$Expected   = 986 * 1024 * 1024  # ~986 MB
$ModelsDir  = Join-Path $env:USERPROFILE '.ollama\models'
$PullOut    = Join-Path $env:TEMP 'owp-pull.log'
$PullErr    = Join-Path $env:TEMP 'owp-pull-err.log'

$script:cancelled  = $false
$script:step       = 0
$script:pullProc   = $null
$script:ollamaExe  = $null
$script:finished   = $false

# ----------------------------- janela de progresso -----------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Open Winlin Prompt — Configuração da IA local'
$form.Size = New-Object System.Drawing.Size(470, 230)
$form.StartPosition = 'CenterScreen'
$form.MinimizeBox = $false
$form.MaximizeBox = $false
$form.FormBorderStyle = 'FixedDialog'
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = 'Preparando...'
$label.AutoSize = $false
$label.Location = New-Object System.Drawing.Point(16, 14)
$label.Size = New-Object System.Drawing.Size(424, 64)
$label.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$form.Controls.Add($label)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(16, 88)
$progress.Size = New-Object System.Drawing.Size(424, 22)
$progress.Minimum = 0
$progress.Maximum = 100
$progress.Value = 0
$form.Controls.Add($progress)

$cancelBtn = New-Object System.Windows.Forms.Button
$cancelBtn.Text = 'Cancelar'
$cancelBtn.Location = New-Object System.Drawing.Point(326, 130)
$cancelBtn.Size = New-Object System.Drawing.Size(114, 30)
$form.Controls.Add($cancelBtn)

$closeBtn = New-Object System.Windows.Forms.Button
$closeBtn.Text = 'Fechar'
$closeBtn.Location = New-Object System.Drawing.Point(326, 130)
$closeBtn.Size = New-Object System.Drawing.Size(114, 30)
$closeBtn.Visible = $false
$form.Controls.Add($closeBtn)

function Set-Status([string]$text, [bool]$error = $false) {
    $label.Text = $text
    $label.ForeColor = if ($error) { [System.Drawing.Color]::Firebrick } else { [System.Drawing.Color]::Black }
}

function Stop-Pull {
    if ($script:pullProc -and -not $script:pullProc.HasExited) {
        try { $script:pullProc.Kill() } catch { }
    }
}

function Finish-With([string]$text, [bool]$error = $false) {
    $script:finished = $true
    $timer.Stop()
    Set-Status $text $error
    $progress.Value = if ($error) { $progress.Value } else { 100 }
    $cancelBtn.Visible = $false
    $closeBtn.Visible = $true
}

$cancelBtn.Add_Click({ $script:cancelled = $true; Stop-Pull; $form.Close() })
$closeBtn.Add_Click({ $form.Close() })
$form.Add_FormClosing({
    $script:cancelled = $true
    Stop-Pull
    try { $timer.Stop() } catch { }
})

# ----------------------------- máquina de etapas -----------------------------
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({
    if ($script:cancelled) { $timer.Stop(); return }

    switch ($script:step) {

        0 { # localizar o ollama
            $cmd = Get-Command ollama -ErrorAction SilentlyContinue
            if ($cmd) { $script:ollamaExe = $cmd.Source }
            elseif (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe") { $script:ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
            if (-not $script:ollamaExe) {
                Finish-With "Ollama não encontrado. Baixe em https://ollama.com/download e rode este script de novo." $true
                Start-Process 'https://ollama.com/download'
                return
            }
            $script:step = 1
        }

        1 { # liberar o Ollama para o app (aceitar pedidos de arquivo local)
            Set-Status 'Liberando o Ollama para o Open Winlin Prompt...'
            [System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User')
            $env:OLLAMA_ORIGINS = '*'
            $progress.Value = 12
            $script:step = 2
        }

        2 { # parar o Ollama atual (para ele reler a configuração)
            Set-Status 'Reiniciando o Ollama para aplicar a liberação...'
            Get-Process -Name ollama -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            $progress.Value = 28
            $script:step = 3
        }

        3 { # aguardar o Ollama parar
            if (Get-Process -Name ollama -ErrorAction SilentlyContinue) { return }
            $script:step = 4
        }

        4 { # iniciar o Ollama de novo
            Start-Process -FilePath $script:ollamaExe -ArgumentList 'serve' -WindowStyle Hidden
            $progress.Value = 45
            $script:step = 5
        }

        5 { # aguardar o Ollama responder
            Set-Status 'Aguardando o Ollama responder...'
            try {
                Invoke-RestMethod -Uri "$OllamaUrl/api/version" -TimeoutSec 2 | Out-Null
                $progress.Value = 60
                $script:step = 6
            } catch { return } # tenta de novo no próximo tick
        }

        6 { # baixar o modelo
            Set-Status "Baixando o modelo ($Model, ~986 MB). Pode levar alguns minutos..."
            $script:pullProc = Start-Process -FilePath $script:ollamaExe -ArgumentList 'pull', $Model `
                -NoNewWindow -PassThru -RedirectStandardOutput $PullOut -RedirectStandardError $PullErr
            $script:step = 7
        }

        7 { # acompanhar o download
            if (-not $script:pullProc) { $script:step = 6; return }
            if (-not $script:pullProc.HasExited) {
                $size = 0
                if (Test-Path $ModelsDir) {
                    $size = (Get-ChildItem $ModelsDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
                    if (-not $size) { $size = 0 }
                }
                $pct = [Math]::Min(97, 60 + [int](37 * ($size / $Expected)))
                $progress.Value = $pct
                Set-Status "Baixando o modelo... $pct%"
                return
            }
            if ($script:pullProc.ExitCode -eq 0) {
                $progress.Value = 100
                $script:step = 8
            } else {
                Finish-With "Falha ao baixar o modelo. Veja o arquivo $PullErr" $true
            }
        }

        8 { # conferir se o modelo ficou pronto
            try {
                $tags = Invoke-RestMethod -Uri "$OllamaUrl/api/tags" -TimeoutSec 5
                if ($tags.models.name -contains $Model) {
                    Finish-With "Pronto! Abra o Open Winlin Prompt e clique em Verificar de novo."
                } else {
                    Finish-With 'Download terminou, mas o modelo não apareceu. Rode o script de novo.' $true
                }
            } catch { Finish-With 'Não foi possível confirmar o modelo. Rode o script de novo.' $true }
        }
    }
})

$form.Add_Shown({ $timer.Start() })
$form.Add_Shown({
    [void]$form.Activate()
})
[void]$form.ShowDialog()

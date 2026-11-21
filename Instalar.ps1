# Open Winlin Prompt — Instalador (interface gráfica WPF)
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

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Xaml

$script:cancelled = $false
$script:done = $false
$script:errorMsg = ''
$script:statusText = 'Pronto para instalar.'
$script:progressPct = 0
$script:currentProc = $null
$script:logQueue = New-Object System.Collections.Concurrent.ConcurrentQueue[string]
$script:stepNames = @(
    'Clonar repositório (LOCALAPPDATA)',
    'Dependências e compilação (npm)',
    'Detectar / instalar o Ollama',
    'Baixar modelo de IA (qwen2.5-coder:1.5b)',
    'Atalho na área de trabalho'
)
$script:stepStates = @('pending', 'pending', 'pending', 'pending', 'pending')

# ---------------------------------------------------------------- helpers
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# log thread-safe: só enfileira; o timer da UI descarrega na thread principal
function Add-Log([string]$Line) { $script:logQueue.Enqueue($Line) }

function Throw-IfCancelled {
    if ($script:cancelled) { throw 'Instalação cancelada pelo usuário.' }
}

# executa um processo externo enviando toda a saída para a fila de log
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
        $script:stepStates[0] = 'running'
        $script:statusText = 'Etapa 1/5 — preparando pasta e clonando...'
        $script:progressPct = 5
        Throw-IfCancelled
        if (Test-Path $TargetDir) {
            Add-Log 'Instalação anterior encontrada — substituindo...'
            Remove-Item $TargetDir -Recurse -Force
        }
        if (-not (Ensure-Tool 'git' 'Git.Git')) { throw 'Git é necessário para clonar o repositório.' }
        Throw-IfCancelled
        $git = (Get-Command git).Source
        if ((Run-Step $git "clone $RepoUrl `"$TargetDir`"") -ne 0) { throw 'Falha ao clonar o repositório.' }
        $script:stepStates[0] = 'done'
        $script:progressPct = 25
        Add-Log "Repositório clonado em $TargetDir"

        # ---- 2. dependências + build
        $script:stepStates[1] = 'running'
        $script:statusText = 'Etapa 2/5 — instalando dependências e compilando...'
        Throw-IfCancelled
        if (-not (Ensure-Tool 'node' 'OpenJS.NodeJS.LTS')) { throw 'Node.js é necessário para compilar o programa.' }
        Refresh-Path
        $npm = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $npm) { throw 'npm não encontrado após instalar o Node.js.' }
        if ((Run-Step $npm.Source 'ci' $TargetDir) -ne 0) {
            Add-Log 'npm ci falhou — tentado npm install...'
            if ((Run-Step $npm.Source 'install' $TargetDir) -ne 0) { throw 'Falha ao instalar dependências.' }
        }
        Throw-IfCancelled
        if ((Run-Step $npm.Source 'run build' $TargetDir) -ne 0) { throw 'Falha ao compilar o programa.' }
        $script:stepStates[1] = 'done'
        $script:progressPct = 50

        # ---- 3. Ollama
        $script:stepStates[2] = 'running'
        $script:statusText = 'Etapa 3/5 — verificando o Ollama...'
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
        $script:stepStates[2] = 'done'
        $script:progressPct = 70

        # ---- 4. modelo
        $script:stepStates[3] = 'running'
        $script:statusText = 'Etapa 4/5 — verificando o modelo de IA...'
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
        $script:stepStates[3] = 'done'
        $script:progressPct = 90

        # ---- 5. atalho
        $script:stepStates[4] = 'running'
        $script:statusText = 'Etapa 5/5 — atalho na área de trabalho...'
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
        $script:stepStates[4] = 'done'
        $script:progressPct = 100
        $script:statusText = 'Instalação concluída!'
        Add-Log ''
        Add-Log '=================================================='
        Add-Log '  Instalação concluída!'
        Add-Log "  Programa em: $TargetDir"
        Add-Log '  Dica: se o app não reconhecer o Ollama, execute o'
        Add-Log '  "Configurar Ollama.cmd" da pasta do programa.'
        Add-Log '=================================================='
    } catch {
        Add-Log "ERRO: $($_.Exception.Message)"
        $script:errorMsg = $_.Exception.Message
        $script:statusText = 'Falha na instalação. Veja o log acima.'
        for ($i = 0; $i -lt $script:stepStates.Count; $i++) {
            if ($script:stepStates[$i] -eq 'running') { $script:stepStates[$i] = 'error' }
        }
    } finally {
        $script:done = $true
    }
}

# ---------------------------------------------------------------- interface (XAML)
$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Instalador — Open Winlin Prompt"
        Width="620" Height="680" WindowStyle="None" AllowsTransparency="True"
        WindowStartupLocation="CenterScreen" Background="Transparent"
        FontFamily="Segoe UI" TextElement.Foreground="#e9e9f4">
  <Window.Resources>
    <LinearGradientBrush x:Key="AccentBrush" StartPoint="0,0" EndPoint="1,0">
      <GradientStop Offset="0" Color="#8a2be2"/>
      <GradientStop Offset="1" Color="#ffa500"/>
    </LinearGradientBrush>
    <LinearGradientBrush x:Key="BgBrush" StartPoint="0,0" EndPoint="0,1">
      <GradientStop Offset="0" Color="#262633"/>
      <GradientStop Offset="1" Color="#17171e"/>
    </LinearGradientBrush>
    <Style x:Key="PrimaryButton" TargetType="Button">
      <Setter Property="Foreground" Value="#f8f8ff"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Background" Value="{StaticResource AccentBrush}"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="PART_Background" CornerRadius="9"
                    Background="{TemplateBinding Background}" SnapsToDevicePixels="True">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"
                                Margin="16,9" TextElement.Foreground="{TemplateBinding Foreground}"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="PART_Background" Property="Opacity" Value="0.88"/></Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="PART_Background" Property="Opacity" Value="0.72"/></Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="PART_Background" Property="Opacity" Value="0.38"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="GhostButton" TargetType="Button">
      <Setter Property="Foreground" Value="#c9c9dc"/>
      <Setter Property="FontSize" Value="12.5"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="BorderBrush" Value="#3c3c4c"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="PART_Background" CornerRadius="9" BorderThickness="1"
                    BorderBrush="{TemplateBinding BorderBrush}"
                    Background="{TemplateBinding Background}" SnapsToDevicePixels="True">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"
                                Margin="14,8" TextElement.Foreground="{TemplateBinding Foreground}"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="PART_Background" Property="Background" Value="#2c2c3a"/></Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="PART_Background" Property="Background" Value="#22222e"/></Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="PART_Background" Property="Opacity" Value="0.45"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="WindowButton" TargetType="Button" BasedOn="{StaticResource GhostButton}">
      <Setter Property="Foreground" Value="#a9a9c0"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="Padding" Value="0"/>
    </Style>
    <Style x:Key="OptionCard" TargetType="Border">
      <Setter Property="CornerRadius" Value="10"/>
      <Setter Property="Background" Value="#21212c"/>
      <Setter Property="BorderBrush" Value="#343441"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="12,9"/>
    </Style>
  </Window.Resources>

  <Border CornerRadius="18" BorderBrush="#3c3c4c" BorderThickness="1" Background="{StaticResource BgBrush}">
    <Grid Margin="22,16,22,20">
      <Grid.RowDefinitions>
        <RowDefinition Height="44"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <!-- cabeçalho -->
      <Grid x:Name="TitleBar" Grid.Row="0" Margin="0,0,0,10">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <StackPanel Orientation="Vertical" Grid.Column="0">
          <TextBlock FontSize="19" FontWeight="Bold">
            <Run Text="Open Winlin Prompt" Foreground="{StaticResource AccentBrush}"/>
          </TextBlock>
          <TextBlock FontSize="11" Foreground="#8f8fa8" Text="Instalador"/>
        </StackPanel>
        <Button x:Name="MinBtn" Grid.Column="1" Style="{StaticResource WindowButton}"
                Width="38" Content="_" Margin="0,0,4,6" VerticalAlignment="Top"/>
        <Button x:Name="CloseBtn" Grid.Column="2" Style="{StaticResource WindowButton}"
                Width="38" Content="✕" Margin="0,0,0,6" VerticalAlignment="Top"/>
      </Grid>

      <!-- status + progresso -->
      <TextBlock x:Name="StatusText" Grid.Row="1" FontSize="12.5" Margin="0,4,0,8"
                 Foreground="#a9f0c0" Text="Pronto para instalar."/>
      <Border Grid.Row="2" CornerRadius="5" Height="10" Background="#0f0f14"
              BorderBrush="#30303e" BorderThickness="1" Margin="0,0,0,12">
        <Border x:Name="ProgressTrack" CornerRadius="5" HorizontalAlignment="Left"
                Width="0" Background="{StaticResource AccentBrush}"/>
      </Border>

      <!-- etapas -->
      <TextBlock x:Name="StepsText" Grid.Row="3" FontSize="12" Margin="0,0,0,10"
                 Foreground="#c9c9dc" Text="○  Clonar repositório (LOCALAPPDATA)"/>

      <!-- opções -->
      <StackPanel Grid.Row="4" Orientation="Vertical" Margin="0,0,0,12">
        <Border Style="{StaticResource OptionCard}" Margin="0,0,0,7">
          <CheckBox x:Name="ChkOllama" IsChecked="True" Foreground="#e9e9f4">
            <StackPanel>
              <TextBlock FontWeight="SemiBold" FontSize="12.5" Text="Instalar o Ollama (se ainda não estiver instalado)"/>
              <TextBlock FontSize="11" Foreground="#8f8fa8" Text="Obrigatório para as sugestões de escrita locais"/>
            </StackPanel>
          </CheckBox>
        </Border>
        <Border Style="{StaticResource OptionCard}" Margin="0,0,0,7">
          <CheckBox x:Name="ChkModel" IsChecked="True" Foreground="#e9e9f4">
            <StackPanel>
              <TextBlock FontWeight="SemiBold" FontSize="12.5" Text="Baixar o modelo de IA (qwen2.5-coder:1.5b, ~986 MB)"/>
            </StackPanel>
          </CheckBox>
        </Border>
        <Border Style="{StaticResource OptionCard}">
          <CheckBox x:Name="ChkShortcut" IsChecked="True" Foreground="#e9e9f4">
            <StackPanel>
              <TextBlock FontWeight="SemiBold" FontSize="12.5" Text="Criar atalho 'Open Winlin Prompt' na área de trabalho"/>
            </StackPanel>
          </CheckBox>
        </Border>
      </StackPanel>

      <!-- log -->
      <Border Grid.Row="5" CornerRadius="10" BorderBrush="#30303e" BorderThickness="1">
        <TextBox x:Name="LogBox" IsReadOnly="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto"
                 Background="#0f0f14" Foreground="#cfcfe0" BorderThickness="0"
                 FontFamily="Consolas" FontSize="11" Padding="10"/>
      </Border>

      <!-- botões -->
      <Grid Grid.Row="6" Margin="0,14,0,0">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <Button x:Name="InstallBtn" Grid.Column="0" Style="{StaticResource PrimaryButton}"
                Content="Instalar" MinWidth="120"/>
        <Button x:Name="CancelBtn" Grid.Column="2" Style="{StaticResource GhostButton}"
                Content="Cancelar" MinWidth="100" Margin="0,0,8,0" IsEnabled="False"/>
        <Button x:Name="DoneBtn" Grid.Column="3" Style="{StaticResource GhostButton}"
                Content="Fechar" MinWidth="100"/>
      </Grid>
    </Grid>
  </Border>
</Window>
'@

$stringReader = New-Object System.IO.StringReader($xaml)
$xmlReader = [System.Xml.XmlReader]::Create($stringReader)
$window = [System.Windows.Markup.XamlReader]::Load($xmlReader)

$installBtn = $window.FindName('InstallBtn')
$cancelBtn = $window.FindName('CancelBtn')
$doneBtn = $window.FindName('DoneBtn')
$closeBtn = $window.FindName('CloseBtn')
$minBtn = $window.FindName('MinBtn')
$chkOllama = $window.FindName('ChkOllama')
$chkModel = $window.FindName('ChkModel')
$chkShortcut = $window.FindName('ChkShortcut')
$statusText = $window.FindName('StatusText')
$progressTrack = $window.FindName('ProgressTrack')
$logBox = $window.FindName('LogBox')
$stepsText = $window.FindName('StepsText')
$titleBar = $window.FindName('TitleBar')

# timer da UI: descarrega o log, atualiza progresso/etapas e estado final
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(150)
$timer.Add_Tick({
    $line = ''
    while ($script:logQueue.TryDequeue([ref]$line)) {
        $logBox.AppendText($line + [Environment]::NewLine)
    }
    if ($logBox.Text.Length -gt 0) { $logBox.ScrollToEnd() }
    $statusText.Text = $script:statusText
    try {
        $w = $progressTrack.Parent.ActualWidth
        if ($w -gt 0) { $progressTrack.Width = $w * ($script:progressPct / 100.0) }
    } catch {}
    $glyphs = @('', '○  ', '●  ', '✓  ', '✗  ')
    $states = @([ordered]@{ pending = '○  '; running = '●  '; done = '✓  '; error = '✗  ' })
    $lines = for ($i = 0; $i -lt $script:stepNames.Count; $i++) {
        $g = $states[0][$script:stepStates[$i]]
        "$g$($script:stepNames[$i])"
    }
    $stepsText.Text = ($lines -join [Environment]::NewLine)
    if ($script:done) {
        $installBtn.IsEnabled = $false
        $cancelBtn.IsEnabled = $false
        $chkOllama.IsEnabled = $false
        $chkModel.IsEnabled = $false
        $chkShortcut.IsEnabled = $false
        $statusText.Foreground = if ($script:errorMsg) { '#f0a390' } else { '#a9f0c0' }
        $statusText.Text = if ($script:errorMsg) { 'Falha na instalação. Veja o log acima.' } else { 'Instalação concluída!' }
        $timer.Stop()
    }
})

$installBtn.Add_Click({
    $optOllama = $chkOllama.IsChecked
    $optModel = $chkModel.IsChecked
    $optShortcut = $chkShortcut.IsChecked
    $script:cancelled = $false
    $installBtn.IsEnabled = $false
    $cancelBtn.IsEnabled = $true
    $chkOllama.IsEnabled = $false
    $chkModel.IsEnabled = $false
    $chkShortcut.IsEnabled = $false
    $statusText.Text = 'Instalando...'
    $task = [System.Threading.Tasks.Task]::Run([Action]{ Install-All -installOllama $optOllama -downloadModel $optModel -makeShortcut $optShortcut })
})

$cancelBtn.Add_Click({
    $script:cancelled = $true
    Add-Log 'Cancelando...'
    if ($script:currentProc -and -not $script:currentProc.HasExited) {
        try { $script:currentProc.Kill() } catch {}
    }
})

$doneBtn.Add_Click({ $window.Close() })
$closeBtn.Add_Click({ $window.Close() })
$minBtn.Add_Click({ $window.WindowState = [System.Windows.WindowState]::Minimized })
$titleBar.Add_MouseLeftButtonDown({ $window.DragMove() })
$window.Add_Closing({
    $script:cancelled = $true
    if ($script:currentProc -and -not $script:currentProc.HasExited) {
        try { $script:currentProc.Kill() } catch {}
    }
})

$timer.Start()
[void]$window.ShowDialog()

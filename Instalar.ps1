# Open Winlin Prompt — Instalador (interface gráfica WPF)
# Uso: duplo clique em "Instalar.cmd" ou:
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File Instalar.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$RepoUrl   = 'https://github.com/PedroNunes0z/open-winlin-prompt.git'
$TargetDir = "$env:LOCALAPPDATA\Programs\open-winlin-prompt"
$Model     = 'qwen2.5-coder:1.5b'

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Xaml

# Helper C# para rodar processos, limpar códigos ANSI e enfileirar logs sem depender de Runspace
Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

public class ProcRunner {
    private static readonly Regex AnsiRegex = new Regex(@"\x1B\[[0-9;?]*[ -/]*[@-~]", RegexOptions.Compiled);

    private static void EnqueueClean(string raw, ConcurrentQueue<string> queue) {
        if (raw == null) return;
        string clean = AnsiRegex.Replace(raw, "").TrimEnd('\r', '\n');
        string trimmed = clean.Trim();
        if (trimmed.Length == 0) return;
        if (trimmed.Length == 1 && "|/-\\⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".IndexOf(trimmed[0]) >= 0) return;
        queue.Enqueue(clean);
    }

    public static int Run(string exe, string args, string workDir, ConcurrentQueue<string> logQueue, Func<bool> isCancelled) {
        var psi = new ProcessStartInfo {
            FileName = exe,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            CreateNoWindow = true
        };
        if (!string.IsNullOrEmpty(workDir)) psi.WorkingDirectory = workDir;

        using (var p = new Process { StartInfo = psi }) {
            p.OutputDataReceived += (s, e) => EnqueueClean(e.Data, logQueue);
            p.ErrorDataReceived  += (s, e) => EnqueueClean(e.Data, logQueue);
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();

            while (!p.WaitForExit(200)) {
                if (isCancelled != null && isCancelled()) {
                    try {
                        var tk = Process.Start(new ProcessStartInfo("taskkill", "/F /T /PID " + p.Id) {
                            CreateNoWindow = true,
                            UseShellExecute = false
                        });
                        if (tk != null) tk.WaitForExit(2000);
                    } catch {}
                    try { p.Kill(); } catch {}
                    break;
                }
            }
            p.WaitForExit();
            return p.ExitCode;
        }
    }

    public static string Capture(string exe, string args, string workDir) {
        var psi = new ProcessStartInfo {
            FileName = exe,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            CreateNoWindow = true
        };
        if (!string.IsNullOrEmpty(workDir)) psi.WorkingDirectory = workDir;

        using (var p = new Process { StartInfo = psi }) {
            p.Start();
            string stdout = p.StandardOutput.ReadToEnd();
            string stderr = p.StandardError.ReadToEnd();
            p.WaitForExit();
            return stdout + "\n" + stderr;
        }
    }
}
"@

# Estado compartilhado entre a thread da UI e o Runspace da instalação
$sync = [hashtable]::Synchronized(@{
    Cancelled   = $false
    Done        = $false
    Success     = $false
    ErrorMsg    = ''
    StatusText  = 'Pronto para instalar.'
    ProgressPct = 0
    LogQueue    = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
    StepStates  = @('pending', 'pending', 'pending', 'pending', 'pending')
})

# ---------------------------------------------------------------- worker (Runspace próprio)
$workerScript = {
    param($Sync, $RepoUrl, $TargetDir, $Model, $InstallOllama, $DownloadModel, $MakeShortcut)

    $ErrorActionPreference = 'Stop'
    $ProgressPreference    = 'SilentlyContinue'

    function Add-Log([string]$Line) { $Sync.LogQueue.Enqueue($Line) }

    function Throw-IfCancelled {
        if ($Sync.Cancelled) { throw 'Instalação cancelada pelo usuário.' }
    }

    function Refresh-Path {
        $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
        $env:Path = "$machine;$user"
    }

    # Resolve o caminho real de um executável: aceita caminho completo, shim sem
    # extensão (npm/npx) e nomes simples buscados no PATH. Devolve $null se não existir.
    function Resolve-Executable([string]$Exe) {
        if ([string]::IsNullOrWhiteSpace($Exe)) { return $null }
        if (Test-Path -LiteralPath $Exe -PathType Leaf) { return (Resolve-Path -LiteralPath $Exe).Path }
        if (-not ($Exe -match '\.(exe|cmd|bat|ps1)$')) {
            foreach ($ext in @('.cmd', '.bat', '.exe')) {
                if (Test-Path -LiteralPath "$Exe$ext" -PathType Leaf) { return "$Exe$ext" }
            }
        }
        $found = Get-Command $Exe -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandType -ne 'Alias' -and $_.Source } |
            Select-Object -First 1
        if ($found -and (Test-Path -LiteralPath $found.Source -PathType Leaf)) { return $found.Source }
        return $null
    }

    function Run-Step([string]$Exe, [string]$Arguments, [string]$WorkDir = '') {
        $resolved = Resolve-Executable $Exe
        if (-not $resolved) {
            throw "Programa nao encontrado: '$Exe'. Verifique a instalacao e tente de novo."
        }
        $Exe = $resolved

        if ($Exe -match '\.(cmd|bat)$') {
            $cmdExe   = if ($env:SystemDirectory) { "$env:SystemDirectory\cmd.exe" } else { "$env:WINDIR\System32\cmd.exe" }
            $realExe  = $cmdExe
            $realArgs = '/d /s /c ""' + $Exe + '" ' + $Arguments + '"'
        } elseif ($Exe -match '\.js$') {
            # CLI em JavaScript (npm-cli.js): executa com o node
            $nodeExe  = (Resolve-Executable 'node')
            if (-not $nodeExe) { throw 'Node.js nao encontrado para executar o npm.' }
            $realExe  = $nodeExe
            $realArgs = "`"$Exe`" $Arguments"
        } elseif ($Exe -match '\.ps1$') {
            # shims .ps1 (alguns gerenciadores de versao criam apenas o .ps1)
            $psExe    = if ($env:SystemDirectory) { "$env:SystemDirectory\WindowsPowerShell\v1.0\powershell.exe" } else { 'powershell.exe' }
            $realExe  = $psExe
            $realArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$Exe`" $Arguments"
        } else {
            $realExe  = $Exe
            $realArgs = $Arguments
        }

        Add-Log "> $Exe $Arguments"
        $cancelCheck = [Func[bool]]{ return $Sync.Cancelled }
        try {
            $code = [ProcRunner]::Run($realExe, $realArgs, $WorkDir, $Sync.LogQueue, $cancelCheck)
        } catch {
            throw "Falha ao executar '$Exe': $($_.Exception.Message)"
        }
        Throw-IfCancelled
        return $code
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

    function Get-NpmExe {
        # 1) npm.cmd ao lado do node.exe (instalacao oficial / winget)
        $node = Get-Command node -ErrorAction SilentlyContinue
        if ($node -and $node.Source) {
            $nodeDir = Split-Path $node.Source -Parent
            foreach ($name in @('npm.cmd', 'npm.exe')) {
                $candidate = Join-Path $nodeDir $name
                if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
            }
        }
        # 2) npm.cmd / npm no PATH
        foreach ($name in @('npm.cmd', 'npm')) {
            $found = Resolve-Executable $name
            if ($found) { return $found }
        }
        # 3) npm-cli.js direto pelo node (nvm/fnm/instalacoes portateis)
        if ($node -and $node.Source) {
            $nodeDir = Split-Path $node.Source -Parent
            $cli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
            if (Test-Path -LiteralPath $cli -PathType Leaf) { return $cli }
        }
        return $null
    }

    # O servidor pode responder por localhost ou 127.0.0.1; se o HTTP falhar
    # (proxy/IPv6), um teste de porta TCP já indica que ele está de pe.
    function Test-OllamaServer {
        foreach ($host_ in @('127.0.0.1', 'localhost')) {
            try {
                Invoke-RestMethod "http://$host_`:11434/api/version" -TimeoutSec 2 | Out-Null
                return $true
            } catch {}
        }
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $async  = $client.BeginConnect('127.0.0.1', 11434, $null, $null)
            $ok     = $async.AsyncWaitHandle.WaitOne(1000) -and $client.Connected
            $client.Close()
            if ($ok) { return $true }
        } catch {}
        return $false
    }

    function Get-OllamaExe {
        $cmd = Get-Command ollama -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
        $candidates = @(
            "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
            "$env:ProgramFiles\Ollama\ollama.exe"
        )
        foreach ($path in $candidates) {
            if (Test-Path $path) { return $path }
        }
        return $null
    }

    function Install-OllamaWindows {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Add-Log 'Tentando instalar o Ollama via winget...'
            $code = Run-Step 'winget' 'install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements'
            Refresh-Path
            $exe = Get-OllamaExe
            if ($code -eq 0 -and $exe) { return $exe }
        }

        Add-Log 'Baixando instalador oficial do Ollama (ollama.com)...'
        $setupPath = Join-Path $env:TEMP 'OllamaSetup.exe'
        Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $setupPath -UseBasicParsing
        Throw-IfCancelled

        Add-Log 'Executando instalação silenciosa do Ollama (aguarde)...'
        $null = Run-Step $setupPath '/VERYSILENT /NORESTART'
        Remove-Item $setupPath -Force -ErrorAction SilentlyContinue
        Refresh-Path
        return (Get-OllamaExe)
    }

    try {
        # ---- 1. Pasta + clone
        $Sync.StepStates[0] = 'running'
        $Sync.StatusText    = 'Etapa 1/5 — preparando pasta e clonando...'
        $Sync.ProgressPct   = 5
        Throw-IfCancelled

        if (-not (Ensure-Tool 'git' 'Git.Git')) { throw 'Git é necessário para clonar o repositório.' }
        Throw-IfCancelled

        if (Test-Path $TargetDir) {
            Add-Log 'Instalação anterior encontrada — substituindo...'
            try {
                Remove-Item $TargetDir -Recurse -Force
            } catch {
                throw 'Não foi possível substituir a pasta anterior. Feche o Open Winlin Prompt se ele estiver aberto e tente novamente.'
            }
        }

        $parentDir = Split-Path $TargetDir -Parent
        if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Path $parentDir -Force | Out-Null }

        $git = (Get-Command git).Source
        if ((Run-Step $git "clone `"$RepoUrl`" `"$TargetDir`"") -ne 0) { throw 'Falha ao clonar o repositório.' }
        $Sync.StepStates[0] = 'done'
        $Sync.ProgressPct   = 25
        Add-Log "Repositório clonado em $TargetDir"

        # ---- 2. Dependências + build
        $Sync.StepStates[1] = 'running'
        $Sync.StatusText    = 'Etapa 2/5 — instalando dependências e compilando...'
        Throw-IfCancelled

        if (-not (Ensure-Tool 'node' 'OpenJS.NodeJS.LTS')) { throw 'Node.js é necessário para compilar o programa.' }
        Refresh-Path
        $npmExe = Get-NpmExe
        if (-not $npmExe) { throw 'npm não encontrado após instalar o Node.js. Reinicie o instalador.' }

        $hasLock = Test-Path (Join-Path $TargetDir 'package-lock.json')
        if ($hasLock) {
            if ((Run-Step $npmExe 'ci' $TargetDir) -ne 0) {
                Add-Log 'npm ci falhou — tentando npm install...'
                if ((Run-Step $npmExe 'install' $TargetDir) -ne 0) { throw 'Falha ao instalar dependências.' }
            }
        } else {
            if ((Run-Step $npmExe 'install' $TargetDir) -ne 0) { throw 'Falha ao instalar dependências.' }
        }

        if ((Run-Step $npmExe 'run build' $TargetDir) -ne 0) { throw 'Falha ao compilar o programa.' }
        $Sync.StepStates[1] = 'done'
        $Sync.ProgressPct   = 50

        # ---- 3. Ollama
        $Sync.StepStates[2] = 'running'
        $Sync.StatusText    = 'Etapa 3/5 — verificando o Ollama...'
        Throw-IfCancelled

        $ollamaExe = Get-OllamaExe
        if (-not $ollamaExe) {
            if ($InstallOllama) {
                $ollamaExe = Install-OllamaWindows
            } else {
                Add-Log 'Ollama não encontrado (opção de instalação desligada).'
            }
        }

        if ($ollamaExe) {
            Add-Log "Ollama encontrado em: $ollamaExe"
            $serverReady = Test-OllamaServer

            if (-not $serverReady) {
                Add-Log 'Iniciando o servidor do Ollama...'
                try { Start-Process $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden } catch {}
                for ($attempt = 0; $attempt -lt 15; $attempt++) {
                    Throw-IfCancelled
                    Start-Sleep -Seconds 1
                    if (Test-OllamaServer) { $serverReady = $true; break }
                }
            }
            if ($serverReady) {
                Add-Log 'Servidor do Ollama ativo.'
            } else {
                Add-Log 'AVISO: o servidor do Ollama demorou para responder.'
            }
        } else {
            Add-Log 'AVISO: Ollama não instalado — as sugestões de IA ficarão indisponíveis.'
        }
        $Sync.StepStates[2] = 'done'
        $Sync.ProgressPct   = 70

        # ---- 4. Modelo
        $Sync.StepStates[3] = 'running'
        $Sync.StatusText    = 'Etapa 4/5 — verificando o modelo de IA...'
        Throw-IfCancelled

        if ($ollamaExe) {
            $models = [ProcRunner]::Capture($ollamaExe, 'list', '')
            if ($models -match [regex]::Escape($Model)) {
                Add-Log "Modelo $Model já está instalado."
            } elseif ($DownloadModel) {
                Add-Log "Baixando o modelo $Model (pode levar alguns minutos)..."
                if ((Run-Step $ollamaExe "pull $Model") -ne 0) {
                    Add-Log 'AVISO: falha ao baixar o modelo. Tente novamente pelo app.'
                } else {
                    Add-Log "Modelo $Model baixado com sucesso."
                }
            } else {
                Add-Log 'Modelo não encontrado (opção de download desligada).'
            }
        }
        $Sync.StepStates[3] = 'done'
        $Sync.ProgressPct   = 90

        # ---- 5. Atalho
        $Sync.StepStates[4] = 'running'
        $Sync.StatusText    = 'Etapa 5/5 — criando atalho na área de trabalho...'
        Throw-IfCancelled

        if ($MakeShortcut) {
            $shell    = New-Object -ComObject WScript.Shell
            $linkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Open Winlin Prompt.lnk'
            $link     = $shell.CreateShortcut($linkPath)
            $link.TargetPath       = Join-Path $TargetDir 'Abrir Open Winlin Prompt.cmd'
            $link.WorkingDirectory = $TargetDir
            $link.Description      = 'Open Winlin Prompt'
            $iconFile = Get-ChildItem -Path $TargetDir -Filter '*.ico' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($iconFile) { $link.IconLocation = $iconFile.FullName }
            $link.Save()
            Add-Log "Atalho criado: $linkPath"
        }

        $Sync.StepStates[4] = 'done'
        $Sync.ProgressPct   = 100
        $Sync.Success       = $true
        $Sync.StatusText    = 'Instalação concluída!'
        Add-Log ''
        Add-Log '=================================================='
        Add-Log '  Instalação concluída com sucesso!'
        Add-Log "  Programa em: $TargetDir"
        Add-Log '  Dica: se o app não reconhecer o Ollama, execute o'
        Add-Log '  "Configurar Ollama.cmd" na pasta do programa.'
        Add-Log '=================================================='
    } catch {
        Add-Log "ERRO: $($_.Exception.Message)"
        $Sync.ErrorMsg   = $_.Exception.Message
        $Sync.StatusText = if ($Sync.Cancelled) { 'Instalação cancelada.' } else { 'Falha na instalação. Veja o log acima.' }
        for ($i = 0; $i -lt $Sync.StepStates.Count; $i++) {
            if ($Sync.StepStates[$i] -eq 'running') { $Sync.StepStates[$i] = 'error' }
        }
    } finally {
        $Sync.Done = $true
    }
}

# ---------------------------------------------------------------- interface (XAML)
$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Instalador — Open Winlin Prompt"
        Width="640" Height="710" WindowStyle="None" AllowsTransparency="True"
        ResizeMode="NoResize" WindowStartupLocation="CenterScreen" Background="Transparent"
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
      <Setter Property="Height" Value="36"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Background" Value="{StaticResource AccentBrush}"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="PART_Background" CornerRadius="9"
                    Background="{TemplateBinding Background}" SnapsToDevicePixels="True">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"
                                Margin="18,0" RecognizesAccessKey="False"
                                TextElement.Foreground="{TemplateBinding Foreground}"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="PART_Background" Property="Opacity" Value="0.88"/>
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="PART_Background" Property="Opacity" Value="0.72"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="PART_Background" Property="Opacity" Value="0.38"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="GhostButton" TargetType="Button">
      <Setter Property="Foreground" Value="#c9c9dc"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Height" Value="36"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="BorderBrush" Value="#3c3c4c"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="PART_Background" CornerRadius="9" BorderThickness="1"
                    BorderBrush="{TemplateBinding BorderBrush}"
                    Background="{TemplateBinding Background}" SnapsToDevicePixels="True">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"
                                Margin="16,0" RecognizesAccessKey="False"
                                TextElement.Foreground="{TemplateBinding Foreground}"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="PART_Background" Property="Background" Value="#2c2c3a"/>
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="PART_Background" Property="Background" Value="#22222e"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="PART_Background" Property="Opacity" Value="0.45"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="WindowButton" TargetType="Button">
      <Setter Property="Foreground" Value="#a9a9c0"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Width" Value="34"/>
      <Setter Property="Height" Value="30"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="BorderBrush" Value="#3c3c4c"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="PART_Background" CornerRadius="8" BorderThickness="1"
                    BorderBrush="{TemplateBinding BorderBrush}"
                    Background="{TemplateBinding Background}" SnapsToDevicePixels="True">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"
                                RecognizesAccessKey="False"
                                TextElement.Foreground="{TemplateBinding Foreground}"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="PART_Background" Property="Background" Value="#2c2c3a"/>
                <Setter Property="Foreground" Value="#ffffff"/>
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="PART_Background" Property="Background" Value="#22222e"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="OptionCard" TargetType="Border">
      <Setter Property="CornerRadius" Value="10"/>
      <Setter Property="Background" Value="#21212c"/>
      <Setter Property="BorderBrush" Value="#343441"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="12,9"/>
    </Style>

    <Style x:Key="CardCheckBox" TargetType="CheckBox">
      <Setter Property="Foreground" Value="#e9e9f4"/>
      <Setter Property="VerticalContentAlignment" Value="Center"/>
      <Setter Property="HorizontalAlignment" Value="Stretch"/>
      <Setter Property="Padding" Value="8,0,0,0"/>
      <Setter Property="Cursor" Value="Hand"/>
    </Style>
  </Window.Resources>

  <Border CornerRadius="18" BorderBrush="#3c3c4c" BorderThickness="1" Background="{StaticResource BgBrush}">
    <Grid Margin="22,18,22,20">
      <Grid.RowDefinitions>
        <RowDefinition Height="46"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <!-- cabeçalho -->
      <Grid x:Name="TitleBar" Grid.Row="0" Margin="0,0,0,8" Background="Transparent">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <StackPanel Orientation="Vertical" Grid.Column="0" VerticalAlignment="Center">
          <TextBlock FontSize="19" FontWeight="Bold">
            <Run Text="Open Winlin Prompt" Foreground="{StaticResource AccentBrush}"/>
          </TextBlock>
          <TextBlock FontSize="11.5" Foreground="#8f8fa8" Text="Instalador"/>
        </StackPanel>
        <Button x:Name="MinBtn" Grid.Column="1" Style="{StaticResource WindowButton}"
                Content="&#x2212;" Margin="0,0,6,0" VerticalAlignment="Center" ToolTip="Minimizar"/>
        <Button x:Name="CloseBtn" Grid.Column="2" Style="{StaticResource WindowButton}"
                Content="&#x2715;" VerticalAlignment="Center" ToolTip="Fechar"/>
      </Grid>

      <!-- status + progresso -->
      <TextBlock x:Name="StatusText" Grid.Row="1" FontSize="12.5" Margin="0,2,0,8"
                 Foreground="#a9f0c0" Text="Pronto para instalar."/>
      <Border Grid.Row="2" CornerRadius="5" Height="10" Background="#0f0f14"
              BorderBrush="#30303e" BorderThickness="1" Margin="0,0,0,12" ClipToBounds="True">
        <Border x:Name="ProgressTrack" CornerRadius="4" HorizontalAlignment="Left"
                Width="0" Background="{StaticResource AccentBrush}"/>
      </Border>

      <!-- etapas com colunas alinhadas -->
      <StackPanel Grid.Row="3" Orientation="Vertical" Margin="0,0,0,12">
        <Grid Margin="0,0,0,3">
          <Grid.ColumnDefinitions><ColumnDefinition Width="22"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
          <TextBlock x:Name="StepIcon0" Grid.Column="0" Text="○" Foreground="#7e7e96" FontSize="12" HorizontalAlignment="Center"/>
          <TextBlock x:Name="StepLabel0" Grid.Column="1" Text="Clonar repositório (LOCALAPPDATA)" Foreground="#9e9eb4" FontSize="12"/>
        </Grid>
        <Grid Margin="0,0,0,3">
          <Grid.ColumnDefinitions><ColumnDefinition Width="22"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
          <TextBlock x:Name="StepIcon1" Grid.Column="0" Text="○" Foreground="#7e7e96" FontSize="12" HorizontalAlignment="Center"/>
          <TextBlock x:Name="StepLabel1" Grid.Column="1" Text="Dependências e compilação (npm)" Foreground="#9e9eb4" FontSize="12"/>
        </Grid>
        <Grid Margin="0,0,0,3">
          <Grid.ColumnDefinitions><ColumnDefinition Width="22"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
          <TextBlock x:Name="StepIcon2" Grid.Column="0" Text="○" Foreground="#7e7e96" FontSize="12" HorizontalAlignment="Center"/>
          <TextBlock x:Name="StepLabel2" Grid.Column="1" Text="Detectar / instalar o Ollama" Foreground="#9e9eb4" FontSize="12"/>
        </Grid>
        <Grid Margin="0,0,0,3">
          <Grid.ColumnDefinitions><ColumnDefinition Width="22"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
          <TextBlock x:Name="StepIcon3" Grid.Column="0" Text="○" Foreground="#7e7e96" FontSize="12" HorizontalAlignment="Center"/>
          <TextBlock x:Name="StepLabel3" Grid.Column="1" Text="Baixar modelo de IA ($Model)" Foreground="#9e9eb4" FontSize="12"/>
        </Grid>
        <Grid>
          <Grid.ColumnDefinitions><ColumnDefinition Width="22"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
          <TextBlock x:Name="StepIcon4" Grid.Column="0" Text="○" Foreground="#7e7e96" FontSize="12" HorizontalAlignment="Center"/>
          <TextBlock x:Name="StepLabel4" Grid.Column="1" Text="Atalho na área de trabalho" Foreground="#9e9eb4" FontSize="12"/>
        </Grid>
      </StackPanel>

      <!-- opções -->
      <StackPanel Grid.Row="4" Orientation="Vertical" Margin="0,0,0,12">
        <Border Style="{StaticResource OptionCard}" Margin="0,0,0,7">
          <CheckBox x:Name="ChkOllama" IsChecked="True" Style="{StaticResource CardCheckBox}">
            <StackPanel>
              <TextBlock FontWeight="SemiBold" FontSize="12.5" Text="Instalar o Ollama (se ainda não estiver instalado)"/>
              <TextBlock FontSize="11" Foreground="#8f8fa8" Text="Obrigatório para as sugestões de escrita locais"/>
            </StackPanel>
          </CheckBox>
        </Border>
        <Border Style="{StaticResource OptionCard}" Margin="0,0,0,7">
          <CheckBox x:Name="ChkModel" IsChecked="True" Style="{StaticResource CardCheckBox}">
            <StackPanel>
              <TextBlock FontWeight="SemiBold" FontSize="12.5" Text="Baixar o modelo de IA ($Model, ~986 MB)"/>
            </StackPanel>
          </CheckBox>
        </Border>
        <Border Style="{StaticResource OptionCard}">
          <CheckBox x:Name="ChkShortcut" IsChecked="True" Style="{StaticResource CardCheckBox}">
            <StackPanel>
              <TextBlock FontWeight="SemiBold" FontSize="12.5" Text="Criar atalho 'Open Winlin Prompt' na área de trabalho"/>
            </StackPanel>
          </CheckBox>
        </Border>
      </StackPanel>

      <!-- log -->
      <Border Grid.Row="5" CornerRadius="10" BorderBrush="#30303e" BorderThickness="1" Background="#0f0f14" Padding="2">
        <TextBox x:Name="LogBox" IsReadOnly="True" TextWrapping="Wrap"
                 VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled"
                 Background="Transparent" Foreground="#cfcfe0" BorderThickness="0"
                 FontFamily="Consolas" FontSize="11.5" Padding="8,6">
          <TextBox.ContextMenu>
            <ContextMenu>
              <MenuItem x:Name="CopyLogItem" Header="Copiar log"/>
            </ContextMenu>
          </TextBox.ContextMenu>
        </TextBox>
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
                Content="Instalar" MinWidth="124"/>
        <Button x:Name="CancelBtn" Grid.Column="2" Style="{StaticResource GhostButton}"
                Content="Cancelar" MinWidth="104" Margin="0,0,8,0" IsEnabled="False"/>
        <Button x:Name="DoneBtn" Grid.Column="3" Style="{StaticResource GhostButton}"
                Content="Fechar" MinWidth="104"/>
      </Grid>
    </Grid>
  </Border>
</Window>
"@

$stringReader = New-Object System.IO.StringReader($xaml)
$xmlReader    = [System.Xml.XmlReader]::Create($stringReader)
$window       = [System.Windows.Markup.XamlReader]::Load($xmlReader)

$installBtn    = $window.FindName('InstallBtn')
$cancelBtn     = $window.FindName('CancelBtn')
$doneBtn       = $window.FindName('DoneBtn')
$closeBtn      = $window.FindName('CloseBtn')
$minBtn        = $window.FindName('MinBtn')
$chkOllama     = $window.FindName('ChkOllama')
$chkModel      = $window.FindName('ChkModel')
$chkShortcut   = $window.FindName('ChkShortcut')
$statusText    = $window.FindName('StatusText')
$progressTrack = $window.FindName('ProgressTrack')
$logBox        = $window.FindName('LogBox')
$copyLogItem   = $window.FindName('CopyLogItem')
$titleBar      = $window.FindName('TitleBar')

$stepIcons  = 0..4 | ForEach-Object { $window.FindName("StepIcon$_") }
$stepLabels = 0..4 | ForEach-Object { $window.FindName("StepLabel$_") }

$stateVisuals = @{
    pending = @{ Glyph = '○'; IconColor = '#7e7e96'; TextColor = '#9e9eb4' }
    running = @{ Glyph = '●'; IconColor = '#ffb84d'; TextColor = '#f4f4ff' }
    done    = @{ Glyph = '✓'; IconColor = '#7ce8a6'; TextColor = '#d4f7e2' }
    error   = @{ Glyph = '✗'; IconColor = '#f08080'; TextColor = '#f5b8b8' }
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(150)
$timer.Add_Tick({
    $line = ''
    $sb = New-Object System.Text.StringBuilder
    while ($sync.LogQueue.TryDequeue([ref]$line)) {
        [void]$sb.AppendLine($line)
    }
    if ($sb.Length -gt 0) {
        $atBottom = ($logBox.VerticalOffset + $logBox.ViewportHeight) -ge ($logBox.ExtentHeight - 20)
        $logBox.AppendText($sb.ToString())
        if ($atBottom) { $logBox.ScrollToEnd() }
    }

    $statusText.Text = $sync.StatusText
    try {
        $innerWidth = [Math]::Max(0, ($progressTrack.Parent.ActualWidth - 2))
        if ($innerWidth -gt 0) {
            $progressTrack.Width = $innerWidth * ($sync.ProgressPct / 100.0)
        }
    } catch {}

    for ($i = 0; $i -lt 5; $i++) {
        $vis = $stateVisuals[$sync.StepStates[$i]]
        $stepIcons[$i].Text        = $vis.Glyph
        $stepIcons[$i].Foreground  = $vis.IconColor
        $stepLabels[$i].Foreground = $vis.TextColor
    }

    if ($sync.Done) {
        $timer.Stop()
        $cancelBtn.IsEnabled = $false
        $statusText.Foreground = if ($sync.Success) { '#a9f0c0' } else { '#f0a390' }
        if ($sync.Success) {
            $doneBtn.Content = 'Concluir'
        } else {
            $installBtn.IsEnabled  = $true
            $chkOllama.IsEnabled   = $true
            $chkModel.IsEnabled    = $true
            $chkShortcut.IsEnabled = $true
        }
    }
})

$script:runspace   = $null
$script:psInstance = $null

$installBtn.Add_Click({
    $sync.Cancelled   = $false
    $sync.Done        = $false
    $sync.Success     = $false
    $sync.ErrorMsg    = ''
    $sync.ProgressPct = 0
    $sync.StatusText  = 'Instalando...'
    for ($i = 0; $i -lt $sync.StepStates.Count; $i++) { $sync.StepStates[$i] = 'pending' }

    $logBox.Clear()
    $installBtn.IsEnabled  = $false
    $cancelBtn.IsEnabled   = $true
    $chkOllama.IsEnabled   = $false
    $chkModel.IsEnabled    = $false
    $chkShortcut.IsEnabled = $false
    $doneBtn.Content       = 'Fechar'
    $statusText.Foreground = '#a9f0c0'

    if ($script:psInstance) { try { $script:psInstance.Dispose() } catch {} }
    if ($script:runspace)   { try { $script:runspace.Close(); $script:runspace.Dispose() } catch {} }

    $script:runspace = [RunspaceFactory]::CreateRunspace()
    $script:runspace.Open()
    $script:psInstance = [PowerShell]::Create()
    $script:psInstance.Runspace = $script:runspace
    [void]$script:psInstance.AddScript($workerScript).
        AddArgument($sync).
        AddArgument($RepoUrl).
        AddArgument($TargetDir).
        AddArgument($Model).
        AddArgument([bool]$chkOllama.IsChecked).
        AddArgument([bool]$chkModel.IsChecked).
        AddArgument([bool]$chkShortcut.IsChecked)
    [void]$script:psInstance.BeginInvoke()

    $timer.Start()
})

$cancelBtn.Add_Click({
    $sync.Cancelled = $true
    $cancelBtn.IsEnabled = $false
    $sync.LogQueue.Enqueue('Cancelando...')
})

$copyLogItem.Add_Click({
    if ($logBox.Text) { [System.Windows.Clipboard]::SetText($logBox.Text) }
})

$doneBtn.Add_Click({ $window.Close() })
$closeBtn.Add_Click({ $window.Close() })
$minBtn.Add_Click({ $window.WindowState = [System.Windows.WindowState]::Minimized })
$titleBar.Add_MouseLeftButtonDown({
    if ($_.LeftButton -eq [System.Windows.Input.MouseButtonState]::Pressed) {
        try { $window.DragMove() } catch {}
    }
})

$window.Add_Closing({
    $sync.Cancelled = $true
    $timer.Stop()
    if ($script:psInstance) { try { $script:psInstance.Dispose() } catch {} }
    if ($script:runspace)   { try { $script:runspace.Close(); $script:runspace.Dispose() } catch {} }
})

[void]$window.ShowDialog()
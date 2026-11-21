# Servidor local da interface (http://localhost:43210).
#
# O login do Google (backup no Drive) só funciona nesta origem, então o app é
# aberto por aqui em vez de file://. Sem Node.js: usa TcpListener do próprio
# .NET, o que também evita exigir permissão de administrador (HttpListener
# precisaria de reserva de URL).
#
# Feche esta janela para encerrar o servidor.

param(
  [int]$Port = 43210,
  [string]$Root = '',
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$AppName = 'Open Winlin Prompt'
$Origin = "http://localhost:$Port"

function Write-Log([string]$Message) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message)
}

# ---- pasta com o app (dist) -------------------------------------------------
if (-not $Root) {
  $candidates = @(
    (Join-Path $PSScriptRoot '..\dist'),
    (Join-Path $PSScriptRoot 'dist'),
    (Join-Path $PSScriptRoot '..\..\dist')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $candidate 'index.html')) {
      $Root = (Resolve-Path -LiteralPath $candidate).Path
      break
    }
  }
}

if (-not $Root -or -not (Test-Path -LiteralPath (Join-Path $Root 'index.html'))) {
  Write-Host 'Nao encontrei a pasta "dist" com o app. Rode o instalador ou o build primeiro.' -ForegroundColor Red
  Read-Host 'Pressione Enter para sair'
  exit 1
}
$Root = [System.IO.Path]::GetFullPath($Root)

$ContentTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.map'  = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
}

function Send-Bytes($Stream, [string]$Status, [byte[]]$Body, [string]$ContentType, [hashtable]$Headers = @{}) {
  $head = "HTTP/1.1 $Status`r`n"
  $head += "Content-Type: $ContentType`r`n"
  $head += "Content-Length: $($Body.Length)`r`n"
  $head += "Cache-Control: no-store`r`n"
  $head += "Access-Control-Allow-Origin: $Origin`r`n"
  $head += "Connection: close`r`n"
  foreach ($key in $Headers.Keys) { $head += "$key`: $($Headers[$key])`r`n" }
  $head += "`r`n"

  $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($headBytes, 0, $headBytes.Length)
  if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
  $Stream.Flush()
}

function Send-Text($Stream, [string]$Status, [string]$Text, [string]$ContentType = 'text/plain; charset=utf-8') {
  Send-Bytes $Stream $Status ([System.Text.Encoding]::UTF8.GetBytes($Text)) $ContentType
}

function Test-ExistingServer {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect('127.0.0.1', $Port)
    $stream = $client.GetStream()
    $request = "GET /health HTTP/1.1`r`nHost: localhost:$Port`r`nConnection: close`r`n`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($request)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $reader = New-Object System.IO.StreamReader($stream)
    $answer = $reader.ReadToEnd()
    $client.Close()
    return ($answer -match 'open-winlin-prompt')
  } catch {
    return $false
  }
}

function Open-AppWindow {
  # OWP_NO_BROWSER=1 serve para testes automatizados
  if ($NoBrowser -or $env:OWP_NO_BROWSER) { return }
  $url = "$Origin/"
  $edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
  if (-not (Test-Path -LiteralPath $edge)) { $edge = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }
  if (Test-Path -LiteralPath $edge) {
    Start-Process -FilePath $edge -ArgumentList "--app=$url", '--window-size=1440,900' | Out-Null
  } else {
    Start-Process $url | Out-Null
  }
}

# ---- servidor ---------------------------------------------------------------
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start()
} catch {
  if (Test-ExistingServer) {
    Write-Log "O servidor já está rodando em $Origin — abrindo a janela do app."
    Open-AppWindow
    Start-Sleep -Seconds 2
    exit 0
  }
  Write-Host "A porta $Port está ocupada por outro programa. Feche-o e tente de novo." -ForegroundColor Red
  Read-Host 'Pressione Enter para sair'
  exit 1
}

$Host.UI.RawUI.WindowTitle = "$AppName - servidor local ($Origin)"
Write-Log "$AppName aberto em $Origin"
Write-Log "Pasta do app: $Root"
Write-Log 'Feche esta janela para encerrar o servidor.'
Open-AppWindow

$running = $true
try {
  while ($running) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $stream = $client.GetStream()

      # lê a primeira linha do pedido (método + caminho)
      $buffer = New-Object byte[] 8192
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { $client.Close(); continue }
      $requestText = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
      $requestLine = ($requestText -split "`r`n")[0]
      $parts = $requestLine -split ' '
      $method = if ($parts.Length -ge 1) { $parts[0] } else { 'GET' }
      $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }

      if ($method -ne 'GET' -and $method -ne 'HEAD') {
        Send-Text $stream '405 Method Not Allowed' 'Metodo nao permitido'
        $client.Close()
        continue
      }

      $path = $rawPath.Split('?')[0]
      if ($path -eq '/health') {
        Send-Text $stream '200 OK' '{"ok":true,"app":"open-winlin-prompt"}' 'application/json; charset=utf-8'
        $client.Close()
        continue
      }

      $relative = [System.Uri]::UnescapeDataString($path).TrimStart('/', '\')
      if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
      $full = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))

      # nada de sair da pasta do app
      if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
        Send-Text $stream '403 Forbidden' 'Acesso negado'
        $client.Close()
        continue
      }

      if ((Test-Path -LiteralPath $full -PathType Container)) {
        $full = Join-Path $full 'index.html'
      }
      # rota desconhecida volta para o index (o app é uma página só)
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $full = Join-Path $Root 'index.html'
      }

      $extension = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $contentType = if ($ContentTypes.ContainsKey($extension)) { $ContentTypes[$extension] } else { 'application/octet-stream' }
      $body = [System.IO.File]::ReadAllBytes($full)

      if ($method -eq 'HEAD') {
        Send-Bytes $stream '200 OK' ([byte[]]@()) $contentType @{ 'X-Content-Length' = $body.Length }
      } else {
        Send-Bytes $stream '200 OK' $body $contentType
      }
    } catch {
      try { Send-Text $stream '500 Internal Server Error' 'Erro interno' } catch { }
    } finally {
      try { $client.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
}

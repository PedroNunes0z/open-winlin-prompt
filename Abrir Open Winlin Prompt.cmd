@echo off
setlocal EnableExtensions
rem Abre o app no servidor local http://localhost:43210 (necessario para o
rem login do Google usado no backup no Drive). A janela do servidor pode ficar
rem minimizada; feche-a para encerrar o app.
set "SERVER=%~dp0scripts\servidor.ps1"
if not exist "%SERVER%" (
  echo Arquivo do servidor nao encontrado: %SERVER%
  pause
  exit /b 1
)
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%SERVER%"
endlocal

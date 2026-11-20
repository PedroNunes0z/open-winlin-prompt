@echo off
setlocal EnableExtensions
REM Open Winlin Prompt - Configuração automática da IA local (Ollama)
REM Abre a janela de progresso e faz tudo sozinho: libera o Ollama, reinicia e baixa o modelo.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configurar-ollama.ps1"
endlocal

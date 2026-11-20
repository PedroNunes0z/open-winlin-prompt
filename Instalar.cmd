@echo off
setlocal EnableExtensions
REM Open Winlin Prompt - Instalador (duplo clique)
REM Clona o repositório em C:\Program Files\open-winlin-prompt, compila,
REM instala o Ollama (se faltar), baixa o modelo e cria atalho na área de trabalho.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"
endlocal
pause

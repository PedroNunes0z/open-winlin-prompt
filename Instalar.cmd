@echo off
setlocal EnableExtensions
REM Open Winlin Prompt - Instalador (duplo clique)
REM Instala em %LOCALAPPDATA%\Programs\open-winlin-prompt (sem precisar de admin),
REM clona o repositorio, compila, instala o Ollama (se faltar), baixa o modelo
REM e cria atalho na area de trabalho. Abre a janela grafica do instalador.
cd /d "%~dp0"
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"
endlocal

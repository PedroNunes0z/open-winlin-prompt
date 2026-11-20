@echo off
setlocal EnableExtensions
set "APP=%~dp0dist\index.html"
if not exist "%APP%" (
  echo App file not found: %APP%
  exit /b 1
)
set "URL=file:///%APP:\=/%"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=chrome.exe"
start "" "%EDGE%" --app="%URL%" --window-size=1440,900
endlocal

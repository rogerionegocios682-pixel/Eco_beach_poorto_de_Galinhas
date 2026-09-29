@echo off
chcp 65001 >nul
title Turismo OS - Servidor de Tempo Real
echo.
echo  ============================================
echo   TURISMO OS - Servidor de tempo real
echo  ============================================
echo.

set "NODE="

REM 1) Node instalado no sistema (node.exe real, nao o atalho quebrado)
for /f "delims=" %%i in ('where node.exe 2^>nul') do (
  if not defined NODE set "NODE=%%i"
)

REM 2) Node embutido no VS Code (Electron em modo Node)
if not defined NODE (
  if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" (
    set "NODE=%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"
    set "ELECTRON_RUN_AS_NODE=1"
  )
)

if not defined NODE (
  echo  [ERRO] Node.js nao encontrado.
  echo  Instale o Node.js em https://nodejs.org (versao 22.5 ou superior)
  echo  ou abra este projeto pelo VS Code.
  echo.
  pause
  exit /b 1
)

echo  Iniciando servidor...
echo.
"%NODE%" "%~dp0servidor\server.js"

echo.
echo  Servidor encerrado.
pause

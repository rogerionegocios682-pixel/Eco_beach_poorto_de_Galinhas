@echo off
REM ====================================================================
REM  Turismo OS - PRINT SERVICE LOCAL
REM --------------------------------------------------------------------
REM  Sobe o servico de impressao que faz a ponte entre o sistema web e
REM  as impressoras instaladas neste computador.
REM
REM  Deixe esta janela aberta enquanto o PDV estiver em uso.
REM  Para parar: feche a janela ou pressione Ctrl+C.
REM ====================================================================
title Turismo OS - Print Service (nao feche esta janela)

cd /d "%~dp0"

REM Porta do servico (troque aqui se estiver ocupada).
if "%PRINT_SERVICE_PORT%"=="" set PRINT_SERVICE_PORT=3210

REM Aceitar conexoes da rede: por padrao NAO (somente localhost).
if "%PRINT_SERVICE_PERMITIR_REDE%"=="" set PRINT_SERVICE_PERMITIR_REDE=0

REM Modo simulacao (grava o cupom em arquivo em vez de imprimir).
REM Util para testar sem impressora instalada.
if "%PRINT_SERVICE_SIMULAR%"=="" set PRINT_SERVICE_SIMULAR=0

echo.
echo  Iniciando o Print Service do Turismo OS...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  ERRO: o Node.js nao foi encontrado neste computador.
  echo.
  echo  Instale o Node.js 22 ou superior em https://nodejs.org
  echo  e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)

node "servidor\print_service.mjs"

echo.
echo  O Print Service foi encerrado.
pause
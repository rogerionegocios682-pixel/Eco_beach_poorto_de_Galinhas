@echo off
REM ====================================================================
REM  Turismo OS - DESINSTALAR O PRINT SERVICE DA INICIALIZACAO
REM --------------------------------------------------------------------
REM  Remove o atalho criado por instalar-print-service.cmd.
REM  O servico em si NAO e apagado: nada e removido do sistema.
REM ====================================================================
title Turismo OS - Desinstalar Print Service da inicializacao

set ATALHO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Turismo OS - Print Service.lnk

echo.
if exist "%ATALHO%" (
  del "%ATALHO%"
  echo  Atalho removido. O Print Service nao inicia mais com o Windows.
) else (
  echo  O atalho nao existe. Nada a fazer.
)
echo.
echo  Os arquivos do sistema continuam intactos.
echo  Para remover tambem o servico manualmente, basta nao abrir
echo  iniciar-print-service.cmd novamente.
echo.
pause
@echo off
REM ====================================================================
REM  Turismo OS - INSTALAR O PRINT SERVICE NO INICIO DO WINDOWS
REM --------------------------------------------------------------------
REM  Cria um atalho do Print Service na pasta "Inicializar" do usuario.
REM  Depois de rodar isto UMA vez, o servico sobe junto com o Windows e o
REM  operador nao precisa abrir nada manualmente.
REM
REM  Para desinstalar, rode: desinstalar-print-service.cmd
REM ====================================================================
title Turismo OS - Instalar Print Service na inicializacao

cd /d "%~dp0"

set INICIAR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set ATALHO=%INICIAR%\Turismo OS - Print Service.lnk
set DESTINO=%~dp0iniciar-print-service.cmd

echo.
echo  Instalando o Print Service na inicializacao do Windows...
echo.

if not exist "%DESTINO%" (
  echo  ERRO: nao encontrei "%DESTINO%".
  echo  Execute este arquivo de dentro da pasta do sistema.
  pause
  exit /b 1
)

powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%ATALHO%');" ^
  "$s.TargetPath = '%DESTINO%';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = 'Servico de impressao local do Turismo OS';" ^
  "$s.Save()"

if errorlevel 1 (
  echo  ERRO ao criar o atalho.
  pause
  exit /b 1
)

echo  Pronto. O Print Service vai iniciar junto com o Windows.
echo.
echo  Atalho criado em:
echo    %ATALHO%
echo.
echo  Para desfazer, execute desinstalar-print-service.cmd
echo.
pause
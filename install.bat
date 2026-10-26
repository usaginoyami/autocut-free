@echo off
chcp 65001 >nul
echo === AutoCut Free - instalador ===

set "DEST=%APPDATA%\Adobe\CEP\extensions\AutoCutFree"
if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"
xcopy "%~dp0extension\*" "%DEST%\" /E /I /Y >nul

echo Habilitando extensoes nao assinadas...
for %%V in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

echo.
echo Preparando Python 3.12 (necessario para o Whisper)...
set "PY="
py -3.12 --version >nul 2>&1 && set "PY=py -3.12"
if not defined PY winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
if not defined PY py -3.12 --version >nul 2>&1 && set "PY=py -3.12"

if not defined PY (
  echo [AVISO] Nao consegui instalar o Python 3.12. Instale manualmente em python.org e rode este instalador de novo.
) else (
  echo Instalando Whisper ^(faster-whisper^)...
  %PY% -m pip install --upgrade pip
  %PY% -m pip install faster-whisper
  nvidia-smi >nul 2>&1 && (
    echo Placa NVIDIA detectada: instalando bibliotecas CUDA para acelerar as legendas...
    %PY% -m pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
  )
)

echo.
ffmpeg -version >nul 2>&1 || echo [AVISO] FFmpeg nao encontrado no PATH. Instale com: winget install Gyan.FFmpeg

echo.
echo Pronto! Reinicie o Premiere Pro e abra: Janela ^> Extensoes ^> AutoCut Free
pause

@echo off
setlocal

set "ROOT_FPC_CFG=%~dp0..\..\..\..\libs\SharedPasCore\fpc-build\fpc-trunk-x64.cfg"
set "ROOT_SHAREDPASCORE=%~dp0..\..\..\..\libs\SharedPasCore"
set "ROOT_VENDOR=%~dp0vendor"
set "ROOT_UOS=%ROOT_VENDOR%\uos\src"
set "ROOT_COMMON=%~dp0common"
if not defined FPC_CFG (
    set "FPC_CFG=%ROOT_FPC_CFG%"
)

:: --- Resolve FPC compiler ---
set "FPC="
if defined FPC_EXE_x64 (
    set "FPC=%FPC_EXE_x64%"
    goto :fpc_found
)
where fpc.exe >nul 2>&1
if %ERRORLEVEL%==0 (
    for /f "delims=" %%i in ('where fpc.exe') do set "FPC=%%i"
    goto :fpc_found
)
set "FPC=c:\projects\fpc-trunk\compiler\utils\fpc.exe"
if not exist "%FPC%" (
    echo ERROR: FPC compiler not found.
    echo   Set FPC_EXE_x64 env variable, add fpc.exe to PATH,
    echo   or install to %FPC%
    exit /b 1
)

:fpc_found
echo Using FPC: %FPC%
if not exist "%FPC_CFG%" (
    echo ERROR: FPC config not found: %FPC_CFG%
    exit /b 1
)

for %%i in ("%FPC%") do set "FPC_BIN_DIR=%%~dpi"
set "FPC_BACKEND_DIR=%FPC_BIN_DIR%.."
if exist "%FPC_BACKEND_DIR%\ppcx64.exe" (
    set "PATH=%FPC_BACKEND_DIR%;%FPC_BIN_DIR%;%PATH%"
)

pushd "%~dp0"
if errorlevel 1 exit /b 1
:: --- Handle "clean" target ---
if "%~1"=="clean" (
    echo Cleaning build artifacts...
    if exist build\x64\dcu del /Q build\x64\dcu\* 2>nul
    if exist build\x64\Gnaural.exe del /Q build\x64\Gnaural.exe
    if exist build\x64\portaudio.dll del /Q build\x64\portaudio.dll
    echo Done.
    popd
    exit /b 0
)


:: --- Build ---
if not exist build\x64\dcu mkdir build\x64\dcu

"%FPC%" -n @"%FPC_CFG%" -FUbuild/x64/dcu -FEbuild/x64 -Fu"%ROOT_SHAREDPASCORE%" -Fu"%ROOT_UOS%" -Fu"%ROOT_COMMON%" -Fucore Gnaural.pas
if %ERRORLEVEL% neq 0 (
    echo BUILD FAILED
    popd
    exit /b %ERRORLEVEL%
)

:: Copy portaudio.dll next to exe
if exist portaudio.dll copy /Y portaudio.dll build\x64\ >nul

:: Copy libsndfile and its dependencies (OGG/Vorbis/FLAC/Opus support)
for %%D in (sndfile.dll ogg.dll vorbis.dll vorbisfile.dll vorbisenc.dll FLAC.dll opus.dll) do (
    if exist %%D copy /Y %%D build\x64\ >nul
)

popd
echo.
echo Build successful: build\x64\Gnaural.exe

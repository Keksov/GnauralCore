@echo off
setlocal

set "FPC_BIN=%~dp0..\..\..\VendorsCore\fpc\fpc-main\bin\x86_64-win64"
set "FPC=%FPC_BIN%\fpc.exe"

if not exist "%FPC%" (
    echo ERROR: FPC not found.
    echo   Expected: %FPC%
    exit /b 1
)

if not exist "%FPC_BIN%\ppcx64.exe" (
    echo ERROR: FPC backend not found: %FPC_BIN%\ppcx64.exe
    exit /b 1
)

set "PATH=%FPC_BIN%;%PATH%"

pushd "%~dp0"
if errorlevel 1 exit /b 1

echo Using FPC: %FPC%

"%FPC%" -n "@fpc-x64.cfg" -ocircle.exe circle.pas
if errorlevel 1 (
    popd
    exit /b 1
)

echo Build successful: circle.exe
popd

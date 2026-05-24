@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title HanakoPro Dev Start

set "PROJECT_ROOT=%CD%"
if not defined HANA_HOME set "HANA_HOME=%USERPROFILE%\.hanakopro-dev"

echo ============================================
echo         HanakoPro - Dev Quick Start
echo ============================================
echo Project: %PROJECT_ROOT%
echo HANA_HOME: %HANA_HOME%
echo.

echo [1/4] Stopping old HanakoPro dev processes...
set "HANA_LAUNCH_ROOT=%PROJECT_ROOT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "$root=(Resolve-Path $env:HANA_LAUNCH_ROOT).Path.TrimEnd('\');" ^
  "$escaped=[regex]::Escape($root);" ^
  "$names=@('node.exe','electron.exe');" ^
  "$targets=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($names -contains $_.Name) -and ($_.CommandLine -match $escaped -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase))) });" ^
  "$targets=@($targets | Sort-Object ProcessId -Unique);" ^
  "if ($targets.Count -eq 0) { Write-Host '  no old dev processes found' } else { foreach ($p in $targets) { Write-Host ('  killing {0} PID={1}' -f $p.Name,$p.ProcessId); & taskkill.exe /F /T /PID $p.ProcessId 2>$null | Out-Null } }"
if errorlevel 1 (
    echo   cleanup command failed, continuing...
)

if exist "%HANA_HOME%\server-info.json" (
    del /f /q "%HANA_HOME%\server-info.json" >nul 2>nul
)
echo.

echo [2/4] Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed!
        pause
        exit /b 1
    )
)
echo Dependencies ready.
echo.

echo [3/4] Building and starting HanakoPro...
echo.
call npm run start
if errorlevel 1 (
    echo.
    echo Start failed!
    pause
    exit /b 1
)

echo.
echo [4/4] HanakoPro exited.

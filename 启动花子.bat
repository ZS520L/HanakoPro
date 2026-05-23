@echo off
cd /d "%~dp0"
title Hanako

echo ============================================
echo         Hanako - Quick Start
echo ============================================
echo.

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed!
        pause
        exit /b 1
    )
)

echo Starting Hanako...
echo.
call npm run start
if errorlevel 1 (
    echo.
    echo Start failed!
    pause
)

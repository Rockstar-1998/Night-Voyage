@echo off
echo ========================================
echo Night Voyage Release Launcher
echo ========================================
echo.
echo Starting Release version...
echo.
echo NOTE: Make sure DEBUG version is already running (npm run tauri dev)
echo.

set "RELEASE_EXE="
if exist "src-tauri\target\release\night-voyage.exe" (
    set "RELEASE_EXE=src-tauri\target\release\night-voyage.exe"
) else if exist ".cache\target\release\night-voyage.exe" (
    set "RELEASE_EXE=.cache\target\release\night-voyage.exe"
)

if defined RELEASE_EXE (
    start "" "%RELEASE_EXE%"
    echo Release version started!
    echo   %RELEASE_EXE%
) else (
    echo ERROR: Release version not found
    echo Please run build-release.bat first
    pause
    exit /b 1
)

echo.
echo Release window opened! You can test multiplayer with DEBUG version now.
pause

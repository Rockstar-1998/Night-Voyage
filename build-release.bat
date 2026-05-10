@echo off
echo ========================================
echo Night Voyage Release Build Script
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Checking environment...
if not exist "src-tauri\Cargo.toml" (
    echo ERROR: src-tauri\Cargo.toml not found
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] node_modules not found, installing dependencies...
    call npm install
)

echo [2/3] Building frontend...
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed
    pause
    exit /b 1
)

echo [3/3] Building Tauri Release...
cd src-tauri
call cargo build --release
if errorlevel 1 (
    echo ERROR: Tauri build failed
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo Build Complete!
echo ========================================
echo.
set "RELEASE_EXE="
if exist "src-tauri\target\release\night-voyage.exe" (
    set "RELEASE_EXE=src-tauri\target\release\night-voyage.exe"
) else if exist ".cache\target\release\night-voyage.exe" (
    set "RELEASE_EXE=.cache\target\release\night-voyage.exe"
)
if defined RELEASE_EXE (
    echo Release executable at:
    echo   %RELEASE_EXE%
) else (
    echo Release executable at:
    echo   src-tauri\target\release\night-voyage.exe
    echo   (or .cache\target\release\night-voyage.exe if target-dir is overridden)
)
echo.
echo Usage:
echo   1. Run debug version first (npm run tauri dev)
echo   2. Then run release version (run-release.bat)
echo.
pause

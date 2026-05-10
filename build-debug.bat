@echo off
echo ========================================
echo Night Voyage Debug Build Script
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Checking environment...
if not exist "src-tauri\Cargo.toml" (
    echo ERROR: src-tauri\Cargo.toml not found
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] node_modules not found, installing dependencies...
    call npm install
)

echo [2/2] Building Debug version...
cd src-tauri
call cargo build
if errorlevel 1 (
    echo ERROR: Build failed
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo Build Complete! Debug version is ready
echo ========================================
echo.
echo To run:
echo   npm run tauri dev   (recommended, starts Vite hot reload)
echo   OR
echo   src-tauri\target\debug\night-voyage.exe
echo.
pause

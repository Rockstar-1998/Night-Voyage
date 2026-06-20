@echo off
setlocal

:: ========================================
:: Night Voyage - Debug Build + Vite Dev Server
:: ========================================
:: Builds Rust debug binary and starts Vite
:: dev server for browser-based frontend debugging.
:: No Tauri window is opened.
:: ========================================

set "ROOT=D:\data\Night Voyage"
set "CACHE_DIR=%ROOT%\.cache"
set "CARGO_HOME=%CACHE_DIR%\.cargo"
set "NPM_CACHE_DIR=%CACHE_DIR%\npm-cache"
set "NPM_LOGS_DIR=%NPM_CACHE_DIR%\_logs"
set "NPM_CONFIG_CACHE=%NPM_CACHE_DIR%"
set "npm_config_cache=%NPM_CACHE_DIR%"
set "NPM_CONFIG_LOGS_DIR=%NPM_LOGS_DIR%"
set "npm_config_logs_dir=%NPM_LOGS_DIR%"
set "TMP=%CACHE_DIR%\tmp"
set "TEMP=%CACHE_DIR%\tmp"
set "TMPDIR=%CACHE_DIR%\tmp"
set "RUSTC_TMPDIR=%CACHE_DIR%\tmp"
set "CARGO_TARGET_TMPDIR=%CACHE_DIR%\tmp"
set "XDG_CACHE_HOME=%CACHE_DIR%"

:: Remove Node.js memory limit entirely
set "NODE_OPTIONS="

set "CARGO_TARGET_DIR=%ROOT%\src-tauri\target"
set "DEBUG_EXE=%CARGO_TARGET_DIR%\debug\night-voyage.exe"

if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"
if not exist "%CARGO_TARGET_DIR%" mkdir "%CARGO_TARGET_DIR%"
if not exist "%CARGO_HOME%" mkdir "%CARGO_HOME%"
if not exist "%NPM_CACHE_DIR%" mkdir "%NPM_CACHE_DIR%"
if not exist "%NPM_LOGS_DIR%" mkdir "%NPM_LOGS_DIR%"
if not exist "%TMP%" mkdir "%TMP%"

echo ========================================
echo   Night Voyage - Debug Build + Vite Dev
echo ========================================
echo [Night Voyage] Root:         %ROOT%
echo [Night Voyage] Cargo target: %CARGO_TARGET_DIR%
echo [Night Voyage] Cargo home:   %CARGO_HOME%
echo [Night Voyage] Profile:      debug
echo ========================================
pushd "%ROOT%" || exit /b 1

:: --- npm install ---
if not exist node_modules (
  echo [Night Voyage] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [Night Voyage] npm install failed.
    popd
    exit /b 1
  )
)

:: --- Pre-clean ---
echo [Night Voyage] Running pre-clean...
powershell -ExecutionPolicy Bypass -File "%ROOT%\scripts\windows-dev-preclean.ps1"

:: ============================================================
:: Phase 1: Build Rust debug binary
:: ============================================================
echo [Night Voyage] Building Rust debug binary...
cd src-tauri
call cargo build
if errorlevel 1 (
  echo [Night Voyage] Debug build FAILED.
  popd
  exit /b 1
)
cd ..

if not exist "%DEBUG_EXE%" (
  echo [Night Voyage] ERROR: Debug exe not found after build.
  popd
  exit /b 1
)

echo [Night Voyage] Debug build succeeded.
echo [Night Voyage] Binary: %DEBUG_EXE%

:: ============================================================
:: Phase 2: Start Vite dev server (browser debugging)
:: ============================================================
echo.
echo ========================================
echo   Starting Vite Dev Server...
echo ========================================
echo.
echo   Open in browser: http://localhost:1420
echo   Press Ctrl+C to stop.
echo.
echo ========================================

call npm run dev:frontend

popd
exit /b 0

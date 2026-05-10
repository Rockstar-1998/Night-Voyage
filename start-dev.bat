@echo off
setlocal

:: ========================================
:: Night Voyage - Build Release (Unrestricted)
:: ========================================
:: Compiles a release build and copies it to a subfolder
:: with its own isolated database. No instances launched.
:: All resource limits removed for maximum build speed.
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

:: Remove all resource limits - use all CPU cores and unlimited memory
:: NOTE: Do NOT set CARGO_TARGET_DIR here - it's configured in .cargo/config.toml
:: NOTE: Do NOT set RUSTFLAGS here - it's configured in .cargo/config.toml

:: Remove Node.js memory limit entirely
set "NODE_OPTIONS="

:: Force WebView2 to use software rendering (no GPU) during build
:: This prevents WebView2 from consuming VRAM if it gets launched
set "WEBVIEW2_DEFAULT_BACKGROUND_COLOR=0"

:: Disable GPU acceleration for any Chromium-based processes
set "CHROME_DESKTOP="
set "GOOGLE_API_KEY="
set "GOOGLE_DEFAULT_CLIENT_ID="
set "GOOGLE_DEFAULT_CLIENT_SECRET="

:: Get CPU count for display only (does not affect build)
set "DISPLAY_JOBS=auto"

set "CARGO_TARGET_DIR=%ROOT%\src-tauri\target"
set "RELEASE_EXE=%CARGO_TARGET_DIR%\release\night-voyage.exe"
set "DIST_DIR=%ROOT%\dist"
set "INSTANCE_A=%DIST_DIR%\instance-a"
set "INSTANCE_B=%DIST_DIR%\instance-b"

if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"
if not exist "%CARGO_TARGET_DIR%" mkdir "%CARGO_TARGET_DIR%"
if not exist "%CARGO_HOME%" mkdir "%CARGO_HOME%"
if not exist "%NPM_CACHE_DIR%" mkdir "%NPM_CACHE_DIR%"
if not exist "%NPM_LOGS_DIR%" mkdir "%NPM_LOGS_DIR%"
if not exist "%TMP%" mkdir "%TMP%"

echo ========================================
echo   Night Voyage - Build Release (Unrestricted)
echo ========================================
echo [Night Voyage] Root:         %ROOT%
echo [Night Voyage] Cargo target: %CARGO_TARGET_DIR%
echo [Night Voyage] Cargo home:   %CARGO_HOME%
echo [Night Voyage] Dist:         %DIST_DIR%
echo [Night Voyage] CPU Jobs:     %DISPLAY_JOBS% (from .cargo/config.toml)
echo [Night Voyage] Node Memory:  UNLIMITED
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
:: Phase 1: Build release
:: ============================================================
if exist "%RELEASE_EXE%" (
  echo [Night Voyage] Found existing release exe - checking if rebuild needed...
)

echo [Night Voyage] Building release (unlimited memory)...
call npm run tauri build
if errorlevel 1 (
  echo [Night Voyage] Release build FAILED.
  popd
  exit /b 1
)

if not exist "%RELEASE_EXE%" (
  echo [Night Voyage] ERROR: Release exe not found after build.
  popd
  exit /b 1
)

echo [Night Voyage] Release build succeeded.

:: ============================================================
:: Phase 2: Copy to isolated subfolders
:: ============================================================
echo [Night Voyage] Creating isolated instances...

if not exist "%INSTANCE_A%" mkdir "%INSTANCE_A%"
if not exist "%INSTANCE_B%" mkdir "%INSTANCE_B%"

copy /Y "%RELEASE_EXE%" "%INSTANCE_A%\night-voyage.exe" >nul
copy /Y "%RELEASE_EXE%" "%INSTANCE_B%\night-voyage.exe" >nul

for %%F in ("%CARGO_TARGET_DIR%\release\*.dll") do (
  copy /Y "%%F" "%INSTANCE_A%\" >nul 2>&1
  copy /Y "%%F" "%INSTANCE_B%\" >nul 2>&1
)

for %%D in ("%CARGO_TARGET_DIR%\release\webview2*.dll") do (
  copy /Y "%%D" "%INSTANCE_A%\" >nul 2>&1
  copy /Y "%%D" "%INSTANCE_B%\" >nul 2>&1
)

set "DB_A=%INSTANCE_A%\night-voyage.sqlite3"
set "DB_B=%INSTANCE_B%\night-voyage.sqlite3"
set "DB_BACKUP_DIR=%ROOT%\.cache\db-backups"

:: Backup existing databases before build
if not exist "%DB_BACKUP_DIR%" mkdir "%DB_BACKUP_DIR%"
if exist "%DB_A%" (
    copy /Y "%DB_A%" "%DB_BACKUP_DIR%\instance-a-night-voyage.sqlite3.backup" >nul
    echo [Night Voyage] Backed up Instance A database
)
if exist "%DB_B%" (
    copy /Y "%DB_B%" "%DB_BACKUP_DIR%\instance-b-night-voyage.sqlite3.backup" >nul
    echo [Night Voyage] Backed up Instance B database
)

:: Create empty DB only if not exists (preserves existing data)
if not exist "%DB_A%" type nul > "%DB_A%"
if not exist "%DB_B%" type nul > "%DB_B%"

echo [Night Voyage] Instance A: %INSTANCE_A%
echo [Night Voyage]   exe: %INSTANCE_A%\night-voyage.exe
echo [Night Voyage]   DB:  %DB_A%
echo [Night Voyage] Instance B: %INSTANCE_B%
echo [Night Voyage]   exe: %INSTANCE_B%\night-voyage.exe
echo [Night Voyage]   DB:  %DB_B%

popd

echo.
echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo   Instance A (separate DB):
    %INSTANCE_A%\night-voyage.exe

echo.
echo   Instance B (separate DB):
    %INSTANCE_B%\night-voyage.exe

echo.
echo   Run them manually to test multiplayer.
echo ========================================

exit /b 0

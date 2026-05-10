$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# ========================================
# Night Voyage - Release Build with Timeout Protection
# ========================================
# Called by start-dev.bat to build the release exe.
# Handles stuck vite/cargo processes that refuse to exit.
# ========================================

param(
  [string]$RootDir,
  [string]$CargoTargetDir,
  [string]$CacheDir,
  [int]$FrontendTimeoutSec = 120,
  [int]$CargoTimeoutSec = 600
)

if ([string]::IsNullOrWhiteSpace($RootDir)) {
  # Fallback: derive from script location
  $RootDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}
if ([string]::IsNullOrWhiteSpace($CargoTargetDir)) {
  $CargoTargetDir = Join-Path $RootDir 'src-tauri\target'
}
if ([string]::IsNullOrWhiteSpace($CacheDir)) {
  $CacheDir = Join-Path $RootDir '.cache'
}

$DistMarker = Join-Path $RootDir 'dist\index.html'
$ExeMarker = Join-Path $CargoTargetDir 'release\night-voyage.exe'
$FrontendBuildLogOut = Join-Path $CacheDir 'vite-build-stdout.log'
$FrontendBuildLogErr = Join-Path $CacheDir 'vite-build-stderr.log'
$CargoBuildLogOut = Join-Path $CacheDir 'cargo-release-stdout.log'
$CargoBuildLogErr = Join-Path $CacheDir 'cargo-release-stderr.log'

# --- Step 1: Frontend build ---
if (Test-Path $DistMarker) {
  Write-Host "[Night Voyage] Frontend dist already exists - skipping vite build."
} else {
  Write-Host "[Night Voyage] Building frontend for release (timeout: $FrontendTimeoutSec s)..."

  # Clean stale log files
  if (Test-Path $FrontendBuildLogOut) { Remove-Item $FrontendBuildLogOut -Force -ErrorAction SilentlyContinue }
  if (Test-Path $FrontendBuildLogErr) { Remove-Item $FrontendBuildLogErr -Force -ErrorAction SilentlyContinue }

  $npmProc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm', 'run', 'build' `
    -WorkingDirectory $RootDir `
    -RedirectStandardOutput $FrontendBuildLogOut `
    -RedirectStandardError $FrontendBuildLogErr `
    -WindowStyle Hidden `
    -PassThru

  $elapsed = 0
  $distDetected = $false
  while ($elapsed -lt $FrontendTimeoutSec) {
    Start-Sleep -Seconds 3
    $elapsed += 3

    if (Test-Path $DistMarker) {
      Write-Host "[Night Voyage] dist output detected after $elapsed s - waiting 5s for file writes to flush..."
      Start-Sleep -Seconds 5
      $distDetected = $true
      break
    }

    if ($npmProc.HasExited) {
      Write-Host "[Night Voyage] npm process exited with code $($npmProc.ExitCode) after $elapsed s"
      break
    }

    if ($elapsed % 15 -eq 0) {
      Write-Host "[Night Voyage] Still waiting for vite build... ($elapsed s / $FrontendTimeoutSec s)"
    }
  }

  if (-not $npmProc.HasExited) {
    Write-Host "[Night Voyage] vite build did not exit within $FrontendTimeoutSec s - killing process tree..."
    Stop-Process -Id $npmProc.Id -Force -ErrorAction SilentlyContinue
    Get-Process -Name 'node' -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  }

  # Wait a moment for process cleanup
  Start-Sleep -Seconds 2

  if (-not (Test-Path $DistMarker)) {
    Write-Host "[Night Voyage] ERROR: Frontend build output not found."
    Write-Host "[Night Voyage]   stdout log: $FrontendBuildLogOut"
    Write-Host "[Night Voyage]   stderr log: $FrontendBuildLogErr"
    if (Test-Path $FrontendBuildLogErr) {
      Write-Host "--- stderr content (last 20 lines) ---"
      Get-Content $FrontendBuildLogErr -Tail 20
      Write-Host "--- end ---"
    }
    # Exit with failure - start-dev.bat will skip release instance
    exit 1
  }

  Write-Host "[Night Voyage] Frontend build complete."
}

# --- Step 2: Cargo release build ---
if (Test-Path $ExeMarker) {
  Write-Host "[Night Voyage] Release exe already exists - skipping cargo build."
} else {
  Write-Host "[Night Voyage] Building Tauri release binary (timeout: $CargoTimeoutSec s)..."

  # Clean stale log files
  if (Test-Path $CargoBuildLogOut) { Remove-Item $CargoBuildLogOut -Force -ErrorAction SilentlyContinue }
  if (Test-Path $CargoBuildLogErr) { Remove-Item $CargoBuildLogErr -Force -ErrorAction SilentlyContinue }

  $cargoProc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'cd', '/d', (Join-Path $RootDir 'src-tauri'), '&&', 'cargo', 'build', '--release' `
    -RedirectStandardOutput $CargoBuildLogOut `
    -RedirectStandardError $CargoBuildLogErr `
    -WindowStyle Hidden `
    -PassThru

  $elapsed = 0
  $exeDetected = $false
  while ($elapsed -lt $CargoTimeoutSec) {
    Start-Sleep -Seconds 5
    $elapsed += 5

    if (Test-Path $ExeMarker) {
      Write-Host "[Night Voyage] Release exe detected after $elapsed s - waiting 10s for linker to finish..."
      Start-Sleep -Seconds 10
      $exeDetected = $true
      break
    }

    if ($cargoProc.HasExited) {
      Write-Host "[Night Voyage] cargo process exited with code $($cargoProc.ExitCode) after $elapsed s"
      break
    }

    if ($elapsed % 30 -eq 0) {
      Write-Host "[Night Voyage] Still compiling... ($elapsed s / $CargoTimeoutSec s)"
    }
  }

  if (-not $cargoProc.HasExited) {
    Write-Host "[Night Voyage] cargo build did not exit within $CargoTimeoutSec s - killing process tree..."
    Stop-Process -Id $cargoProc.Id -Force -ErrorAction SilentlyContinue
    Get-Process -Name 'rustc' -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  }

  # Wait a moment for process cleanup
  Start-Sleep -Seconds 2

  if (-not (Test-Path $ExeMarker)) {
    Write-Host "[Night Voyage] ERROR: Release exe not found after build."
    Write-Host "[Night Voyage]   stdout log: $CargoBuildLogOut"
    Write-Host "[Night Voyage]   stderr log: $CargoBuildLogErr"
    if (Test-Path $CargoBuildLogErr) {
      Write-Host "--- stderr content (last 20 lines) ---"
      Get-Content $CargoBuildLogErr -Tail 20
      Write-Host "--- end ---"
    }
    exit 2
  }

  Write-Host "[Night Voyage] Release build complete."
}

Write-Host "[Night Voyage] Release exe ready: $ExeMarker"
exit 0
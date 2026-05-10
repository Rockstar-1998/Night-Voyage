$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$NightVoyageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$CargoTargetDir = if ([string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
  Join-Path $NightVoyageRoot 'src-tauri\target'
} else {
  [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)
}
$CargoHomeDir = if ([string]::IsNullOrWhiteSpace($env:CARGO_HOME)) {
  $userProfile = [Environment]::GetFolderPath('UserProfile')
  if ([string]::IsNullOrWhiteSpace($userProfile)) {
    Join-Path $NightVoyageRoot '.cache\.cargo'
  } else {
    Join-Path $userProfile '.cargo'
  }
} else {
  [System.IO.Path]::GetFullPath($env:CARGO_HOME)
}

function Stop-ProcessByNameFast {
  param(
    [string]$Name
  )

  try {
    $procs = Get-Process -Name $Name -ErrorAction SilentlyContinue
    if ($procs) {
      foreach ($p in $procs) {
        Write-Host ("[Night Voyage] stop pid={0} name={1}" -f $p.Id, $p.ProcessName)
      }
      Stop-Process -Name $Name -Force -ErrorAction SilentlyContinue
    }
  } catch {
  }
}

function Stop-PortOwnersFast {
  param(
    [int]$Port
  )

  try {
    $output = netstat -ano -p tcp 2>$null
    $lines = $output -split "`r?`n" | Where-Object { $_ -match (":{0}\s" -f $Port) }
    $pids = @()
    foreach ($line in $lines) {
      $parts = $line -split '\s+' | Where-Object { $_ -ne '' }
      if ($parts.Length -ge 5) {
        $pidText = $parts[-1]
        if ($pidText -match '^[0-9]+$') {
          $pids += [int]$pidText
        }
      }
    }
    $pids = $pids | Sort-Object -Unique
    foreach ($pid in $pids) {
      if ($pid -le 0 -or $pid -eq $PID) { continue }
      try {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
          Write-Host ("[Night Voyage] stop port-{0} pid={1} name={2}" -f $Port, $pid, $proc.ProcessName)
          Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
      } catch {
      }
    }
  } catch {
  }
}

function Remove-StaleLockFilesFast {
  $lockPaths = @(
    (Join-Path $CargoTargetDir '.cargo-lock'),
    (Join-Path $CargoTargetDir 'debug\.cargo-lock'),
    (Join-Path $CargoTargetDir 'release\.cargo-lock'),
    (Join-Path $NightVoyageRoot 'src-tauri\target\.cargo-lock'),
    (Join-Path $NightVoyageRoot 'src-tauri\target\debug\.cargo-lock'),
    (Join-Path $NightVoyageRoot 'src-tauri\target\release\.cargo-lock'),
    (Join-Path $CargoTargetDir '.package-cache'),
    (Join-Path $NightVoyageRoot 'src-tauri\target\.package-cache')
  )

  foreach ($lockPath in $lockPaths) {
    if (Test-Path $lockPath) {
      try {
        Remove-Item -Path $lockPath -Force -ErrorAction Stop
        Write-Host ("[Night Voyage] remove stale lock {0}" -f $lockPath)
      } catch {
      }
    }
  }
}

function Remove-StaleBuildArtifacts {
  $artifactRoots = @(
    (Join-Path $CargoTargetDir 'debug'),
    (Join-Path $NightVoyageRoot 'src-tauri\target\debug')
  )
  $artifactPatterns = @(
    'night-voyage.exe',
    'night-voyage.pdb',
    'night_voyage_lib.pdb',
    'night_voyage_lib.dll',
    'night_voyage_lib.dll.exp',
    'night_voyage_lib.dll.lib',
    'night_voyage_lib.lib'
  )

  foreach ($artifactRoot in $artifactRoots) {
    if (-not (Test-Path $artifactRoot)) {
      continue
    }

    foreach ($artifactPattern in $artifactPatterns) {
      try {
        Get-ChildItem -Path $artifactRoot -Filter $artifactPattern -File -ErrorAction Stop | ForEach-Object {
          try {
            Remove-Item -Path $_.FullName -Force -ErrorAction Stop
            Write-Host ("[Night Voyage] remove stale artifact {0}" -f $_.FullName)
          } catch {
          }
        }
      } catch {
      }
    }
  }
}

function Remove-StaleIncrementalCache {
  $incrementalDirs = @(
    (Join-Path $CargoTargetDir 'debug\incremental'),
    (Join-Path $NightVoyageRoot 'src-tauri\target\debug\incremental')
  )

  foreach ($dir in $incrementalDirs) {
    if (Test-Path $dir) {
      try {
        $size = (Get-ChildItem -Path $dir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $sizeMB = [math]::Round($size / 1MB, 1)
        if ($sizeMB -gt 200) {
          Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
          Write-Host ("[Night Voyage] remove stale incremental cache {0} ({1} MB)" -f $dir, $sizeMB)
        }
      } catch {
      }
    }
  }
}

function Remove-StaleSqliteWalFiles {
  $cacheDir = Join-Path $NightVoyageRoot '.cache'
  if (-not (Test-Path $cacheDir)) {
    return
  }

  $walPatterns = @(
    'night-voyage-dev.sqlite3-shm',
    'night-voyage-dev.sqlite3-wal',
    'night-voyage-release.sqlite3-shm',
    'night-voyage-release.sqlite3-wal'
  )

  foreach ($pattern in $walPatterns) {
    $filePath = Join-Path $cacheDir $pattern
    if (Test-Path $filePath) {
      try {
        Remove-Item -Path $filePath -Force -ErrorAction Stop
        Write-Host ("[Night Voyage] remove stale sqlite wal/shm {0}" -f $filePath)
      } catch {
      }
    }
  }
}

Write-Host '[Night Voyage] Windows dev pre-clean start'
Write-Host ("[Night Voyage] workspace {0}" -f $NightVoyageRoot)
Write-Host ("[Night Voyage] cargo-target {0}" -f $CargoTargetDir)
Write-Host ("[Night Voyage] cargo-home {0}" -f $CargoHomeDir)

try {
  Stop-ProcessByNameFast -Name 'night-voyage'
  Stop-PortOwnersFast -Port 1420
  Remove-StaleLockFilesFast
  Remove-StaleBuildArtifacts
  Remove-StaleIncrementalCache
  Remove-StaleSqliteWalFiles
} finally {
  Write-Host '[Night Voyage] Windows dev pre-clean done'
  $global:LASTEXITCODE = 0
  exit 0
}

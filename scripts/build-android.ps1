# Night Voyage Android Build Script
# 一键构建Release APK并安装到模拟器/真机（保留用户数据）

param(
    [switch]$Dev,
    [switch]$Install,
    [switch]$NoBuild,
    [string]$Device
)

$ErrorActionPreference = "Stop"

# 设置环境变量
$env:ANDROID_HOME = "E:\LibSoftware\android_sdk"
$env:JAVA_HOME = "D:\minecraft\zulu17"
$env:PATH = "$env:ANDROID_HOME\platform-tools;$env:PATH"

# Rust单线程编译避免Windows Android交叉编译bug
# PC版多线程编译正常，只有Android目标需要单线程
$env:CARGO_BUILD_JOBS = "1"

Write-Host "=== Night Voyage Android Build ===" -ForegroundColor Cyan
Write-Host "Mode: $(if ($Dev) { 'Development' } else { 'Release' })" -ForegroundColor Gray

# 检查adb
try {
    $adbVersion = adb version
    Write-Host "ADB: $adbVersion" -ForegroundColor Green
} catch {
    Write-Error "ADB not found. Please check ANDROID_HOME path."
    exit 1
}

# 检查设备
Write-Host "`nChecking devices..." -ForegroundColor Yellow
$devices = adb devices | Select-String -Pattern "^\S+\tdevice$"
if (-not $devices) {
    Write-Error "No Android device/emulator found. Please start emulator or connect device."
    exit 1
}

$devices | ForEach-Object { Write-Host "  Found: $_" -ForegroundColor Green }

# 构建
if (-not $NoBuild) {
    Write-Host "`nBuilding APK..." -ForegroundColor Yellow

    if ($Dev) {
        npx tauri android dev
    } else {
        npx tauri android build
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed!"
        exit 1
    }

    Write-Host "Build completed!" -ForegroundColor Green
}

# 安装APK（保留数据）
if ($Install -or -not $Dev) {
    Write-Host "`nInstalling APK (preserving data)..." -ForegroundColor Yellow

    $apkPath = "D:\data\Night Voyage\src-tauri\gen\android\app\build\outputs\apk\release\app-release.apk"

    if (-not (Test-Path $apkPath)) {
        # 尝试debug路径
        $apkPath = "D:\data\Night Voyage\src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk"
    }

    if (Test-Path $apkPath) {
        # -r 参数保留数据
        adb install -r "$apkPath"

        if ($LASTEXITCODE -eq 0) {
            Write-Host "Installation successful!" -ForegroundColor Green

            # 启动应用
            Write-Host "`nLaunching app..." -ForegroundColor Yellow
            adb shell am start -n com.nightvoyage.app/.MainActivity
        } else {
            Write-Error "Installation failed!"
            exit 1
        }
    } else {
        Write-Error "APK not found at expected path"
        exit 1
    }
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan

# Night Voyage Android Build Script (x86_64 only for emulator)
# 只编译x86_64架构，用于模拟器测试（编译更快）

param(
    [switch]$Release,
    [switch]$Install
)

$ErrorActionPreference = "Stop"

# 设置环境变量
$env:ANDROID_HOME = "E:\LibSoftware\android_sdk"
$env:JAVA_HOME = "D:\minecraft\zulu17"
$env:PATH = "$env:ANDROID_HOME\platform-tools;$env:PATH"

# Rust单线程编译避免Windows bug
$env:CARGO_BUILD_JOBS = "1"

Write-Host "=== Night Voyage Android Build (x86_64 only) ===" -ForegroundColor Cyan
Write-Host "Mode: $(if ($Release) { 'Release' } else { 'Debug' })" -ForegroundColor Gray
Write-Host "Target: x86_64 (emulator only)" -ForegroundColor Gray

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

# 构建 - 只编译x86_64
Write-Host "`nBuilding APK (x86_64 only)..." -ForegroundColor Yellow

$profile = if ($Release) { "release" } else { "debug" }

# 使用Tauri CLI但只构建x86_64
# 方法：直接调用cargo构建x86_64目标
cd "$PSScriptRoot\..\src-tauri"

# 构建Rust库（x86_64 only）
cargo build --target x86_64-linux-android $(if ($Release) { "--release" })

if ($LASTEXITCODE -ne 0) {
    Write-Error "Rust build failed!"
    exit 1
}

Write-Host "Rust build completed!" -ForegroundColor Green

# 手动构建APK（跳过Rust编译，因为已经手动编译了）
cd "$PSScriptRoot\..\src-tauri\gen\android"

# 使用Gradle直接构建APK
$gradleArgs = if ($Release) {
    "assembleX86_64Release"
} else {
    "assembleX86_64Debug"
}

.\gradlew.bat $gradleArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "APK build failed!"
    exit 1
}

Write-Host "APK build completed!" -ForegroundColor Green

# 安装APK（保留数据）
if ($Install) {
    Write-Host "`nInstalling APK (preserving data)..." -ForegroundColor Yellow

    $apkPath = if ($Release) {
        "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\x86_64\release\app-x86_64-release.apk"
    } else {
        "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\x86_64\debug\app-x86_64-debug.apk"
    }

    if (Test-Path $apkPath) {
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
        Write-Error "APK not found at expected path: $apkPath"
        exit 1
    }
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan

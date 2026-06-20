# Night Voyage Android Build Script (arm64 Debug)
# 编译arm64-v8a架构的Debug APK，用于真机测试
# Debug APK自动签名，可以直接安装

param(
    [switch]$Install
)

$ErrorActionPreference = "Stop"

# 设置环境变量
$env:ANDROID_HOME = "E:\LibSoftware\android_sdk"
$env:JAVA_HOME = "D:\minecraft\zulu17"
$env:NDK_HOME = "E:\LibSoftware\android_sdk\ndk\29.0.14206865"
$env:PATH = "$env:NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

# Rust单线程编译避免Windows bug
$env:CARGO_BUILD_JOBS = "1"

Write-Host "=== Night Voyage Android Build (arm64 Debug) ===" -ForegroundColor Cyan
Write-Host "Target: arm64-v8a (64-bit ARM)" -ForegroundColor Gray
Write-Host "Profile: debug (auto-signed)" -ForegroundColor Gray
Write-Host ""

# 检查adb
try {
    $adbVersion = adb version
    Write-Host "ADB: $adbVersion" -ForegroundColor Green
} catch {
    Write-Error "ADB not found. Please check ANDROID_HOME path."
    exit 1
}

# 构建 - arm64 debug（自动签名）
Write-Host "Building arm64 Debug APK..." -ForegroundColor Yellow
Write-Host "This may take 10-20 minutes depending on your system." -ForegroundColor Gray
Write-Host ""

cd "$PSScriptRoot\.."

# 使用Tauri CLI构建arm64 debug（--debug表示debug模式，自动签名）
npx tauri android build --debug --target aarch64

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed!" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host "Build completed!" -ForegroundColor Green

# 查找生成的APK
$apkPaths = @(
    "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk",
    "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk",
    "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk"
)

$foundApk = $null
foreach ($path in $apkPaths) {
    if (Test-Path $path) {
        $foundApk = $path
        break
    }
}

if (-not $foundApk) {
    # 搜索所有debug apk
    $apkFiles = Get-ChildItem "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk" -Recurse -Filter "*debug*.apk" -ErrorAction SilentlyContinue
    if ($apkFiles) {
        $foundApk = $apkFiles[0].FullName
    }
}

if ($foundApk) {
    Write-Host ""
    Write-Host "APK location: $foundApk" -ForegroundColor Cyan
    
    # 显示APK信息
    $apkSize = (Get-Item $foundApk).Length / 1MB
    Write-Host "APK size: $([math]::Round($apkSize, 2)) MB" -ForegroundColor Gray
    
    # 安装APK（保留数据）
    if ($Install) {
        Write-Host ""
        Write-Host "Installing APK (preserving data)..." -ForegroundColor Yellow
        
        # 检查设备
        $devices = adb devices | Select-String -Pattern "^\S+\tdevice$"
        if (-not $devices) {
            Write-Error "No Android device found. Please connect your device."
            exit 1
        }
        
        adb install -r "$foundApk"
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Installation successful!" -ForegroundColor Green
            
            # 启动应用
            Write-Host ""
            Write-Host "Launching app..." -ForegroundColor Yellow
            adb shell am start -n com.nightvoyage.app/.MainActivity
        } else {
            Write-Error "Installation failed!"
            exit 1
        }
    } else {
        Write-Host ""
        Write-Host "To install, run:" -ForegroundColor Yellow
        Write-Host "  adb install -r `"$foundApk`"" -ForegroundColor Gray
    }
} else {
    Write-Error "No debug APK found!"
    exit 1
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan

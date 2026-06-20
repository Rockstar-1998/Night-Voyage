# Night Voyage Android Build Script (arm64 Release)
# 编译arm64-v8a架构的Release APK，用于真机部署
# 支持的设备：绝大多数现代Android手机/平板（arm64-v8a）

param(
    [switch]$Install,
    [switch]$Sign
)

$ErrorActionPreference = "Stop"

# 设置环境变量
$env:ANDROID_HOME = "E:\LibSoftware\android_sdk"
$env:JAVA_HOME = "D:\minecraft\zulu17"
$env:NDK_HOME = "E:\LibSoftware\android_sdk\ndk\29.0.14206865"
$env:PATH = "$env:NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

# Rust单线程编译避免Windows bug
$env:CARGO_BUILD_JOBS = "1"

Write-Host "=== Night Voyage Android Build (arm64 Release) ===" -ForegroundColor Cyan
Write-Host "Target: arm64-v8a (64-bit ARM)" -ForegroundColor Gray
Write-Host "Profile: release" -ForegroundColor Gray
Write-Host ""

# 检查adb
try {
    $adbVersion = adb version
    Write-Host "ADB: $adbVersion" -ForegroundColor Green
} catch {
    Write-Error "ADB not found. Please check ANDROID_HOME path."
    exit 1
}

# 检查签名配置（如果需要签名）
if ($Sign) {
    $keystorePath = "$PSScriptRoot\..\night-voyage.keystore"
    if (-not (Test-Path $keystorePath)) {
        Write-Host ""
        Write-Host "WARNING: Keystore not found at $keystorePath" -ForegroundColor Yellow
        Write-Host "Release APK will be unsigned. To create a keystore, run:" -ForegroundColor Yellow
        Write-Host "  keytool -genkey -v -keystore night-voyage.keystore -alias nightvoyage -keyalg RSA -keysize 2048 -validity 10000" -ForegroundColor Gray
        Write-Host ""
    }
}

# 构建 - 只编译arm64 release
Write-Host "Building arm64 Release APK..." -ForegroundColor Yellow
Write-Host "This may take 10-20 minutes depending on your system." -ForegroundColor Gray
Write-Host ""

cd "$PSScriptRoot\.."

# 使用Tauri CLI构建arm64 release
# 注意：Tauri CLI 2.x 使用 --debug 表示debug模式，不加表示release模式
npx tauri android build --target aarch64

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed!" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host "Build completed!" -ForegroundColor Green

# 查找生成的APK
$apkPaths = @(
    "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release.apk",
    "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk",
    "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\release\app-release.apk"
)

$foundApk = $null
foreach ($path in $apkPaths) {
    if (Test-Path $path) {
        $foundApk = $path
        break
    }
}

if (-not $foundApk) {
    # 搜索所有release apk
    $apkFiles = Get-ChildItem "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk" -Recurse -Filter "*release*.apk" -ErrorAction SilentlyContinue
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
    
    # 签名（如果需要）
    if ($Sign -and (Test-Path "$PSScriptRoot\..\night-voyage.keystore")) {
        Write-Host ""
        Write-Host "Signing APK..." -ForegroundColor Yellow
        $signedApk = "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\signed\app-arm64-release-signed.apk"
        New-Item -ItemType Directory -Path "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\signed" -Force | Out-Null
        
        & "$env:JAVA_HOME\bin\jarsigner.exe" -verbose -sigalg SHA256withRSA -digestalg SHA-256 `
            -keystore "$PSScriptRoot\..\night-voyage.keystore" `
            -signedjar $signedApk `
            $foundApk nightvoyage
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "APK signed successfully!" -ForegroundColor Green
            $foundApk = $signedApk
        } else {
            Write-Warning "Signing failed, using unsigned APK"
        }
    }
    
    # 安装APK（保留数据）
    if ($Install) {
        Write-Host ""
        Write-Host "Installing APK (preserving data)..." -ForegroundColor Yellow
        
        # 检查设备
        $devices = adb devices | Select-String -Pattern "^\S+\tdevice$"
        if (-not $devices) {
            Write-Error "No Android device found. Please connect your device or start emulator."
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
    Write-Error "No release APK found!"
    exit 1
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan

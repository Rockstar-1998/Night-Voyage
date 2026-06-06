# Night Voyage Android Build Script (x86 Debug for emulator)
# 只编译x86架构的Debug APK，用于模拟器快速测试

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

Write-Host "=== Night Voyage Android Build (x86 Debug) ===" -ForegroundColor Cyan
Write-Host "Target: x86 (32-bit emulator)" -ForegroundColor Gray
Write-Host "Profile: debug" -ForegroundColor Gray
Write-Host ""

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

# 构建 - 只编译x86 debug
Write-Host "`nBuilding x86 Debug APK..." -ForegroundColor Yellow

cd "$PSScriptRoot\.."

# 使用Tauri CLI构建x86 debug
npx tauri android build --debug --target i686

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed!" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host "Build completed!" -ForegroundColor Green

# 安装APK（保留数据）
if ($Install) {
    Write-Host "`nInstalling APK (preserving data)..." -ForegroundColor Yellow

    # Debug APK路径
    $apkPath = "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\x86\debug\app-x86-debug.apk"

    # 如果上面的路径不存在，尝试通用路径
    if (-not (Test-Path $apkPath)) {
        $apkPath = "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk\debug\app-x86-debug.apk"
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
        # 查找所有debug apk
        $apkFiles = Get-ChildItem "$PSScriptRoot\..\src-tauri\gen\android\app\build\outputs\apk" -Recurse -Filter "*debug*.apk" -ErrorAction SilentlyContinue
        if ($apkFiles) {
            Write-Host "Found APKs:" -ForegroundColor Yellow
            $apkFiles | ForEach-Object { Write-Host "  $($_.FullName)" }
            
            # 使用第一个找到的apk
            $apkPath = $apkFiles[0].FullName
            Write-Host "`nInstalling: $apkPath" -ForegroundColor Yellow
            adb install -r "$apkPath"
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Installation successful!" -ForegroundColor Green
                adb shell am start -n com.nightvoyage.app/.MainActivity
            }
        } else {
            Write-Error "No debug APK found!"
            exit 1
        }
    }
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan

# Night Voyage Android Quick Install
# 仅安装已构建的APK（保留用户数据，不重新编译）

$ErrorActionPreference = "Stop"

# 设置环境变量
$env:ANDROID_HOME = "E:\LibSoftware\android_sdk"
$env:JAVA_HOME = "D:\minecraft\zulu17"
$env:PATH = "$env:ANDROID_HOME\platform-tools;$env:PATH"

Write-Host "=== Night Voyage Quick Install ===" -ForegroundColor Cyan

# 检查设备
Write-Host "Checking devices..." -ForegroundColor Yellow
$devices = adb devices | Select-String -Pattern "^\S+\tdevice$"
if (-not $devices) {
    Write-Error "No Android device/emulator found."
    exit 1
}

$devices | ForEach-Object { Write-Host "  Found: $_" -ForegroundColor Green }

# 查找APK
$apkPaths = @(
    "D:\data\Night Voyage\src-tauri\gen\android\app\build\outputs\apk\release\app-release.apk",
    "D:\data\Night Voyage\src-tauri\gen\android\app\build\outputs\apk\release\app-universal-release.apk",
    "D:\data\Night Voyage\src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk"
)

$apkPath = $null
foreach ($path in $apkPaths) {
    if (Test-Path $path) {
        $apkPath = $path
        break
    }
}

if (-not $apkPath) {
    Write-Error "No APK found. Please build first with: .\build-android.ps1"
    exit 1
}

Write-Host "Found APK: $apkPath" -ForegroundColor Green

# 安装（保留数据）
Write-Host "`nInstalling (preserving data)..." -ForegroundColor Yellow
adb install -r "$apkPath"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Installation successful!" -ForegroundColor Green

    # 启动应用
    Write-Host "Launching app..." -ForegroundColor Yellow
    adb shell am start -n com.nightvoyage.app/.MainActivity

    Write-Host "`n=== Done ===" -ForegroundColor Cyan
} else {
    Write-Error "Installation failed!"
    exit 1
}

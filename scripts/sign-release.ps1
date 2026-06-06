# Night Voyage Android Release APK Signer
# 为Release APK创建签名并安装

param(
    [string]$KeystorePath = "$env:USERPROFILE\.android\night-voyage.keystore",
    [string]$KeystorePassword = "nightvoyage",
    [string]$KeyAlias = "night-voyage",
    [switch]$Install
)

$ErrorActionPreference = "Stop"

# 设置环境变量
$env:ANDROID_HOME = "E:\LibSoftware\android_sdk"
$env:JAVA_HOME = "D:\minecraft\zulu17"
$env:PATH = "$env:ANDROID_HOME\platform-tools;$env:PATH"

$ApkPath = "D:\data\Night Voyage\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
$SignedApkPath = "D:\data\Night Voyage\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-signed.apk"

Write-Host "=== Night Voyage APK Signer ===" -ForegroundColor Cyan

# 检查APK是否存在
if (-not (Test-Path $ApkPath)) {
    Write-Error "APK not found: $ApkPath`nPlease build release first with: .\build-android.ps1"
    exit 1
}

# 创建密钥库（如果不存在）
if (-not (Test-Path $KeystorePath)) {
    Write-Host "Creating keystore..." -ForegroundColor Yellow
    $keytool = "$env:JAVA_HOME\bin\keytool.exe"
    
    & $keytool -genkey -v `
        -keystore $KeystorePath `
        -alias $KeyAlias `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -storepass $KeystorePassword `
        -keypass $KeystorePassword `
        -dname "CN=Night Voyage, OU=Dev, O=NightVoyage, L=Unknown, ST=Unknown, C=CN"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create keystore!"
        exit 1
    }
    
    Write-Host "Keystore created: $KeystorePath" -ForegroundColor Green
}

# 签名APK
Write-Host "`nSigning APK..." -ForegroundColor Yellow
$apksigner = "$env:ANDROID_HOME\build-tools\35.0.0\apksigner.bat"

# 如果apksigner不存在，尝试其他版本
if (-not (Test-Path $apksigner)) {
    $buildToolsVersions = Get-ChildItem "$env:ANDROID_HOME\build-tools" -ErrorAction SilentlyContinue | Sort-Object Name -Descending
    foreach ($version in $buildToolsVersions) {
        $apksigner = "$($version.FullName)\apksigner.bat"
        if (Test-Path $apksigner) {
            break
        }
    }
}

if (-not (Test-Path $apksigner)) {
    Write-Error "apksigner not found! Please check Android SDK build-tools."
    exit 1
}

& $apksigner sign `
    --ks $KeystorePath `
    --ks-pass pass:$KeystorePassword `
    --key-pass pass:$KeystorePassword `
    --out $SignedApkPath `
    $ApkPath

if ($LASTEXITCODE -ne 0) {
    Write-Error "APK signing failed!"
    exit 1
}

Write-Host "APK signed successfully!" -ForegroundColor Green
Write-Host "Signed APK: $SignedApkPath" -ForegroundColor Cyan

# 验证签名
Write-Host "`nVerifying signature..." -ForegroundColor Yellow
& $apksigner verify -v $SignedApkPath

# 安装（保留数据）
if ($Install) {
    Write-Host "`nInstalling signed APK (preserving data)..." -ForegroundColor Yellow
    
    # 检查设备
    $devices = adb devices | Select-String -Pattern "^\S+\tdevice$"
    if (-not $devices) {
        Write-Error "No Android device/emulator found."
        exit 1
    }
    
    adb install -r $SignedApkPath
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Installation successful!" -ForegroundColor Green
        adb shell am start -n com.nightvoyage.app/.MainActivity
    } else {
        Write-Error "Installation failed!"
        exit 1
    }
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan

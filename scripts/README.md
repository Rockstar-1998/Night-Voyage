# 构建与开发脚本

## 脚本说明

### 1. build-android-arm64-debug.ps1 - Android Debug 构建
编译 arm64-v8a 架构的 Debug APK，用于真机测试。Debug APK 自动签名，可直接安装。

**用法：**
```powershell
# 构建 Debug APK
.\build-android-arm64-debug.ps1

# 构建并安装到设备
.\build-android-arm64-debug.ps1 -Install
```

### 2. build-android-arm64-release.ps1 - Android Release 构建
编译 arm64-v8a 架构的 Release APK，用于真机部署。

**用法：**
```powershell
# 构建 Release APK
.\build-android-arm64-release.ps1

# 构建并签名
.\build-android-arm64-release.ps1 -Sign

# 构建、签名并安装
.\build-android-arm64-release.ps1 -Sign -Install
```

### 3. build-frontend.js - 前端构建入口
由 `npm run build` 调用，自动检测平台选择桌面端或移动端 Vite 配置。

- Android 平台使用 `vite.config.mobile.ts`
- 其他平台使用默认 `vite.config.ts`

### 4. windows-dev-preclean.ps1 - 开发环境预清理
由 `start-dev.bat` 和 `npm run dev:preclean` 调用，在构建前清理开发环境。

## 数据保留说明

Android 安装脚本使用 `adb install -r` 参数：
- `-r` = Replace existing application（替换应用）
- **保留**：应用数据、SharedPreferences、数据库
- **替换**：APK 代码、资源文件

## 环境要求

Android 构建脚本已硬编码以下路径：
- Android SDK: `E:\LibSoftware\android_sdk`
- JDK: `D:\minecraft\zulu17`
- 项目路径: `D:\data\Night Voyage`

如需修改路径，请编辑脚本中的对应变量。

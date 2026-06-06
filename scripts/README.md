# Android 构建脚本

## 脚本说明

### 1. build-android.ps1 - 完整构建脚本
一键构建并安装APK到Android设备/模拟器。

**用法：**
```powershell
# 构建Release并安装（保留用户数据）
.\build-android.ps1

# 仅构建，不安装
.\build-android.ps1 -NoBuild

# 开发模式（连接开发服务器）
.\build-android.ps1 -Dev

# 仅安装已构建的APK
.\build-android.ps1 -Install -NoBuild
```

**特点：**
- 自动设置环境变量（ANDROID_HOME, JAVA_HOME）
- 使用单线程编译避免Windows Rust bug
- 使用 `adb install -r` 保留用户数据
- 自动启动应用

### 2. quick-install.ps1 - 快速安装
仅安装已构建的APK，不重新编译。

**用法：**
```powershell
# 快速安装（保留用户数据）
.\quick-install.ps1
```

**适用场景：**
- 代码未修改，只想重新安装
- 测试不同设备
- 快速恢复应用

## 数据保留说明

两个脚本都使用 `adb install -r` 参数：
- `-r` = Replace existing application（替换应用）
- **保留**：应用数据、SharedPreferences、数据库
- **替换**：APK代码、资源文件

## 环境要求

脚本已硬编码以下路径：
- Android SDK: `E:\LibSoftware\android_sdk`
- JDK: `D:\minecraft\zulu17`
- 项目路径: `D:\data\Night Voyage`

如需修改路径，请编辑脚本中的对应变量。

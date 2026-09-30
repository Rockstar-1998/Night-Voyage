# 清理不需要的文件 Spec

## Why
项目根目录和 scripts 目录中积累了大量一次性修复脚本（fix_*.py、refactor_*.py、trace*.py 等）、废弃的构建脚本、调试产物和临时文件，影响仓库整洁度。

## What Changes
- 删除根目录下 40 个不需要的文件：废弃构建脚本（build-debug.bat、build-release.bat、run-release.bat）、一次性修复脚本（fix_*.py、refactor_*.py、trace*.py、rewrite_*.py、read_diff.py）、调试产物（cargo-build-log.txt、diff.txt、llm.txt）、错放位置的角色卡 JSON 文件
- 删除 scripts/ 目录下 11 个不需要的文件：废弃的 Android 构建脚本（x86/x86_64 变体、通用版）、未使用的工具脚本（memory_leak_detector、mock-tauri-ws-server、quick-install、sign-*、startup_benchmark、windows-build-release-with-timeout）
- 删除 src-tauri/ 目录下 2 个一次性工具脚本（fix-vendor-builds.py、update-checksums.py）
- 更新 scripts/README.md 以反映清理后的脚本列表

## Impact
- Affected specs: 无功能影响，纯仓库治理
- Affected code: 无运行时代码变更

## 保留的文件（用户确认使用中）
- `start-dev.bat` — PC 版构建
- `scripts/build-android-arm64-debug.ps1` — Android debug 构建
- `scripts/build-android-arm64-release.ps1` — Android release 构建
- `scripts/build-frontend.js` — `npm run build` 引用
- `scripts/windows-dev-preclean.ps1` — `start-dev.bat` 和 `npm run dev:preclean` 引用
- `night-voyage.keystore` — Android 签名密钥
- `index-mobile.html` — 移动端 Vite 构建入口
- `index.html` — PC 端 Vite 构建入口

## ADDED Requirements

### Requirement: 删除废弃构建脚本
系统 SHALL 删除以下废弃的构建/启动脚本：
- `build-debug.bat`
- `build-release.bat`
- `run-release.bat`

#### Scenario: 删除后构建不受影响
- **WHEN** 用户使用 `start-dev.bat` 构建 PC 版
- **THEN** 构建流程正常工作，不受删除影响

### Requirement: 删除一次性修复脚本
系统 SHALL 删除根目录下所有一次性修复/重构/追踪脚本：
- fix.py, fix2.py
- fix_animations_and_sizes.py, fix_character.py, fix_colors.py, fix_imports.py
- fix_new_chat.py, fix_onchange.py, fix_parenthesis.py, fix_parenthesis_2.py
- fix_remaining_cards.py, fix_settings.py, fix_settings3.py, fix_stuck_rounds.sql
- fix_syntax_final.py, fix_ui.py, fix_wb.py, fix_worldbook_app.py
- read_diff.py
- refactor.py, refactor_charactersidebar.py, refactor_detail.py, refactor_icons.py
- refactor_newchat.py, refactor_params.py, refactor_selects_1.py, refactor_selects_smart.py
- refactor_worldbook.py
- rewrite_settings.py
- trace.py, trace2.py, trace3.py

#### Scenario: 删除后项目功能不受影响
- **WHEN** 删除这些一次性脚本后
- **THEN** 应用构建和运行均正常

### Requirement: 删除调试产物和临时文件
系统 SHALL 删除以下调试/临时文件：
- `cargo-build-log.txt` — 构建日志
- `diff.txt` — diff 输出
- `llm.txt` — LLM 响应转储

### Requirement: 删除错放位置的角色卡文件
系统 SHALL 删除根目录下的角色卡 JSON 文件（这些文件不属于项目源码）：
- `V9.4 [preview] 狐神抚 · 毓忻.json`
- `狐神抚 V9.4 [Night Voyage].json`

### Requirement: 删除 scripts/ 下未使用的脚本
系统 SHALL 删除 scripts/ 目录下以下未使用的脚本：
- build-android-x86-debug.ps1
- build-android-x86_64.ps1
- build-android.ps1
- memory_leak_detector.cjs
- memory_leak_detector.py
- mock-tauri-ws-server.js
- quick-install.ps1
- sign-existing-apk.ps1
- sign-release.ps1
- startup_benchmark.py
- windows-build-release-with-timeout.ps1

### Requirement: 删除 src-tauri/ 下一次性工具脚本
系统 SHALL 删除 src-tauri/ 目录下以下一次性工具脚本：
- fix-vendor-builds.py
- update-checksums.py

### Requirement: 更新 scripts/README.md
系统 SHALL 更新 scripts/README.md，使其只反映保留的脚本（build-android-arm64-debug.ps1、build-android-arm64-release.ps1、build-frontend.js、windows-dev-preclean.ps1）。

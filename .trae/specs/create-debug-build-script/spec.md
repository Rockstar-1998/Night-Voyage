# 创建 Debug 构建脚本 Spec

## Why
用户需要在浏览器中调试前端 UI，不需要打开 Tauri 窗口。当前只有 `start-dev.bat`（构建 release 并复制到隔离实例），缺少一个仅构建 Rust debug 后端 + 启动 Vite 开发服务器的脚本。

## What Changes
- 新建 `start-debug.bat`，基于 `start-dev.bat` 的环境变量设置，但改为：
  - 构建 Rust debug 版本（`cargo build` 而非 `npm run tauri build`）
  - 启动 Vite 开发服务器（`npm run dev:frontend`），在浏览器中调试
  - 不打开 Tauri 窗口
  - 不创建隔离实例

## Impact
- Affected specs: 无
- Affected code: 无运行时代码变更，仅新增构建脚本

## ADDED Requirements

### Requirement: Debug 构建脚本
系统 SHALL 提供 `start-debug.bat` 脚本，执行以下流程：
1. 设置与 `start-dev.bat` 相同的环境变量（缓存目录、Cargo Home 等）
2. 运行 `npm install`（如 node_modules 不存在）
3. 运行 pre-clean
4. 构建 Rust debug 版本（`cargo build`，在 src-tauri 目录下）
5. 启动 Vite 开发服务器（`npm run dev:frontend`），用户可在浏览器 localhost:1420 调试

#### Scenario: 用户在浏览器中调试前端
- **WHEN** 用户运行 `start-debug.bat`
- **THEN** Rust debug 后端编译完成，Vite 开发服务器启动，用户可在浏览器中访问前端页面

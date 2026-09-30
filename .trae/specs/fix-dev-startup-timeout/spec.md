# 修复 Dev 启动超时后 Vite 残留进程 Spec

## Why

Tauri CLI 的 `dev` 命令硬编码了 180 秒超时等待前端 dev server。Vite 在冷启动时可能需要 6+ 分钟（382963ms），远超 180 秒。超时后 Tauri 报错退出（exit code 1），但 Vite 子进程仍在后台运行，占用端口 1420。下次启动时，pre-clean 脚本需要杀掉残留进程，形成恶性循环。

## What Changes

- 将 `tauri.conf.json` 的 `beforeDevCommand` 从字符串改为对象形式 `{ "script": "npm run dev", "wait": false }`，让 Tauri 不阻塞等待 beforeDevCommand 完成
- 修改 `start-dev.bat`：先启动 Vite dev server 并等待其就绪，然后再启动 `tauri dev --no-dev-server`
- 修改 `vite.config.ts`：添加启动就绪信号文件机制，让 bat 脚本可以检测 Vite 是否就绪

## Impact

- Affected code:
  - `src-tauri/tauri.conf.json` — `beforeDevCommand` 配置
  - `start-dev.bat` — 启动流程
  - `vite.config.ts` — 添加就绪信号
  - `package.json` — 可能需要添加新的 npm script

---

## ADDED Requirements

### Requirement: Vite 启动与 Tauri 解耦

启动流程 SHALL 先启动 Vite dev server 并等待其就绪，然后再启动 Tauri 应用。Tauri 不再负责启动和等待 Vite。

#### Scenario: 正常启动

- **WHEN** 用户运行 `start-dev.bat`
- **THEN** 脚本先启动 Vite dev server
- **AND** 等待 Vite 在端口 1420 上就绪（无硬编码超时，使用 HTTP 探测）
- **AND** Vite 就绪后启动 `tauri dev`（不启动 beforeDevCommand 中的 Vite）
- **AND** Tauri 直接连接到已运行的 Vite dev server

#### Scenario: Vite 启动缓慢

- **WHEN** Vite 冷启动需要超过 180 秒
- **THEN** 启动脚本 SHALL 继续等待 Vite 就绪，而非超时报错
- **AND** 不产生 "Could not connect after 180s" 错误

#### Scenario: Tauri 退出后清理

- **WHEN** Tauri 进程退出（无论是正常退出还是错误退出）
- **THEN** 启动脚本 SHALL 终止 Vite 子进程
- **AND** 端口 1420 被释放

### Requirement: beforeDevCommand 不阻塞

`tauri.conf.json` 的 `beforeDevCommand` SHALL 设置为 `{ "script": "npm run dev", "wait": false }` 或等效配置，使 Tauri 不阻塞等待 Vite 启动完成。

#### Scenario: Tauri dev 启动时

- **WHEN** `tauri dev` 执行 `beforeDevCommand`
- **THEN** 命令在后台启动，Tauri 立即继续执行
- **AND** Tauri 连接到 `devUrl` 指定的已运行 dev server

## MODIFIED Requirements

无修改项。

## REMOVED Requirements

无移除项。

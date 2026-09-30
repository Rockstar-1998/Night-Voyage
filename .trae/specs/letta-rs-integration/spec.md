# Letta 集成重构：使用 letta-rs 客户端 + run_letta.py 方案

## Why
当前 Python embeddable + venv 方案反复失败（venv 模块缺失、setuptools 缺失、`python -m letta` 无 `__main__.py`、`letta server` CLI 在 SQLite 模式下有 bug）。需要放弃该方案，回退到最新 git 提交，改用 `letta-rs` Rust 客户端库直接与 Letta server 通信，并用参考 `letta_tavern` 项目的 `run_letta.py` 脚本启动 server。

## What Changes
- **BREAKING**: 回退所有当前未提交的 Letta 相关改动（git checkout HEAD）
- 用 `letta-rs` crate（v0.1.3，兼容 letta server 0.8.8）替换手写的 `letta_client.rs`
- 用 `run_letta.py` 脚本（参考 `letta_tavern/backend/run_letta.py`）替换 `letta server` CLI 启动方式
- 重写 `letta_sidecar.rs`：移除 Python embeddable 下载/venv 创建逻辑，改为管理 `run_letta.py` 子进程
- 重写 `letta_stream.rs`：使用 `letta-rs` 的 `create_stream()` SSE 消费
- 重写 `letta_setup`：下载 Python embeddable → 安装 pip/setuptools/wheel/aiosqlite/letta → 写入 `run_letta.py`
- 前端设置页 Letta 面板保留，但后端命令签名可能变化

## Impact
- Affected specs: `letta-integration-handoff.md` 中 Phase 2-4 全部重写
- Affected code:
  - `src-tauri/Cargo.toml` — 新增 `letta` crate 依赖
  - `src-tauri/src/services/letta_client.rs` — 删除，由 `letta-rs` 替代
  - `src-tauri/src/services/letta_sidecar.rs` — 重写
  - `src-tauri/src/services/letta_stream.rs` — 重写
  - `src-tauri/src/commands/letta.rs` — 重写
  - `src-tauri/src/lib.rs` — 更新 AppState 和命令注册
  - 前端文件基本不变（事件契约不变）

## ADDED Requirements

### Requirement: 使用 letta-rs crate 作为 Letta REST 客户端
系统 SHALL 使用 `letta-rs` crate（v0.1.3）替代手写的 `letta_client.rs`，直接调用其 `LettaClient`、`AgentApi`、`MessageApi`、`HealthApi` 等强类型 API。

#### Scenario: 健康检查
- **WHEN** sidecar 启动后执行健康检查
- **THEN** 使用 `letta::HealthApi::check()` 替代手写的 `ping()`

#### Scenario: 创建 Agent
- **WHEN** 用户在 Letta 模式会话中发送第一条消息
- **THEN** 使用 `letta::AgentApi::create()` 替代手写的 `create_agent()`

#### Scenario: 流式消息
- **WHEN** 用户在 Letta 模式会话中发送消息
- **THEN** 使用 `letta::MessageApi::create_stream()` 替代手写的 `send_message_stream()`

### Requirement: 使用 run_letta.py 启动 Letta server
系统 SHALL 使用 `run_letta.py` 脚本（参考 `letta_tavern/backend/run_letta.py`）启动 Letta server，而非 `letta server` CLI 或 `python -m letta server`。该脚本直接 patch 数据库工具函数 + 手动建表 + 直接 import FastAPI app 对象 + uvicorn.run()，绕过官方 CLI 的 SQLite bug。

#### Scenario: 启动 sidecar
- **WHEN** 应用启动或用户手动启动 sidecar
- **THEN** 执行 `python run_letta.py <port> <host>`，脚本内嵌为 Rust 常量并自动写入缓存目录

### Requirement: Letta server 版本锁定 0.8.8
系统 SHALL 在 `letta_setup` 中安装 `letta==0.8.8`，确保与 `letta-rs` client v0.1.3 兼容。

#### Scenario: 安装 letta
- **WHEN** 用户点击「初始化 Letta 环境」
- **THEN** pip install `letta==0.8.8`（而非不指定版本）

### Requirement: 缓存路径动态解析
系统 SHALL 使用可执行文件同级目录或 Tauri app_data_dir 作为 Letta 缓存目录，不硬编码 `D:\software_cache`。

#### Scenario: 路径解析
- **WHEN** 应用启动
- **THEN** 优先使用 exe 同级目录下的 `letta/`，回退到 app_data_dir 下的 `letta/`

## MODIFIED Requirements

### Requirement: Letta sidecar 进程管理
原手写 `letta_sidecar.rs` 改为管理 `python run_letta.py` 子进程，移除 Python embeddable 下载逻辑（移到 `letta_setup` 命令中）。Sidecar 仍为单例，零回退，异步非阻塞。

### Requirement: Letta 流式消息转译
原手写 SSE 解析改为使用 `letta-rs` 的 `MessageApi::create_stream()` 返回的 `MessageStream`，消费 `StreamingEvent` 枚举，转译为现有 `llm-stream-chunk`/`llm-stream-event`/`llm-stream-error`/`chat-round-state` 事件。

## REMOVED Requirements

### Requirement: 手写 Letta REST 客户端
**Reason**: `letta-rs` crate 提供了完整的强类型客户端，无需手写
**Migration**: 删除 `letta_client.rs`，所有调用改为 `letta-rs` API

### Requirement: 使用 `letta server` CLI 或 `python -m letta server` 启动
**Reason**: 官方 CLI 在 SQLite 模式下有 bug（LETTA_PG_URI 导致引擎误判为 PostgreSQL），且 `python -m letta` 无 `__main__.py`
**Migration**: 使用 `run_letta.py` 脚本直接 uvicorn.run(app)

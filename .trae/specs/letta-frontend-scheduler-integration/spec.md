# Letta 前端调度器集成 Spec

## Why

当前工作区后端处于**编译断裂**状态：`src-tauri/src/commands/mod.rs` 已声明 `pub mod letta;`，但 `src-tauri/src/commands/letta.rs` 文件不存在，导致 `cargo check` 失败、`tauri dev` 无法启动。需要补齐后端 Tauri 命令层并把 sidecar 状态接入 `AppState`，完成"前端 TS 客户端直连 Letta sidecar、Rust 仅负责进程管理 + API 档案读取 + 历史存储"的架构闭环。

## What Changes

- 新建 `src-tauri/src/commands/letta.rs`，实现前端 `src/lib/letta.ts` 已依赖的 8 个 Tauri 命令
- 修改 `src-tauri/src/lib.rs`：在 `AppState` 增加 `letta_sidecar` 字段，setup 中初始化，`invoke_handler!` 注册全部新命令
- 复用 `services/letta_sidecar.rs` 已实现的 `start_sidecar` / `health_check` / `LettaSidecarState`
- 复用 `commands/providers.rs::load_provider_secret` 的查询模式，暴露含 `api_key` 的完整 provider 档案给前端
- 操作 `conversations` 表的 `engine_kind` / `letta_agent_id` 字段（migration 0032 已建）

## Impact

- Affected specs: 无既有 spec 涉及（旧 `letta-rs-integration` spec 为已废弃的 Rust 客户端方案，与本方案无关）
- Affected code:
  - 新增：`src-tauri/src/commands/letta.rs`
  - 修改：`src-tauri/src/lib.rs`（AppState + invoke_handler）
  - 既有不动：`src-tauri/src/services/letta_sidecar.rs`、`src-tauri/migrations/0032_letta_engine.sql`、`src/lib/letta.ts`、`src/App.tsx`

## ADDED Requirements

### Requirement: Letta sidecar 生命周期命令

系统 SHALL 提供 4 个 Tauri 命令管理 Letta Python sidecar 进程，前端通过 `@tauri-apps/api/core` 的 `invoke` 调用。

#### Scenario: 查询 sidecar 状态
- **WHEN** 前端调用 `letta_server_status`
- **THEN** 返回 `{ url: string, running: boolean }`，`running` 基于 `AppState.letta_sidecar.child` 是否为 `Some` 判定，`url` 取已存储的 URL（无则空串）

#### Scenario: 启动 sidecar
- **WHEN** 前端调用 `letta_server_start`，且当前 sidecar 未运行
- **THEN** 调用 `services::letta_sidecar::start_sidecar(cache_dir, LETTA_PORT)`，将返回的 `(Child, url)` 存入 `AppState.letta_sidecar`，异步执行 `health_check`，返回 `{ url, running: true }`
- **WHEN** sidecar 已在运行时再次调用 `letta_server_start`
- **THEN** 直接返回当前 `{ url, running: true }`，不重复启动

#### Scenario: 停止 sidecar
- **WHEN** 前端调用 `letta_server_stop`
- **THEN** 取出 `AppState.letta_sidecar.child` 并 `kill()`，清空 child 与 url，返回 `()`

#### Scenario: 安装 Python 环境
- **WHEN** 前端调用 `letta_setup`
- **THEN** 同步调用 `ensure_python_env(cache_dir)` 与 `ensure_run_letta_script(cache_dir)`，完成 Python embeddable + letta 依赖安装，返回 `()`

### Requirement: API 档案读取命令

系统 SHALL 提供 `letta_get_provider_detail` 命令，将含 `api_key` 的完整 provider 档案递送给前端，由前端转交 Letta sidecar 注册 BYOK provider。

#### Scenario: 读取 provider 完整档案
- **WHEN** 前端调用 `letta_get_provider_detail(providerId)`
- **THEN** 查询 `api_providers` 表（列：`id, name, provider_kind, base_url, api_key, model_name, max_tokens, max_context_tokens, temperature`），返回 camelCase 序列化对象 `{ id, name, providerKind, baseUrl, apiKey, modelName, maxTokens?, maxContextTokens?, temperature? }`
- **WHEN** `providerId` 不存在
- **THEN** 返回 `Err`（零回退原则，不返回伪空对象）

### Requirement: 会话引擎绑定命令

系统 SHALL 提供 3 个命令在 `conversations` 表上管理引擎类型与 Letta Agent ID 绑定。

#### Scenario: 保存 agent_id
- **WHEN** 前端调用 `letta_save_agent_id(conversationId, agentId)`
- **THEN** 执行 `UPDATE conversations SET letta_agent_id = ? WHERE id = ?`，返回 `()`

#### Scenario: 读取 agent_id
- **WHEN** 前端调用 `letta_get_agent_id(conversationId)`
- **THEN** 返回 `Option<String>`（`letta_agent_id` 列值，NULL 时返回 `null`）

#### Scenario: 设置引擎类型
- **WHEN** 前端调用 `letta_set_engine_kind(conversationId, engineKind)`
- **THEN** 执行 `UPDATE conversations SET engine_kind = ? WHERE id = ?`，返回 `()`

### Requirement: AppState 集成

`AppState` SHALL 包含 `letta_sidecar` 字段持有 sidecar 进程句柄与 URL，在 `setup` 阶段初始化为默认空状态。

#### Scenario: 应用启动
- **WHEN** Tauri `setup` 执行
- **THEN** `AppState.letta_sidecar` 被初始化为 `LettaSidecarState::default()`（child=None, url=None），不阻塞 UI 启动

## 命令契约（前端已固定，后端须严格对齐）

| 命令名 | 参数 | 返回 | 备注 |
|---|---|---|---|
| `letta_server_status` | 无 | `{ url: string, running: boolean }` | |
| `letta_server_start` | 无 | `{ url: string, running: boolean }` | 异步健康检查，不阻塞返回 |
| `letta_server_stop` | 无 | `()` | |
| `letta_setup` | 无 | `()` | 同步安装，可能耗时较长 |
| `letta_get_provider_detail` | `{ providerId: number }` | `ApiProviderDetail` | 含 api_key |
| `letta_save_agent_id` | `{ conversationId: number, agentId: string }` | `()` | |
| `letta_get_agent_id` | `{ conversationId: number }` | `string \| null` | |
| `letta_set_engine_kind` | `{ conversationId: number, engineKind: string }` | `()` | |

参数命名采用 camelCase（Tauri 默认会将 JS 端 camelCase 参数透传，Rust 端用 snake_case 形参接收，例如前端 `providerId` → Rust `provider_id`，但 `invoke` 的 payload key 须为 `providerId`）。

## 缓存路径合规性说明

`services/letta_sidecar.rs::resolve_cache_dir` 当前从 EXE 向上查找 `.cache` 目录。需在实现阶段确认解析结果指向 `D:\software_cache` 体系（项目硬约束：缓存必须落在 `D:\software_cache`）。若解析到非合规路径，须在本次实现中修正为 `D:\software_cache\letta`，并保证 `sidecar.log`、`letta.db`、Python 环境均写入该目录。

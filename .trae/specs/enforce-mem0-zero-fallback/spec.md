# MEM0 零回退显式报错 Spec

## Why

当前 MEM0 链路从启动到运行时存在 9 处静默回退，违反 `night-voyage-guardrails` 的 `Enforce Zero-Fallback Errors` 硬约束。用户在 UI 看到 `memory_mode = mem0`，但实际从启动起就因 embedding 404 降级为无状态运行，所有失败仅 `eprintln` 到 stderr，UI 无任何错误反馈。原始 `integrate-mem0-rs-memory-layer` spec 本身就**规定了**这种静默降级（"失败时仅记录日志，不影响对话流程"、"初始化失败时不阻断应用启动"），本 spec 修正这些违反 guardrails 的设计，强制每个环节出错时直接显式报错。

## What Changes

- **BREAKING**: 移除 `AppState.memory_service: Mutex<Option<...>>` 的"可选降级"语义，改为构造失败即阻止应用启动，或在 UI 显式弹窗后强制将会话 `memory_mode` 回退至 `stateless`/`legacy` 并锁定 mem0 选项
- **BREAKING**: `MemoryService::search()` 在 prompt 编译期失败时，错误必须冒泡到 UI（通过事件或 RoundState 字段），不允许返回空 Vec 静默继续
- **BREAKING**: `MemoryService::add()` 在记忆写入失败时，错误必须通过事件通知 UI（toast 或顶栏提示），不允许仅 `eprintln` 后返回 `Ok(())`
- 移除 `Mem0RsProvider::health()` 的无条件 `Ok(true)` 伪健康检查，改为真实探测 embedding 端点
- `load_retrieved_detail_blocks` 移除"无 memory_service / mem0 未激活 → 静默返回空 Vec"分支，改为返回显式错误
- `run_memory_extraction_task` 失败时通过事件通知 UI，不再仅 `eprintln`
- `parse_records` 遇到格式不符的条目时记录到 debug 报告，不再静默 `filter_map` 丢弃
- 删除 `lib.rs`、`memory_providers/mod.rs`、`prompt_compiler.rs`、`chat_service.rs` 中所有"degrade gracefully / degrade to empty / degrade to None"注释与对应代码路径

## Impact

- Affected specs:
  - `integrate-mem0-rs-memory-layer` — 修改其"记忆写入"、"记忆检索"、"AppState 集成"三组需求的失败处理场景
- Affected code:
  - `src-tauri/src/lib.rs` — `AppState.memory_service` 字段类型变更，setup 钩子错误处理重写
  - `src-tauri/src/services/memory_providers/mod.rs` — `build_memory_service` 错误传播策略变更
  - `src-tauri/src/services/memory_providers/mem0_rs.rs` — `health()` 真实探测实现，`parse_records` 错误记录
  - `src-tauri/src/services/memory_service.rs` — `MemoryServiceError` 可能扩展 variant
  - `src-tauri/src/services/prompt_compiler.rs` — `load_retrieved_detail_blocks` 返回 `Result`，错误冒泡到 `compile_prompt` 调用方
  - `src-tauri/src/services/chat_service.rs` — `run_memory_extraction_task` 错误事件发射
  - `src-tauri/src/services/stream_processor.rs` — 接收编译错误并通过事件通知 UI
  - `src-tauri/src/models/mod.rs` — 新增 `MemoryBackendErrorEvent`、`MemorySearchFailedEvent` 等事件结构
  - `src/lib/backend.ts` — 新增对应事件监听器
  - `src/App.tsx` — 注册新事件监听，展示错误 toast/顶栏
  - `src/components/SettingsArea.tsx` — mem0 配置错误时禁用选项并显示原因

## ADDED Requirements

### Requirement: 启动期硬失败或显式 UI 回退

系统 SHALL 在应用启动时执行 mem0 初始化，初始化失败时**不得**静默降级为 `None` 继续运行。

#### Scenario: 初始化成功
- **WHEN** `build_memory_service` 返回 `Ok(provider)`
- **THEN** `AppState.memory_service` 持有有效实例
- **AND** 应用正常启动
- **AND** UI 设置面板的 mem0 选项可用

#### Scenario: 初始化失败 — provider 未配置
- **WHEN** `build_memory_service` 因无 provider、API key 缺失等返回 `Err`
- **THEN** `AppState.memory_service` 设为 `None` 并标记 `mem0_init_error` 错误状态
- **AND** 应用仍可启动（非 mem0 功能不受影响）
- **AND** UI 启动后弹出显式错误提示："MEM0 初始化失败：{原因}，已禁用 mem0 模式"
- **AND** 设置面板 mem0 选项被禁用并显示错误原因
- **AND** 所有会话的 `memory_mode` 强制视为非 mem0（不写入数据库，仅在运行时屏蔽）

#### Scenario: 初始化失败 — embedding 端点不可达
- **WHEN** provider 已配置但 embedding 端点返回 404/超时
- **THEN** 同上"初始化失败"场景
- **AND** 错误提示明确包含 HTTP 状态码与端点 URL

### Requirement: 真实健康检查

系统 SHALL 在 `MemoryService::health()` 中执行真实的端点探测，不得返回伪 `Ok(true)`。

#### Scenario: 健康检查通过
- **WHEN** 调用 `health()`
- **THEN** 向 embedding 端点发送一次 1-token 的测试请求
- **AND** 仅当 HTTP 200 且响应可解析时返回 `Ok(true)`

#### Scenario: 健康检查失败
- **WHEN** embedding 端点返回非 2xx 或网络错误
- **THEN** 返回 `Err(MemoryServiceError::Backend(...))` 包含具体状态码与 URL
- **AND** 不影响其他已建立的内存状态

### Requirement: 检索失败显式上报

系统 SHALL 在 prompt 编译期 `MemoryService::search()` 失败时，将错误显式冒泡到 UI，不得静默返回空结果继续编译。

#### Scenario: 单策略检索失败
- **WHEN** mem0 模式激活且某策略（detail/character_state/plot）的 `search()` 返回 `Err`
- **THEN** 该策略的错误记录到 `PromptCompileDebugReport.errors`
- **AND** 其他策略继续执行（不因单策略失败终止整体编译）
- **AND** 通过 `llm-memory-error` 事件向 UI 发射错误载荷 `{ conversation_id, round_id, strategy, error }`
- **AND** UI 在聊天界面顶栏显示"记忆检索失败：{strategy}: {error}"，可手动关闭

#### Scenario: 全部策略失败
- **WHEN** 3 个策略全部失败
- **THEN** 编译流程继续（不阻塞 LLM 请求）
- **AND** prompt 中不包含任何 RetrievedDetail blocks（这是显式决策，不是静默降级）
- **AND** UI 错误提示升级为"记忆检索完全失败，本轮无记忆上下文"

#### Scenario: memory_service 为 None
- **WHEN** 会话 `memory_mode = mem0` 但 `AppState.memory_service = None`
- **THEN** 编译流程立即返回 `Err("mem0 mode requested but memory service unavailable: {init_error}")`
- **AND** 该错误通过 `llm-stream-error` 事件通知 UI
- **AND** 不发送 LLM 请求（避免无声地以无记忆模式运行）

### Requirement: 写入失败显式上报

系统 SHALL 在 `MemoryService::add()` 失败时通过事件通知 UI，不得仅 `eprintln` 后返回 `Ok(())`。

#### Scenario: 写入失败
- **WHEN** `memory_service.add()` 返回 `Err`
- **THEN** 通过 `llm-memory-error` 事件向 UI 发射 `{ conversation_id, round_id, operation: "add", error }`
- **AND** UI 显示 toast "记忆写入失败：{error}"
- **AND** 不影响已完成的对话流（assistant 消息已展示给用户）

### Requirement: 解析异常显式记录

系统 SHALL 在 `parse_records` 遇到格式不符的条目时记录到 debug 报告，不得静默丢弃。

#### Scenario: 条目格式异常
- **WHEN** mem0-rs 返回的条目缺少 `id` 或 `memory` 字段
- **THEN** 该条目跳过但不入结果列表
- **AND** 在 debug 日志中记录"skipped malformed memory record: {raw_json}"
- **AND** 跳过计数累加并在 debug 报告中体现

## MODIFIED Requirements

### Requirement: 记忆写入（来自 integrate-mem0-rs-memory-layer）

原 spec "失败时仅记录日志，不影响对话流程" 修改为：失败时通过 `llm-memory-error` 事件显式通知 UI，对话主流程不阻塞但 UI 必须可见错误状态。

### Requirement: 记忆检索（来自 integrate-mem0-rs-memory-layer）

原 spec "检索失败时跳过 RetrievedDetail 层注入，在 debug 日志中记录错误，不阻断编译流程" 修改为：检索失败时通过 `llm-memory-error` 事件显式通知 UI，编译流程继续但 UI 必须可见错误状态。原 spec "memory_service 为 None 时静默返回空 Vec" 修改为：返回显式错误并阻止 LLM 请求。

### Requirement: AppState 集成（来自 integrate-mem0-rs-memory-layer）

原 spec "初始化失败时记录日志但不 panic、不阻断应用启动" 修改为：初始化失败时记录错误状态到 `AppState.mem0_init_error`，应用可启动但 mem0 模式被禁用且 UI 必须显示错误原因。

## REMOVED Requirements

### Requirement: memory_service 可选降级语义

**Reason**: `AppState.memory_service: Mutex<Option<...>>` 的 `None` 状态原本表示"feature unavailable, callers degrade gracefully"，与零回退冲突。
**Migration**: 保留 `Option<...>` 类型（因为初始化可能失败），但新增 `mem0_init_error: Option<String>` 字段记录失败原因。`None` 状态不再表示"静默降级"，而是表示"显式禁用，调用方必须报错"。

### Requirement: 伪健康检查

**Reason**: `health()` 无条件返回 `Ok(true)` 是"默认成功"伪检查，掩盖配置错误。
**Migration**: 改为真实探测 embedding 端点。

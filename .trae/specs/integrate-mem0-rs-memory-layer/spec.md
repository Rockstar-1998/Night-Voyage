# mem0-rs 记忆层集成 Spec

## Why

当前 Prompt Compiler 第 6 层（RetrievedDetail 向量细节层）协议槽位已完整预留（枚举 `PromptBlockKind::RetrievedDetail`、`PromptBlockSource::Retrieval`、`max_retrieved_detail_tokens` 预算、`apply_budget_trim` 裁剪逻辑、debug 颜色 `#14b8a6`），但**实现完全空白**：`load_retrieved_detail_blocks()` 未实现，`llm/mod.rs` 的 `EmbeddingGateway`/`VectorStore` trait 仅有签名桩，无任何具体实现，Cargo.toml 无向量依赖，migrations 无向量表。

引入 mem0-rs（官方 mem0 v2.0.4 的 Rust 端口）填充该层，可为长对话场景提供跨时间的语义关联召回能力（如"用户在第 3 轮提过喜欢酒馆 X"，在第 50 轮相关话题出现时被召回），补足 PlotSummary（主线总结）与 RecentHistory（时间序近期原文）覆盖不到的"跨时间事实关联"维度。

## What Changes

- 新增 `services/memory_service.rs` 模块，定义项目自有的 `MemoryService` trait 作为业务侧抽象边界（**解耦核心**）
- 新增 `services/memory_providers/mem0_rs.rs` 模块，作为 `MemoryService` trait 的一个具体实现，封装 mem0-rs 调用
- 将 mem0-rs 作为 **workspace 依赖**引入（非 fork 源码），通过 feature flags 按需启用 `openai`/`ollama` 后端
- 在 `prompt_compiler.rs` 中实现 `load_retrieved_detail_blocks()`，调用 `MemoryService::search()` 检索相关记忆，注入 `PromptBlockKind::RetrievedDetail` blocks
- 在 `chat_service.rs` 中新增 `spawn_memory_extraction_task()`，在 assistant 消息流结束后异步调用 `MemoryService::add()` 提取并存储事实
- 调整 `PromptBlockKind::RetrievedDetail` 的 priority 从 600（低权重参考区）提升至 550（中等可信历史层），位于 PlotSummary（500）之后、RecentHistory（800）之前
- 在 `apply_budget_trim` 中调整裁剪顺序：RetrievedDetail 不再是最先被裁的层
- 注入时加权威性标注前缀，让模型理解"这是历史记忆，非当前状态，如与最近对话矛盾以最近对话为准"
- 新增 migration 增加配置字段（`conversations.mem0_enabled` 等）类比 `plot_summary_mode`
- 新增 Tauri 命令暴露开关与状态（`mem0_status`/`mem0_set_enabled`/`mem0_search_test` 等）
- 前端在会话设置中暴露 mem0 开关 UI

## Impact

- Affected specs:
  - `plot-summary-and-retrieved-detail` — 本 spec 完成其 Task 3（RetrievedDetail 层编译逻辑）的实现部分
  - `prompt-compiler-stage-a` — 新增第 6 层加载逻辑进入编译链路
  - `history-memory-injection-architecture` — 补充第 6 层的具体数据来源
- Affected code:
  - `src-tauri/Cargo.toml` — 新增 mem0-rs workspace 依赖
  - `src-tauri/src/services/mod.rs` — 新增 `memory_service` 与 `memory_providers` 模块声明
  - `src-tauri/src/services/memory_service.rs` — **新建**，定义 `MemoryService` trait 与数据类型
  - `src-tauri/src/services/memory_providers/mod.rs` — **新建**，声明 provider 子模块
  - `src-tauri/src/services/memory_providers/mem0_rs.rs` — **新建**，mem0-rs 适配器实现
  - `src-tauri/src/services/prompt_compiler.rs` — 实现 `load_retrieved_detail_blocks()`，在第 684 行 `plot_summary_blocks` 注入之后追加 RetrievedDetail blocks
  - `src-tauri/src/services/chat_service.rs` — 在 stream 完成后 spawn `memory_extraction_task`
  - `src-tauri/src/services/stream_processor.rs` — 在流结束钩子中触发记忆提取
  - `src-tauri/src/models/mod.rs` — 调整 `RetrievedDetail` priority 600 → 550
  - `src-tauri/src/lib.rs` — `AppState` 新增 `memory_service` 字段，setup 中初始化
  - `src-tauri/src/commands/mod.rs` — 新增 `mem0` 命令模块声明
  - `src-tauri/src/commands/mem0.rs` — **新建**，mem0 管理命令
  - `src-tauri/migrations/0033_mem0_config.sql` — **新建**，增加配置字段
  - `src/lib/backend.ts` — 新增 mem0 相关 TS 接口与 invoke 封装
  - `src/components/SettingsArea.tsx` — 会话设置中增加 mem0 开关
  - `src/App.tsx` — 装载 mem0 状态

## ADDED Requirements

### Requirement: 记忆服务抽象边界

系统 SHALL 提供项目自有的 `MemoryService` trait 作为业务侧与具体记忆后端之间的抽象边界，业务代码只依赖该 trait，不直接引用 mem0-rs 的任何类型。

#### Scenario: 业务侧解耦
- **WHEN** 业务代码（prompt_compiler、chat_service）需要调用记忆能力
- **THEN** 只通过 `MemoryService` trait 调用，不直接 import mem0-rs 类型
- **AND** 未来替换为其他记忆后端时，业务代码无需修改

#### Scenario: 适配器隔离
- **WHEN** mem0-rs 上游更新导致 API 变化
- **THEN** 只需修改 `memory_providers/mem0_rs.rs` 适配器
- **AND** 业务代码与其他 provider 实现不受影响

### Requirement: 记忆写入

系统 SHALL 在每轮 assistant 消息流结束后，异步调用 `MemoryService::add()` 将当轮对话（user + assistant）提交给记忆服务，由记忆服务用轻量 LLM 提取原子事实并存储。

#### Scenario: 写入触发
- **WHEN** assistant 消息流完成
- **THEN** 异步 spawn `memory_extraction_task`
- **AND** 该任务不阻塞主响应链路
- **AND** 失败时仅记录日志，不影响对话流程

#### Scenario: 写入范围
- **WHEN** 调用 `add()`
- **THEN** 提交的内容是当轮的 user 消息与 assistant 回复
- **AND** 带 `user_id`（conversation_id）和 `agent_id`（character_id）元数据
- **AND** 不提交角色卡、世界书等常量层内容

### Requirement: 记忆检索与注入

系统 SHALL 在每次编译 prompt 时，以当前用户输入为 query 调用 `MemoryService::search()`，检索跨时间的相关事实，注入为 `PromptBlockKind::RetrievedDetail` blocks。

#### Scenario: 检索触发
- **WHEN** Prompt Compiler 执行 `compile_prompt()`
- **THEN** 在 `plot_summary_blocks` 注入之后调用 `load_retrieved_detail_blocks()`
- **AND** 用当前用户输入作为检索 query
- **AND** 按 `user_id`（conversation_id）过滤

#### Scenario: 注入格式
- **WHEN** 检索返回非空结果
- **THEN** 每个 RetrievedDetail block 内容前加权威性标注前缀
- **AND** 标注明确指示"这是历史记忆，非当前状态，如与最近对话矛盾以最近对话为准"

#### Scenario: 检索失败
- **WHEN** `MemoryService::search()` 返回错误
- **THEN** 跳过 RetrievedDetail 层注入
- **AND** 在 debug 日志中记录错误
- **AND** 不阻断编译流程（其他层正常注入）

### Requirement: 优先级与裁剪

系统 SHALL 将 RetrievedDetail 的 priority 从 600（低权重参考区）提升至 550（中等可信历史层），并相应调整预算裁剪顺序。

#### Scenario: 优先级排序
- **WHEN** system_blocks 按 priority 排序
- **THEN** RetrievedDetail（550）位于 PlotSummary（500）之后、RecentHistory（800）之前

#### Scenario: 预算裁剪
- **WHEN** 总 token 超预算需要裁剪
- **THEN** 裁剪顺序为：最旧 RecentHistory → 部分 WorldBookMatch → 部分 PlotSummary → RetrievedDetail
- **AND** 角色卡/世界书核心/角色状态覆盖/预设规则不被裁剪

### Requirement: 会话级开关

系统 SHALL 在 `conversations` 表增加 `mem0_enabled` 字段，允许每个会话独立开启/关闭 mem0 记忆能力。

#### Scenario: 默认关闭
- **WHEN** 新建会话
- **THEN** `mem0_enabled` 默认为 0（关闭）
- **AND** 关闭状态下不执行记忆写入与检索

#### Scenario: 开启后行为
- **WHEN** 用户在会话设置中开启 mem0
- **THEN** 后续每轮 assistant 完成后执行记忆写入
- **AND** 后续每次编译 prompt 时执行记忆检索

### Requirement: Provider 复用

系统 SHALL 复用现有 `api_providers` 表中已配置的 LLM/embedding provider，作为 mem0-rs 的 LLM 提取器与 embedding 来源，避免重复配置。

#### Scenario: provider 解析
- **WHEN** 初始化 mem0-rs 客户端
- **THEN** 从 `api_providers` 表读取一个 provider（可由用户指定或使用会话绑定的 provider）
- **AND** 将其 base_url、api_key、model_name 传递给 mem0-rs 配置
- **AND** 不要求用户在 mem0 设置中重复输入 API key

## MODIFIED Requirements

### Requirement: RetrievedDetail 层编译逻辑

原 `plot-summary-and-retrieved-detail` spec 的 Task 3 只要求"预留框架"，数据来源先用手动标记的片段。现修改为：由 mem0-rs 提供实际数据来源，`load_retrieved_detail_blocks()` 调用 `MemoryService::search()` 获取检索结果。

### Requirement: Prompt Block 优先级体系

`PromptBlockKind::priority()` 中 `RetrievedDetail` 的返回值从 600 修改为 550。裁剪顺序表中 `RetrievedDetail` 的位置相应调整。

## REMOVED Requirements

### Requirement: 原向量存储桩代码

**Reason**: `llm/mod.rs` 中 `EmbeddingGateway`/`VectorStore` trait 仅有签名桩无实现，且 mem0-rs 自带完整的 embedding 与 vector store 实现，不需要项目自行实现这些 trait。
**Migration**: 保留 trait 定义（未来可能用于其他用途），但不为其实现 mem0-rs 适配器；mem0-rs 的 embedding/vector store 由其内部管理，对业务侧透明。

## 解耦设计原则（核心约束）

1. **trait 边界**: 业务代码只依赖 `MemoryService` trait，不 import mem0-rs 类型
2. **适配器模式**: mem0-rs 适配器（`memory_providers/mem0_rs.rs`）是唯一允许 import mem0-rs 的地方
3. **workspace 依赖**: 通过 Cargo.toml 引入 mem0-rs crate，**不 fork 源码到项目内**
4. **配置注入**: mem0-rs 的配置（LLM、embedding、vector_store）由适配器从项目的 `api_providers` 表与配置文件构造，不要求用户在 mem0 自身重复配置
5. **错误隔离**: mem0-rs 的错误类型在适配器内转换为项目自有的 `MemoryServiceError`，不泄漏到业务侧
6. **可替换性**: 未来若要切换到其他记忆后端（如 R-Mem 或自研），只需新增一个 `memory_providers/` 下的实现，业务代码零修改

## 非目标（Out of Scope）

- 不实现图 RAG（mem0-rs 当前版本无图记忆，未来如需可再加）
- 不实现 rerank（首期不需要，避免增加复杂度）
- 不实现 Android 端的 mem0 集成（guardrails 要求 PC 优先，Android 后续评估）
- 不实现 mem0-rs 的 REST server 模式（仅用 library 模式，避免 sidecar 复杂度）
- 不修改 PlotSummary 层（第 5 层）与 RecentHistory 层（第 8 层）的实现
- 不替代任何现有层（MEM0 是补充，不是替代）

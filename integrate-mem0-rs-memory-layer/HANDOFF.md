# mem0-rs 记忆层集成 — 会话交接文档

> 生成时间：2026-06-27。本文件记录截至当前会话的全部进度、关键决策与未完成事项，供后续接手继续。
> 任务分类：后端为主（Tauri 2 + Rust），最后一步含前端（SolidJS）。

## 0. 一句话目标

把 `MEM0/mem0-rs` 记忆层作为「可选、按会话开关」的功能集成进 Night Voyage，**高度解耦**：mem0-rs 类型只允许出现在单一适配器文件，业务代码只依赖项目自有的 `MemoryService` trait。

## 1. 核心架构约束（必须遵守）

- **解耦第一**：mem0-rs 的类型（`Memory`、`MemoryConfig`、`AddOptions` 等）只能出现在 `src-tauri/src/services/memory_providers/mem0_rs.rs`。其他所有业务代码只依赖 `services/memory_service.rs` 里项目自有的 `MemoryService` trait + `MemoryMessage`/`MemoryRecord`/`MemoryServiceError`。
- **缓存路径**：mem0 持久化（向量库 + history db）固定写入 `D:\software_cache\mem0\`，严禁写 C 盘（guardrails 硬约束）。
- **零回退原则**：失败必须显式可见。但 mem0 是「可选能力」，所以：
  - 初始化失败 → 记录日志，`memory_service = None`，**不 panic、不阻断启动**。
  - 检索失败 → 返回空 Vec + debug 记录错误，**不阻断 prompt 编译**。
  - 写入失败 → `eprintln!` 记录，**不影响对话流程**。
  - 注意：这不是「静默回退伪成功」，而是「可选功能优雅降级 + 显式日志」，符合规则。
- **非阻塞写入**：记忆提取走 `tokio::spawn`，参考 `spawn_character_state_overlay_generation_task` 模式。
- **作用域映射**：mem0 `user_id` = conversation_id（会话），`agent_id` = character_id（角色）。

## 2. 关键技术决策（已定，勿推翻）

- **sqlx 升级到 `=0.8.0`（pin 死）**：原因是 sqlx 0.7 的 libsqlite3-sys ^0.26 与 mem0-core 的 rusqlite 0.31（libsqlite3-sys ^0.28）冲突（都 `links = "sqlite3"`）。用户明确选择「升级本项目 sqlx 到 =0.8.0」，保持 mem0-rs 不动。已验证 cargo check 通过，sqlx 0.8.0 未破坏现有代码。
- **mem0 库模式**：`mem0::from_config(MemoryConfig)` → `Memory` 编排器，内嵌 `embedded` 向量库（JSON 持久化），无需外部服务。`Memory` 是 `Send + Sync`（HistoryStore 用 `Mutex<Connection>`），可安全存为 `Arc<dyn MemoryService>`。
- **embedding 配置无处安放**：`api_providers` 表没有 embedding 列。决策：embedding model/dims 存在 `settings` 表（默认 `text-embedding-3-small` / `1536`），LLM 与 embedding 凭证复用 `api_providers`（base_url + api_key）。
- **provider 选择**：优先 `settings.mem0_provider_id` 指定的 provider，否则取 `api_providers` 中 `updated_at DESC, id DESC` 最新的一条。
- **mem0 embedder/llm provider 名**：用 `openai_compatible`，embedder 需要 `openai_base_url`。

## 3. 已完成任务（Task 1–5 + Task 6 大部分）

### Task 1 ✅ Cargo 依赖
`src-tauri/Cargo.toml`：
- `sqlx = { version = "=0.8.0", default-features = false, features = ["sqlite", "runtime-tokio-rustls", "macros", "migrate"] }`
- 新增 `async-trait = "0.1"`
- 新增 `mem0 = { path = "../MEM0/mem0-rs/crates/mem0" }`

### Task 2 ✅ DB migration + 结构体字段
- `src-tauri/migrations/0033_mem0_config.sql`：`ALTER TABLE conversations ADD COLUMN mem0_enabled INTEGER NOT NULL DEFAULT 0;`
- `src-tauri/src/models/mod.rs`：`ConversationListItem` 增加 `pub mem0_enabled: bool,`（在 `plot_summary_mode` 之后、`member_count` 之前）。
- 受影响的 SELECT 查询 + 初始化器全部已更新（pattern：`mem0_enabled: row.try_get::<i64, _>("mem0_enabled").map(|v| v != 0).unwrap_or(false),`）：
  - `commands/conversations.rs`：`conversations_list`、`conversations_get_by_id`(base_sql)、`row_to_conversation_list_item` 三处 SELECT + 初始化。
  - `network/mod.rs`：`load_conversation_summary`（约 362 行 query + 403 行初始化）。
  - 注意：`conversations_create` 的 INSERT 依赖 schema 默认值，无需显式 bind。

### Task 3 ✅ MemoryService trait
`src-tauri/src/services/memory_service.rs`（项目自有边界，无 mem0 类型）：
- trait `MemoryService: Send + Sync`，`#[async_trait]`，方法：`add / search / get_all / delete / delete_all / health`。
- 类型：`MemoryMessage{role,content}`（含 `user()`/`assistant()` 构造器）、`MemoryRecord{id,memory,score,created_at}`、`MemoryServiceError{NotConfigured, Backend}`（实现 Display + Error）。
- `src-tauri/src/services/mod.rs` 已加 `pub mod memory_service;` 和 `pub mod memory_providers;`。

### Task 4 ✅ mem0-rs 适配器
- `src-tauri/src/services/memory_providers/mod.rs`：
  - `MEM0_STORAGE_DIR = "D:\\software_cache\\mem0"`
  - settings keys：`mem0_embedding_model` / `mem0_embedding_dims` / `mem0_provider_id`
  - 默认值：`text-embedding-3-small` / `1536`
  - `build_memory_service(db) -> Result<Arc<dyn MemoryService>, String>`、`resolve_provider()`、`load_setting()`
- `src-tauri/src/services/memory_providers/mem0_rs.rs`（**唯一 import mem0 的文件**）：
  - `use mem0::{AddOptions, JsonMap, Memory, MemoryConfig, Message, SearchOptions};`
  - `Mem0RsProviderConfig`（项目自有，无 mem0 类型）、`Mem0RsProvider{ memory: Memory }`
  - `new()` 内组装 MemoryConfig JSON（embedder/llm/vector_store/history_db_path），`create_dir_all` 缓存目录，`mem0::from_config`。
  - `parse_records()` 解析 mem0 `{ "results": [...] }`。
  - 实现 trait 全部方法；`delete_all` 先 `get_all` 计数再删。

### Task 5 ✅ AppState 集成
`src-tauri/src/lib.rs`：
- `AppState` 新增 `pub memory_service: Mutex<Option<Arc<dyn services::memory_service::MemoryService>>>`（懒加载 + 容错）。
- setup 钩子里 `block_on(build_memory_service(&pool))`，失败 `eprintln!` 后 `.ok()` 转 None，**不阻断启动**。
- `app.manage(AppState{ ..., memory_service: Mutex::new(memory_service) })`。
- **已 cargo check 通过（仅 warnings）**。

### Task 6 ⚠️ 进行中（已写大部分，未编译验证）
`src-tauri/src/services/prompt_compiler.rs`：
- 顶部已加 `use std::sync::Arc;` 和 `memory_service::MemoryService`（在 `use crate::{ services::{ ... } }` 块内）。
- `compile_prompt()` 签名**已加第 4 个参数** `memory_service: Option<&Arc<dyn MemoryService>>`。
- 在 `system_blocks.extend(plot_summary_blocks);` 之后、`sort_by` 之前，已插入对 `load_retrieved_detail_blocks(...)` 的调用并 `extend`。
- 已新增 `load_retrieved_detail_blocks()` 函数（在 `build_block` 之前），含：
  - 常量 `RETRIEVED_DETAIL_AUTHORITY_PREFIX = "[历史记忆 - 非当前状态，如与最近对话矛盾以最近对话为准]\n"`
  - `DEFAULT_RETRIEVED_DETAIL_TOP_K = 5`
  - None / 空 query / `mem0_enabled=0` / search 失败 → 返回空 Vec
  - 每条记忆包成 `PromptBlock{ kind: RetrievedDetail, role: System, source: Retrieval{fragment_id}, required: false }`；`fragment_id = record.id.parse::<i64>().unwrap_or(0)`（mem0 id 是字符串，真实 id 记到 debug.input_sources）。
  - 支持 `max_retrieved_detail_tokens` 预算截断。

> 编辑过程中曾误删 `build_block` 的 `PromptBlock {` 行，**已修复**。但 Task 6 改动**尚未 cargo check 验证**，这是接手后第一件事。

## 4. 待完成任务

### ⚠️ 立即验证（Task 6 收尾）
**改了 `compile_prompt` 签名后，3 个调用点必须更新，否则编译失败：**
1. `prompt_compiler.rs:734`（`compile_chat_messages` 内）：`compile_prompt(db, &input, exclude_message_id)` → 末尾加 `, None`（该函数只有 `db`，拿不到 AppState；暂传 None，或后续重构传入）。
2. `prompt_compiler.rs:766`（`compile_token_usage_report` 内）：`compile_prompt(db, &input, 0)` → 加 `, None`。
3. `stream_processor.rs:339`：`compile_prompt(&db, &compile_input, assistant_message_id)` → 这里**应该传真正的 memory_service**。`stream_llm_response` 有 `app: AppHandle`，可 `let ms = app.state::<crate::AppState>().memory_service.lock().await.clone();` 然后传 `ms.as_ref()`。
   - 注意 `Arc<dyn MemoryService>` 是否能 `.clone()`：Arc 可 clone。`Mutex<Option<Arc<..>>>` lock 后 `.clone()` 得 `Option<Arc<..>>`，再 `.as_ref()`。

然后 `cd src-tauri && cargo check`。

### Task 7：优先级 + 裁剪顺序
- `prompt_compiler.rs` 的 `PromptBlockKind::priority()`：`RetrievedDetail` 从 **600 改为 550**（注意：`priority()` 在 prompt_compiler.rs 第 ~92 行，**不是** models/mod.rs，tasks.md 写错了位置）。
- `apply_budget_trim`（约 2080 行）当前裁剪顺序：RetrievedDetail（最先）→ PlotSummary → WorldBookMatch → WorldVariable → oldest RecentHistory。
- 需调整为：**最旧 RecentHistory → WorldBookMatch → PlotSummary → RetrievedDetail（不再最先裁）**。即把 `trim_oldest_history_block` 提到最前，RetrievedDetail 放到后面。具体顺序见 spec.md。
- `kind_color` 里 RetrievedDetail 保持 `#14b8a6`（已是，勿改）。

### Task 8：记忆写入侧
- `chat_service.rs` 新增 `pub fn spawn_memory_extraction_task(app, db, conversation_id, round_id, user_message, assistant_message, character_id)`，内部 `tokio::spawn`。
- 取 `app.state::<crate::AppState>().memory_service`，检查 `mem0_enabled`，构造 user+assistant 两条 `MemoryMessage`，调 `memory_service.add(messages, &conversation_id.to_string(), &character_id.to_string())`。失败 `eprintln!`。
- `stream_processor.rs` 流结束钩子调用它。参考：
  - `character_state_overlays.rs:324 load_overlay_generation_context`：user_content 来自 `message_rounds.aggregated_user_content`，assistant_content 来自 `messages.content`（经 `active_assistant_message_id`）。
  - chat_service.rs 取 state 模式：`app.state::<crate::AppState>()`（如 795、830 行）。

### Task 9：Tauri 命令
- 新建 `src-tauri/src/commands/mem0.rs`：`mem0_status` / `mem0_set_enabled(conversation_id, enabled)` / `mem0_search_test` / `mem0_list_memories` / `mem0_delete_memory` / `mem0_delete_all`。
- `commands/mod.rs` 加 `pub mod mem0;`；`lib.rs` 的 `invoke_handler!` 注册全部命令。

### Task 10：前端（src/，PC 端；注意移动端 src-mobile/ 独立，本任务先做 PC）
- `src/lib/backend.ts`：加 mem0 invoke 封装 + `ConversationListItem` 接口加 `mem0Enabled?: boolean`。
- `SettingsArea.tsx`：会话设置区加 mem0 开关（类比 `plotSummaryMode` 开关），切换调 `mem0SetEnabled`。可选「查看记忆」按钮。
- `npm run build` 验证。
- ⚠️ guardrails：PC（src/）与移动端（src-mobile/）前端完全独立，禁止 isMobile 分支；本次先覆盖 PC，移动端风险需在结论标注。

### Task 11：编译 + 构建验证
`cargo check` + `npm run build`，再做运行期验证（开关、写入日志、检索日志、`D:\software_cache\mem0\` 生成文件、priority=550）。

## 5. 关键文件清单

| 文件 | 状态 |
|---|---|
| `src-tauri/Cargo.toml` | ✅ 改完 |
| `src-tauri/migrations/0033_mem0_config.sql` | ✅ 新建 |
| `src-tauri/src/models/mod.rs` | ✅ 改完 |
| `src-tauri/src/commands/conversations.rs` | ✅ 改完 |
| `src-tauri/src/network/mod.rs` | ✅ 改完 |
| `src-tauri/src/services/mod.rs` | ✅ 改完 |
| `src-tauri/src/services/memory_service.rs` | ✅ 新建完成 |
| `src-tauri/src/services/memory_providers/mod.rs` | ✅ 新建完成 |
| `src-tauri/src/services/memory_providers/mem0_rs.rs` | ✅ 新建完成 |
| `src-tauri/src/lib.rs` | ✅ AppState + setup 改完 |
| `src-tauri/src/services/prompt_compiler.rs` | ⚠️ Task6 改了但**未编译验证 + 3 个调用点未更新** |
| `src-tauri/src/services/stream_processor.rs` | ⏳ 待改（调用点 + Task8 钩子） |
| `src-tauri/src/services/chat_service.rs` | ⏳ 待改（Task8） |
| `src-tauri/src/commands/mem0.rs` | ⏳ 待新建（Task9） |
| `src/lib/backend.ts` + SettingsArea | ⏳ 待改（Task10） |

## 6. 接手后的第一步（最重要）

1. 更新 `compile_prompt` 的 3 个调用点（见 Task6 收尾），其中 stream_processor 传真实 memory_service，另外两个传 `None`。
2. `cd src-tauri && cargo check`，修掉 Task6 引入的任何编译错误。
3. 然后按 Task 7 → 8 → 9 → 10 → 11 顺序推进。

## 7. 参考文档

- `integrate-mem0-rs-memory-layer/spec.md`：完整规格
- `integrate-mem0-rs-memory-layer/tasks.md`：11 个 task 拆解（注意 Task7 里 priority 位置写错，实际在 prompt_compiler.rs）
- `integrate-mem0-rs-memory-layer/checklist.md`：验收清单
- `docs/preset-system-architecture.md`：prompt 编译分层架构（含第 6 层 RetrievedDetail 设计）

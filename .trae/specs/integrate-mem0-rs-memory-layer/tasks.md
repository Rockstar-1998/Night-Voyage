# Tasks

- [ ] Task 1: Cargo 依赖引入与 workspace 配置

  - [ ] SubTask 1.1: 在 `src-tauri/Cargo.toml` 新增 `mem0-rs` 依赖（通过 git 或 path 引入 `MEM0/mem0-rs`），启用 `full` feature 或按需启用 `openai`/`ollama` feature
  - [ ] SubTask 1.2: 验证 `cargo check` 通过，确认 mem0-rs 编译无冲突
  - [ ] SubTask 1.3: 确认 mem0-rs 的 `embedded` vector store 可用（JSON 持久化模式），无需外部服务

- [ ] Task 2: 数据库 Schema 设计与迁移

  - [ ] SubTask 2.1: 设计 migration `0033_mem0_config.sql`，在 `conversations` 表增加 `mem0_enabled INTEGER NOT NULL DEFAULT 0` 字段
  - [ ] SubTask 2.2: 考虑是否需要 `mem0_provider_id INTEGER` 字段（可选，用于指定该会话用哪个 provider 做记忆提取；若不指定则用会话绑定的 provider）
  - [ ] SubTask 2.3: 运行 migration，验证 `conversations` 表结构更新
  - [ ] SubTask 2.4: 在 `models/mod.rs` 的 `Conversation` 相关结构体增加 `mem0_enabled` 字段

- [ ] Task 3: 记忆服务抽象层（解耦核心）

  - [ ] SubTask 3.1: 新建 `src-tauri/src/services/memory_service.rs`，定义 `MemoryService` trait
  - [ ] SubTask 3.2: 定义 trait 方法签名：`async fn add(&self, messages: Vec<MemoryMessage>, user_id: &str, agent_id: &str) -> Result<(), MemoryServiceError>`、`async fn search(&self, query: &str, user_id: &str, limit: usize) -> Result<Vec<MemoryRecord>, MemoryServiceError>`、`async fn get_all(&self, user_id: &str, limit: usize) -> Result<Vec<MemoryRecord>, MemoryServiceError>`、`async fn delete(&self, memory_id: &str) -> Result<(), MemoryServiceError>`、`async fn delete_all(&self, user_id: &str) -> Result<usize, MemoryServiceError>`、`async fn health(&self) -> Result<bool, MemoryServiceError>`
  - [ ] SubTask 3.3: 定义数据类型 `MemoryMessage`、`MemoryRecord`、`MemoryServiceError`（项目自有类型，不引用 mem0-rs 类型）
  - [ ] SubTask 3.4: 在 `services/mod.rs` 增加 `pub mod memory_service;` 与 `pub mod memory_providers;`

- [ ] Task 4: mem0-rs 适配器实现

  - [ ] SubTask 4.1: 新建 `src-tauri/src/services/memory_providers/mod.rs`，声明 `pub mod mem0_rs;` 与 `pub use` 重新导出
  - [ ] SubTask 4.2: 新建 `src-tauri/src/services/memory_providers/mem0_rs.rs`，实现 `Mem0RsProvider` 结构体
  - [ ] SubTask 4.3: 在适配器内 `use mem0::{Memory, MemoryConfig, AddOptions, SearchOptions}` 等 mem0-rs 类型
  - [ ] SubTask 4.4: 实现 `Mem0RsProvider::new(config)` 构造函数，接收项目自有的配置类型（provider base_url/api_key/model_name + vector_store 路径）
  - [ ] SubTask 4.5: 实现 `MemoryService` trait 的所有方法，内部调用 mem0-rs 的 `Memory` API，将 mem0-rs 错误转换为 `MemoryServiceError`
  - [ ] SubTask 4.6: 在适配器内配置 mem0-rs 使用 `embedded` vector store（JSON 持久化到 `D:\software_cache\mem0\` 目录）
  - [ ] SubTask 4.7: 在适配器内配置 mem0-rs 的 LLM 与 embedding provider（从项目 `api_providers` 表读取的配置转换而来）

- [ ] Task 5: AppState 集成与初始化

  - [ ] SubTask 5.1: 在 `src-tauri/src/lib.rs` 的 `AppState` 增加 `pub memory_service: Arc<dyn MemoryService>` 字段（或 `Mutex<Option<Arc<dyn MemoryService>>>` 以支持懒加载与失败容错）
  - [ ] SubTask 5.2: 在 setup 钩子中初始化 `Mem0RsProvider`，从配置或默认 provider 构造
  - [ ] SubTask 5.3: 初始化失败时记录日志但不阻断应用启动（mem0 是可选能力，非核心）
  - [ ] SubTask 5.4: 暴露 `memory_service` 给 commands 与 services 使用

- [ ] Task 6: Prompt Compiler 第 6 层注入实现

  - [ ] SubTask 6.1: 在 `prompt_compiler.rs` 新增 `async fn load_retrieved_detail_blocks(memory_service, conversation_id, current_user_input, max_tokens, debug) -> Result<Vec<PromptBlock>, String>`
  - [ ] SubTask 6.2: 函数内部调用 `memory_service.search(current_user_input, &conversation_id, top_k)` 检索
  - [ ] SubTask 6.3: 将每条检索结果包装为 `PromptBlock`（kind=RetrievedDetail, source=Retrieval, priority=550）
  - [ ] SubTask 6.4: 在 block 内容前加权威性标注前缀：`"[历史记忆 - 非当前状态，如与最近对话矛盾以最近对话为准]\n"`
  - [ ] SubTask 6.5: 在 `compile_prompt()` 第 684 行 `system_blocks.extend(plot_summary_blocks);` 之后调用 `load_retrieved_detail_blocks()` 并 extend
  - [ ] SubTask 6.6: 检查 `conversations.mem0_enabled` 字段，关闭时直接返回空 Vec
  - [ ] SubTask 6.7: 检索失败时返回空 Vec 并在 debug 日志记录错误，不阻断编译

- [ ] Task 7: 优先级与裁剪顺序调整

  - [ ] SubTask 7.1: 在 `models/mod.rs` 的 `PromptBlockKind::priority()` 中将 `RetrievedDetail` 的返回值从 600 改为 550
  - [ ] SubTask 7.2: 检查 `prompt_compiler.rs` 的 `apply_budget_trim` 函数中裁剪顺序表
  - [ ] SubTask 7.3: 调整裁剪顺序：最旧 RecentHistory → 部分 WorldBookMatch → 部分 PlotSummary → RetrievedDetail（不再是最先裁）
  - [ ] SubTask 7.4: 确保 `PromptBlockKind::debug_color()` 中 RetrievedDetail 仍为 `#14b8a6`（不变）

- [ ] Task 8: 记忆写入侧集成

  - [ ] SubTask 8.1: 在 `chat_service.rs` 新增 `pub fn spawn_memory_extraction_task(app, db, conversation_id, round_id, user_message, assistant_message, character_id)`
  - [ ] SubTask 8.2: 函数内部用 `tokio::spawn` 异步执行，不阻塞主响应链路
  - [ ] SubTask 8.3: 从 `AppState` 获取 `memory_service`，检查 `conversations.mem0_enabled`
  - [ ] SubTask 8.4: 构造 `MemoryMessage` 列表（user 与 assistant 各一条），调用 `memory_service.add(messages, &conversation_id, &character_id)`
  - [ ] SubTask 8.5: 失败时 `eprintln!` 记录日志，不影响对话流程
  - [ ] SubTask 8.6: 在 `stream_processor.rs` 的流结束钩子中调用 `spawn_memory_extraction_task`（参考现有 `spawn_character_state_overlay_generation_task` 模式）

- [ ] Task 9: Tauri 命令暴露

  - [ ] SubTask 9.1: 新建 `src-tauri/src/commands/mem0.rs`，定义命令
  - [ ] SubTask 9.2: `mem0_status` 命令返回 `{ enabled, provider_ready, vector_store_path }`
  - [ ] SubTask 9.3: `mem0_set_enabled(conversation_id, enabled)` 命令更新 `conversations.mem0_enabled`
  - [ ] SubTask 9.4: `mem0_search_test(conversation_id, query, limit)` 命令用于调试，直接调用 `memory_service.search` 返回结果
  - [ ] SubTask 9.5: `mem0_list_memories(conversation_id, limit)` 命令用于查看已存储的记忆
  - [ ] SubTask 9.6: `mem0_delete_memory(memory_id)` 与 `mem0_delete_all(conversation_id)` 命令用于清理
  - [ ] SubTask 9.7: 在 `commands/mod.rs` 增加 `pub mod mem0;`
  - [ ] SubTask 9.8: 在 `lib.rs` 的 `invoke_handler!` 注册所有 mem0 命令

- [ ] Task 10: 前端集成

  - [ ] SubTask 10.1: 在 `src/lib/backend.ts` 新增 mem0 相关 TS 接口与 invoke 封装（`mem0Status`/`mem0SetEnabled`/`mem0SearchTest`/`mem0ListMemories`/`mem0DeleteMemory`/`mem0DeleteAll`）
  - [ ] SubTask 10.2: 在 `ConversationListItem` 接口增加 `mem0Enabled?: boolean` 字段
  - [ ] SubTask 10.3: 在 `SettingsArea.tsx` 的会话设置区域增加 mem0 开关 UI（类比 `plotSummaryMode` 开关）
  - [ ] SubTask 10.4: 开关切换时调用 `mem0SetEnabled` 命令
  - [ ] SubTask 10.5: 在会话设置中提供"查看记忆"按钮，点击后调用 `mem0ListMemories` 展示已存储记忆（可选，调试用）
  - [ ] SubTask 10.6: 运行 `npm run build` 验证前端构建通过

- [ ] Task 11: 编译验证与集成测试

  - [ ] SubTask 11.1: 运行 `cargo check` 确认后端编译通过
  - [ ] SubTask 11.2: 运行 `npm run build` 确认前端构建通过
  - [ ] SubTask 11.3: 启动应用，在会话设置中开启 mem0
  - [ ] SubTask 11.4: 发送测试对话，验证日志中显示 `memory_extraction_task` 执行
  - [ ] SubTask 11.5: 发送第二条对话，验证日志中 `load_retrieved_detail_blocks` 被调用并返回结果
  - [ ] SubTask 11.6: 验证 debug 视图中 RetrievedDetail blocks 出现且 priority=550
  - [ ] SubTask 11.7: 验证 `D:\software_cache\mem0\` 下生成向量存储文件
  - [ ] SubTask 11.8: 关闭 mem0 开关后发送对话，验证不再执行记忆写入与检索

# Task Dependencies

- Task 1（依赖引入）是所有后续任务的前提
- Task 2（migration）与 Task 3（trait 定义）可并行
- Task 4（适配器）依赖 Task 1 与 Task 3
- Task 5（AppState）依赖 Task 3 与 Task 4
- Task 6（注入）依赖 Task 3 与 Task 5
- Task 7（优先级）独立，可并行
- Task 8（写入侧）依赖 Task 5
- Task 9（命令）依赖 Task 5
- Task 10（前端）依赖 Task 9
- Task 11（验证）依赖所有前置任务

# 并行化建议

- 第一批并行：Task 1、Task 2、Task 3、Task 7
- 第二批：Task 4（依赖 1+3）
- 第三批并行：Task 5、Task 8（依赖 4+5）、Task 9（依赖 5）
- 第四批：Task 6（依赖 5）
- 第五批：Task 10（依赖 9）
- 最后：Task 11

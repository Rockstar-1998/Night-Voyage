# Checklist

## 解耦设计验证

- [ ] 业务代码（`prompt_compiler.rs`、`chat_service.rs`、`stream_processor.rs`）中无任何 `use mem0::` 或 `use mem0_rust::` 导入
- [ ] `MemoryService` trait 定义在 `services/memory_service.rs`，方法签名只使用项目自有类型
- [ ] `MemoryServiceError` 是项目自定义错误类型，不包装或泄漏 mem0-rs 错误
- [ ] mem0-rs 的所有类型（`Memory`、`MemoryConfig`、`AddOptions`、`SearchOptions` 等）只出现在 `services/memory_providers/mem0_rs.rs` 内
- [ ] mem0-rs 通过 Cargo.toml 的 `[dependencies]` 引入，项目内无 mem0-rs 源码副本
- [ ] 未来替换记忆后端只需新增 `memory_providers/` 下的实现，业务代码零修改

## 数据库验证

- [ ] `0033_mem0_config.sql` migration 存在且可应用
- [ ] `conversations` 表新增 `mem0_enabled INTEGER NOT NULL DEFAULT 0` 字段
- [ ] 既有会话的 `mem0_enabled` 默认值为 0（关闭）
- [ ] `Conversation` 相关 Rust 结构体有 `mem0_enabled` 字段且参与序列化/反序列化

## Trait 与适配器验证

- [ ] `MemoryService` trait 定义了 `add`、`search`、`get_all`、`delete`、`delete_all`、`health` 六个方法
- [ ] `MemoryMessage`、`MemoryRecord`、`MemoryServiceError` 三个类型定义在 `memory_service.rs`
- [ ] `Mem0RsProvider` 结构体实现 `MemoryService` trait
- [ ] 适配器配置 `embedded` vector store 持久化路径为 `D:\software_cache\mem0\`
- [ ] 适配器从 `api_providers` 表读取 provider 配置构造 mem0-rs 的 LLM/embedding 配置
- [ ] 适配器将 mem0-rs 错误转换为 `MemoryServiceError`

## AppState 集成验证

- [ ] `AppState` 有 `memory_service` 字段
- [ ] setup 钩子中初始化 `Mem0RsProvider`
- [ ] 初始化失败时记录日志但不 panic、不阻断应用启动
- [ ] `memory_service` 可被 commands 与 services 访问

## Prompt Compiler 注入验证

- [ ] `load_retrieved_detail_blocks` 函数在 `prompt_compiler.rs` 中定义
- [ ] 函数在 `system_blocks.extend(plot_summary_blocks);` 之后被调用
- [ ] 检索 query 是当前用户输入
- [ ] 检索按 `conversation_id` 作为 `user_id` 过滤
- [ ] 检索结果包装为 `PromptBlock`（kind=RetrievedDetail, source=Retrieval, priority=550）
- [ ] 每个 block 内容前有权威性标注前缀 `[历史记忆 - 非当前状态，如与最近对话矛盾以最近对话为准]`
- [ ] `mem0_enabled=0` 时直接返回空 Vec
- [ ] 检索失败时返回空 Vec 并在 debug 日志记录，不阻断编译

## 优先级与裁剪验证

- [ ] `PromptBlockKind::RetrievedDetail` 的 `priority()` 返回 550（原为 600）
- [ ] `apply_budget_trim` 中 RetrievedDetail 不再是最先被裁的层
- [ ] 裁剪顺序为：最旧 RecentHistory → 部分 WorldBookMatch → 部分 PlotSummary → RetrievedDetail
- [ ] 角色卡/世界书核心/角色状态覆盖/预设规则不被裁剪
- [ ] `debug_color()` 中 RetrievedDetail 仍为 `#14b8a6`

## 写入侧验证

- [ ] `spawn_memory_extraction_task` 函数在 `chat_service.rs` 中定义
- [ ] 函数用 `tokio::spawn` 异步执行，不阻塞主响应链路
- [ ] 函数检查 `conversations.mem0_enabled`，关闭时不执行
- [ ] 提交内容为当轮 user + assistant 消息
- [ ] 带 `user_id`（conversation_id）和 `agent_id`（character_id）元数据
- [ ] 不提交角色卡、世界书等常量层内容
- [ ] 失败时仅 `eprintln!` 记录日志，不影响对话流程
- [ ] `stream_processor.rs` 在流结束钩子中调用 `spawn_memory_extraction_task`

## Tauri 命令验证

- [ ] `commands/mem0.rs` 定义了 6 个命令：`mem0_status`、`mem0_set_enabled`、`mem0_search_test`、`mem0_list_memories`、`mem0_delete_memory`、`mem0_delete_all`
- [ ] `commands/mod.rs` 有 `pub mod mem0;`
- [ ] `lib.rs` 的 `invoke_handler!` 注册了所有 6 个命令
- [ ] 命令从 `AppState.memory_service` 获取服务实例

## 前端集成验证

- [ ] `src/lib/backend.ts` 有 mem0 相关 TS 接口与 invoke 封装
- [ ] `ConversationListItem` 接口有 `mem0Enabled?: boolean` 字段
- [ ] `SettingsArea.tsx` 有 mem0 开关 UI
- [ ] 开关切换调用 `mem0SetEnabled` 命令
- [ ] `npm run build` 通过

## 编译与运行验证

- [ ] `cargo check` 通过，无 error
- [ ] `npm run build` 通过
- [ ] 应用启动不因 mem0 初始化失败而 panic
- [ ] 开启 mem0 后发送对话，日志显示 `memory_extraction_task` 执行
- [ ] 第二轮对话日志显示 `load_retrieved_detail_blocks` 被调用并返回结果
- [ ] debug 视图中 RetrievedDetail blocks 出现且 priority=550
- [ ] `D:\software_cache\mem0\` 下生成向量存储文件
- [ ] 关闭 mem0 后不再执行记忆写入与检索

## 非目标边界验证

- [ ] 未实现图 RAG（不在本 spec 范围）
- [ ] 未实现 rerank（不在本 spec 范围）
- [ ] 未实现 Android 端集成（不在本 spec 范围）
- [ ] 未实现 mem0-rs REST server 模式（仅 library 模式）
- [ ] 未修改 PlotSummary 层实现
- [ ] 未修改 RecentHistory 层实现
- [ ] 未替代任何现有层

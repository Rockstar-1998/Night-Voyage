# Tasks

- [x] Task 1: 定义 Prompt Compiler 核心类型（PromptCompileInput, PromptBlock, PromptBlockKind, PromptBlockSource, PromptCompileResult）

  - [x] SubTask 1.1: 在 `prompt_compiler.rs` 中新增 `PromptCompileInput` 结构体，包含 `conversation_id`, `mode`, `target_round_id`, `provider_kind`, `model_name`, `include_streaming_seed`, `budget`
  - [x] SubTask 1.2: 新增 `PromptCompileMode` 枚举（`ClassicChat`, `ClassicRegenerate`, `AgentDirectorPlaceholder`）
  - [x] SubTask 1.3: 新增 `PromptBudget` 结构体（`max_total_tokens`, `reserve_output_tokens`, `max_summary_tokens`, `max_world_book_tokens`, `max_retrieved_detail_tokens`）
  - [x] SubTask 1.4: 新增 `PromptBlockKind` 枚举（`PresetRule`, `CharacterBase`, `WorldBookMatch`, `WorldVariable[TODO]`, `PlotSummary`, `RetrievedDetail`, `RecentHistory`, `CurrentUser`, `ExampleMessage`, `PrefillSeed`）
  - [x] SubTask 1.5: 新增 `PromptBlockSource` 枚举（`Preset`, `Character`, `WorldBook`, `Summary`, `Retrieval`, `Message`, `Compiler`）
  - [x] SubTask 1.6: 新增 `PromptBlock` 结构体（`kind`, `priority`, `role`, `title`, `content`, `source`, `token_cost_estimate`, `required`）
  - [x] SubTask 1.7: 新增 `PromptCompileDebugReport` 结构体（包含编译过程关键信息）
  - [x] SubTask 1.8: 新增 `PromptCompileResult` 结构体（`system_blocks`, `example_blocks`, `history_blocks`, `current_user_block`, `prefill_seed`, `params`, `debug`）

- [x] Task 2: Stage A — 重构 compile_chat_messages() 为显式 IR 输出

  - [x] SubTask 2.1: 读取现有 `compile_chat_messages()` 实现，理解当前输入源和编译逻辑
  - [x] SubTask 2.2: 将当前字符串拼接逻辑改造为生成 `Vec<PromptBlock>`
  - [x] SubTask 2.3: 为每个 block 填充 `kind`、`source`、`priority`、`required` 等元数据
  - [x] SubTask 2.4: 验证改造后的 `compile_chat_messages()` 输出结构化 IR

- [x] Task 3: Stage B — 聊天链路改造为先 compile 再由 adapter 转 request

  - [x] SubTask 3.1: 在 `stream_llm_response()` 或等效调用点，改为先调用 `compile_prompt()` 获取 `PromptCompileResult`
  - [x] SubTask 3.2: 将 `PromptCompileResult` 传递给 Provider Adapter，由其转换为 Anthropic/OpenAI 请求体
  - [x] SubTask 3.3: 确保消息历史、system blocks、example blocks 正确从 IR 映射到 provider 请求格式
  - [x] SubTask 3.4: 验证聊天请求链路正常工作

- [x] Task 4: Stage C — 引入预算裁剪框架和 Debug Report

  - [x] SubTask 4.1: 在 `prompt_compiler.rs` 中实现预算裁剪逻辑，按 `RetrievedDetail` → `PlotSummary` → `WorldBookMatch` 顺序裁剪
  - [x] SubTask 4.2: 实现 `CurrentUser` 不被裁剪，`PresetRule` 和 `CharacterBase` 尽量不裁剪的约束
  - [x] SubTask 4.3: 在编译过程中填充 `PromptCompileDebugReport`，包含各 block 的 token 估计、裁剪原因等
  - [x] SubTask 4.4: 验证 debug report 可正确生成

- [x] Task 5: 验证 PromptCompiler 核心类型与 spec 一致性

  - [x] SubTask 5.1: 对照 `spec.md` 验证所有新增类型字段完整
  - [x] SubTask 5.2: 验证 `WorldVariable` 已标记 TODO 注释
  - [x] SubTask 5.3: 验证 Provider Adapter 边界清晰（Prompt Compiler 不直接输出 provider 请求体）

# Task Dependencies

- Task 1 无外部依赖，可最先开始
- Task 2 依赖 Task 1（需要核心类型定义）
- Task 3 依赖 Task 2（需要 compile_chat_messages 改造完成）
- Task 4 依赖 Task 2 和 Task 3（需要在编译链路中集成裁剪和 debug）
- Task 5 可最后验证所有任务
- Task 2、3、4 顺序执行，不可并行

# 备注

- 所有核心类型已在 `src-tauri/src/services/prompt_compiler.rs` 中定义
- `PromptBlockKind::WorldVariable` 已替换原 `CharacterStateOverlay`，并添加 TODO 注释
- 预算裁剪和 Debug Report 框架已实现
- 聊天链路已采用 "compile then adapter" 模式

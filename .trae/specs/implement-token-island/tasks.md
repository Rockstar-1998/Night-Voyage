# Tasks

- [x] Task 1: 后端 — 新增 `get_conversation_token_usage` Tauri command
  - [x] SubTask 1.1: 定义 `TokenLayerUsage` 和 `TokenUsageReport` 序列化结构体（在 `models/mod.rs` 中）
  - [x] SubTask 1.2: 在 `prompt_compiler.rs` 中新增 `compile_token_usage_report()` 函数，复用现有编译逻辑但只返回 token 用量数据
  - [x] SubTask 1.3: 在 `commands/chat.rs` 中注册 `get_conversation_token_usage` command，调用编译函数并返回报告
  - [x] SubTask 1.4: 查询会话关联 provider 的 `max_context_tokens`，查询最近 assistant 消息的 `actual_prompt_tokens`

- [x] Task 2: 后端 — 新增 `update_conversation_context_window` Tauri command
  - [x] SubTask 2.1: 在 `commands/chat.rs` 中注册 command，更新 `api_providers.max_context_tokens`
  - [x] SubTask 2.2: 校验会话是否关联 provider，未关联时返回错误

- [x] Task 3: 后端 — 捕获 API 响应 usage 字段
  - [x] SubTask 3.1: 新增数据库迁移 `messages` 表添加 `actual_prompt_tokens INTEGER` 列
  - [x] SubTask 3.2: 在 `stream_processor.rs` 的 OpenAI 兼容流式解析中提取 `usage.prompt_tokens` / `usage.completion_tokens`
  - [x] SubTask 3.3: 在 `stream_processor.rs` 的 Anthropic 流式解析中提取 `usage` 字段（message_stop / message_delta 事件）
  - [x] SubTask 3.4: 在 `LlmStreamEventPayload` 中新增 `prompt_tokens: Option<i64>` 和 `completion_tokens: Option<i64>` 字段
  - [x] SubTask 3.5: 在 `finalize_streamed_response` 中将 `actual_prompt_tokens` 写入 messages 表

- [x] Task 4: 前端 — 新增类型定义和 invoke 封装
  - [x] SubTask 4.1: 在 `backend.ts` 中定义 `TokenLayerUsage`、`TokenUsageReport` 接口
  - [x] SubTask 4.2: 新增 `getConversationTokenUsage` 和 `updateConversationContextWindow` invoke 函数

- [x] Task 5: 前端 — 实现 TokenIsland 组件
  - [x] SubTask 5.1: 创建 `TokenIsland.tsx`，实现收起状态的胶囊条（总 token / 上下文窗口 + 迷你分段进度条）
  - [x] SubTask 5.2: 实现展开状态的设定面板（上下文窗口输入框 + 各层详细列表 + 总计）
  - [x] SubTask 5.3: 实现 Motion One 展开/收起动画
  - [x] SubTask 5.4: 实现接近上限（>80%）和超过上限（>100%）的警告视觉状态
  - [x] SubTask 5.5: 实现未设定上下文窗口时的提示状态

- [x] Task 6: 前端 — 将 TokenIsland 嵌入 ChatArea 正上方
  - [x] SubTask 6.1: 在 ChatArea 组件中，将 TokenIsland 放置在聊天消息区域正上方，作为顶部固定元素
  - [x] SubTask 6.2: 实现切换会话时自动刷新 token 用量数据
  - [x] SubTask 6.3: 监听流式响应完成事件，刷新 token 用量数据

# Task Dependencies

- [Task 2] depends on [Task 1] (需要 TokenUsageReport 结构定义)
- [Task 3] independent of [Task 1, 2] (可并行开发)
- [Task 4] depends on [Task 1, 2] (需要后端 command 注册完成)
- [Task 5] depends on [Task 4] (需要类型定义和 invoke 封装)
- [Task 6] depends on [Task 5] (需要 TokenIsland 组件)

# Tasks

- [x] Task 1: 升级 Anthropic API 版本与请求头基础设施
  - [x] SubTask 1.1: 将 `providers.rs` 中 `ANTHROPIC_API_VERSION` 常量从 `2023-06-01` 更新为 `2025-04-14`
  - [x] SubTask 1.2: 在 `provider_adapter.rs` 的 `build_anthropic_http_request` 中新增 `anthropic-beta` 头支持，根据请求类型自动添加所需 beta 功能标识
  - [x] SubTask 1.3: 在 `providers.rs` 的 `providers_test_claude_native` 和 `providers_fetch_models` 中同步更新 API 版本

- [x] Task 2: 新增 top_k 采样参数全链路支持
  - [x] SubTask 2.1: 新增迁移 `0020_preset_top_k.sql`，为 `presets` 表添加 `top_k INTEGER NULL`，为 `preset_provider_overrides` 表添加 `top_k_override INTEGER NULL`
  - [x] SubTask 2.2: 在 `llm/mod.rs` 的 `CompiledSamplingParams` 中新增 `top_k: Option<i64>`
  - [x] SubTask 2.3: 在 `prompt_compiler.rs` 中加载 `top_k` 并应用 provider override
  - [x] SubTask 2.4: 在 `provider_adapter.rs` 的 Anthropic 请求构建中映射 `top_k`；在 OpenAI 兼容请求构建中忽略 `top_k`（因为 OpenAI 不支持）
  - [x] SubTask 2.5: 在 `presets.rs` 命令中扩展 `PresetSummary`、`PresetDetail`、`PresetCompilePreview`、`presets_create`、`presets_update` 的 DTO 以包含 `topK` 和 `topKOverride`
  - [x] SubTask 2.6: 在 `ProviderCapabilityMatrix` 中新增 `supports_top_k: bool`，Anthropic 为 `true`，OpenAI 兼容为 `false`；在 `validate_prompt_for_provider` 中对不支持 `top_k` 的 provider 显式报错而非静默忽略

- [x] Task 3: system 字段升级为 RequestTextBlock 数组格式
  - [x] SubTask 3.1: 在 `provider_adapter.rs` 的 `build_anthropic_http_request` 中，将 `system` 字段从纯字符串拼接改为 `RequestTextBlock[]` 数组格式，每个 `system_block` 映射为 `{"type": "text", "text": "..."}`
  - [x] SubTask 3.2: 确保数组格式天然支持未来扩展 `cache_control` 字段，无需再次重构

- [x] Task 4: Anthropic 模型列表拉取适配
  - [x] SubTask 4.1: 在 `providers.rs` 的 `providers_fetch_models` 中，为 `provider_kind = anthropic` 添加专用模型列表逻辑
  - [x] SubTask 4.2: 先尝试调用 `{base_url}/v1/models`，若返回 404 或非标准格式，回退到硬编码的 Anthropic 官方模型列表
  - [x] SubTask 4.3: 硬编码列表包含当前已知 Claude 模型 ID（claude-sonnet-4-20250514、claude-3-5-sonnet-20241022、claude-3-5-haiku-20241022、claude-3-opus-20240229 等）

- [x] Task 5: Token 计数 API 命令
  - [x] SubTask 5.1: 在 `providers.rs` 中新增 `providers_count_tokens` Tauri 命令
  - [x] SubTask 5.2: 命令接受 `providerId`、`messages`、`system`、`model`、`tools` 等参数
  - [x] SubTask 5.3: 对 `provider_kind = anthropic` 构建 Messages API 兼容请求体（不含 `stream`），发送 `POST {base_url}/v1/messages/count_tokens`，带 `anthropic-beta: token-counting-2024-11-01` 头
  - [x] SubTask 5.4: 对 `provider_kind = openai_compatible` 返回显式错误
  - [x] SubTask 5.5: 在 `lib.rs` 中注册新命令

- [x] Task 6: 图片输入管道
  - [x] SubTask 6.1: 扩展 `chat_submit_input` 命令，接受可选的 `attachments` 参数（包含 `asset_id` 或 `base64_data` + `mime_type`）
  - [x] SubTask 6.2: 在 Prompt Compiler 中将图片附件编译为 `LlmContentPart::Image`
  - [x] SubTask 6.3: 在 `provider_adapter.rs` 的 `anthropic_content_part_to_json` 中确认 Image part 的 base64 映射已正确实现
  - [x] SubTask 6.4: 添加图片格式校验，仅允许 `image/jpeg`、`image/png`、`image/gif`、`image/webp`，其他格式显式报错
  - [x] SubTask 6.5: 将图片内容持久化到 `message_content_parts` 表

- [x] Task 7: 统一流式事件 llm-stream-event 完整发射
  - [x] SubTask 7.1: 在 `chat.rs` 的 `stream_anthropic_text_response` 中，为每个 SSE 事件同时发射 `llm-stream-event` 和 `llm-stream-chunk`
  - [x] SubTask 7.2: `llm-stream-event` 的 `eventKind` 根据 Anthropic 事件类型映射：`text_delta`、`thinking_delta`、`content_block_start`、`content_block_stop`、`tool_use`、`message_stop`
  - [x] SubTask 7.3: `llm-stream-chunk` 保持向后兼容，`delta` 只包含可见文本增量（不含 thinking）
  - [x] SubTask 7.4: 在 `stream_openai_text_response` 中也同步发射 `llm-stream-event`，`providerKind = "openai_compatible"`

- [x] Task 8: tool_result 回注命令与 agent mode 最小闭环
  - [x] SubTask 8.1: 在 `chat.rs` 中新增 `chat_submit_tool_result` Tauri 命令
  - [x] SubTask 8.2: 命令接受 `conversationId`、`roundId`、`toolUseId`、`content`（字符串或 content parts）、`isError` 参数
  - [x] SubTask 8.3: 校验会话 `chat_mode` 必须为 `director_agents`，否则返回显式错误
  - [x] SubTask 8.4: 将 tool_result 写入 `message_content_parts`
  - [x] SubTask 8.5: 更新 `message_tool_calls` 中对应记录的 `status` 为 `result_available`
  - [x] SubTask 8.6: 构建包含 tool_result 的新 Anthropic 请求体，发起新的流式请求
  - [x] SubTask 8.7: 流式结果走与普通聊天相同的持久化和事件发射路径
  - [x] SubTask 8.8: 在 `lib.rs` 中注册新命令

- [x] Task 9: 更新对接文档
  - [x] SubTask 9.1: 在 `plans/backend-ai-handoff.md` 中新增 Phase 14 Update 章节，记录本阶段所有变更

# Task Dependencies

- Task 1 无外部依赖，可最先开始
- Task 2 依赖 Task 1（API 版本升级后才能确认 top_k 在新版本中的行为）
- Task 3 依赖 Task 1（system 数组格式需要新 API 版本支持）
- Task 4 依赖 Task 1（模型列表端点需要新 API 版本）
- Task 5 依赖 Task 1 和 Task 3（token 计数需要新 API 版本和 beta 头）
- Task 6 依赖 Task 1（图片输入需要新 API 版本）
- Task 7 依赖 Task 1（统一流式事件需要确认新版本事件格式）
- Task 8 依赖 Task 7（tool_result 回注后的继续推理需要统一流式事件）
- Task 9 依赖所有其他 Task 完成
- Task 2、3、4 可并行执行
- Task 5、6 可并行执行

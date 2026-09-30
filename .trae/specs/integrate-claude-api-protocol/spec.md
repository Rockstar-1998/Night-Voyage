# Claude API 协议完整接入 Spec

## Why

Night Voyage 后端已通过 Phase 12-13 完成了 Anthropic Claude 原生协议的基础接入（文本聊天、SSE 流式、thinking 隐藏持久化、tool_use 骨架），但仍存在多项协议能力缺口：API 版本过旧、缺少 `top_k` 参数、`system` 字段不支持数组格式、模型列表拉取未适配 Anthropic 端点、缺少 token 计数 API、缺少 `anthropic-beta` 头支持、图片输入管道未贯通、统一流式事件未完全发射、tool_result 回注命令未落地。本阶段目标是将这些缺口逐一关闭，使 Claude 原生协议接入达到生产可用水平。

## What Changes

- 升级 Anthropic API 版本从 `2023-06-01` 到 `2025-04-14`（或仓库内可配置的最新稳定版本）
- 在 `CompiledSamplingParams` 和 Anthropic 请求构建中新增 `top_k` 参数支持
- `system` 字段从纯字符串升级为同时支持 `string` 和 `RequestTextBlock[]` 数组格式（为 prompt caching 做准备）
- Anthropic provider 的模型列表拉取从复用 OpenAI `/v1/models` 改为调用 Anthropic 专用模型列表端点或回退策略
- 新增 `providers_count_tokens` 命令，调用 Anthropic `/v1/messages/count_tokens` API
- 新增 `anthropic-beta` 请求头支持，允许按功能启用 beta 能力（token counting、prompt caching 等）
- 图片输入管道：从 `chat_submit_input` 接受附件到 Anthropic base64 image source 的完整链路
- 统一流式事件 `llm-stream-event` 的完整发射，替代当前仅文本的 `llm-stream-chunk`
- 新增 `chat_submit_tool_result` 命令，完成 tool_use → tool_result 的 agent mode 最小闭环
- 更新 `backend-ai-handoff.md` 对接文档

## Impact

- Affected specs: Phase 12-13 的 Claude 原生协议接入、Prompt Compiler 输出结构、Provider Adapter 层、流式事件契约
- Affected code:
  - `src-tauri/src/llm/mod.rs` — 新增 `top_k`、`system` 数组格式、beta 头类型
  - `src-tauri/src/services/provider_adapter.rs` — Anthropic 请求构建升级
  - `src-tauri/src/commands/chat.rs` — 流式事件发射升级、图片输入管道、tool_result 回注
  - `src-tauri/src/commands/providers.rs` — 模型列表适配、token 计数命令
  - `src-tauri/src/services/prompt_compiler.rs` — `top_k` 参数编译
  - `src-tauri/migrations/` — 预设表新增 `top_k` 字段
  - `plans/backend-ai-handoff.md` — 对接文档更新

## ADDED Requirements

### Requirement: Anthropic API 版本升级

系统 SHALL 将 Anthropic API 版本从 `2023-06-01` 升级到 `2025-04-14`，并在 `providers.rs` 中以常量形式维护，便于后续统一升级。

#### Scenario: API 版本正确发送

- **WHEN** 后端向 Anthropic 发送任何 HTTP 请求
- **THEN** 请求头 `anthropic-version` 的值 SHALL 为 `2025-04-14`

### Requirement: top_k 采样参数支持

系统 SHALL 在预设系统、Prompt Compiler 和 Anthropic 请求构建中支持 `top_k` 参数。

#### Scenario: 预设中配置 top_k

- **WHEN** 用户在预设中设置 `top_k` 值
- **THEN** 该值 SHALL 被保存到 `presets.top_k` 字段
- **AND** Prompt Compiler 编译结果 SHALL 包含 `top_k`
- **AND** Anthropic 请求体 SHALL 包含 `top_k` 字段

#### Scenario: OpenAI 兼容 provider 忽略 top_k

- **WHEN** 预设编译结果包含 `top_k` 且 provider 为 `openai_compatible`
- **THEN** OpenAI 请求体 SHALL NOT 包含 `top_k` 字段（OpenAI 不支持此参数）

### Requirement: system 字段数组格式支持

系统 SHALL 支持将 `system_blocks` 编译为 Anthropic `RequestTextBlock[]` 数组格式，而不仅仅是纯字符串拼接。

#### Scenario: system 作为数组发送

- **WHEN** Prompt Compiler 编译结果包含多个 system_blocks 且 provider 为 `anthropic`
- **THEN** Anthropic 请求体的 `system` 字段 SHALL 为 `RequestTextBlock[]` 数组格式
- **AND** 每个 block SHALL 包含 `type: "text"` 和 `text` 字段

#### Scenario: system 数组格式兼容缓存控制

- **WHEN** 未来需要为 system block 添加 `cache_control` 字段
- **THEN** 数组格式 SHALL 天然支持扩展，无需再次重构请求构建逻辑

### Requirement: Anthropic 模型列表拉取

系统 SHALL 为 `provider_kind = anthropic` 提供专用的模型列表拉取策略。

#### Scenario: Anthropic provider 拉取模型列表

- **WHEN** 前端调用 `providers_fetch_models` 且 `provider_kind = anthropic`
- **THEN** 后端 SHALL 尝试调用 `{base_url}/v1/models` 端点
- **AND** 若端点返回 404 或非标准格式，后端 SHALL 返回硬编码的 Anthropic 官方模型列表作为回退
- **AND** 硬编码列表 SHALL 包含当前已知的 Claude 模型 ID

### Requirement: Token 计数 API

系统 SHALL 提供 `providers_count_tokens` 命令，调用 Anthropic `/v1/messages/count_tokens` API。

#### Scenario: Anthropic provider 计数 token

- **WHEN** 前端调用 `providers_count_tokens` 且 `provider_kind = anthropic`
- **THEN** 后端 SHALL 构建与 Messages API 相同的请求体（不含 `stream`）
- **AND** 发送 `POST {base_url}/v1/messages/count_tokens`
- **AND** 返回 `token_count` 数值

#### Scenario: OpenAI 兼容 provider 不支持

- **WHEN** 前端调用 `providers_count_tokens` 且 `provider_kind = openai_compatible`
- **THEN** 后端 SHALL 返回显式错误，说明 OpenAI 兼容接口不支持 token 计数

### Requirement: anthropic-beta 请求头支持

系统 SHALL 在 Anthropic HTTP 请求中支持 `anthropic-beta` 头。

#### Scenario: 启用 beta 功能

- **WHEN** 请求需要启用 beta 功能（如 token counting、prompt caching）
- **THEN** 后端 SHALL 在请求头中添加 `anthropic-beta: <beta-feature-list>`
- **AND** beta 功能列表 SHALL 由后端根据请求类型自动决定

### Requirement: 图片输入管道

系统 SHALL 支持从聊天输入到 Anthropic base64 image source 的完整图片输入链路。

#### Scenario: 用户发送带图片的消息

- **WHEN** 用户在 `chat_submit_input` 中附带图片附件
- **THEN** 后端 SHALL 将图片存入本地受控资产目录
- **AND** Prompt Compiler 编译时 SHALL 将图片编译为 `LlmContentPart::Image`
- **AND** Anthropic 请求构建时 SHALL 将图片转为 `{"type": "image", "source": {"type": "base64", "media_type": "...", "data": "..."}}`

#### Scenario: 图片格式校验

- **WHEN** 用户上传的图片格式不在 `image/jpeg`、`image/png`、`image/gif`、`image/webp` 范围内
- **THEN** 后端 SHALL 返回显式错误，不做静默忽略或格式转换

### Requirement: 统一流式事件发射

系统 SHALL 在 Anthropic 流式链路中完整发射 `llm-stream-event` 事件，替代当前仅文本的 `llm-stream-chunk`。

#### Scenario: Anthropic 文本 delta 事件

- **WHEN** Anthropic SSE 返回 `content_block_delta` 且 delta 类型为 `text_delta`
- **THEN** 后端 SHALL 发射 `llm-stream-event`，`eventKind = "text_delta"`，`textDelta` 包含增量文本

#### Scenario: Anthropic thinking delta 事件

- **WHEN** Anthropic SSE 返回 `content_block_delta` 且 delta 类型为 `thinking_delta`
- **THEN** 后端 SHALL 发射 `llm-stream-event`，`eventKind = "thinking_delta"`，`textDelta` 包含增量思维文本

#### Scenario: 兼容现有 llm-stream-chunk

- **WHEN** 后端发射 `llm-stream-event`
- **THEN** 后端 SHALL 同时继续发射 `llm-stream-chunk` 以保持向后兼容
- **AND** `llm-stream-chunk` 的 `delta` 字段 SHALL 只包含可见文本增量（不含 thinking）

### Requirement: tool_result 回注命令

系统 SHALL 提供 `chat_submit_tool_result` 命令，完成 tool_use → tool_result 的最小闭环。

#### Scenario: 提交 tool_result

- **WHEN** 前端调用 `chat_submit_tool_result` 并传入 `tool_use_id`、`content`、`is_error`
- **THEN** 后端 SHALL 将 tool_result 写入 `message_content_parts`
- **AND** 后端 SHALL 更新 `message_tool_calls` 中对应记录的 `status` 为 `result_available`
- **AND** 后端 SHALL 返回更新后的轮次状态

#### Scenario: tool_result 提交后继续推理

- **WHEN** tool_result 提交完成且会话处于 agent mode
- **THEN** 后端 SHALL 构建包含 tool_result 的新请求体
- **AND** 发起新的 Anthropic 流式请求
- **AND** 流式结果 SHALL 走与普通聊天相同的持久化和事件发射路径

#### Scenario: 非 agent mode 拒绝 tool_result

- **WHEN** 会话 `chat_mode` 不为 `director_agents`
- **THEN** 后端 SHALL 返回显式错误，说明 tool_result 仅在 agent mode 下可用

## MODIFIED Requirements

### Requirement: 预设采样参数

预设系统的采样参数层 SHALL 新增 `top_k` 字段。

- `presets` 表新增 `top_k INTEGER NULL`
- `PresetSummary`、`PresetDetail`、`PresetCompilePreview.params` 新增 `topK`
- `presets_create` 和 `presets_update` 新增可选 `topK`
- `preset_provider_overrides` 新增 `top_k_override`
- Prompt Compiler 编译时 SHALL 加载 `top_k` 并应用 provider override

### Requirement: Provider Adapter 请求构建

Anthropic 请求构建 SHALL 升级为：
- `system` 字段使用 `RequestTextBlock[]` 数组格式
- 新增 `top_k` 参数映射
- 新增 `anthropic-beta` 头
- API 版本升级到 `2025-04-14`

### Requirement: 流式事件契约

`llm-stream-chunk` 事件 SHALL 保持向后兼容，同时新增 `llm-stream-event` 作为统一事件出口。

## REMOVED Requirements

无移除项。本阶段为纯增量扩展。

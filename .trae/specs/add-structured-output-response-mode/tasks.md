# Tasks

- [x] Task 1: 创建 `structured_output_parser.rs` 增量 JSON 流式解析器
  - [x] SubTask 1.1: 定义 `StructuredOutputParser` 结构体和状态机（跟踪当前解析的 JSON 字段路径）
  - [x] SubTask 1.2: 实现 `feed(delta: &str)` 方法，接收增量 JSON 片段并更新解析状态
  - [x] SubTask 1.3: 实现 `StructuredOutputEvent` 枚举（ThinkingDelta / TextDelta / ChoicesComplete / FieldSwitch / ParseError）
  - [x] SubTask 1.4: 实现 thinking / text 字段的增量提取逻辑（字符串值逐字符追踪）
  - [x] SubTask 1.5: 实现 choices 对象的完整闭合检测和解析
  - [x] SubTask 1.6: 实现无效 JSON 容错（流中断时提取已完整字段、返回显式错误）
  - [x] SubTask 1.7: 编写单元测试（覆盖增量解析、字段切换、choices 解析、容错场景）

- [x] Task 2: 定义 Schema 模板系统和相关类型
  - [x] SubTask 2.1: 在 `llm/mod.rs` 中定义 `StructuredOutputSchema` 枚举（Basic / InteractiveFiction）
  - [x] SubTask 2.2: 实现 `to_json_schema()` 方法，将模板转换为 JSON Schema Value
  - [x] SubTask 2.3: 实现 `from_str()` 解析，支持从字符串标识（"basic" / "interactive_fiction"）转换
  - [x] SubTask 2.4: 在 `LlmChatRequest` 中新增 `structured_output_schema: Option<String>` 字段

- [x] Task 3: 扩展 ProviderCapabilityMatrix 和 response_mode
  - [x] SubTask 3.1: 在 `ProviderCapabilityMatrix` 中新增 `supports_structured_json_output: bool` 字段
  - [x] SubTask 3.2: OpenAI 兼容和 Anthropic provider 设置 `supports_structured_json_output = true`
  - [x] SubTask 3.3: 修改 `normalize_loaded_response_mode`，新增 `"structured_json"` 合法值
  - [x] SubTask 3.4: 编写单元测试验证新 response_mode 值的校验逻辑

- [x] Task 4: 实现 OpenAI Structured Outputs 请求构建
  - [x] SubTask 4.1: 在 `provider_adapter.rs` 中实现 `build_openai_structured_json_request`，设置 `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`
  - [x] SubTask 4.2: 在 system prompt 中追加 JSON 格式说明（告知模型必须输出符合 Schema 的 JSON）
  - [x] SubTask 4.3: 在 `build_openai_http_request` 中集成 structured_json 分支
  - [x] SubTask 4.4: 编写单元测试验证请求体结构

- [x] Task 5: 实现 Anthropic Structured Outputs 请求构建
  - [x] SubTask 5.1: 在 `provider_adapter.rs` 中实现 Schema 模板到 Anthropic tool 定义的转换
  - [x] SubTask 5.2: 设置 `tool_choice: { type: "tool", name: "night_voyage_response" }`
  - [x] SubTask 5.3: 在 system prompt 中追加格式说明（要求模型使用 tool 提交响应）
  - [x] SubTask 5.4: 在 `build_anthropic_http_request` 中集成 structured_json 分支
  - [x] SubTask 5.5: 编写单元测试验证请求体结构

- [x] Task 6: OpenAI 流式链路集成增量 JSON 解析器
  - [x] SubTask 6.1: 修改 `stream_openai_text_response`，在 `response_mode == "structured_json"` 时创建 `StructuredOutputParser` 实例
  - [x] SubTask 6.2: 将每个 text delta 喂入解析器，根据返回的 `StructuredOutputEvent` 分别处理
  - [x] SubTask 6.3: thinking_delta 事件写入 hidden_parts 并发射 `llm-stream-event`
  - [x] SubTask 6.4: text_delta 事件写入 full_content 并发射 `llm-stream-chunk`
  - [x] SubTask 6.5: choices_complete 事件持久化到消息数据
  - [x] SubTask 6.6: 非 structured_json 模式保持现有行为不变

- [x] Task 7: Anthropic 流式链路集成增量 JSON 解析器
  - [x] SubTask 7.1: 修改 `stream_anthropic_text_response`，在 `response_mode == "structured_json"` 时检测 `tool_use` content block（name 为 `night_voyage_response`）
  - [x] SubTask 7.2: 将 `input_json_delta` 片段喂入 `StructuredOutputParser`
  - [x] SubTask 7.3: 根据解析器事件分别发射 thinking_delta / text_delta / choices_complete
  - [x] SubTask 7.4: 非 structured_json 模式保持现有行为不变

- [x] Task 8: 预设系统持久化 structured_output_schema
  - [x] SubTask 8.1: 新增数据库迁移，`presets` 表添加 `structured_output_schema TEXT DEFAULT 'basic'`
  - [x] SubTask 8.2: `preset_provider_overrides` 表添加 `structured_output_schema_override TEXT`
  - [x] SubTask 8.3: 更新 `PresetSummary` / `PresetDetail` 类型，新增 `structuredOutputSchema` 字段
  - [x] SubTask 8.4: 更新 `presets_create` / `presets_update` 命令，支持 `structuredOutputSchema` 参数
  - [x] SubTask 8.5: 更新 Prompt Compiler 编译逻辑，加载 `structured_output_schema` 并传递到 `LlmChatRequest`

- [x] Task 9: 前端结构化响应渲染
  - [x] SubTask 9.1: 在 `messageFormatter.ts` 中新增 `StructuredResponseNode` 类型和 `choices` 渲染逻辑
  - [x] SubTask 9.2: 修改 `MessageFormatRenderer.tsx`，支持渲染 `StructuredResponseNode`（thinking 折叠块 + text 正文 + choices 按钮）
  - [x] SubTask 9.3: 修改 `MessageItem.tsx`，检测消息的结构化响应标记并传递给渲染器
  - [x] SubTask 9.4: choices 按钮点击触发 `chat_submit_input` 事件

- [x] Task 10: 预设 UI 响应模式切换
  - [x] SubTask 10.1: 修改 `CompletionParametersPanel.tsx`，Response Mode 下拉框新增 `structured_json` 选项
  - [x] SubTask 10.2: 选择 `structured_json` 时显示 Schema 模板选择器（基础 / 交互小说）
  - [x] SubTask 10.3: Provider Override 区域同步新增 Response Mode Override 的 `structured_json` 选项和 Schema 选择器

- [x] Task 11: 更新对接文档
  - [x] SubTask 11.1: 更新 `plans/backend-ai-handoff.md`，记录 structured_json 模式的 Tauri command / event 变更

# Task Dependencies

- Task 1 (增量 JSON 解析器) → Task 6 (OpenAI 流式集成), Task 7 (Anthropic 流式集成)
- Task 2 (Schema 模板) → Task 4 (OpenAI 请求构建), Task 5 (Anthropic 请求构建)
- Task 3 (Capability + response_mode) → Task 4, Task 5, Task 8
- Task 4 + Task 5 (请求构建) → Task 6, Task 7 (流式集成)
- Task 8 (预设持久化) → Task 10 (预设 UI)
- Task 6 + Task 7 (流式集成) → Task 9 (前端渲染)
- Task 9 (前端渲染) → Task 10 (预设 UI 切换)
- Task 11 可与 Task 9/10 并行

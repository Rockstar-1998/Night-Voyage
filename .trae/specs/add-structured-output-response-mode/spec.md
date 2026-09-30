# Structured Output 响应模式 Spec

## Why

当前项目使用伪 XML 标签（如 `<thinking></thinking>`）在 LLM 响应中分隔思维链与正文，前端通过正则解析这些标签并渲染为可折叠块。但当使用质量较低的模型时，模型可能忘记闭合标签，导致思维链内容泄漏到正文中。为根除此问题，引入基于 OpenAI / Anthropic Structured Outputs 协议的 JSON 结构化响应模式，在协议层面强制模型输出分离的 thinking / text / choices 字段。

## What Changes

- 新增 `structured_output_parser.rs` 文件，实现增量 JSON 流式解析器，独立于现有伪 XML 解析逻辑
- 新增 `response_mode: "structured_json"` 模式，与现有 `"text"` / `"json_object"` 并列
- 新增 Schema 模板系统：提供基础模板（thinking + text）和交互小说模板（thinking + text + choices），支持可选扩展
- 新增 OpenAI `json_schema` structured outputs 请求构建路径
- 新增 Anthropic tool_use structured outputs 请求构建路径
- 修改 `stream_processor.rs`，在 OpenAI 流式链路中集成增量 JSON 解析器
- 修改 `ProviderCapabilityMatrix`，新增 `supports_structured_json_output` 能力标记
- 修改前端 `MessageItem` / `MessageFormatRenderer`，支持渲染结构化响应中的 thinking / text / choices
- 修改预设设置 UI，新增响应模式切换选项
- **不删除**现有伪 XML 解析逻辑，两种模式共存可切换

## Impact

- Affected specs: `improve-structured-rendering`（消息格式化功能）、`integrate-claude-api-protocol`（API 协议）、`prompt-compiler-stage-a`（Prompt Compiler）
- Affected code:
  - `src-tauri/src/services/structured_output_parser.rs` — **新增**增量 JSON 流式解析器
  - `src-tauri/src/services/stream_processor.rs` — OpenAI 流式链路集成增量 JSON 解析
  - `src-tauri/src/services/provider_adapter.rs` — 新增 structured outputs 请求构建
  - `src-tauri/src/llm/mod.rs` — 新增结构化响应相关类型
  - `src-tauri/src/services/prompt_compiler.rs` — response_mode 新增 `"structured_json"` 值
  - `src/components/MessageItem.tsx` — 渲染结构化响应
  - `src/components/MessageFormatRenderer.tsx` — 渲染 choices
  - `src/components/CompletionParametersPanel.tsx` — 新增响应模式选项
  - `src/lib/messageFormatter.ts` — 新增结构化响应节点类型

---

## ADDED Requirements

### Requirement: 增量 JSON 流式解析器

系统 SHALL 在 `src-tauri/src/services/structured_output_parser.rs` 中实现独立的增量 JSON 流式解析器，能够在模型逐步输出 JSON 片段时实时提取字段值。

#### Scenario: 解析 thinking 字段增量

- **WHEN** 模型流式输出 `{"thinking": "用户想让我...` 这样的部分 JSON
- **THEN** 解析器 SHALL 识别当前正在填充 `thinking` 字段
- **AND** SHALL 发射 `thinking_delta` 事件，payload 为 `"用户想让我..."`

#### Scenario: 字段切换

- **WHEN** 模型输出从 `thinking` 字段切换到 `text` 字段（如 `"text": "你好`）
- **THEN** 解析器 SHALL 识别字段切换
- **AND** SHALL 停止发射 `thinking_delta` 事件
- **AND** SHALL 开始发射 `text_delta` 事件

#### Scenario: 解析 choices 字段

- **WHEN** 模型输出包含 `choices` 对象（如 `"choices": {"A": "回去", "B": "继续"}`）
- **THEN** 解析器 SHALL 在 `choices` 对象完整闭合后发射 `choices_complete` 事件
- **AND** `choices` 对象在流式期间不发射增量事件（因为选项通常很短，等完整闭合后再发射）

#### Scenario: 无效 JSON 容错

- **WHEN** 模型输出的 JSON 不完整或格式错误（如流中断）
- **THEN** 解析器 SHALL 尽可能提取已完整接收的字段
- **AND** SHALL 返回显式错误说明解析失败的位置和原因
- **AND** SHALL NOT 静默丢弃已解析的内容

#### Scenario: 解析器独立性

- **THEN** `structured_output_parser.rs` SHALL NOT 依赖 `stream_processor.rs` 中的任何函数
- **AND** SHALL 仅依赖标准库和 `serde_json`
- **AND** SHALL 通过 trait 或函数签名与流式处理链路解耦

---

### Requirement: Schema 模板系统

系统 SHALL 提供 Schema 模板，定义结构化响应的 JSON Schema。

#### Scenario: 基础模板

- **THEN** 系统 SHALL 提供基础模板 `StructuredOutputSchema::Basic`，定义如下 Schema：
  ```json
  {
    "type": "object",
    "properties": {
      "thinking": { "type": "string", "description": "模型的内部推理过程" },
      "text": { "type": "string", "description": "回复正文" }
    },
    "required": ["thinking", "text"]
  }
  ```

#### Scenario: 交互小说模板

- **THEN** 系统 SHALL 提供交互小说模板 `StructuredOutputSchema::InteractiveFiction`，定义如下 Schema：
  ```json
  {
    "type": "object",
    "properties": {
      "thinking": { "type": "string", "description": "模型的内部推理过程" },
      "text": { "type": "string", "description": "叙事正文" },
      "choices": {
        "type": "object",
        "description": "玩家可选的行动选项",
        "additionalProperties": { "type": "string" }
      }
    },
    "required": ["thinking", "text"]
  }
  ```

#### Scenario: Schema 模板选择

- **WHEN** 用户在预设中选择 `response_mode: "structured_json"`
- **THEN** 系统 SHALL 允许用户选择 Schema 模板（基础 / 交互小说）
- **AND** 默认使用基础模板

---

### Requirement: OpenAI Structured Outputs 请求构建

系统 SHALL 在 `provider_adapter.rs` 中新增 OpenAI `json_schema` structured outputs 请求构建路径。

#### Scenario: 构建 json_schema 请求

- **WHEN** `response_mode` 为 `"structured_json"` 且 `provider_kind` 为 `"openai_compatible"`
- **THEN** 系统 SHALL 在请求体中设置 `response_format` 为：
  ```json
  {
    "type": "json_schema",
    "json_schema": {
      "name": "night_voyage_response",
      "strict": true,
      "schema": <根据所选模板生成的 JSON Schema>
    }
  }
  ```
- **AND** SHALL 在 system prompt 中追加 JSON 格式说明

#### Scenario: 模型不支持 structured outputs

- **WHEN** `response_mode` 为 `"structured_json"` 但 `ProviderCapabilityMatrix.supports_structured_json_output` 为 `false`
- **THEN** 系统 SHALL 返回显式错误，说明当前 provider 不支持结构化 JSON 输出
- **AND** SHALL NOT 静默降级为其他模式

---

### Requirement: Anthropic Structured Outputs 请求构建

系统 SHALL 在 `provider_adapter.rs` 中新增 Anthropic tool_use structured outputs 请求构建路径。

#### Scenario: 构建 tool_use 结构化请求

- **WHEN** `response_mode` 为 `"structured_json"` 且 `provider_kind` 为 `"anthropic"`
- **THEN** 系统 SHALL 将 Schema 模板转换为一个 Anthropic tool 定义
- **AND** 请求体 SHALL 包含 `tools` 数组，其中有一个 tool，其 `input_schema` 为所选模板的 Schema
- **AND** 请求体 SHALL 设置 `tool_choice: { "type": "tool", "name": "night_voyage_response" }`
- **AND** 系统 SHALL 在 system prompt 中追加格式说明，要求模型使用该 tool 提交响应

#### Scenario: Anthropic structured output 流式解析

- **WHEN** Anthropic 返回 `tool_use` content block 且 tool name 为 `night_voyage_response`
- **THEN** `stream_processor.rs` SHALL 使用增量 JSON 解析器解析 `input_json_delta` 片段
- **AND** SHALL 发射 `thinking_delta` / `text_delta` / `choices_complete` 事件

---

### Requirement: ProviderCapabilityMatrix 扩展

系统 SHALL 在 `ProviderCapabilityMatrix` 中新增 `supports_structured_json_output` 字段。

#### Scenario: OpenAI 兼容 provider 能力

- **WHEN** `provider_kind` 为 `"openai_compatible"`
- **THEN** `supports_structured_json_output` SHALL 为 `true`

#### Scenario: Anthropic provider 能力

- **WHEN** `provider_kind` 为 `"anthropic"`
- **THEN** `supports_structured_json_output` SHALL 为 `true`

---

### Requirement: response_mode 新增 structured_json 值

系统 SHALL 在 `normalize_loaded_response_mode` 中新增 `"structured_json"` 合法值。

#### Scenario: 预设中配置 structured_json

- **WHEN** 用户在预设中设置 `response_mode` 为 `"structured_json"`
- **THEN** 该值 SHALL 被保存到 `presets.response_mode` 字段
- **AND** Prompt Compiler 编译结果 SHALL 包含 `response_mode: "structured_json"`
- **AND** 系统 SHALL 同时加载对应的 `structured_output_schema` 配置

#### Scenario: response_mode 校验

- **WHEN** `response_mode` 值不为 `"text"` / `"json_object"` / `"structured_json"` 之一
- **THEN** 系统 SHALL 返回显式校验错误

---

### Requirement: 结构化响应 Schema 配置持久化

系统 SHALL 在预设表中新增 `structured_output_schema` 字段，存储所选的 Schema 模板标识。

#### Scenario: 保存 Schema 模板选择

- **WHEN** 用户在预设中选择 `response_mode: "structured_json"` 并选择 Schema 模板
- **THEN** 系统 SHALL 将模板标识（如 `"basic"` / `"interactive_fiction"`）保存到 `presets.structured_output_schema` 字段
- **AND** 默认值为 `"basic"`

#### Scenario: response_mode 非 structured_json 时忽略 schema

- **WHEN** `response_mode` 不为 `"structured_json"`
- **THEN** 系统 SHALL 忽略 `structured_output_schema` 字段

---

### Requirement: 前端结构化响应渲染

系统 SHALL 在前端支持渲染结构化响应中的 thinking / text / choices 字段。

#### Scenario: 渲染 thinking 字段

- **WHEN** 消息包含结构化 thinking 内容
- **THEN** 前端 SHALL 将 thinking 渲染为可折叠块（复用 `CollapsibleTag` 组件，标签名为 "Thinking"）
- **AND** 折叠状态 SHALL 遵循 `pseudoXmlDefaultExpanded` 配置

#### Scenario: 渲染 text 字段

- **WHEN** 消息包含结构化 text 内容
- **THEN** 前端 SHALL 将 text 渲染为普通消息正文
- **AND** text 内容 SHALL 经过现有的 `parseMessageContent` 管道处理（支持伪 XML、斜体、引用等格式）

#### Scenario: 渲染 choices 字段

- **WHEN** 消息包含结构化 choices 内容
- **THEN** 前端 SHALL 在正文下方渲染选项按钮
- **AND** 每个选项 SHALL 显示 key 和 value
- **AND** 点击选项 SHALL 触发 `chat_submit_input` 事件，将选项 value 作为用户输入

#### Scenario: 结构化响应节点类型

- **THEN** `messageFormatter.ts` SHALL 新增 `StructuredResponseNode` 类型：
  ```typescript
  interface StructuredResponseNode {
    kind: 'structured_response';
    thinking: string;
    text: string;
    choices: Record<string, string> | null;
  }
  ```
- **AND** `FormatNode` 联合类型 SHALL 包含 `StructuredResponseNode`

---

### Requirement: 预设 UI 响应模式切换

系统 SHALL 在预设设置 UI 中新增响应模式切换选项。

#### Scenario: 切换响应模式

- **WHEN** 用户在预设设置的 "Response Mode" 下拉框中选择选项
- **THEN** 下拉框 SHALL 提供以下选项：默认、text、json_object、structured_json
- **AND** 选择 `structured_json` 时 SHALL 显示 Schema 模板选择器

#### Scenario: Schema 模板选择器

- **WHEN** 用户选择 `structured_json` 响应模式
- **THEN** UI SHALL 显示 Schema 模板下拉框
- **AND** 下拉框 SHALL 提供以下选项：基础（thinking + text）、交互小说（thinking + text + choices）
- **AND** 默认选择"基础"

---

### Requirement: OpenAI 流式链路集成增量 JSON 解析

系统 SHALL 在 `stream_processor.rs` 的 OpenAI 流式处理函数中集成增量 JSON 解析器。

#### Scenario: structured_json 模式下的 OpenAI 流式处理

- **WHEN** `response_mode` 为 `"structured_json"` 且 `provider_kind` 为 `"openai_compatible"`
- **THEN** `stream_openai_text_response` SHALL 使用 `structured_output_parser` 解析每个 delta
- **AND** thinking 内容 SHALL 写入 hidden_parts（与 Anthropic thinking 处理方式一致）
- **AND** text 内容 SHALL 写入 full_content
- **AND** choices 内容 SHALL 在完整接收后持久化

#### Scenario: 非 structured_json 模式

- **WHEN** `response_mode` 不为 `"structured_json"`
- **THEN** OpenAI 流式处理 SHALL 保持现有行为不变

---

## MODIFIED Requirements

### Requirement: normalize_loaded_response_mode

`normalize_loaded_response_mode` 的合法值从 `"text" | "json_object"` 扩展为 `"text" | "json_object" | "structured_json"`。

### Requirement: ProviderCapabilityMatrix

`ProviderCapabilityMatrix` 新增 `supports_structured_json_output: bool` 字段。OpenAI 兼容和 Anthropic provider 均为 `true`。

### Requirement: 预设数据结构

预设系统新增 `structured_output_schema` 字段：
- `presets` 表新增 `structured_output_schema TEXT DEFAULT 'basic'`
- `PresetSummary`、`PresetDetail` 新增 `structuredOutputSchema`
- `presets_create` 和 `presets_update` 新增可选 `structuredOutputSchema`
- `preset_provider_overrides` 新增 `structured_output_schema_override`

### Requirement: LlmChatRequest

`LlmChatRequest` 新增 `structured_output_schema: Option<String>` 字段，用于传递 Schema 模板标识到 Provider Adapter。

## REMOVED Requirements

无移除项。现有伪 XML 解析逻辑完全保留，两种模式共存。

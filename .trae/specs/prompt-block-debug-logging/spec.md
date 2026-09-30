# PromptBlock 结构化日志 Spec

## Why

当前 LLM 调试日志中 `system` 字段是普通字符串数组，缺少 PromptBlock 的元数据（kind、source、priority 等），导致难以调试和追踪各层的来源与顺序。

## What Changes

- 为 LLM 调试日志中的 system 字段添加 PromptBlock 元数据
- Debug 日志改为包含完整的 block 元数据而非仅字符串

## Impact

- Affected code:
  - `src-tauri/src/services/prompt_compiler.rs` — 日志中输出 PromptBlock 元数据
  - `src-tauri/src/commands/chat.rs` — 日志记录调用链

## ADDED Requirements

### Requirement: Debug 日志包含 PromptBlock 元数据

LLM 调试日志应包含每个 system block 的结构化信息，而非仅纯文本。

#### Scenario: Debug 日志包含 block 元数据

- **WHEN** 记录 LLM 请求调试日志
- **THEN** 日志中 system blocks 包含 `kind`、`source`、`priority`、`required` 等元数据

## 说明

- `top_k`: Anthropic **支持** `top_k` 参数（根据 `anthropic-openapi-spec-main/openapi/messages.yaml`），所以不需要省略
- `WorldVariable` 层：标记为 TODO，继续忽略
- `ExampleMessage` 层：需要预设系统配置 few-shot 示例后才会出现

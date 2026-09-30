# 修复自动重试逻辑 Spec

## Why

自动重试（`retry_failed_round`）使用快照中保存的原始 HTTP 请求直接重发，不重新编译 prompt。而重新生成（`regenerate_round`）每次都重新编译 prompt 并构建新请求。这导致两个问题：
1. 快照中的请求可能与当前对话状态不一致（流式传输中途失败后，部分内容可能已写入数据库），导致重试永远无法成功。
2. 快照中的请求可能缺少或不正确地包含结构化输出配置（`response_format` / schema），导致重试后只返回选项字段。

## What Changes

- **修改** `retry_failed_round` 的实现，使其与 `regenerate_round` 使用相同的流程：重新编译 prompt、重新构建请求，而不是重放快照中的旧请求
- **保留** 快照中的 `validation_rules` 和 `response_mode` 用于输出验证
- **保留** 重试的退避逻辑（`RETRY_BACKOFF_SECS`）

## Impact

- Affected specs: `add-structured-output-response-mode`
- Affected code:
  - `src-tauri/src/services/chat_service.rs` — `retry_failed_round` 函数
  - `src-tauri/src/services/stream_processor.rs` — `spawn_retry_worker` / `run_retry_worker` 函数

## ADDED Requirements

### Requirement: 自动重试重新编译 prompt

The system SHALL 在自动重试时重新编译 prompt 并构建新的 HTTP 请求，而非重放快照中的旧请求。

#### Scenario: 自动重试触发
- **WHEN** 用户点击"自动重试"按钮
- **THEN** 系统重新编译 prompt（使用最新的对话历史、预设配置、结构化输出 schema）
- **THEN** 使用新编译的 prompt 构建 HTTP 请求并发送
- **THEN** 保留快照中的 `validation_rules` 用于输出验证

#### Scenario: 重试成功
- **WHEN** 重试请求成功返回
- **THEN** 行为与重新生成一致：正确处理结构化输出、内容保存、状态更新

## MODIFIED Requirements

### Requirement: 自动重试不再使用快照中的旧请求

原逻辑中，`run_retry_worker` 直接使用 `execute_provider_http_request(&snapshot.request)` 重放快照中的旧请求。

**修改后**：
- `retry_failed_round` 改为调用 `spawn_stream_task`（与 `regenerate_round` 相同的流程）
- 删除 `spawn_retry_worker` 和 `run_retry_worker` 函数
- 删除 `stream_openai_retry_response` 和 `stream_anthropic_retry_response` 函数
- 重试的退避逻辑不再需要（`spawn_stream_task` 本身不包含退避重试）

## REMOVED Requirements

### Requirement: 基于快照请求的重试机制
**Reason**: 快照请求与当前对话状态不一致，导致重试失败或返回不完整内容。应改为重新编译 prompt 的方式。
**Migration**: 无需迁移。重试按钮的行为变为与"重新生成"一致，但保留在同一个消息上（不创建新 swipe）。

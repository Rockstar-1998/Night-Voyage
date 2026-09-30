# 系统提示词分层独立消息 Spec

## Why

当前 OpenAI 兼容路径将所有系统提示词层（PresetRule、CharacterBase、CharacterStateOverlay、PlotSummary、WorldBook 等）合并为一个 `role: "system"` 消息发送，而 Anthropic 路径已经将每个层作为独立的 system block 发送。合并后模型难以区分各层语义边界，调试时也无法快速定位某一层的内容。OpenAI Chat Completion 协议的 messages 数组完全支持多个 `role: "system"` 条目，应将两条路径对齐为每层独立消息。

## What Changes

- 修改 `flatten_request_to_legacy_chat_messages`：将 `request.system` 中的每个条目作为独立的 `role: "system"` 消息推送，而非用 `\n\n` 合并为单个消息
- 更新相关测试用例以匹配新的消息结构

## Impact

- Affected specs: 无
- Affected code:
  - `src-tauri/src/services/provider_adapter.rs` — `flatten_request_to_legacy_chat_messages` 函数、相关测试

## ADDED Requirements

### Requirement: OpenAI 兼容路径系统提示词分层独立消息

OpenAI 兼容路径 SHALL 将 `request.system` 中的每个条目作为独立的 `role: "system"` 消息放入 messages 数组，而非合并为单个系统消息。

#### Scenario: 多个系统层生成多个 system 消息
- **WHEN** `request.system` 包含 3 个条目（PresetRule、CharacterBase、WorldBook）
- **THEN** 生成的 messages 数组中包含 3 个 `role: "system"` 消息，顺序与 `request.system` 一致

#### Scenario: 单个系统层生成单个 system 消息
- **WHEN** `request.system` 包含 1 个条目
- **THEN** 生成的 messages 数组中包含 1 个 `role: "system"` 消息

#### Scenario: 无系统层时不生成 system 消息
- **WHEN** `request.system` 为空
- **THEN** 生成的 messages 数组中不包含任何 `role: "system"` 消息

## MODIFIED Requirements

### Requirement: Anthropic 路径系统提示词结构不变

Anthropic 路径已经是每层独立 system block，无需修改。

## REMOVED Requirements

无移除项。

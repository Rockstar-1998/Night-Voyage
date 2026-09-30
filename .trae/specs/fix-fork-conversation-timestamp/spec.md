# 修复会话分支点击无响应 Spec

## Why

`conversations_fork` 使用 SQLite 的 `datetime('now')` 写入时间戳字符串（如 `"2026-04-18 12:00:00"`），而项目其余所有代码使用 `now_ts()` 写入 Unix 时间戳整数。`round_state_get` 中 `try_get::<i64>("updated_at")` 对字符串解析失败，导致 `refreshConversationContext`（`Promise.all`）整体 reject，点击分支会话时消息无法加载、界面无响应。

此外，前端 `createEffect` 中 `void refreshConversationContext(conversationId)` 吞噬了 Promise rejection，导致错误无法被用户感知，也无法通过 console 诊断。当 `refreshConversationContext` 失败时，消息列表不会被更新，用户看到空消息界面。

## What Changes

- 修复 `conversations_fork` 中所有 `datetime('now')` 为 `now_ts()` 绑定的 `?` 参数，统一时间戳格式为 Unix 整数 ✅（已完成）
- 修复 `conversations_fork` 中复制消息时 `member_id` 仍指向原会话成员的问题，改为映射到分支会话的新成员 ID ✅（已完成）
- 修复前端 `refreshConversationContext` 错误吞噬问题，添加 catch 日志和用户可见错误提示
- 修复 `conversations_fork` 中 `message_rounds` 未设置 `active_assistant_message_id` 的问题

## Impact

- Affected specs: `add-message-ops-user-align-delete`（会话分支功能）
- Affected code:
  - `src-tauri/src/commands/conversations.rs` — `conversations_fork` 函数
  - `src/App.tsx` — `refreshConversationContext` 和 `createEffect`

---

## ADDED Requirements

### Requirement: 分支会话时间戳格式一致性

`conversations_fork` 创建的所有记录的时间戳字段 SHALL 使用 `now_ts()` 生成的 Unix 时间戳整数，与项目其余代码保持一致。

#### Scenario: 创建分支会话

- **WHEN** `conversations_fork` 创建 `conversations` 记录
- **THEN** `created_at` 和 `updated_at` SHALL 为 Unix 时间戳整数（`now_ts()` 返回值）

#### Scenario: 创建分支会话成员

- **WHEN** `conversations_fork` 复制 `conversation_members`
- **THEN** `created_at` 和 `updated_at` SHALL 为 Unix 时间戳整数

#### Scenario: 创建分支消息轮次

- **WHEN** `conversations_fork` 创建 `message_rounds`
- **THEN** `created_at` 和 `updated_at` SHALL 为 Unix 时间戳整数

---

### Requirement: 分支会话消息成员 ID 映射

`conversations_fork` 复制消息时 SHALL 将 `member_id` 映射到分支会话的新成员 ID，而非保留原会话的成员 ID。

#### Scenario: 复制消息时映射成员 ID

- **WHEN** `conversations_fork` 复制消息到分支会话
- **THEN** 每条消息的 `member_id` SHALL 指向分支会话 `conversation_members` 中对应的成员记录
- **AND** 映射关系基于 `member_role`、`display_name`、`join_order` 的组合唯一性确定

#### Scenario: 原会话被删除后分支会话仍可正常加载

- **WHEN** 原会话被删除
- **THEN** 分支会话的消息 SHALL 仍能正确关联到分支会话自身的成员记录
- **AND** `messages_list` 的 `LEFT JOIN conversation_members` SHALL 返回正确的 `display_name`

---

### Requirement: 分支会话消息轮次设置 active_assistant_message_id

`conversations_fork` 创建 `message_rounds` 时 SHALL 为每个轮次设置 `active_assistant_message_id`，指向该轮次中最后一条非隐藏的 assistant 消息。

#### Scenario: 创建分支轮次时设置活跃消息

- **WHEN** `conversations_fork` 为某个轮次复制完所有消息
- **THEN** 系统 SHALL 查询该轮次中最后一条 `role='assistant'` 且 `is_hidden=0` 的消息 ID
- **AND** 将该 ID 设置为该轮次的 `active_assistant_message_id`

#### Scenario: 轮次无 assistant 消息

- **WHEN** 某个轮次中没有 `role='assistant'` 且 `is_hidden=0` 的消息
- **THEN** `active_assistant_message_id` SHALL 保持为 NULL

---

### Requirement: refreshConversationContext 错误可见化

`refreshConversationContext` 失败时 SHALL 输出错误日志到控制台，并设置消息列表为空数组以避免残留旧消息。

#### Scenario: refreshConversationContext 失败

- **WHEN** `refreshConversationContext` 因任何原因失败
- **THEN** 错误 SHALL 被记录到 `console.error`
- **AND** 消息列表 SHALL 被设置为空数组
- **AND** `currentRoundState` SHALL 被设置为 null

## MODIFIED Requirements

### Requirement: conversations_fork 命令

`conversations_fork` 命令 SHALL 使用 `now_ts()` 统一时间戳格式，在复制消息时映射 `member_id` 到分支会话的新成员，并在每个轮次复制完成后设置 `active_assistant_message_id`。

## REMOVED Requirements

无移除项。

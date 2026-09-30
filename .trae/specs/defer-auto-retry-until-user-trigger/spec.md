# 延迟自动重试至用户触发 Spec

## Why

当前自动重试机制在首次流式失败后立即自动重试（`spawn_stream_task` 的 loop 中 `continue`），用户无法控制重试时机。用户希望首次失败后停止，由用户点击"自动重试"按钮后再进入自动重试循环；自动重试执行期间用户可点击"停止流式传输"中止。该改造需同时适配单人模式和多人模式（房客被动接收房主的重试状态）。

## What Changes

- **`spawn_stream_task` 新增 `auto_retry_enabled: bool` 参数**：控制失败后是否自动 `continue` 重试循环。
- **首次发送 / 重新生成 / 工具派发**调用 `spawn_stream_task` 时传 `auto_retry_enabled = false`：首次失败后 emit `llm-stream-retry` + 广播 `StreamRetry`，但 **break** loop 而非 continue。
- **手动重试**（`retry_failed_round`）调用 `spawn_stream_task` 时传 `auto_retry_enabled = true`：失败后 sleep + continue（现有自动重试行为）。
- **`StreamRetryEvent` / `RoomMessage::StreamRetry` / `RoomStreamRetryPayload` 新增 `auto_retry_enabled` 字段**：让前端区分"首次失败"与"自动重试中"。
- **前端 `retryNotice` 信号扩展**：包含 `autoRetryEnabled` 和 `roundId`，不再 4 秒自动消失。
  - `autoRetryEnabled = false`：显示"发送失败" + "自动重试"按钮（点击调用 `retryFailedRound`）。
  - `autoRetryEnabled = true`：显示"自动重试中" + "停止"按钮（点击调用 `abortRoundStream`）。
- **前端事件处理分流**：`llm-stream-retry` 和 `room:stream_retry` 根据 `autoRetryEnabled` 设置不同的 `replyStatus` / `isStreaming` / `error` 状态。
- **`retryNotice` 清除时机**：收到 `llm-stream-end` / `llm-stream-error` / `room:stream_end` / 切换会话 / 发送新消息时清除。

## Impact

- Affected specs:
  - `fix-multiplayer-retry-stream-desync` — `StreamRetry` 房间消息结构变更（新增字段）
  - `fix-retry-failed-round-logic` — `spawn_stream_task` 签名变更
  - `fix-multiplayer-guest-sync-regressions` — StreamRetry 广播行为变更（携带新字段）
- Affected code:
  - `src-tauri/src/models/mod.rs` — `StreamRetryEvent` 新增 `auto_retry_enabled` 字段
  - `src-tauri/src/network/mod.rs` — `RoomMessage::StreamRetry` / `RoomStreamRetryPayload` 新增 `auto_retry_enabled` 字段
  - `src-tauri/src/services/stream_processor.rs` — `spawn_stream_task` 新增参数 + loop 逻辑改造
  - `src-tauri/src/services/chat_service.rs` — 4 个调用点传入 `auto_retry_enabled`
  - `src/lib/backend/types.ts` — `StreamRetryEvent` / `RoomStreamRetryEvent` 新增 `autoRetryEnabled`
  - `src/App.tsx` — `retryNotice` 扩展 + 事件处理分流 + UI 改造 + 清除时机

## ADDED Requirements

### Requirement: 首次失败不自动重试

系统 SHALL 在首次流式发送失败后停止重试循环，等待用户操作，而非立即自动重试。

#### Scenario: 首次发送失败后停止

- **WHEN** 用户发送消息（`submit_input`）触发 `spawn_stream_task(auto_retry_enabled = false)`
- **AND** `stream_llm_response` 返回可重试错误（非 abort、非确定性错误）
- **THEN** 系统 emit `llm-stream-retry` 事件（携带 `auto_retry_enabled = false`）+ 广播 `StreamRetry`（携带 `auto_retry_enabled = false`）到房间客户端
- **AND** 清空消息内容 + 重置 round 状态为 streaming
- **AND** **break** loop（不 sleep、不 continue）
- **AND** 前端收到事件后 `setReplyStatus('idle')` + `isStreaming = false` + 保留 `error` 字段 + 显示"发送失败"提示 + "自动重试"按钮

#### Scenario: 重新生成失败后停止

- **WHEN** 用户重新生成（`regenerate_round`）触发 `spawn_stream_task(auto_retry_enabled = false)`
- **AND** `stream_llm_response` 返回可重试错误
- **THEN** 行为与首次发送失败相同（break loop，等待用户操作）

#### Scenario: 工具调用派发失败后停止

- **WHEN** 工具调用自动派发（`dispatch_tool_round`）触发 `spawn_stream_task(auto_retry_enabled = false)`
- **AND** `stream_llm_response` 返回可重试错误
- **THEN** 行为与首次发送失败相同（break loop，等待用户操作）

### Requirement: 用户触发自动重试

系统 SHALL 在用户点击"自动重试"按钮后，通过 `retry_failed_round` 以 `auto_retry_enabled = true` 启动自动重试循环。

#### Scenario: 用户点击自动重试按钮

- **WHEN** 首次失败后用户点击"自动重试"按钮
- **THEN** 前端调用 `retryFailedRound(conversationId, memberId, roundId)`
- **AND** 后端 `retry_failed_round` 检查 `snapshot.status != "running"` 通过
- **AND** 重置消息内容 + `spawn_stream_task(auto_retry_enabled = true)`
- **AND** 自动重试循环中失败后 sleep 1 秒 + continue（现有行为）
- **AND** 每次 retry emit `llm-stream-retry`（携带 `auto_retry_enabled = true`）+ 广播 `StreamRetry`（携带 `auto_retry_enabled = true`）
- **AND** 前端收到事件后 `setReplyStatus('connecting')` + `isStreaming = true` + 显示"自动重试中"提示 + "停止"按钮

### Requirement: 自动重试中用户可停止

系统 SHALL 在自动重试执行期间允许用户点击"停止流式传输"中止重试循环。

#### Scenario: 自动重试中用户点击停止

- **WHEN** 自动重试循环进行中（`auto_retry_enabled = true`）
- **AND** 用户点击"停止"按钮 → `handleAbortReply` → `abortRoundStream`
- **THEN** 后端 `abort_round_stream` → `RoundRepository::mark_aborted` + `RetrySnapshotRepository::mark_aborted`
- **AND** `spawn_stream_task` loop 中 `is_round_aborted` 检测到 aborted → break
- **AND** 前端收到 `llm-stream-error` / `llm-stream-end` 后清除 `retryNotice` + `setReplyStatus('idle')`

### Requirement: 房客被动接收重试状态

系统 SHALL 在多人模式下向房客广播重试事件，房客根据 `auto_retry_enabled` 字段显示对应状态（无操作按钮）。

#### Scenario: 房客收到首次失败通知

- **WHEN** 房主首次发送失败，房客收到 `room:stream_retry`（`autoRetryEnabled = false`）
- **THEN** 房客清空消息内容 + `isStreaming = false` + 显示"发送失败"提示（无按钮）
- **AND** `setReplyStatus('idle')`

#### Scenario: 房客收到自动重试中通知

- **WHEN** 房主点击"自动重试"后循环重试，房客收到 `room:stream_retry`（`autoRetryEnabled = true`）
- **THEN** 房客清空消息内容 + `isStreaming = true` + 显示"自动重试中"提示（无按钮）
- **AND** `setReplyStatus('connecting')`

#### Scenario: 房主停止后房客收到结束通知

- **WHEN** 房主点击"停止"后，房客收到 `room:stream_end`
- **THEN** 房客 `isStreaming = false` + 清除 `retryNotice` + `setReplyStatus('idle')`

## MODIFIED Requirements

### Requirement: 自动重试循环（来自 fix-retry-failed-round-logic）

原 spec 规定 `spawn_stream_task` 的 loop 在失败后自动 continue 重试。修改为：loop 行为由 `auto_retry_enabled` 参数控制——`false` 时首次失败 break 等待用户操作；`true` 时保持现有自动 continue 行为。`retry_failed_round` 是唯一以 `auto_retry_enabled = true` 调用 `spawn_stream_task` 的入口。

### Requirement: 房间重试事件广播（来自 fix-multiplayer-retry-stream-desync）

原 spec 规定 `StreamRetry` 房间消息携带 `conversation_id` / `round_id` / `message_id` / `error` / `attempt_count`。修改为：新增 `auto_retry_enabled: bool` 字段，让房客前端区分"首次失败"与"自动重试中"两种状态。

### Requirement: 重试通知 UI（来自 App.tsx 现有实现）

原 `retryNotice` 信号 4 秒后自动消失，统一显示"自动重试中"。修改为：`retryNotice` 信号包含 `autoRetryEnabled` 和 `roundId` 字段，不再自动消失，根据 `autoRetryEnabled` 显示不同标题和操作按钮。需在成功 / 错误 / 切换会话 / 发送新消息时手动清除。

## REMOVED Requirements

（无移除项）

# 多人模式重试流内容失同步修复 Spec

## Why

项目在某次提交中引入了无状态模式（stateless）、传统模式（legacy）与 MEM0 模式（mem0）三种记忆架构。用户怀疑多人模式（online）在该提交后无法运行。

经地毯式审阅三人模式 × online 交叉路径，**核心路径在三种模式下均能正常运行**（聚合内容构建、MultiplayerProtocol 注入、历史加载、mem0 检索/抽取、剧情总结、流处理统一路径均正确）。但在**错误重试路径**上发现一个真实缺陷：自动重试（`spawn_stream_task` 循环）与手动重试/重新生成（`retry_failed_round` / `regenerate_round`）发出的 `llm-stream-retry` 和 `message_reset` 事件仅通过 `app.emit` 发送到房主前端，**不广播到房间 TCP 客户端**。

房客客户端通过 `listenRoomStreamChunk` 以**追加**方式累积流式文本（`content: ${message.content}${payload.delta}`）。当房主重试时：
1. 房主收到 `llm-stream-retry` → 清空消息内容为 `''`
2. 房主后端重置 DB `messages.content = ''`
3. 房客**收不到任何重试/重置通知** → 保留旧的部分内容
4. 新一轮流式开始 → 新 chunk 广播到房客 → 房客执行 `旧部分内容 + 新完整内容` → **内容错乱**

此缺陷影响所有三种模式（重试路径与 `memory_mode` 无关），且影响自动重试与手动重试/重新生成两条路径。

## What Changes

- **新增 `StreamRetry` 与 `MessageReset` 房间广播消息类型**：在 `RoomMessage` enum 中新增两个 variant，用于向房间 TCP 客户端广播重试与消息重置事件。
- **自动重试循环广播重试事件**：`spawn_stream_task` 的重试分支在发射 `llm-stream-retry` 后，同步广播 `StreamRetry` 到房间客户端。
- **手动重试/重新生成广播重置事件**：`retry_failed_round` 和 `regenerate_round` 中的 `emit_message_reset_event` 调用后，同步广播 `MessageReset` 到房间客户端。
- **房客前端处理重试/重置事件**：`backend.ts` 新增 `listenRoomStreamRetry` 和 `listenRoomMessageReset` 监听器；`App.tsx` 注册监听，收到事件时清空对应消息内容并重置流式状态。
- **移动端不在本次范围**：移动端多人房间功能尚未实现（`src-mobile/App.tsx:210` 显示"开发中"），本次仅修复 PC 端。

## Impact

- Affected specs:
  - `implement-multiplayer-room-mode` — 房间数据实时同步需求扩展（新增重试/重置同步）
  - `fix-retry-failed-round-logic` — 自动重试功能在 online 模式下的广播补全
- Affected code:
  - `src-tauri/src/network/mod.rs` — `RoomMessage` enum 新增 `StreamRetry`、`MessageReset` variant，新增对应 flat payload 结构
  - `src-tauri/src/services/stream_processor.rs` — `spawn_stream_task` 重试分支新增房间广播
  - `src-tauri/src/services/chat_service.rs` — `retry_failed_round`、`regenerate_round` 中 `emit_message_reset_event` 后新增房间广播；新增广播辅助函数
  - `src/lib/backend.ts` — 新增 `RoomStreamRetryEvent`、`RoomMessageResetEvent` 类型与 `listenRoomStreamRetry`、`listenRoomMessageReset` 函数
  - `src/App.tsx` — 注册 `listenRoomStreamRetry`、`listenRoomMessageReset`，重置消息内容与流式状态

## 审计结论（无 breakage 的核心路径）

以下路径经审阅确认在三种模式 × online 下均正确工作，**本次不修改**：

| 路径 | 说明 |
|------|------|
| `build_aggregated_user_content` | 三种模式 + online 下均正确调用，与 `memory_mode` 解耦 |
| `MultiplayerProtocol` 系统块 | 三种模式 + online 下均注入且 `required: true` 不被预算裁剪 |
| `load_recent_history_blocks` | legacy/stateless + online 正确加载聚合历史；mem0 + online 按设计跳过历史 |
| `load_retrieved_detail_blocks`（mem0 search） | online 下按会话级聚合检索，与设计一致 |
| `run_memory_extraction_task`（mem0 add） | online 下按会话级聚合抽取，与设计一致 |
| `request_ai_plot_summary`（仅 legacy） | online + legacy 下正确处理聚合内容 |
| `spawn_post_round_tasks` | 三模式分支正确，与 `conversation_type` 无关 |
| `emit_round_state` / `broadcast_room_player_message` | 三种模式下均正确广播 |
| `flush_text_delta_event` → `StreamChunk` 广播 | 已正确广播到房间 TCP 客户端 |

## 设计性后果（非 bug，本次不修改）

以下为三模式引入后的设计性后果，需用户确认是否后续处理：

1. **mem0 + online 不加载历史**：mem0 模式下 `history_blocks = Vec::new()`，多人对话连贯性依赖 mem0 检索质量与开场白。
2. **mem0 + online 无 per-player 记忆隔离**：所有玩家共享同一会话级记忆池，记忆按聚合内容存取。
3. **mem0 检索失败硬终止轮次**：`load_retrieved_detail_blocks` 全策略失败时返回 `Err`，触发 `spawn_stream_task` 立即终止重试，多人轮次直接失败需手动 abort。此为 `enforce-mem0-zero-fallback` spec 的既定设计。

---

## ADDED Requirements

### Requirement: 房间重试事件广播

系统 SHALL 在自动重试循环中向房间 TCP 客户端广播重试事件，使房客客户端能同步清空消息内容并显示重试状态。

#### Scenario: 自动重试触发时房客收到通知

- **WHEN** `spawn_stream_task` 重试循环决定重试（`mark_failed` 后）
- **THEN** 除现有 `app.emit("llm-stream-retry")` 外，系统通过 `host_server.broadcast_message` 广播 `RoomMessage::StreamRetry { conversation_id, round_id, message_id, error }` 到所有 TCP 客户端
- **AND** 房客前端收到 `room-stream-retry` 事件后清空对应 `messageId` 的内容为 `''`，设置 `isStreaming: true`

#### Scenario: 手动重试/重新生成时房客收到重置通知

- **WHEN** `retry_failed_round` 或 `regenerate_round` 调用 `emit_message_reset_event`
- **THEN** 除现有 `app.emit` 外，系统通过 `host_server.broadcast_message` 广播 `RoomMessage::MessageReset { conversation_id, round_id, message_id }` 到所有 TCP 客户端
- **AND** 房客前端收到 `room-message-reset` 事件后清空对应 `messageId` 的内容为 `''`

#### Scenario: 房主不受重复事件影响

- **WHEN** 房主前端同时收到 `llm-stream-retry`（Tauri 事件）和 `room-stream-retry`（TCP 事件）
- **THEN** 房主前端忽略 `room-stream-retry` 事件（与现有 `listenRoomStreamChunk` 中 `if !activeRoomClientSession() return` 一致的房主跳过逻辑）

#### Scenario: 无房间时静默跳过广播

- **WHEN** 会话 `conversation_type = "single"` 或 `host_server = None`
- **THEN** 广播逻辑跳过（`host_server` 锁获取后为 `None`），不影响单人模式

### Requirement: 房客前端重试/重置事件处理

系统 SHALL 在 PC 端房客前端注册房间重试与消息重置事件监听器，正确清空消息内容以避免流式内容错乱。

#### Scenario: 房客收到重试事件

- **WHEN** 房客前端收到 `room-stream-retry` 事件且 `payload.conversationId === selectedConversationId()`
- **AND** 当前为房客会话（`activeRoomClientSession()` 为真）
- **THEN** 调用 `upsertStreamingAssistant(payload.messageId, payload.roundId)` 确保消息存在
- **AND** 调用 `updateMessageContent(payload.messageId, () => ({ content: '', isStreaming: true }))` 清空内容

#### Scenario: 房客收到消息重置事件

- **WHEN** 房客前端收到 `room-message-reset` 事件且 `payload.conversationId === selectedConversationId()`
- **AND** 当前为房客会话
- **THEN** 调用 `updateMessageContent(payload.messageId, () => ({ content: '', isStreaming: true }))` 清空内容

## MODIFIED Requirements

### Requirement: 房间数据实时同步（来自 implement-multiplayer-room-mode）

原 spec 规定"AI 流式输出同步：每个流式 chunk 实时广播到所有客户端"。修改为：除流式 chunk 外，**重试事件与消息重置事件也必须实时广播到所有客户端**，以确保房客客户端在重试期间内容状态与房主一致。

### Requirement: 自动重试（来自 fix-retry-failed-round-logic）

原 spec 规定自动重试通过 `llm-stream-retry` 事件通知前端。修改为：在 online 模式下，重试事件必须同时通过 TCP 广播到房间客户端，房客前端收到后清空消息内容，避免新一轮流式 chunk 追加到旧的部分内容上。

## REMOVED Requirements

（无移除项）

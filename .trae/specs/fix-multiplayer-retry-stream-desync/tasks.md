# Tasks

- [x] Task 1: 后端新增 RoomMessage 广播 variant 与 payload 结构
  - [x] SubTask 1.1: 在 `src-tauri/src/network/mod.rs` 的 `RoomMessage` enum 中新增 `StreamRetry { conversation_id, round_id, message_id, error }` variant
  - [x] SubTask 1.2: 在 `src-tauri/src/network/mod.rs` 的 `RoomMessage` enum 中新增 `MessageReset { conversation_id, round_id, message_id }` variant
  - [x] SubTask 1.3: 新增 `RoomStreamRetryPayload`、`RoomMessageResetPayload` flat 结构（`#[serde(rename_all = "camelCase")]`），用于 Tauri 事件发射
  - [x] SubTask 1.4: 在 `network/mod.rs` 的 `event_name()` 与 `event_payload()` 中补充 `room:stream_retry` 和 `room:message_reset` 的 Tauri event 转发（注：转发机制在 network/mod.rs 而非 rooms.rs，rooms.rs 仅负责构造广播消息）

- [x] Task 2: 后端自动重试循环广播 StreamRetry
  - [x] SubTask 2.1: 在 `src-tauri/src/services/stream_processor.rs` 的 `spawn_stream_task` 重试分支（`app.emit("llm-stream-retry")` 之后），新增异步 spawn 调用 `host_server.broadcast_message(&RoomMessage::StreamRetry { ... })`
  - [x] SubTask 2.2: 广播逻辑参考现有 `flush_text_delta_event` 中的 TCP 广播模式（`app.state::<AppState>().host_server.lock()` → `server.lock()` → `broadcast_message`）
  - [x] SubTask 2.3: 确保 `host_server = None` 时静默跳过，不影响单人模式

- [x] Task 3: 后端手动重试/重新生成广播 MessageReset
  - [x] SubTask 3.1: 在 `src-tauri/src/services/chat_service.rs` 中新增辅助函数 `broadcast_room_message_reset(&app, conversation_id, round_id, message_id)`，参考现有 `broadcast_room_player_message` 模式
  - [x] SubTask 3.2: 在 `retry_failed_round` 的 `emit_message_reset_event` 调用后，调用 `broadcast_room_message_reset`
  - [x] SubTask 3.3: `regenerate_round` 经确认不调用 `emit_message_reset_event`（它创建新 swipe 消息而非重置内容），无需添加广播

- [x] Task 4: 前端新增房间重试/重置事件监听
  - [x] SubTask 4.1: 在 `src/lib/backend.ts` 新增 `RoomStreamRetryEvent`、`RoomMessageResetEvent` 接口定义
  - [x] SubTask 4.2: 在 `src/lib/backend.ts` 新增 `listenRoomStreamRetry`、`listenRoomMessageReset` 函数，监听 `room:stream_retry`、`room:message_reset` Tauri 事件
  - [x] SubTask 4.3: 在 `src/App.tsx` 的事件注册区注册 `listenRoomStreamRetry`，处理逻辑：校验 `conversationId` 与 `activeRoomClientSession()`，调用 `upsertStreamingAssistant` + `updateMessageContent` 清空内容
  - [x] SubTask 4.4: 在 `src/App.tsx` 注册 `listenRoomMessageReset`，处理逻辑：校验 `conversationId` 与 `activeRoomClientSession()`，调用 `updateMessageContent` 清空内容
  - [x] SubTask 4.5: 在 `src/App.tsx` 的 unlisten 清理区补充两个新监听器的 unlisten 调用

- [x] Task 5: 编译验证与回归检查
  - [x] SubTask 5.1: `cargo build` 确认后端编译通过（exit code 0，仅 pre-existing warnings）
  - [x] SubTask 5.2: 前端 `npx tsc --noEmit` 确认修改文件零诊断错误（pre-existing 错误均在无关文件中）
  - [x] SubTask 5.3: 确认单人模式（single）行为完全不变（`host_server = None` 路径跳过广播）

# Task Dependencies

- Task 2、Task 3 依赖 Task 1（需要 RoomMessage variant 先定义）
- Task 4 独立于后端，可与 Task 2、Task 3 并行
- Task 5 依赖 Task 1-4 全部完成

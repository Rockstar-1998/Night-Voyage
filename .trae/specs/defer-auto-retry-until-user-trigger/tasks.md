# Tasks

- [x] Task 1: 后端 `StreamRetryEvent` / `RoomMessage::StreamRetry` / `RoomStreamRetryPayload` 新增 `auto_retry_enabled` 字段
  - [x] SubTask 1.1: 修改 `src-tauri/src/models/mod.rs` 的 `StreamRetryEvent`，新增 `pub auto_retry_enabled: bool` 字段
  - [x] SubTask 1.2: 修改 `src-tauri/src/network/mod.rs` 的 `RoomMessage::StreamRetry` variant，新增 `auto_retry_enabled: bool` 字段
  - [x] SubTask 1.3: 修改 `src-tauri/src/network/mod.rs` 的 `RoomStreamRetryPayload` 结构体，新增 `pub auto_retry_enabled: bool` 字段
  - [x] SubTask 1.4: 修改 `src-tauri/src/network/mod.rs` 的 `event_payload()` 中 `StreamRetry` 分支，映射 `auto_retry_enabled` 到 payload

- [x] Task 2: 后端 `spawn_stream_task` 新增 `auto_retry_enabled` 参数 + loop 逻辑改造
  - [x] SubTask 2.1: 修改 `src-tauri/src/services/stream_processor.rs` 的 `spawn_stream_task` 签名，新增 `auto_retry_enabled: bool` 参数
  - [x] SubTask 2.2: 修改失败分支（非 abort、非确定性错误路径），emit `llm-stream-retry` 时携带 `auto_retry_enabled`
  - [x] SubTask 2.3: 修改失败分支广播 `StreamRetry` 时携带 `auto_retry_enabled`
  - [x] SubTask 2.4: 修改失败分支末尾：`auto_retry_enabled = false` 时 break loop（不 sleep、不 continue）；`auto_retry_enabled = true` 时保持现有 sleep 1 秒 + continue

- [x] Task 3: 后端 `chat_service.rs` 4 个调用点传入 `auto_retry_enabled`
  - [x] SubTask 3.1: `submit_input`（约行 529）调用 `spawn_stream_task` 传入 `false`
  - [x] SubTask 3.2: `dispatch_tool_round`（约行 689）调用 `spawn_stream_task` 传入 `false`
  - [x] SubTask 3.3: `regenerate_round`（约行 756）调用 `spawn_stream_task` 传入 `false`
  - [x] SubTask 3.4: `retry_failed_round`（约行 1054）调用 `spawn_stream_task` 传入 `true`

- [x] Task 4: 前端类型定义扩展
  - [x] SubTask 4.1: 修改 `src/lib/backend/types.ts` 的 `StreamRetryEvent`，新增 `autoRetryEnabled: boolean`
  - [x] SubTask 4.2: 修改 `src/lib/backend/types.ts` 的 `RoomStreamRetryEvent`，新增 `autoRetryEnabled: boolean`

- [x] Task 5: 前端 `retryNotice` 信号扩展 + 事件处理分流 + UI 改造
  - [x] SubTask 5.1: 修改 `src/App.tsx` 的 `retryNotice` 信号类型，新增 `autoRetryEnabled: boolean` 和 `roundId: number` 字段
  - [x] SubTask 5.2: 修改 `listenStreamRetry` 回调，根据 `payload.autoRetryEnabled` 分流
  - [x] SubTask 5.3: 修改 `listenRoomStreamRetry` 回调，房客侧根据 `payload.autoRetryEnabled` 分流
  - [x] SubTask 5.4: 修改 `retryNotice` UI，根据 `autoRetryEnabled` 显示不同标题和操作按钮
  - [x] SubTask 5.5: 在 `message_stop` case / `listenStreamError` / `listenRoomStreamEnd` 回调中添加 `setRetryNotice(null)` 清除通知
  - [x] SubTask 5.6: 在 `handleSend` 开头添加 `setRetryNotice(null)` 清除通知
  - [x] SubTask 5.7: 在切换会话的 `createEffect` 中添加 `setRetryNotice(null)` 清除通知

- [x] Task 6: 构建验证
  - [x] SubTask 6.1: `cargo build --manifest-path src-tauri/Cargo.toml` 通过（exit 0，11 个既有 warnings）
  - [x] SubTask 6.2: `npx tsc --noEmit -p tsconfig.json` 通过（5 个既有错误，无新增）

# Task Dependencies

- Task 2 依赖 Task 1（`StreamRetryEvent` 需要先有新字段才能在 emit 时携带）
- Task 3 依赖 Task 2（`spawn_stream_task` 签名需先改）
- Task 4 独立（前端类型定义）
- Task 5 依赖 Task 4（前端类型需先扩展）
- Task 6 依赖 Task 1-5 全部完成
- Task 1 + Task 4 可并行；Task 2 + Task 5 可在依赖完成后并行

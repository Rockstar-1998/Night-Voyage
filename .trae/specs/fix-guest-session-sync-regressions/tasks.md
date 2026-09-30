# Tasks

- [x] Task 1: 房客玩家角色卡绑定（前端）：让房客加入房间后正确显示选择的角色卡。
  - [x] SubTask 1.1: 修改 `src/components/JoinRoomModal.tsx` 的 `onJoined` 回调签名，传递 `selectedCharacterId` 给 `props.onJoined`
  - [x] SubTask 1.2: 修改 `src/App.tsx` 的 `RoomClientSession` 类型，新增 `playerCharacterId?: number` 字段
  - [x] SubTask 1.3: 修改 `src/App.tsx` 的 `handleRoomJoined` 接收 `selectedCharacterId`，保存到 `roomClientSession`
  - [x] SubTask 1.4: 修改 `src/App.tsx` 的 `currentPlayerCharacter()` memo，房客模式优先用 `roomClientSession().playerCharacterId` 查 `playerCharacters`，找不到再回退到 member 查找
  - [x] SubTask 1.5: 修改 `src/App.tsx` 的 `handleRoomJoined`，更新 `selectedConversationMembers` 中房客自己的 member 的 `playerCharacterId`

- [x] Task 2: retryNotice UI 房客隐藏操作按钮（前端）：房客模式下 retryNotice 仅显示状态提示，不显示"自动重试"和"停止"按钮。
  - [x] SubTask 2.1: 修改 `src/App.tsx` 的 retryNotice UI 块，外层 `<Show when={!activeRoomClientSession()}>` 包裹操作按钮区，仅状态标题和失败原因始终显示

- [x] Task 3: broadcast_stream_end 同步化（后端）：房主 abort 后房客及时收到 stream_end。
  - [x] SubTask 3.1: 修改 `src-tauri/src/services/chat_service.rs` 的 `broadcast_stream_end` 从 `pub fn` 改为 `pub async fn`，去掉 `tauri::async_runtime::spawn` 包裹，直接 `await` `broadcast_message`
  - [x] SubTask 3.2: 修改所有 `broadcast_stream_end` 调用点（在 `stream_processor.rs` 的 abort 路径和 is_round_aborted 路径），添加 `.await`

- [x] Task 4: listenRoomTokenUsage null 守卫（前端）：房客收到 null tokenUsageReport 时保持旧值，TokenIsland 不消失。
  - [x] SubTask 4.1: 修改 `src/App.tsx` 的 `listenRoomTokenUsage` 回调，当 `payload.tokenUsageReport` 为 null 时跳过 `setRoomClientSession` 更新（保持旧值）。额外修复后端 `RoomTokenUsageEvent.report` 字段名为 `token_usage_report`，与前端 `tokenUsageReport` 对齐。

- [x] Task 5: swipe 切换广播到房客（后端 + 前端）：房主切换 swipe 版本时房客同步切换。
  - [x] SubTask 5.1: 修改 `src-tauri/src/network/mod.rs` 的 `RoomMessage` enum 新增 `SwipeActivated { conversation_id: i64, round_id: i64, message_id: i64 }` variant
  - [x] SubTask 5.2: 修改 `src-tauri/src/network/mod.rs` 的 `RoomMessage::as_payload` 或序列化逻辑，确保 `SwipeActivated` 能正确序列化发送
  - [x] SubTask 5.3: 修改 `src-tauri/src/services/chat_service.rs` 的 `switch_swipe`，在 `set_active_assistant_message` 后广播 `RoomMessage::SwipeActivated { conversation_id, round_id, target_message_id }`
  - [x] SubTask 5.4: 修改 `src/lib/backend/types.ts` 新增 `RoomSwipeActivatedEvent` 接口（`{ conversationId, roundId, messageId }`）
  - [x] SubTask 5.5: 修改 `src/lib/backend/rooms.ts` 新增 `listenRoomSwipeActivated` 监听器
  - [x] SubTask 5.6: 修改 `src/App.tsx` 新增 `listenRoomSwipeActivated` 监听器，房客收到后更新对应 round 中消息的 `isActiveInRound`（旧激活 false，新激活 true）

- [x] Task 6: 构建验证：确保双端构建通过。
  - [x] SubTask 6.1: 在 `src-tauri/` 下运行 `cargo build`，确保无编译错误 — 通过（11 个既有 warning，无新增）
  - [x] SubTask 6.2: 在项目根目录运行 `npx tsc --noEmit`，确保前端无类型错误 — 5 个错误均位于 App.tsx 577-590 行 WorkspaceTransitionStage，预先存在与本次修改无关

# Task Dependencies

- Task 1, Task 2, Task 3, Task 4, Task 5 之间无强依赖，可并行实施
- Task 6 依赖 Task 1–5 全部完成
- Task 5 的后端子任务（5.1–5.3）需先于前端子任务（5.4–5.6）完成，因为前端监听事件名依赖后端定义

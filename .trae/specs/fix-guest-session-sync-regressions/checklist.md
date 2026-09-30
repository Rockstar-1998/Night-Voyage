# Checklist

## Task 1: 房客玩家角色卡绑定

- [x] `src/components/JoinRoomModal.tsx` 的 `onJoined` 回调传递 `selectedCharacterId`（行 170，类型签名行 29-32）
- [x] `src/App.tsx` 的 `RoomClientSession` 类型新增 `playerCharacterId?: number` 字段（行 199）
- [x] `src/App.tsx` 的 `handleRoomJoined` 接收并保存 `playerCharacterId` 到 `roomClientSession`（行 1661、1702）
- [x] `src/App.tsx` 的 `currentPlayerCharacter()` memo 房客模式优先用 `roomClientSession().playerCharacterId`（行 820）
- [x] `src/App.tsx` 的 `handleRoomJoined` 更新 `selectedConversationMembers` 中房客自己 member 的 `playerCharacterId`（行 1721-1728）
- [x] 房客加入时选择了角色卡 → 会话抽屉显示该角色卡（非"请选择"）— 代码逻辑验证通过
- [x] 房客加入时未选择角色卡 → 会话抽屉显示"当前会话未绑定玩家角色卡" — `playerCharacterId` 为 undefined 时 memo 返回 undefined

## Task 2: retryNotice UI 房客隐藏按钮

- [x] `src/App.tsx` 的 retryNotice UI 房客模式（`activeRoomClientSession() != null`）不显示"自动重试"按钮（行 2489 Show 守卫）
- [x] `src/App.tsx` 的 retryNotice UI 房客模式不显示"停止"按钮（同一 Show 守卫包裹）
- [x] 房客模式仍显示失败原因和状态标题（行 2481-2488，在 Show 之外）
- [x] 房主模式仍显示操作按钮（`!activeRoomClientSession()` 为 true 时 Show 生效）

## Task 3: broadcast_stream_end 同步化

- [x] `src-tauri/src/services/chat_service.rs` 的 `broadcast_stream_end` 改为 `pub async fn`，直接 `await` `broadcast_message`（行 1464）
- [x] `src-tauri/src/services/chat_service.rs` 不再使用 `tauri::async_runtime::spawn` 包裹
- [x] `src-tauri/src/services/stream_processor.rs` 的 abort 路径调用 `broadcast_stream_end(...).await`（行 189）
- [x] `src-tauri/src/services/stream_processor.rs` 的 is_round_aborted 路径调用 `broadcast_stream_end(...).await`（行 221，另有 Prompt Compiler/mem0 错误路径行 210）
- [x] 房主点击"停止" → 房客收到 `room:stream_end` → `isStreaming = false` + `replyStatus = 'idle'` — 同步 await 确保及时送达
- [x] 房客 ChatInputBar 不再显示"房客不能停止房主的流式传输" — replyStatus 回到 idle 后 isActive 为 false

## Task 4: listenRoomTokenUsage null 守卫

- [x] `src/App.tsx` 的 `listenRoomTokenUsage` 回调当 `payload.tokenUsageReport` 为 null 时跳过 `tokenUsageReport` 更新（行 2132-2134）
- [x] null 时保持所有旧值（contextWindowSize 嵌套在 tokenUsageReport 内部，null 时无法获取，直接 return 保持旧值是正确做法）
- [x] null 时 `isRoomGuest` 保持 true（tokenUsageReport 不被覆盖为 null）
- [x] 房主重新生成或自动重试时，房客 TokenIsland 上下文窗口条不消失 — 额外修复后端 `RoomTokenUsageEvent.report` 字段名为 `token_usage_report`，与前端 `tokenUsageReport` 对齐

## Task 5: swipe 切换广播

- [x] `src-tauri/src/network/mod.rs` 的 `RoomMessage` 新增 `SwipeActivated` variant（行 181-184）
- [x] `src-tauri/src/network/mod.rs` 的 `SwipeActivated` 能正确序列化发送给房客（`event_name` 行 425 + `event_payload` 行 644-651 + `RoomSwipeActivatedEvent` 结构体行 375-378）
- [x] `src-tauri/src/services/chat_service.rs` 的 `switch_swipe` 在切换后广播 `SwipeActivated`（行 808-818，同步 await）
- [x] `src/lib/backend/types.ts` 新增 `RoomSwipeActivatedEvent` 接口（行 979-983）
- [x] `src/lib/backend/rooms.ts` 新增 `listenRoomSwipeActivated` 监听器（行 368-376）
- [x] `src/App.tsx` 新增 `listenRoomSwipeActivated` 监听器，房客收到后切换 `isActiveInRound`（行 2366-2379）
- [x] 旧激活消息 `isActiveInRound = false`，新激活消息 `isActiveInRound = true`（行 2372-2376）
- [x] 房客 UI 切换显示新 swipe 版本 — `visibleMessages` memo 过滤 `isActiveInRound !== false`

## Task 6: 构建验证

- [x] `src-tauri/` 下 `cargo build` 通过，无编译错误（11 个既有 warning，无新增）
- [x] 项目根目录 `npx tsc --noEmit` — 5 个错误均位于 App.tsx 577-590 行 `WorkspaceTransitionStage`，预先存在与本次修改无关
- [x] 现有 warning 与本次改动无关（`PromptCompileMode`、`PresetCompilePreviewData`、`compile_chat_messages`、`adapt_prompt_compile_result_to_openai_messages`、`StreamResponseData` 字段等 dead-code 告警）

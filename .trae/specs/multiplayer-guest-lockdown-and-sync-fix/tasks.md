# Tasks

## 阶段 1：后端权限校验补全（C2 零回退硬性要求，先做）

- [x] Task 1: 为 `abort_round_stream` 补全 host 权限校验
  - [x] 修改 `src-tauri/src/commands/chat.rs:165-170` 的 `abort_round_stream` 命令签名，增加 `conversation_id: i64` 与 `member_id: i64` 参数
  - [x] 修改 `src-tauri/src/services/chat_service.rs:983-987` 的 `abort_round_stream` 服务方法签名，增加 `conversation_id` 与 `member_id`，并在入口调用 `ConversationRepository::ensure_member_is_host(&db, conversation_id, member_id).await?`
  - [x] 修改 `src/lib/backend/messages.ts:46-48` 的 `abortRoundStream`，补齐 `conversationId` 与 `memberId` 参数
  - [x] 修改 `src/App.tsx` 中 `handleAbortReply`（约 983-1023）的调用点，传入 `conversationId` 与 `hostMember()?.id`
  - [x] 在 `src-tauri/src/lib.rs` 确认命令注册无需改动（参数自动从 Tauri invoke 传入）
  - [x] 验证：`cargo build`（在 `src-tauri/` 下）通过；`tsc --noEmit`（在项目根）通过

- [x] Task 2: 为 `messages_delete` 补全 host 权限校验
  - [x] 修改 `src-tauri/src/commands/chat.rs:157-162` 的 `messages_delete` 命令签名，增加 `conversation_id: i64` 与 `member_id: i64` 参数
  - [x] 修改 `src-tauri/src/services/chat_service.rs:793-866` 的 `delete_message` 服务方法签名，增加 `conversation_id` 与 `member_id`，在入口调用 `ensure_member_is_host`
  - [x] 修改 `src/lib/backend/messages.ts:42-44` 的 `messagesDelete`，补齐 `conversationId` 与 `memberId` 参数
  - [x] 修改 `src/App.tsx` 中 `handleDeleteMessage`（约 1128-1161）的调用点，传入 `conversationId` 与 `hostMember()?.id`
  - [x] 验证：`cargo build` 与 `tsc --noEmit` 通过

- [x] Task 3: 为 `messages_switch_swipe` 补全 host 权限校验
  - [x] 修改 `src-tauri/src/commands/chat.rs:148-154` 的 `messages_switch_swipe` 命令签名，增加 `conversation_id: i64` 与 `member_id: i64` 参数
  - [x] 修改 `src-tauri/src/services/chat_service.rs:784-791` 的 `switch_swipe` 服务方法签名，增加 `conversation_id` 与 `member_id`，在入口调用 `ensure_member_is_host`
  - [x] 修改 `src/lib/backend/messages.ts:38-40` 的 `messagesSwitchSwipe`，补齐 `conversationId` 与 `memberId` 参数
  - [x] 修改 `src/App.tsx` 中 `handleSwitchSwipe`（约 1185-1212）的调用点，传入 `conversationId` 与 `hostMember()?.id`
  - [x] 验证：`cargo build` 与 `tsc --noEmit` 通过

- [x] Task 4: 修复 `messages_update_content` 前后端参数不匹配
  - [x] 后端 `src-tauri/src/commands/chat.rs:136-145` 已有 `conversation_id` 与 `member_id` 参数，**无需改后端**
  - [x] 修改 `src/lib/backend/messages.ts:34-36` 的 `messagesUpdateContent`，补齐 `conversationId` 与 `memberId` 参数
  - [x] 修改 `src/App.tsx:1097-1106` 的 `handleEditMessage`，传入 `selectedConversationId()` 与 `hostMember()?.id`
  - [x] 验证：`tsc --noEmit` 通过；房主实际编辑一条消息成功

- [x] Task 5: 为 `conversations_fork` 增加 online 模式拒绝
  - [x] 修改 `src-tauri/src/commands/conversations.rs:1051-1279` 的 `conversations_fork` 函数，在 `fetch_one` 取得 `conversation_type` 后立即校验：若为 `'online'`，返回 `Err("不支持对多人房间会话执行分支操作".to_string())`
  - [x] 验证：`cargo build` 通过

## 阶段 2：前端房客操作按钮锁定

- [x] Task 6: `MessageItem.tsx` 房客隐藏所有消息操作按钮
  - [x] 在 `src/components/MessageItem.tsx` 顶部新增 `props.isOnline?: boolean`（若尚不存在）
  - [x] 修改 swipe 切换按钮（行 233-251）：`<Show when={props.message.sender === 'ai' && props.swipeInfo && props.swipeInfo!.total > 1 && !props.isRoomClient}>`
  - [x] 修改 user 消息编辑按钮（行 260-269）：增加 `&& !props.isRoomClient` 条件
  - [x] 修改 user 消息分支按钮（行 270-276）：增加 `&& !props.isRoomClient && !props.isOnline` 条件（房客隐藏 + online 隐藏）
  - [x] 修改 user 消息删除按钮（行 277-287）：增加 `&& !props.isRoomClient` 条件
  - [x] 修改 AI 消息编辑按钮（行 290-299）：增加 `&& !props.isRoomClient` 条件
  - [x] 修改 AI 消息重新生成按钮（行 300-306）：增加 `&& !props.isRoomClient` 条件
  - [x] 修改 AI 消息分支按钮（行 307-313）：增加 `&& !props.isRoomClient && !props.isOnline` 条件
  - [x] 修改 AI 消息删除按钮（行 314-324）：增加 `&& !props.isRoomClient` 条件
  - [x] 修改 `src/components/ChatArea.tsx` 中 `<MessageItem>` 调用处，传入 `isOnline={selectedConversation()?.conversationType === 'online'}`
  - [x] 验证：`tsc --noEmit` 通过；房客模式下 hover 消息无任何操作按钮显示；房主在 online 模式下无分支按钮；单人模式按钮全保留

- [x] Task 7: `ChatInputBar.tsx` 房客禁用停止生成
  - [x] 在 `src/components/ChatInputBar.tsx` 的 props 中新增 `isRoomClient?: boolean`（若尚不存在）
  - [x] 修改"停止生成"按钮（约 101-110）：当 `props.isRoomClient === true` 且 `replyStatus === 'streaming'` 时，按钮 `disabled` 属性为 true，并加 `title="房客不能停止房主的流式传输"`
  - [x] 修改 `src/App.tsx` 中 `<ChatInputBar>` 调用处，传入 `isRoomClient={activeRoomClientSession() !== null}`
  - [x] 验证：`tsc --noEmit` 通过；房客在流式传输中"停止生成"按钮置灰不可点；房主与单人模式不受影响

- [x] Task 8: `App.tsx` `handleForkMessage` online 兜底
  - [x] 修改 `src/App.tsx:1108-1126` 的 `handleForkMessage`，在函数入口增加 `if (selectedConversation()?.conversationType === 'online') return;`
  - [x] 验证：`tsc --noEmit` 通过

## 阶段 3：房客同步 DEBUG 日志（前后端）

- [x] Task 9: `rooms.ts` 所有 `listenRoom*` 函数加 `console.debug`
  - [x] 修改 `src/lib/backend/rooms.ts:112-175` 的所有 `listenRoom*` 函数，在 `listen<T>(event, (event) => handler(event.payload))` 回调入口加 `console.debug('[room:xxx]', payload)`，xxx 为事件名
  - [x] 高频事件 `listenRoomStreamChunk` 仅打印 `conversationId` / `messageId` / `delta.length`，不打印完整 delta
  - [x] 验证：`tsc --noEmit` 通过；浏览器控制台可看到 `[room:xxx]` 前缀日志

- [x] Task 10: `App.tsx` 所有 `room:*` 监听器加状态变更日志
  - [x] 修改 `src/App.tsx` 中所有 `room:*` 监听器（`listenRoomStreamChunk` 1773-1782 / `listenRoomStreamEnd` 1784-1792 / `listenRoomStreamRetry` 1794-1803 / `listenRoomMessageReset` 1805-1814 / `listenRoomContextSnapshot` 1816-1838 / `listenRoomRoundStateUpdate` 1840-1843 / `listenRoomPlayerMessage` 1845-1868 / `listenRoomMemberJoined` 1880-1913 / `listenRoomMemberLeft` 1915-1934 / `listenRoomDisconnected` 1875-1877 / `listenRoomError` 1870-1873）
  - [x] 每个监听器在执行 `setMessages` / `setCurrentRoundState` / `setSelectedConversationMembers` / `setRoomClientSession` 前后打印 `console.debug` 日志，标注变更前后的关键值（如 `messages.length` / `roundState.status` / `members.length` / `roomClientSession?.conversation.id`）
  - [x] 高频 `listenRoomStreamChunk` 仅打印关键索引，不打印完整内容
  - [x] 验证：`tsc --noEmit` 通过；房客加入房间、收发消息、断连全流程日志可追溯

- [x] Task 11: `network/mod.rs` `RoomClient` 全链路 `eprintln!`
  - [x] 修改 `src-tauri/src/network/mod.rs` 的 `RoomClient` 实现（行 1093-1256）：
    - `connect`（1121-1239）：开始时打印 `[room-client] connecting to host_address:port`；成功时打印 `[room-client] connected, room_id=X, member_id=Y, messages=N, members=M`；失败时打印 `[room-client] connect error: ...`；超时打印 `[room-client] connect timeout`
    - `send_message`（1241-1247）：发送前打印 `[room-client] sending frame: type=...`；发送后打印 `[room-client] frame sent`
    - `disconnect`（1249-1256）：开始打印 `[room-client] disconnecting`；完成打印 `[room-client] disconnected`
    - 读循环（1203-1234）：现有 `[room-client] received message: type=...`（行 1209）保留；`Ok(None)` 分支打印 `[room-client] peer closed connection`；`Err(e)` 分支打印 `[room-client] read error: ...`
  - [x] 验证：`cargo build` 通过；房客加入时 stderr 可看到完整连接生命周期日志

- [x] Task 12: `handleRoomJoined` 成功路径加日志
  - [x] 修改 `src/App.tsx:1497-1533` 的 `handleRoomJoined`，在成功填充 `RoomClientSession` 后打印 `console.debug('[room:joined]', { conversationId, memberId, messageCount, memberCount, hasHostCharacter })`
  - [x] 验证：`tsc --noEmit` 通过；房客加入后控制台可看到 `[room:joined]` 日志

## 阶段 4：房客断连信号全量清理

- [x] Task 13: `listenRoomDisconnected` 强化清理
  - [x] 修改 `src/App.tsx:1875-1877` 的 `listenRoomDisconnected` 回调，在 `setRoomClientSession(null)` 之后增加：
    - `setMessages([])`
    - `setSelectedConversationMembers([])`
    - `setCurrentRoundState(null)`
  - [x] 打印 `console.debug('[room:disconnected] cleared signals: messages, members, roundState')`
  - [x] 验证：`tsc --noEmit` 通过；房客 TCP 断开后 UI 上消息列表、成员列表、轮次状态全部清空

## 阶段 5：构建验证与验收

- [x] Task 14: 双端构建验证
  - [x] 在 `src-tauri/` 下运行 `cargo build`，贴出真实输出
  - [x] 在项目根运行 `npm run build`（PC 前端），贴出真实输出
  - [x] 在项目根运行 `tsc --noEmit`，贴出真实输出
  - [x] 若有错误，修复后重新运行

- [x] Task 15: Walkthrough 文档与提交
  - [x] 在 `Walkthrough/` 目录新建 `YYYYMMDD-HHmm-multiplayer-guest-lockdown-and-sync-fix-修改.md` 文件
  - [x] 包含改动摘要、改动动机、约束合规审计表（C1-C7）、验收记录（构建命令输出）、已知限制
  - [ ] 提交并推送（按 git-commit-message 规则）

# Task Dependencies

- Task 6 / Task 7 / Task 8 依赖 Task 1-5 完成（前端调用需匹配新签名）
- Task 9-12（日志）相互独立，可并行
- Task 13 依赖 Task 10（监听器已加日志后再强化清理逻辑）
- Task 14 依赖所有前置任务完成
- Task 15 依赖 Task 14 通过

# 并行化建议

- 阶段 1 的 Task 1-5 可并行（5 个独立命令的签名修改）
- 阶段 3 的 Task 9-12 可并行（前端 rooms.ts / App.tsx / 后端 network / handleRoomJoined 互不依赖）

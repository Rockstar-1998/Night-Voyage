# Checklist

## 阶段 1：后端权限校验补全

- [x] `abort_round_stream` 命令签名扩展为 `(conversation_id, member_id, round_id)`，服务方法入口调用 `ensure_member_is_host`
- [x] `messages_delete` 命令签名扩展为 `(conversation_id, member_id, message_id)`，服务方法入口调用 `ensure_member_is_host`
- [x] `messages_switch_swipe` 命令签名扩展为 `(conversation_id, member_id, round_id, target_message_id)`，服务方法入口调用 `ensure_member_is_host`
- [x] `messages_update_content` 前端 `messagesUpdateContent` 与 `handleEditMessage` 补齐 `conversationId` 与 `memberId` 参数，与后端签名对齐
- [x] `conversations_fork` 在 `conversation_type = 'online'` 时返回错误 `"不支持对多人房间会话执行分支操作"`
- [x] 房客调用 `abort_round_stream` / `messages_delete` / `messages_switch_swipe` / `messages_update_content` 时后端返回 `"权限不足：只有房主可以执行此操作"`
- [x] 房主调用上述命令行为保持现状（除 fork 在 online 下被拒绝）
- [x] 单人会话下所有命令行为完全不变

## 阶段 2：前端房客操作按钮锁定

- [x] `MessageItem.tsx` 中 11 个操作按钮（user 编辑 / user 分支 / user 删除 / AI 编辑 / AI 重新生成 / AI 分支 / AI 删除 / swipe 上一版本 / swipe 下一版本）在 `isRoomClient === true` 时全部隐藏
- [x] "自动重试"按钮对房客保持隐藏（现状）
- [x] `MessageItem.tsx` 中 user 分支与 AI 分支按钮在 `isOnline === true` 时对房主也隐藏
- [x] `ChatInputBar.tsx` 中"停止生成"按钮在 `isRoomClient === true && replyStatus === 'streaming'` 时 `disabled`
- [x] 房客的"发送"与"放弃发言"按钮保持可用
- [x] 房客无法进入消息编辑态（`setIsEditing(true)` 不被触发）
- [x] 房主在 online 模式下保留编辑 / 重新生成 / 删除 / swipe / 自动重试按钮
- [x] 单人模式下所有按钮行为完全不变

## 阶段 3：房客同步 DEBUG 日志

- [x] `src/lib/backend/rooms.ts` 所有 `listenRoom*` 函数在收到事件时打印 `[room:xxx]` 前缀的 `console.debug`
- [x] `listenRoomStreamChunk` 仅打印 `conversationId` / `messageId` / `delta.length`，不打印完整 delta
- [x] `src/App.tsx` 所有 `room:*` 监听器在状态变更（`setMessages` / `setCurrentRoundState` / `setSelectedConversationMembers` / `setRoomClientSession`）前后打印 `console.debug`
- [x] `src-tauri/src/network/mod.rs` `RoomClient::connect` 打印开始 / 成功 / 失败 / 超时日志（`[room-client]` 前缀）
- [x] `src-tauri/src/network/mod.rs` `RoomClient::send_message` 打印发送前 / 发送后日志
- [x] `src-tauri/src/network/mod.rs` `RoomClient::disconnect` 打印开始 / 完成日志
- [x] `src-tauri/src/network/mod.rs` 读循环 `Ok(None)` 与 `Err(e)` 分支打印日志
- [x] `handleRoomJoined` 成功路径打印 `[room:joined]` 日志，包含 `conversationId` / `memberId` / `messageCount` / `memberCount` / `hasHostCharacter`
- [x] 日志不影响流式性能（高频事件只打印必要字段）

## 阶段 4：房客断连信号全量清理

- [x] `listenRoomDisconnected` 回调在 `setRoomClientSession(null)` 之后同步清理 `setMessages([])` / `setSelectedConversationMembers([])` / `setCurrentRoundState(null)`
- [x] 房客 TCP 断开后 UI 上消息列表、成员列表、轮次状态全部清空
- [x] 房客重新连接后 `handleRoomJoined` 全量覆盖信号，无残留数据混淆
- [x] 房客主动 `roomLeave` 后行为与 TCP 断开一致（保持现状）

## 阶段 5：构建验证与验收

- [x] `cargo build`（在 `src-tauri/` 下）真实输出贴出，无错误
- [x] `npm run build`（PC 前端）真实输出贴出，无错误
- [x] `tsc --noEmit` 真实输出贴出，无错误
- [x] Walkthrough 文件已创建（`Walkthrough/YYYYMMDD-HHmm-multiplayer-guest-lockdown-and-sync-fix-修改.md`）
- [x] 约束合规审计表（C1-C7）已填写，无 × 项（或 × 项有用户批准记录）
- [x] 已知限制列表已列出（如移动端不在本次范围）
- [ ] 提交信息使用 Walkthrough 内容（首行 `[修改] 主题`，正文含审计表）— 待用户确认是否提交

## 整体合规检查

- [x] C1 Frontend Render-Only：前端仅渲染，权限判断与日志输出不影响后端职责
- [x] C2 Zero-Fallback Errors：所有权限拒绝显式报错，无静默成功
- [x] C3 Responsiveness：日志不阻塞 UI 线程，高频事件日志仅打印必要字段
- [x] C4 AI UI Isolation：本次改动不涉及 AI 渲染层
- [x] C5 Mobile Frontend Independence：本次仅改 PC 端 `src/` 与共享后端，不动 `src-mobile/`
- [x] C6 Project Cache Location：本次改动不涉及缓存路径
- [x] C7 PC/Android Coverage：移动端多人房间功能尚未实现，本次保留扩展空间（后端权限校验对两端均生效）

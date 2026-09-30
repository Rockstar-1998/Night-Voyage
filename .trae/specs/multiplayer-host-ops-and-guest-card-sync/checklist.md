# Checklist

## RoomMessage 枚举与事件名
- [x] `RoomMessage::MessageEdited` 变体已定义，字段为 `conversation_id` / `message_id` / `content`，`event_name()` 返回 `"room:message_edited"`
- [x] `RoomMessage::MessageDeleted` 变体已定义，字段为 `conversation_id` / `message_id` / `round_deleted`，`event_name()` 返回 `"room:message_deleted"`
- [x] `RoomMessage::RewoundToRound` 变体已定义，字段为 `conversation_id` / `target_round_id`，`event_name()` 返回 `"room:rewound_to_round"`
- [x] `RoomMessage::ContextWindowChanged` 变体已定义，字段为 `conversation_id` / `context_window_size`，`event_name()` 返回 `"room:context_window_changed"`
- [x] `RoomMessage::GuestCharacterUpdated` 变体已定义，字段为 `conversation_id` / `member_id` / `character`，`event_name()` 返回 `"room:guest_character_updated"`

## 房主编辑消息同步
- [x] `update_message_content` 在 DB 更新成功后调用 `broadcast_message` 广播 `MessageEdited`
- [x] 广播仅在 `host_server` 为 `Some` 时触发（单人模式不广播）
- [x] 房客侧 `listenRoomMessageEdited` 监听器已注册
- [x] 房客收到事件后按 `messageId` 替换 `messages()` 中对应消息的 `content`，清空 `contentParts`
- [x] `conversationId` 不匹配时 `return`，不静默应用错误数据

## 房主删除消息同步
- [x] `delete_message` 在 DB 删除成功后调用 `broadcast_message` 广播 `MessageDeleted`
- [x] `round_deleted` 字段正确标识是否连带删除了整个 round（`delete_round_completely` 被调用时为 true）
- [x] 房客侧 `listenRoomMessageDeleted` 监听器已注册
- [x] 房客收到事件后移除 `messageId`；若 `roundDeleted` 为真，移除同 round 全部消息

## 房主回溯对话同步
- [x] `rewind_to_round` 在 `reset_to_collecting` 成功后广播 `RewoundToRound`
- [x] 同时广播 `RoundStateUpdate` 让房客拿到目标 round 回到 collecting 的新状态
- [x] 房客侧 `listenRoomRewoundToRound` 监听器已注册
- [x] 房客收到后移除 `round_id > target_round_id` 的所有消息
- [x] 房客 `currentRoundState` 更新为目标 round 的 collecting 状态

## 房主设置上下文窗口条同步
- [x] `update_conversation_context_window` 在 DB 更新成功后广播 `ContextWindowChanged`
- [x] 房客侧 `listenRoomContextWindowChanged` 监听器已注册
- [x] 房客收到后更新 `roomClientSession().contextWindowSize`
- [x] 房客 TokenIsland 立即反映新窗口大小（无需手动刷新）

## 房主重新生成补广播 MessageReset
- [x] `regenerate_round` 在清空 AI 消息 content 后、开始新流式输出前调用 `broadcast_room_message_reset`
- [x] 房客侧已有的 `listenRoomMessageReset` 监听器能正确清空该 round 的 AI 消息旧内容
- [x] 清空后房客能正常接收新的 `room:stream_chunk` 追加新内容
- [x] 单人模式重新生成不广播（RoomServer 不存在）

## 房客运行期更新人设卡
- [x] `room_update_guest_character` Tauri 命令已注册
- [x] 命令校验 `character` 序列化后不超过 256KB
- [x] `conversation_repository.update_guest_character_json` 方法已实现
- [x] `ConversationRepository::ensure_member_is_host` **未**被调用（房客可更新自己的卡，非 host 专属操作）
- [x] `handleSwitchPlayerCharacter` 在 `activeRoomClientSession()` 存在时调用 `roomUpdateGuestCharacter` 而非 `conversationMembersUpdate`
- [x] 房客传入的 `character` 从 `playerCharacters()` 列表取出选中卡的 name / description / tags / baseSections
- [x] 房主侧 `listenRoomGuestCharacterUpdated` 监听器已注册
- [x] 房主收到后更新 `selectedConversationMembers` 中对应 member 的 `guestCharacterJson`
- [x] 单人模式切换角色卡走原 `conversationMembersUpdate` 路径，行为不变

## 房客→房主转发链路（TCP 上行）
- [x] `RoomMessage::UpdateGuestCharacter` 变体已定义（房客→房主上行消息，不同于 `GuestCharacterUpdated` 下行广播）
- [x] `room_update_guest_character` 命令在房客模式（`room_client` 存在）时通过 `RoomClient::send_message` 发送 `UpdateGuestCharacter` 给房主
- [x] `room_update_guest_character` 命令在房主模式（`host_server` 存在）时直接更新 DB + 广播 `GuestCharacterUpdated`（兜底）
- [x] RoomServer read loop 收到 `UpdateGuestCharacter` 后更新房主 DB 的 `guest_character_json` 并广播 `GuestCharacterUpdated` 给所有房客

## 约束合规
- [x] C1 Frontend Render-Only：所有广播逻辑在后端，前端仅监听与渲染
- [x] C2 Zero-Fallback Errors：广播失败 `eprintln!` 记录但不影响房主操作（best-effort，房主是真相源）；房客监听器 conversationId 不匹配时 `return`
- [x] C3 Responsiveness：所有广播均为低频用户操作，不在流式 chunk 高频路径
- [x] C5 Mobile Frontend Independence：仅修改 `src/` 与共享后端，不动 `src-mobile/`
- [x] C7 PC/Android Coverage：后端命令共享，PC 端先实现，移动端多人房间实现时接入

## 构建验证
- [x] `cargo build --manifest-path src-tauri/Cargo.toml` 通过
- [x] `npx tsc --noEmit` 通过（不含既有基线错误）

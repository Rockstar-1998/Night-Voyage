# Tasks

- [x] Task 1: 后端 RoomMessage 枚举新增 5 个变体
  - [x] SubTask 1.1: 在 `src-tauri/src/network/mod.rs` 的 `RoomMessage` 枚举新增 `MessageEdited { conversation_id, message_id, content }`，`event_name()` 返回 `"room:message_edited"`
  - [x] SubTask 1.2: 新增 `MessageDeleted { conversation_id, message_id, round_deleted }`，`event_name()` 返回 `"room:message_deleted"`
  - [x] SubTask 1.3: 新增 `RewoundToRound { conversation_id, target_round_id }`，`event_name()` 返回 `"room:rewound_to_round"`
  - [x] SubTask 1.4: 新增 `ContextWindowChanged { conversation_id, context_window_size }`，`event_name()` 返回 `"room:context_window_changed"`
  - [x] SubTask 1.5: 新增 `GuestCharacterUpdated { conversation_id, member_id, character }`，`event_name()` 返回 `"room:guest_character_updated"`

- [x] Task 2: 后端 chat_service 补广播（编辑/删除/回溯/重新生成）
  - [x] SubTask 2.1: `update_message_content`（`chat_service.rs:772`）在 `MessageRepository::update_content_parts_text` 成功后，获取 `app.handle()` 的 `host_server`，广播 `MessageEdited`
  - [x] SubTask 2.2: `delete_message`（`chat_service.rs:797`）在方法末尾返回前，广播 `MessageDeleted`，`round_deleted` 标识是否调用了 `delete_round_completely`
  - [x] SubTask 2.3: `rewind_to_round`（`chat_service.rs:937`）在 `reset_to_collecting` 成功后，广播 `RewoundToRound`；同时广播 `RoundStateUpdate` 让房客拿到目标 round 的新状态
  - [x] SubTask 2.4: `regenerate_round` 在清空 AI 消息 content 后、开始新流式输出前，调用 `broadcast_room_message_reset(app, conversation_id, round_id)` 补一次 MessageReset 广播
  - [x] 备注：所有广播通过 `app.handle()` 获取 `AppState.host_server`，仅在 `Some(server)` 时广播；广播失败 `eprintln!` 记录但不影响房主本地操作结果（best-effort）

- [x] Task 3: 后端 conversations.rs 补广播（上下文窗口）
  - [x] SubTask 3.1: `update_conversation_context_window`（`commands/conversations.rs`）在 DB 更新成功后，获取 `host_server` 广播 `ContextWindowChanged`
  - [x] 备注：需要 `app: AppHandle` 参数（若签名中没有则补齐）

- [x] Task 4: 后端新增 `room_update_guest_character` 命令
  - [x] SubTask 4.1: 在 `src-tauri/src/repositories/conversation_repository.rs` 新增 `update_guest_character_json(db, member_id, json: &str) -> Result<(), String>` 方法
  - [x] SubTask 4.2: 在 `src-tauri/src/commands/rooms.rs` 新增 `room_update_guest_character` 命令，参数 `conversation_id` / `member_id` / `character: GuestCharacterCardPayload`
  - [x] SubTask 4.3: 命令内校验调用者是该 member 本人（通过 conversation_id 匹配）；校验 JSON 序列化不超过 256KB
  - [x] SubTask 4.4: 更新 `guest_character_json` 后广播 `GuestCharacterUpdated`
  - [x] SubTask 4.5: 在 `src-tauri/src/lib.rs` 注册命令

- [x] Task 5: 前端类型与监听器函数
  - [x] SubTask 5.1: `src/lib/backend/types.ts` 新增 5 个事件接口：`RoomMessageEditedEvent` / `RoomMessageDeletedEvent` / `RoomRewoundToRoundEvent` / `RoomContextWindowChangedEvent` / `RoomGuestCharacterUpdatedEvent`
  - [x] SubTask 5.2: `src/lib/backend/rooms.ts` 新增 5 个 `listenRoom*` 函数 + `roomUpdateGuestCharacter` 调用函数

- [x] Task 6: 前端 App.tsx 注册监听器 + 房客人设卡分流
  - [x] SubTask 6.1: 注册 `listenRoomMessageEdited`，收到后按 `messageId` 在 `messages()` 中定位并替换 `content`，清空 `contentParts`
  - [x] SubTask 6.2: 注册 `listenRoomMessageDeleted`，收到后移除 `messageId`；若 `roundDeleted` 为真，移除同 round 全部消息
  - [x] SubTask 6.3: 注册 `listenRoomRewoundToRound`，收到后过滤 `messages()` 移除 `round_id > target_round_id` 的消息；更新 `currentRoundState`
  - [x] SubTask 6.4: 注册 `listenRoomContextWindowChanged`，收到后更新 `roomClientSession().contextWindowSize`
  - [x] SubTask 6.5: 注册 `listenRoomGuestCharacterUpdated`，收到后更新 `selectedConversationMembers` 信号中对应 member 的 `guestCharacterJson`
  - [x] SubTask 6.6: `handleSwitchPlayerCharacter`（`App.tsx:1544`）在 `activeRoomClientSession()` 存在时分流：不调用 `conversationMembersUpdate`，改为从 `playerCharacters()` 取出选中卡的 name/description/tags/baseSections 调用 `roomUpdateGuestCharacter(memberId, character)`

- [x] Task 7: 构建验证
  - [x] SubTask 7.1: `cargo build --manifest-path src-tauri/Cargo.toml` 通过
  - [x] SubTask 7.2: `npx tsc --noEmit` 通过（不含既有基线错误）

- [x] Task 8: Walkthrough 留痕 + git commit + push

# Task Dependencies

- Task 2 / Task 3 / Task 4 依赖 Task 1（RoomMessage 变体先定义）
- Task 6 依赖 Task 5（前端类型与监听器函数先定义）
- Task 7 依赖 Task 1–6 全部完成
- Task 8 依赖 Task 7 通过
- Task 2 / Task 3 / Task 4 可并行（互不依赖）

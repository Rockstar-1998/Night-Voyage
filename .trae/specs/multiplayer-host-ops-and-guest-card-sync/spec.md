# 多人模式房主操作同步与房客人设卡运行期更新 Spec

## Why

经审查多人模式代码，发现两类未覆盖的同步漏洞：

1. **房主 5 项操作不同步给房客**：`update_message_content`（编辑消息）、`delete_message`（删除消息）、`update_conversation_context_window`（设置上下文窗口条）、`rewind_to_round`（回溯对话）在后端仅操作房主 DB，**完全不调用 `RoomServer::broadcast`**。`regenerate_round`（重新生成）仅广播流式 chunk，不广播 `MessageReset`，房客侧看不到"清空旧内容"的动作。这导致房客 UI 与房主状态长期不一致：房客看到已删除的消息、旧版编辑内容、被回溯掉的轮次、过时的上下文窗口。

2. **房客运行期更新人设卡无同步链路**：`add-guest-character-card-to-room` spec 仅覆盖房客**加入时**携带角色卡（写入 `conversation_members.guest_character_json`）。但房客通过 RightDrawer 在运行期切换/更新自己的人设卡时，`conversation_members_update` 命令仅更新 `display_name` 与 `player_character_id`（查房主本地 `character_cards` 表），**完全不处理 `guest_character_json`**，且无广播机制。房客的人设卡更新对房主不可见，Prompt Compiler 下次编译时仍使用旧角色卡数据。

## What Changes

### 房主操作广播补全（后端 + 前端）

新增 4 个 `RoomMessage` 变体，并在对应后端 service 函数中调用 `broadcast_message`：

- **`MessageEdited { conversation_id, message_id, content }`**：`update_message_content` 更新 DB 后广播。房客收到后用 `message_id` 定位并替换本地 `messages` 信号中对应消息的 `content`。
- **`MessageDeleted { conversation_id, message_id, round_deleted }`**：`delete_message` 删除 DB 后广播，`round_deleted` 标识是否连带删除了整个 round。房客收到后从本地 `messages` 移除该消息（及同 round 的其他消息，若 `round_deleted` 为真）。
- **`RewoundToRound { conversation_id, target_round_id }`**：`rewind_to_round` 完成 DB 操作后广播。房客收到后从本地 `messages` 移除 `round_id > target_round_id` 的所有消息，并将 `target_round_id` 的状态重置为 collecting。
- **`ContextWindowChanged { conversation_id, context_window_size }`**：`update_conversation_context_window` 更新 DB 后广播。房客收到后更新 `roomClientSession().contextWindowSize`。

重新生成补全（复用现有机制）：
- **`regenerate_round` 补调 `broadcast_room_message_reset`**：现有 `broadcast_room_message_reset` 函数（`chat_service.rs:1120`）在 regenerate 路径未被调用。在 `regenerate_round` 清空 AI 消息内容后、开始新流式输出前，补调一次 `MessageReset` 广播，让房客侧清空旧内容再接收新 chunk。

### 房客侧前端监听器补全（前端）

- **`listenRoomMessageEdited`**：新增监听器，收到 `room:message_edited` 事件后，按 `message_id` 在 `messages()` 中找到并替换 `content`（同时清空 `contentParts` 强制重新解析）。
- **`listenRoomMessageDeleted`**：新增监听器，收到 `room:message_deleted` 事件后，按 `message_id` 从 `messages()` 移除；若 `roundDeleted` 为真，移除同 round 全部消息。
- **`listenRoomRewoundToRound`**：新增监听器，收到 `room:rewound_to_round` 事件后，过滤 `messages()` 移除 `round_id > target_round_id` 的消息；更新 `currentRoundState`。
- **`listenRoomContextWindowChanged`**：新增监听器，收到 `room:context_window_changed` 事件后，更新 `roomClientSession().contextWindowSize`。
- **`listenRoomMessageReset`（重新生成）**：已有监听器，无需新增；验证 `regenerate_round` 补调 `MessageReset` 后该监听器能正确清空房客侧旧内容。

### 房客运行期更新人设卡（前后端）

- **新增 Tauri command `room_update_guest_character`**：房客调用，参数为 `member_id` + `character: GuestCharacterCardPayload`。后端校验调用者是该 member 本人（非 host 也能调，但只能更新自己的 `guest_character_json`），更新 `conversation_members.guest_character_json` 后广播 `GuestCharacterUpdated { conversation_id, member_id, character }` 给房主与所有房客。
- **`RoomMessage::GuestCharacterUpdated` 变体**：广播房客角色卡变更。房主收到后更新本地 `selectedConversationMembers` 信号中对应成员的 `guestCharacterJson`。
- **RightDrawer 房客模式分流**：`onSwitchPlayerCharacter` 在 `activeRoomClientSession()` 存在时，不调用 `conversationMembersUpdate`，改为调用新命令 `roomUpdateGuestCharacter(memberId, character)`，从本地 `playerCharacters` 列表中取出选中的角色卡数据（name / description / tags / baseSections）传入。
- **Prompt Compiler 数据源不变**：`load_conversation_compile_context` 已在 `add-guest-character-card-to-room` spec 中改为从 `guest_character_json` 加载，运行期更新后下次编译自动拿到新数据，无需额外改动。

## Impact

- Affected specs:
  - `implement-multiplayer-room-mode` — 房间数据实时同步范围扩展（新增 4 个 RoomMessage 变体 + GuestCharacterUpdated）
  - `multiplayer-guest-lockdown-and-sync-fix` — 房客操作权限锁定基础上，房主操作同步补全
  - `multiplayer-guest-state-and-schema-sync` — ContextWindowChanged 与该 spec 的 TokenUsage 广播互补
  - `add-guest-character-card-to-room` — guest_character_json 从仅 join 时写入扩展到运行期可更新
  - `fix-room-guest-client-sync` — 房客侧 messages 信号现在能响应房主的编辑/删除/回溯
- Affected code:
  - `src-tauri/src/network/mod.rs` — `RoomMessage` 枚举新增 5 个变体（MessageEdited / MessageDeleted / RewoundToRound / ContextWindowChanged / GuestCharacterUpdated）
  - `src-tauri/src/services/chat_service.rs` — `update_message_content` / `delete_message` / `rewind_to_round` 补广播；`regenerate_round` 补调 `broadcast_room_message_reset`
  - `src-tauri/src/commands/conversations.rs` — `update_conversation_context_window` 补广播
  - `src-tauri/src/commands/rooms.rs` — 新增 `room_update_guest_character` 命令
  - `src-tauri/src/repositories/conversation_repository.rs` — 新增 `update_guest_character_json` 方法（若不存在）
  - `src/lib/backend/types.ts` — 新增 5 个事件接口
  - `src/lib/backend/rooms.ts` — 新增 5 个 `listenRoom*` 函数 + `roomUpdateGuestCharacter`
  - `src/App.tsx` — 注册 5 个新监听器；`handleSwitchPlayerCharacter` 房客模式分流
  - `src/components/RightDrawer.tsx` — 无直接改动（props 回调分流在 App.tsx 层）
- **移动端不在本次范围**：移动端多人房间功能尚未实现，本次仅修复 PC 端 `src/` 与共享 Rust 后端。移动端实现多人房间时需同步接入这些 RoomMessage 变体。

## 设计约束

- **不修改单人模式行为**：所有广播逻辑仅在 `conversation_type = "online"` 且 `RoomServer` 存在时触发，单人模式走原路径。
- **零回退**：广播失败时房主侧 `eprintln!` 记录错误但保留房主本地正确状态（房主是真相源）；房客侧监听器收到事件时若 conversationId 不匹配则 `return`，不静默应用错误数据。
- **性能保护**：编辑/删除/回溯/上下文窗口/角色卡更新都是低频用户操作，不在流式 chunk 高频路径中，无需节流。`MessageEdited` 广播完整 content（文本，无图片），大小可控。
- **广播为 best-effort**：房主广播后不等待房客 ACK；若房客网络抖动未收到，下次 `room_request_context` → `ContextSnapshot` 全量同步作为兜底（已有机制）。
- **房客只能更新自己的角色卡**：`room_update_guest_character` 后端校验 `member_id` 对应的 member 是调用者本人（通过 `conversation_id` + `member_id` 匹配当前 Tauri state 中的身份），房客不能更新其他房客的卡。
- **不动 src-mobile/**。
- **不修改 `conversation_members_update` 命令**：该命令保留现有行为（更新 display_name / player_character_id），房客运行期角色卡更新走独立的 `room_update_guest_character` 命令，职责分离。

---

## ADDED Requirements

### Requirement: 房主编辑消息广播

系统 SHALL 在房主编辑消息内容后，将更新广播给所有房客，使房客 UI 同步显示新内容。

#### Scenario: 房主编辑消息并广播

- **WHEN** 房主调用 `messages_update_content` 成功更新 DB
- **THEN** 后端广播 `MessageEdited { conversation_id, message_id, content }`
- **AND** 所有房客收到 `room:message_edited` 事件
- **AND** 房客按 `message_id` 在本地 `messages` 信号中替换 `content`，清空 `contentParts` 强制重新解析

#### Scenario: 单人模式编辑不广播

- **WHEN** 单人模式下房主调用 `messages_update_content`
- **THEN** 不广播任何 RoomMessage（RoomServer 不存在）

### Requirement: 房主删除消息广播

系统 SHALL 在房主删除消息后，将删除事件广播给所有房客，使房客 UI 同步移除已删消息。

#### Scenario: 房主删除单条消息

- **WHEN** 房主调用 `messages_delete` 成功删除 DB 记录
- **AND** 未连带删除整个 round
- **THEN** 后端广播 `MessageDeleted { conversation_id, message_id, round_deleted: false }`
- **AND** 房客收到后从 `messages` 信号移除该 `message_id`

#### Scenario: 房主删除消息连带删除 round

- **WHEN** 房主删除消息导致整个 round 被删除（如删除 AI 消息或 round 无可见消息）
- **THEN** 后端广播 `MessageDeleted { conversation_id, message_id, round_deleted: true }`
- **AND** 房客收到后移除该 `message_id` 及同 `round_id` 的所有消息

### Requirement: 房主回溯对话广播

系统 SHALL 在房主回溯到指定轮次后，将回溯事件广播给所有房客，使房客 UI 移除被回溯掉的轮次。

#### Scenario: 房主回溯到目标轮次

- **WHEN** 房主调用 `rewind_to_round` 成功完成 DB 操作（删除目标之后的 rounds + 重置目标 round 为 collecting）
- **THEN** 后端广播 `RewoundToRound { conversation_id, target_round_id }`
- **AND** 房客收到后从 `messages` 信号移除所有 `round_id > target_round_id` 的消息
- **AND** 房客更新 `currentRoundState` 反映目标 round 回到 collecting 状态

### Requirement: 房主设置上下文窗口条广播

系统 SHALL 在房主更新上下文窗口大小后，将新值广播给所有房客，使房客 TokenIsland 实时显示新窗口。

#### Scenario: 房主拖动上下文窗口条并保存

- **WHEN** 房主调用 `update_conversation_context_window` 成功更新 DB
- **THEN** 后端广播 `ContextWindowChanged { conversation_id, context_window_size }`
- **AND** 房客收到后更新 `roomClientSession().contextWindowSize`
- **AND** 房客 TokenIsland 立即反映新窗口大小

### Requirement: 房主重新生成补广播 MessageReset

系统 SHALL 在房主重新生成轮次时，于清空 AI 消息内容后、开始新流式输出前，广播一次 `MessageReset`，使房客侧清空旧内容再接收新 chunk。

#### Scenario: 房主重新生成 AI 消息

- **WHEN** 房主调用 `regenerate_message` / `chat_regenerate_round`
- **AND** 后端清空 AI 消息 content 并准备重新流式输出
- **THEN** 后端调用 `broadcast_room_message_reset` 广播 `MessageReset { conversation_id, round_id }`
- **AND** 房客收到 `room:message_reset` 后清空该 round 的 AI 消息内容
- **AND** 随后房客收到 `room:stream_chunk` 追加新内容

#### Scenario: 单人模式重新生成

- **WHEN** 单人模式下房主重新生成
- **THEN** 不广播 MessageReset（房主侧本地 `listenLlmStreamEvent` 已处理清空逻辑）

### Requirement: 房客运行期更新人设卡

系统 SHALL 允许房客在房间运行期更新自己的人设卡，并将更新同步给房主与其他房客。

#### Scenario: 房客通过 RightDrawer 切换角色卡

- **WHEN** 房客在 RightDrawer 中切换玩家角色卡
- **AND** `activeRoomClientSession()` 存在（房客模式）
- **THEN** 前端调用 `roomUpdateGuestCharacter(memberId, character)`
- **AND** 不调用 `conversationMembersUpdate`
- **AND** 后端更新 `conversation_members.guest_character_json`
- **AND** 广播 `GuestCharacterUpdated { conversation_id, member_id, character }`

#### Scenario: 房主收到房客角色卡更新

- **WHEN** 房主收到 `room:guest_character_updated` 事件
- **THEN** 房主更新本地 `selectedConversationMembers` 信号中对应 member 的 `guestCharacterJson`
- **AND** 下次 Prompt Compiler 编译时使用新的角色卡数据

#### Scenario: 房客角色卡数据大小限制

- **WHEN** `room_update_guest_character` 收到的 `character` 序列化后超过 256KB
- **THEN** 后端返回错误 `"角色卡数据过大（超过 256KB），请精简后重试"`
- **AND** 不更新 DB，不广播

#### Scenario: 房客只能更新自己的角色卡

- **WHEN** 房客调用 `room_update_guest_character` 时 `member_id` 不是自己
- **THEN** 后端返回错误 `"只能更新自己的角色卡"`
- **AND** 不更新 DB

#### Scenario: 单人模式不受影响

- **WHEN** 单人模式下用户切换角色卡
- **THEN** 走原 `conversationMembersUpdate` 路径，行为保持现状

---

## MODIFIED Requirements

### Requirement: 房间数据实时同步（来自 implement-multiplayer-room-mode）

原 spec 规定房主广播消息流式 chunk / end / retry / reset。修改为：**房主 additionally 广播 MessageEdited / MessageDeleted / RewoundToRound / ContextWindowChanged / GuestCharacterUpdated**，覆盖所有房主主动操作与房客角色卡运行期更新。

### Requirement: 房客侧 messages 信号更新（来自 fix-room-guest-client-sync）

原 spec 规定房客侧 messages 信号仅通过 `ContextSnapshot` 全量同步。修改为：**房客侧 messages 信号 additionally 响应 `room:message_edited` / `room:message_deleted` / `room:rewound_to_round` 事件做增量更新**，减少全量同步频率。

### Requirement: guest_character_json 写入时机（来自 add-guest-character-card-to-room）

原 spec 规定 `guest_character_json` 仅在房客加入时写入。修改为：**`guest_character_json` 在房客加入时写入，且在运行期可通过 `room_update_guest_character` 命令更新**。

---

## REMOVED Requirements

（无移除项）

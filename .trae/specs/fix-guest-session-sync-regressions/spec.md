# 房客会话同步回归修复 Spec

## Why

上几轮自动重试改造和房客同步修复后，房客侧仍存在 4 个回归缺陷：玩家角色卡为空、房客看到不应有的自动重试/停止按钮、重新生成时上下文窗口条消失、swipe 版本切换不同步。这些问题影响房客的基本使用体验。

## What Changes

- **房客玩家角色卡为空**：`JoinRoomModal` 的 `onJoined` 回调传递 `selectedCharacterId`；`handleRoomJoined` 将其保存到 `roomClientSession`；`currentPlayerCharacter()` memo 房客模式优先用 `roomClientSession.playerCharacterId`；同时更新 `selectedConversationMembers` 中房客 member 的 `playerCharacterId`。
- **房客看到自动重试/停止按钮**：`retryNotice` UI 中房客（`activeRoomClientSession() != null`）不显示操作按钮，仅显示状态提示。
- **房主停止时房客卡住**：`broadcast_stream_end` 从 `tauri::async_runtime::spawn` 改为同步 `await`（与 StreamRetry 修复一致），确保房客及时收到 `room:stream_end`。
- **重新生成时房客上下文窗口条消失**：`listenRoomTokenUsage` 中，当 `payload.tokenUsageReport` 为 null 时跳过更新（保持旧值），避免 `isRoomGuest` 变 false 导致 TokenIsland 消失。
- **房主切换 swipe 版本不同步**：后端 `switch_swipe` 新增广播 `RoomMessage::SwipeActivated { conversation_id, round_id, message_id }`；前端新增 `listenRoomSwipeActivated` 监听器，房客收到后切换激活的 swipe 消息。

## Impact

- Affected specs:
  - `defer-auto-retry-until-user-trigger` — retryNotice UI 需区分房客/房主
  - `fix-multiplayer-guest-sync-regressions` — currentPlayerCharacter 需进一步修复
  - `fix-multiplayer-retry-stream-desync` — broadcast_stream_end 需同步化
- Affected code:
  - `src/components/JoinRoomModal.tsx` — `onJoined` 回调传递 `selectedCharacterId`
  - `src/App.tsx` — `handleRoomJoined` 保存 `playerCharacterId`；`currentPlayerCharacter()` 优先用 session；retryNotice UI 房客隐藏按钮；`listenRoomTokenUsage` null 守卫；新增 `listenRoomSwipeActivated`
  - `src-tauri/src/services/chat_service.rs` — `broadcast_stream_end` 同步化；`switch_swipe` 新增广播
  - `src-tauri/src/network/mod.rs` — `RoomMessage` 新增 `SwipeActivated` variant + payload
  - `src/lib/backend/types.ts` — 新增 `RoomSwipeActivatedEvent`
  - `src/lib/backend/rooms.ts` — 新增 `listenRoomSwipeActivated`

## ADDED Requirements

### Requirement: 房客玩家角色卡绑定

系统 SHALL 在房客加入房间时，将房客选择的玩家角色卡 ID 保存到 `roomClientSession` 中，使 `currentPlayerCharacter()` memo 能正确返回房客的角色卡。

#### Scenario: 房客加入时选择了角色卡

- **WHEN** 房客在 `JoinRoomModal` 中选择角色卡后加入房间
- **THEN** `onJoined` 回调传递 `selectedCharacterId`
- **AND** `handleRoomJoined` 将 `playerCharacterId` 保存到 `roomClientSession`
- **AND** `selectedConversationMembers` 中房客自己的 member 的 `playerCharacterId` 被更新
- **AND** `currentPlayerCharacter()` memo 房客模式优先用 `roomClientSession.playerCharacterId` 查 `playerCharacters`
- **AND** 会话抽屉显示房客选择的角色卡（非"请选择"）

#### Scenario: 房客加入时未选择角色卡

- **WHEN** 房客在 `JoinRoomModal` 中未选择角色卡（"不携带角色卡"）后加入房间
- **THEN** `playerCharacterId` 为 undefined
- **AND** 会话抽屉显示"当前会话未绑定玩家角色卡"（与现状一致）

### Requirement: 房客 retryNotice 不显示操作按钮

系统 SHALL 在房客模式下隐藏 retryNotice 的"自动重试"和"停止"按钮，仅显示状态提示。

#### Scenario: 房客收到重试通知

- **WHEN** 房客收到 `room:stream_retry` 事件，`retryNotice` 被设置
- **AND** 当前为房客模式（`activeRoomClientSession() != null`）
- **THEN** retryNotice UI 显示失败原因和状态标题
- **AND** **不显示**"自动重试"或"停止"按钮

#### Scenario: 房主收到重试通知

- **WHEN** 房主收到 `llm-stream-retry` 事件，`retryNotice` 被设置
- **AND** 当前为房主模式（`activeRoomClientSession() == null`）
- **THEN** retryNotice UI 显示失败原因、状态标题和操作按钮（"自动重试"或"停止"）

### Requirement: 房主停止后房客同步结束流式

系统 SHALL 在房主 abort 后同步广播 `StreamEnd` 到房客，确保房客及时结束流式状态。

#### Scenario: 房主 abort 后房客收到结束

- **WHEN** 房主点击"停止" → `abort_round_stream` → `spawn_stream_task` loop 检测到 aborted
- **THEN** `broadcast_stream_end` 同步 `await` `broadcast_message`（不使用 `tauri::async_runtime::spawn`）
- **AND** 房客收到 `room:stream_end` → `isStreaming = false` + `replyStatus = 'idle'` + `setRetryNotice(null)`
- **AND** ChatInputBar 不再显示"房客不能停止房主的流式传输"

### Requirement: 房客上下文窗口条不因 null report 消失

系统 SHALL 在房客收到 null `tokenUsageReport` 时保持旧值，避免 `isRoomGuest` 变 false 导致 TokenIsland 消失。

#### Scenario: 重新生成时房客上下文窗口条保持

- **WHEN** 房主重新生成或自动重试时，后端 `compile_token_usage_report` 返回 null
- **AND** 房主广播 `room:token_usage`（`tokenUsageReport = null`）
- **THEN** 房客 `listenRoomTokenUsage` 跳过 `tokenUsageReport` 更新（保持旧值）
- **AND** `isRoomGuest` 保持 true
- **AND** TokenIsland 上下文窗口条不消失

### Requirement: 房主 swipe 切换广播到房客

系统 SHALL 在房主切换 swipe 版本时广播 `SwipeActivated` 到房客，房客同步切换激活的 swipe 消息。

#### Scenario: 房主切换 swipe

- **WHEN** 房主调用 `switch_swipe` 切换到另一个 swipe 版本
- **THEN** 后端 `switch_swipe` 广播 `RoomMessage::SwipeActivated { conversation_id, round_id, message_id }` 到所有 TCP 客户端
- **AND** 房客收到 `room:swipe_activated` 事件后，设置对应 round 中消息的 `isActiveInRound`
- **AND** 旧激活消息 `isActiveInRound = false`，新激活消息 `isActiveInRound = true`
- **AND** 房客 UI 切换显示新 swipe 版本

## MODIFIED Requirements

### Requirement: currentPlayerCharacter（来自 fix-multiplayer-guest-sync-regressions）

原 spec 规定房客模式用 `roomClientSession().memberId` 找 member 的 `playerCharacterId`。修改为：房客模式优先用 `roomClientSession().playerCharacterId`（房客加入时保存），因为后端 join handler 将 `player_character_id` 设为 NULL，member 数据中不包含此字段。

### Requirement: broadcast_stream_end（来自 fix-multiplayer-retry-stream-desync）

原 spec 规定 `broadcast_stream_end` 使用 `tauri::async_runtime::spawn` 异步广播。修改为：同步 `await` `broadcast_message`，与 StreamRetry 修复一致，确保房客及时收到结束信号。

### Requirement: retryNotice UI（来自 defer-auto-retry-until-user-trigger）

原 spec 规定 retryNotice UI 显示"自动重试"/"停止"按钮。修改为：房客模式下隐藏操作按钮，仅显示状态提示。

## REMOVED Requirements

（无移除项）

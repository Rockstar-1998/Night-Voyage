# 多人模式房客权限锁定与同步可观测性修复 Spec

## Why

经地毯式审查多人模式代码，发现四类相互关联的设计缺陷：

1. **房客操作按钮几乎全部未锁定**：`MessageItem.tsx` 中 12 个操作按钮（编辑 / 重新生成 / 分支 / 删除 / swipe 切换 / 自动重试）仅"自动重试"读取 `isRoomClient`，其余 11 个对房客同样可见可点。点击后部分被后端 `ensure_member_is_host` 拒绝（弹错误窗），部分（删除 / swipe / abort）后端无校验，直接操作房客本地空 DB。
2. **Fork / Branch 在多人模式下完全无校验**：`conversations_fork` 后端函数体（`conversations.rs:1051-1279`）未调用 `ensure_member_is_host`，也未检查 `conversation_type`。房主可在 online 会话上 fork（语义模糊），房客点击因本地 DB 无数据被动报错。用户决策：**多人模式下房主和房客都禁用 Fork**。
3. **房客同步链路几乎无日志可观测**：12 个 `room:*` 事件监听器中仅 `listenRoomError` 有 `console.error`；后端 `RoomClient` 仅 1 处 `eprintln`（`network/mod.rs:1209` 收消息时打印类型），连接 / 断开 / 发送 / 读取错误均无日志。已修多轮房客同步仍未根治，根因是缺可观测性。
4. **`abort_round_stream` 与 `messages_delete` 后端无 host 校验**：房客调用虽因本地 DB 空数据自然失败，但这是"被动失败"而非显式拦截，违反 C2 零回退原则。同时 `messagesUpdateContent` 前后端参数签名不匹配（前端缺 `conversationId` / `memberId`），编辑功能对所有人失效。

另外，调研确认房客侧本地 SQLite 实际上**不会被写入任何房间数据**（`room_join` / `RoomClient::connect` / 房客事件监听器均无 `sqlx::query`），房客完全依赖前端信号 + Tauri 事件。**"房客纯内存模式"已经是现状**。但 `listenRoomDisconnected` 在 TCP 断开时仅清理 `roomClientSession`，**不清理 `messages` / `members` / `roundState`**，存在残留。本 spec 强化断连时的全量信号清理，确保"每次连接都从房主重新同步"的契约可验证。

## What Changes

### 房客操作权限锁定（前端）
- **`MessageItem.tsx`**：所有消息操作按钮（编辑 user / 编辑 AI / 重新生成 / 分支 user / 分支 AI / 删除 user / 删除 AI / swipe 上一版本 / swipe 下一版本）在 `props.isRoomClient === true` 时**全部隐藏**。
- **`ChatInputBar.tsx`**：当 `isRoomClient === true` 且 `replyStatus === 'streaming'` 时，**禁用"停止生成"按钮**（房客不能 abort 房主流式）。房客的"发送"与"放弃发言"按钮保留。
- **`MessageItem.tsx`**：`isRoomClient === true` 时消息进入只读模式，不显示编辑入口（即不响应 `setIsEditing(true)`）。
- **单人模式不变**：`isRoomClient === false`（含房主）时所有按钮行为保持现状。

### Fork / Branch 多人模式禁用（前后端）
- **`MessageItem.tsx`**：分支按钮（user 消息 + AI 消息两处）增加判断 `props.isOnline === true` 时隐藏。即房主在 online 会话下也看不到分支按钮。
- **`App.tsx`**：`handleForkMessage` 在 `selectedConversation()?.conversationType === 'online'` 时直接 `return`（前端兜底）。
- **后端 `conversations_fork`**（`commands/conversations.rs:1051`）：函数入口增加 `conversation_type` 校验，若原会话 `conversation_type = 'online'`，返回错误 `"不支持对多人房间会话执行分支操作"`。

### 后端权限校验补全（C2 零回退）
- **`abort_round_stream`**（`chat.rs:165`）→ `ChatService::abort_round_stream`（`chat_service.rs:983`）：增加 `conversation_id` 与 `member_id` 参数，调用 `ensure_member_is_host`。前端 `abortRoundStream` 同步补齐参数。
- **`messages_delete`**（`chat.rs:157`）→ `ChatService::delete_message`（`chat_service.rs:793`）：增加 `conversation_id` 与 `member_id` 参数，调用 `ensure_member_is_host`。前端 `messagesDelete` 同步补齐参数。
- **`messages_switch_swipe`**（`chat.rs:148`）→ `ChatService::switch_swipe`（`chat_service.rs:784`）：增加 `conversation_id` 与 `member_id` 参数，调用 `ensure_member_is_host`。前端 `messagesSwitchSwipe` 同步补齐参数。
- **`messages_update_content`**（`chat.rs:136`）：前端 `messagesUpdateContent`（`messages.ts:34`）与 `handleEditMessage`（`App.tsx:1097`）补齐 `conversationId` 与 `memberId` 参数，与后端签名对齐。修复全员失效的编辑功能。

### 房客同步 DEBUG 日志（前端 + 后端）
- **`src/lib/backend/rooms.ts`**：所有 `listenRoom*` 函数（`listenRoomStreamChunk` / `listenRoomStreamEnd` / `listenRoomStreamRetry` / `listenRoomMessageReset` / `listenRoomContextSnapshot` / `listenRoomRoundStateUpdate` / `listenRoomPlayerMessage` / `listenRoomMemberJoined` / `listenRoomMemberLeft` / `listenRoomError` / `listenRoomDisconnected`）在收到事件时打印 `[room-xxx]` 前缀的 `console.debug` 日志，包含 `conversationId` / `messageId` / `roundId` 等关键字段。
- **`src/App.tsx`**：所有 `room:*` 监听器回调在执行关键状态变更（`setMessages` / `setCurrentRoundState` / `setSelectedConversationMembers` / `setRoomClientSession`）前后打印 `console.debug` 日志，标注变更前后的关键值。
- **`src-tauri/src/network/mod.rs`**：`RoomClient` 在 `connect`（成功 / 失败 / 超时）、`send_message`（发送前 / 发送后）、`disconnect`（开始 / 完成）、读循环（`Ok(None)` 对端关闭 / `Err(e)` 读取错误 / 收到消息类型）处增加 `eprintln!` 日志，前缀 `[room-client]`。
- **日志前缀统一**：前端 `[room-xxx]`，后端 `[room-client]` / `[room-server]`，便于 grep 过滤。

### 房客纯内存模式强化
- **现状确认**（不改）：房客本地 DB 不写任何房间数据（`room_join` / `RoomClient::connect` / 房客事件监听器均无 `sqlx::query`）。
- **`listenRoomDisconnected` 强化**（`App.tsx:1875`）：TCP 断开时除 `setRoomClientSession(null)` 外，**同步清理** `setMessages([])` / `setSelectedConversationMembers([])` / `setCurrentRoundState(null)`，与 `handleRoomLeft` 行为对齐。避免断连后房客侧残留陈旧消息导致下次连接时 UI 闪烁。
- **`handleRoomJoined` 日志强化**：成功路径打印 `[room-joined]` 日志，包含 `conversationId` / `memberId` / 消息数 / 成员数 / 是否带 `hostCharacter`。
- **重连全量同步契约验证**（不加新代码，靠日志验证）：`room_join` → `JoinSuccess`（含 `full_messages`）→ `room_request_context` → `room:context_snapshot` 全量覆盖。DEBUG 日志让这条链路可观测。

## Impact

- Affected specs:
  - `implement-multiplayer-room-mode` — 房间数据实时同步需求扩展（房客操作权限收窄、Fork 禁用、断连清理）
  - `fix-room-guest-client-sync` — 房客同步可观测性补全
  - `fix-multiplayer-retry-stream-desync` — 重试 / 重置事件链路加日志
- Affected code:
  - `src/components/MessageItem.tsx` — 12 个操作按钮的 `isRoomClient` / `isOnline` 权限判断
  - `src/components/ChatInputBar.tsx` — 房客禁用"停止生成"按钮
  - `src/App.tsx` — `handleForkMessage` online 兜底、所有 `room:*` 监听器加日志、`listenRoomDisconnected` 强化清理、`handleRoomJoined` 加日志
  - `src/lib/backend/rooms.ts` — 所有 `listenRoom*` 函数加 `console.debug`
  - `src/lib/backend/messages.ts` — `messagesUpdateContent` / `messagesDelete` / `messagesSwitchSwipe` / `abortRoundStream` 补齐参数
  - `src-tauri/src/commands/chat.rs` — `abort_round_stream` / `messages_delete` / `messages_switch_swipe` / `messages_update_content` 签名扩展
  - `src-tauri/src/commands/conversations.rs` — `conversations_fork` 增加 online 校验
  - `src-tauri/src/services/chat_service.rs` — `abort_round_stream` / `delete_message` / `switch_swipe` / `update_message_content` 增加 `ensure_member_is_host`
  - `src-tauri/src/network/mod.rs` — `RoomClient` 全链路 `eprintln!` 日志
- **移动端不在本次范围**：移动端多人房间功能尚未实现（`src-mobile/App.tsx` 显示"开发中"），本次仅修复 PC 端 `src/` 与共享 Rust 后端。

## 设计约束

- **不修改单人模式行为**：所有权限判断以 `isRoomClient` / `conversationType === 'online'` 为前提，`isRoomClient === false` 且非 online 时完全保持现状。
- **不修改房主侧按钮**：房主在 online 模式下保留编辑 / 重新生成 / 删除 / swipe / 自动重试等操作（房主是房间的实际控制者）。
- **房主在 online 模式下也禁用 Fork**：用户明确要求"房主和房客都不能用"。
- **零回退**：所有权限拒绝必须显式报错（前端隐藏 + 后端 `ensure_member_is_host` 双重保险），不得静默成功。
- **日志不能影响性能**：`console.debug` 与 `eprintln!` 仅用于关键路径，流式 chunk 等高频事件只打印必要字段（conversationId / messageId / delta 长度），不打印完整 delta。
- **不引入新依赖**：仅使用 `console.debug` / `eprintln!`，不引入日志框架。
- **不修改房客本地 DB 写入逻辑**：调研确认房客本地 DB 本就不写房间数据，无需"去掉持久化"，仅需强化断连时的前端信号清理。

---

## ADDED Requirements

### Requirement: 房客消息操作按钮全锁定

系统 SHALL 在房客（`isRoomClient === true`）模式下隐藏所有消息操作按钮，仅保留消息查看与发送。

#### Scenario: 房客查看 AI 消息

- **WHEN** 房客（`isRoomClient === true`）查看 AI 消息
- **THEN** 不显示"编辑"、"重新生成"、"分支"、"删除"按钮
- **AND** 不显示 swipe 版本切换按钮（即使 `swipeInfo.total > 1`）
- **AND** 不显示"自动重试"按钮（已实现，保持现状）

#### Scenario: 房客查看 user 消息

- **WHEN** 房客查看任何 user 消息（自己的或其他玩家的）
- **THEN** 不显示"编辑"、"分支"、"删除"按钮

#### Scenario: 房客无法进入消息编辑态

- **WHEN** 房客点击消息气泡（若有点击事件）
- **THEN** 不进入编辑态（`setIsEditing(true)` 不被调用）

#### Scenario: 房主在 online 模式下保留操作

- **WHEN** 房主（`isRoomClient === false`）在 online 会话中查看消息
- **THEN** 显示"编辑"、"重新生成"、"删除"、"swipe 切换"、"自动重试"按钮（保持现状）
- **AND** **不显示"分支"按钮**（见下一条 Requirement）

#### Scenario: 单人模式完全不变

- **WHEN** 单人会话（`conversationType === 'single'`）中查看消息
- **THEN** 所有按钮行为保持现状（包括分支按钮可见可点）

### Requirement: 多人模式禁用 Fork / Branch

系统 SHALL 在 `conversation_type === 'online'` 的会话中禁用 Fork / Branch 操作，房主和房客都不可用。

#### Scenario: online 会话前端隐藏分支按钮

- **WHEN** 房主或房客在 online 会话中查看任何消息
- **THEN** user 消息和 AI 消息都不显示"分支"按钮

#### Scenario: online 会话前端兜底拦截

- **WHEN** `handleForkMessage` 被调用且 `selectedConversation()?.conversationType === 'online'`
- **THEN** 函数直接 `return`，不调用 `conversationsFork`

#### Scenario: 后端拒绝 online 会话 fork

- **WHEN** `conversations_fork` 命令被调用且原会话 `conversation_type = 'online'`
- **THEN** 返回错误 `"不支持对多人房间会话执行分支操作"`
- **AND** 不执行任何 DB 复制操作

#### Scenario: 单人会话 fork 不受影响

- **WHEN** `conversations_fork` 命令被调用且原会话 `conversation_type = 'single'`
- **THEN** 执行现有 fork 逻辑，行为保持不变

### Requirement: 房客禁用停止生成

系统 SHALL 在房客模式下禁用"停止生成"（abort）按钮，房客不能中断房主的流式传输。

#### Scenario: 房客在流式传输中

- **WHEN** 房客（`isRoomClient === true`）所在房间处于 `replyStatus === 'streaming'`
- **THEN** 输入区的"停止生成"按钮**禁用**（`disabled` 属性，不可点击）
- **AND** 房客仍可发送新消息（若房主允许并发发送）或选择"放弃发言"

#### Scenario: 房主在流式传输中

- **WHEN** 房主在流式传输中
- **THEN** "停止生成"按钮可用（保持现状）

### Requirement: 后端权限校验补全

系统 SHALL 为所有影响房间状态的消息操作命令补全 `ensure_member_is_host` 校验，确保房客无法绕过前端隐藏直接调用后端。

#### Scenario: 房客调用 abort_round_stream

- **WHEN** 房客调用 `abort_round_stream`
- **THEN** 后端返回 `"权限不足：只有房主可以执行此操作"`
- **AND** 不执行 `RoundRepository::mark_aborted`

#### Scenario: 房客调用 messages_delete

- **WHEN** 房客调用 `messages_delete`
- **THEN** 后端返回 `"权限不足：只有房主可以执行此操作"`
- **AND** 不执行任何删除

#### Scenario: 房客调用 messages_switch_swipe

- **WHEN** 房客调用 `messages_switch_swipe`
- **THEN** 后端返回 `"权限不足：只有房主可以执行此操作"`
- **AND** 不执行 `set_active_assistant_message`

#### Scenario: 房主调用上述命令

- **WHEN** 房主调用 `abort_round_stream` / `messages_delete` / `messages_switch_swipe`
- **THEN** 命令正常执行（保持现状）

### Requirement: 编辑消息前后端参数对齐

系统 SHALL 修复 `messages_update_content` 前后端参数签名不匹配的缺陷，使编辑功能对房主可用。

#### Scenario: 房主编辑消息

- **WHEN** 房主点击编辑按钮并提交新内容
- **THEN** 前端调用 `messagesUpdateContent(conversationId, memberId, messageId, content)`
- **AND** 后端 `messages_update_content` 收到 4 个参数，执行 `ensure_member_is_host` 校验后更新消息内容

#### Scenario: 房客尝试编辑

- **WHEN** 房客点击编辑按钮（已被前端隐藏，假设绕过 UI 直接调用）
- **THEN** 后端返回 `"权限不足：只有房主可以执行此操作"`

### Requirement: 房客同步 DEBUG 日志

系统 SHALL 在房客同步链路的全部分支增加 DEBUG 日志，使房客同步问题可观测、可排查。

#### Scenario: 前端收到 room 事件

- **WHEN** 前端任何 `room:*` 监听器收到事件
- **THEN** `console.debug` 打印 `[room-xxx]` 前缀日志，包含 `conversationId` / `messageId` / `roundId` 等关键字段
- **AND** 在执行 `setMessages` / `setCurrentRoundState` / `setSelectedConversationMembers` / `setRoomClientSession` 前后打印变更前后的关键值

#### Scenario: 后端 RoomClient 连接生命周期

- **WHEN** `RoomClient::connect` / `send_message` / `disconnect` 被调用
- **THEN** `eprintln!` 打印 `[room-client]` 前缀日志，标注开始 / 成功 / 失败 / 超时

#### Scenario: 后端 RoomClient 读循环

- **WHEN** `RoomClient` 读循环收到消息 / 对端关闭 / 读取错误
- **THEN** `eprintln!` 打印 `[room-client]` 前缀日志，标注消息类型 / 错误详情

#### Scenario: 流式 chunk 高频事件日志控制

- **WHEN** 房客收到 `room:stream_chunk` 事件
- **THEN** 日志仅打印 `conversationId` / `messageId` / `delta` 长度，**不打印完整 delta 内容**
- **AND** 日志不影响流式性能

### Requirement: 房客断连信号全量清理

系统 SHALL 在房客 TCP 断开时全量清理前端信号，确保下次连接从房主重新同步的数据不与残留数据混淆。

#### Scenario: 房客 TCP 断开

- **WHEN** 房客收到 `room:disconnected` 事件
- **THEN** `setRoomClientSession(null)`
- **AND** `setMessages([])`
- **AND** `setSelectedConversationMembers([])`
- **AND** `setCurrentRoundState(null)`

#### Scenario: 房客主动退出房间

- **WHEN** 房客调用 `roomLeave` 并触发 `handleRoomLeft`
- **THEN** 行为与 TCP 断开一致（保持现状，已清理全部信号）

#### Scenario: 房客重新连接

- **WHEN** 房客断开后重新调用 `room_join` 成功
- **THEN** `handleRoomJoined` 用 `JoinSuccess` 数据全量覆盖 `messages` / `members` / `roundState` / `roomClientSession`
- **AND** `roomRequestContext` 主动拉取一次 `context_snapshot` 兜底
- **AND** 日志打印 `[room-joined]` 包含 `conversationId` / `memberId` / 消息数 / 成员数

---

## MODIFIED Requirements

### Requirement: 房间数据实时同步（来自 implement-multiplayer-room-mode）

原 spec 规定"房主拥有最大权限（请求 AI、修改内容、重新生成），其他玩家只可以发送消息"。修改为：**房客仅可发送消息与放弃发言，所有消息操作（编辑 / 重新生成 / 分支 / 删除 / swipe 切换 / 自动重试 / 停止生成）均禁用**。Fork / Branch 在多人模式下对房主也禁用。

### Requirement: 房间断线处理（来自 implement-multiplayer-room-mode）

原 spec 规定"客户端断线时房主将成员标记为不活跃"。修改为：**房客侧 TCP 断开时同步清理前端 `messages` / `members` / `roundState` 信号**，避免残留数据导致下次连接 UI 闪烁或状态分裂。

### Requirement: 房间重试事件广播（来自 fix-multiplayer-retry-stream-desync）

原 spec 规定房客收到 `room-stream-retry` / `room-message-reset` 时清空消息内容。修改为：**房客同步链路所有事件监听器增加 DEBUG 日志**，使重试 / 重置 / chunk / end / context_snapshot / player_message / member_joined / member_left / disconnected 全链路可观测。

---

## REMOVED Requirements

（无移除项）

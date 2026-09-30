# 多人房客同步回归修复 Spec

## Why

房客加入房间后存在 5 个同步缺陷：玩家角色卡为空、上下文窗口条损坏、schema 默认展开未同步、房主角色卡头像/背景缺失、自动重试时覆写而非清空消息。这些问题阻碍了多人模式的基本可用性。

## What Changes

### 1. 房客玩家角色卡修复

- **根因**：`currentPlayerCharacter()`（App.tsx:813-817）使用 `hostMember()` 取房主的 `playerCharacterId`，房客本地 `playerCharacters` store 无此卡 → 返回 undefined → 显示"请选择"
- **修复**：房客模式下用 `roomClientSession().memberId` 找自己的 member，取自己的 `playerCharacterId`

### 2. 上下文窗口条修复

- **根因 A**：`compile_token_usage_report`（prompt_compiler.rs:1961）在当前 round 无输入消息时报错 "current round input message was not found" → `token_usage_report` 为 None → 房客 TokenIsland 回退到本地 `getConversationTokenUsage` 也报错（房客 DB 无房主消息）
- **根因 B**：房客设定上下文窗口时调用 `updateConversationContextWindow` 操作房客本地 DB → 触发本地 prompt 编译 → 报错
- **修复 A**：`compile_token_usage_report` 在无输入消息时返回空 report（不报错），让 token 计数正常显示 0 而非崩溃
- **修复 B**：房客侧 TokenIsland 的上下文窗口输入框设为只读（`isRoomGuest` 时 disabled），禁止房客本地设定上下文窗口

### 3. Schema 默认展开状态同步

- **根因**：`userToggleState` Map（MessageFormatRenderer:65）只存被用户手动 toggle 过的 key。`computeInitialExpanded`（line 138-141）对未 toggle 的 key 回退到 `props.defaultExpanded`，该值来自本地 SchemaConfigPanel 配置，未从房主同步
- **修复**：房主侧 schema toggle state Map 改为存储**所有 key 的当前有效展开状态**（而非仅手动 toggle 过的 key）。房主初始化 schema 时将所有 key 的 `defaultExpanded` 写入 Map；toggle 时更新对应 key。房客加入时 `setAllSchemaToggleState` 全量覆盖，无需依赖本地 `defaultExpanded`

### 4. 房主角色卡头像/背景同步

- **根因**：`RoomJoinResult` 结构体（rooms.rs:42-63）**缺少** `host_character_image_base64` / `host_character_name` / `host_character_description` 字段。`RoomJoinSession`（network/mod.rs:769-770）有这些字段且 join handler 填充了它们（network/mod.rs:1191-1217），但 `room_join` 函数构造 `RoomJoinResult` 时未映射
- **修复**：`RoomJoinResult` 新增 3 个字段，`room_join` 从 `session` 映射

### 5. 自动重试覆写修复

- **根因**：`stream_processor.rs:240-258` 的 `StreamRetry` 广播在 `tauri::async_runtime::spawn` 中异步执行，新流式块可能先于 retry 事件到达房客 → 房客未清空旧内容就开始接收新流 → 覆写而非刷新
- **修复**：移除 `spawn` 包裹，改为同步 `await` `broadcast_message`，确保 StreamRetry 在新流开始前到达房客

## Impact

- Affected specs:
  - `fix-room-guest-client-sync` — 房主角色卡同步（issue 4 补全 RoomJoinResult 缺失字段）
  - `multiplayer-guest-state-and-schema-sync` — schema toggle 与 TokenIsland 同步（issue 2/3 修复回归）
  - `fix-multiplayer-retry-stream-desync` — 自动重试同步（issue 5 修复时序问题）
- Affected code:
  - `src/App.tsx` — `currentPlayerCharacter()` 房客分流（issue 1）
  - `src-tauri/src/services/prompt_compiler.rs` — `compile_token_usage_report` 容错（issue 2A）
  - `src/components/TokenIsland.tsx` — 房客侧上下文窗口输入只读（issue 2B）
  - `src/components/MessageFormatRenderer.tsx` — schema toggle state 初始化全量 key（issue 3）
  - `src-tauri/src/network/mod.rs` — RoomServer schema_toggle_state 初始化全量 key（issue 3）
  - `src-tauri/src/commands/rooms.rs` — `RoomJoinResult` 新增 3 字段 + 映射（issue 4）
  - `src-tauri/src/services/stream_processor.rs` — StreamRetry 同步广播（issue 5）

## 设计约束

- **不修改单人模式行为**：所有修复仅在房客模式或 `host_server.is_some()` 时生效
- **零回退**：`compile_token_usage_report` 容错不吞异常，而是返回空 report 并日志记录
- **不动 src-mobile/**
- **最小改动**：不引入新依赖、不改 DB schema、不改网络协议

---

## ADDED Requirements

### Requirement: 房客侧玩家角色卡显示自己的角色

系统 SHALL 在房客模式下用房客自己的 member 的 `playerCharacterId` 查找玩家角色卡，而非房主的。

#### Scenario: 房客加入后看到自己的玩家角色卡

- **WHEN** 房客加入房间
- **AND** 房客选择了自己的玩家角色卡
- **THEN** 会话抽屉中玩家角色卡显示房客自己的角色
- **AND** 不显示"请选择"

### Requirement: 房客侧上下文窗口输入只读

系统 SHALL 在房客模式下将 TokenIsland 的上下文窗口输入框设为只读，禁止房客修改上下文窗口。

#### Scenario: 房客侧 TokenIsland 输入框只读

- **WHEN** 房客查看 TokenIsland
- **THEN** 上下文窗口输入框不可编辑
- **AND** 不触发本地 `updateConversationContextWindow`

### Requirement: compile_token_usage_report 容错无输入消息

系统 SHALL 在当前 round 无输入消息时返回空 token usage report，而非报错。

#### Scenario: 当前 round 无输入消息

- **WHEN** `compile_token_usage_report` 被调用
- **AND** 当前 round 没有 user 输入消息（round 处于 collecting 状态）
- **THEN** 返回 total tokens 为 0 的空 report
- **AND** 不返回 "current round input message was not found" 错误

### Requirement: Schema toggle state 全量同步

系统 SHALL 在 schema toggle state Map 中存储所有 key 的当前有效展开状态，包括未被手动 toggle 的 key 的默认值。

#### Scenario: 房客加入后 schema 展开状态与房主一致

- **WHEN** 房主配置了某 schema key 的 `defaultExpanded = true`
- **AND** 房主未手动 toggle 该 key
- **AND** 房客加入房间
- **THEN** 房客的该 key 展开状态与房主一致（展开）

### Requirement: RoomJoinResult 包含房主角色卡头像

系统 SHALL 在 `RoomJoinResult` 中包含 `host_character_image_base64` / `host_character_name` / `host_character_description` 字段。

#### Scenario: 房客加入后立即获得房主角色卡头像

- **WHEN** 房客加入房间
- **AND** 房主有角色卡头像
- **THEN** `RoomJoinResult.hostCharacterImageBase64` 包含 base64 图片
- **AND** 房客侧 `remoteHostCharacter()` 返回非 null
- **AND** AuroraBackground 和 AI 消息头像显示房主角色卡图片

### Requirement: StreamRetry 同步广播

系统 SHALL 在自动重试时同步广播 `StreamRetry`（不使用 async spawn），确保房客在新流式块到达前清空旧消息内容。

#### Scenario: 自动重试时房客先清空再接收新流

- **WHEN** 房主触发自动重试
- **THEN** `StreamRetry` 广播在新流开始前完成
- **AND** 房客先清空被重试消息的内容
- **AND** 然后接收新流式块

---

## MODIFIED Requirements

### Requirement: currentPlayerCharacter memo（来自 fix-room-guest-client-sync）

原实现用 `hostMember()` 的 `playerCharacterId`。修改为：**房客模式下用 `roomClientSession().memberId` 找自己的 member，取自己的 `playerCharacterId`**。

### Requirement: schema toggle state 存储（来自 multiplayer-guest-state-and-schema-sync）

原实现只存手动 toggle 的 key。修改为：**存储所有 key 的当前有效展开状态**，房主初始化时写入所有 key 的 `defaultExpanded`。

### Requirement: StreamRetry 广播时序（来自 fix-multiplayer-retry-stream-desync）

原实现用 `tauri::async_runtime::spawn` 异步广播。修改为：**同步 `await` 广播，确保时序正确**。

---

## REMOVED Requirements

（无移除项）

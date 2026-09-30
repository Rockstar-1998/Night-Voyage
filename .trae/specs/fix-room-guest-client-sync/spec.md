# 房客客户端与房主状态同步修复 Spec

## Why

房客加入房间后，存在以下与房主状态不同步的问题：

1. **房主角色信息缺失**：房客 `RoomClientSession` 中没有 `hostCharacter` 字段，导致房客模式下所有依赖当前 AI 角色卡片的渲染（`selectedCharacter`、`AuroraBackground`、AI 消息 `avatar` 与 `senderName`、`upsertStreamingAssistant`）都回退到本地 NPC/Player 列表，房客看不到房主选择的主控角色信息。
2. **加入时只拿到部分消息**：当前 `RoomJoinResult` 仅返回 `recentMessages`（少量最近消息），房客加入时看不到完整历史上下文。
3. **运行期缺少全量同步通道**：房客依赖房主通过 `room:member_joined` 等事件被动同步房间状态，缺少主动拉取全量上下文的兜底机制；若某次广播失败或房客后加入已有消息历史但未收到 broadcast，则状态长期不一致。

后端已经扩展 `RoomJoinResult`（带 `#[serde(alias = "recentMessages")]`）以承载房主角色信息与全量消息，并新增 `room:context_snapshot` 事件与 `room_request_context` 命令。本 spec 负责前端配合补全。

## What Changes

- **扩展前端 `RoomJoinResult` 类型**：在 `src/lib/backend/types.ts` 中新增 4 个可选字段（`hostCharacterImageBase64`、`hostCharacterName`、`hostCharacterDescription`、`fullMessages`），同时保留 `recentMessages` 以保持向后兼容。
- **新增 `RoomHostCharacter` 接口**：在 `src/lib/backend/types.ts` 中定义房主角色最小可用信息（name / description / imagePath / imageBase64）。
- **新增 `RoomContextSnapshotEvent` 接口**：在 `src/lib/backend/types.ts` 中定义 `room:context_snapshot` 事件的 payload。
- **新增 `listenRoomContextSnapshot` 与 `roomRequestContext` 函数**：在 `src/lib/backend/rooms.ts` 中提供事件监听与命令调用入口。
- **扩展 `RoomClientSession` 类型**：在 `src/App.tsx` 中新增 `hostCharacter?: RoomHostCharacter | null` 字段。
- **新增 `remoteHostCharacter` memo**：从 `activeRoomClientSession()` 解出房主角色，作为房客模式下的角色源。
- **房客模式下角色解析优先使用 `remoteHostCharacter`**：
  - `selectedCharacter` memo 在房客模式下返回 `remoteHostCharacter()`（房主模式保持原行为，从 NPC/Player 列表解析）。
  - `AuroraBackground` 优先使用 `roomClientSession()?.hostCharacter?.imageBase64`。
  - `toChatMessage` 中 AI 消息的 `avatar` 优先使用 `remoteHostCharacter()?.imageBase64`，`senderName` 在本地角色名缺失时回退到 `remoteHostCharacter()?.name`。
  - `upsertStreamingAssistant` 中 AI 消息的 `avatar` 与 `senderName` 同样优先使用 `remoteHostCharacter()`。
- **加入后主动拉取全量上下文**：在 `handleRoomJoined` 中调用 `roomRequestContext()`，兜底处理 `MemberJoined` 广播失败的情况；同时在房主后发的 `room:context_snapshot` 中也更新 `roomClientSession.hostCharacter`。
- **注册 `listenRoomContextSnapshot` 监听器**：在 `src/App.tsx` 的事件注册区注册；处理逻辑：校验 `conversationId`、房客会话（`activeRoomClientSession()` 为真）、同步消息/成员/roundState，并按需更新 `hostCharacter`。

## Impact

- Affected specs:
  - `implement-multiplayer-room-mode` — 房间数据实时同步需求扩展（新增房主角色 + 全量 context snapshot）
- Affected code:
  - `src/lib/backend/types.ts` — 扩展 `RoomJoinResult`、新增 `RoomHostCharacter`、`RoomContextSnapshotEvent`
  - `src/lib/backend/rooms.ts` — 新增 `listenRoomContextSnapshot`、`roomRequestContext`
  - `src/App.tsx` — 扩展 `RoomClientSession`、新增 `remoteHostCharacter` memo、调整 `selectedCharacter` / `AuroraBackground` / `toChatMessage` / `upsertStreamingAssistant` / `handleRoomJoined`、注册 `listenRoomContextSnapshot`
- **移动端不在本次范围**：本次仅修复 PC 端 `src/`。移动端 `src-mobile/` 暂未实现多人房间功能。

## 设计约束

- 不修改 `currentAiCharacter`、`currentPlayerCharacter`、`hostMember` 等已有 memo 的逻辑。
- 不修改单人模式（`activeRoomClientSession()` 为 null）的渲染路径。
- 所有 `listenRoomContextSnapshot` 处理逻辑在房主模式下跳过（`if (!activeRoomClientSession()) return`），避免与房主本地状态冲突。
- 不修改其他房间事件监听器（`room:member_joined` / `room:member_left` / `room:stream_chunk` / `room:player_message` 等）的现有行为。
- 零回退：所有失败必须显式上报；房客模式下若房主未提供 `hostCharacter`，渲染时直接使用 `null`/回退到本地 `CharacterCard`，不引入静默默认成功逻辑。

## ADDED Requirements

### Requirement: 房主角色信息通过 RoomJoinResult 传递给房客

系统 SHALL 在 `room_join` 命令的返回结构中携带房主所选主控角色的最小可用信息（图片 base64、name、description），并在前端 `RoomJoinResult` 类型中以可选字段形式表达。

#### Scenario: 房客加入房间后获得房主角色

- **WHEN** 房客调用 `room_join` 并收到 `RoomJoinResult`
- **AND** 房主后端携带了 `hostCharacterImageBase64` / `hostCharacterName` / `hostCharacterDescription`
- **THEN** 前端将这些字段填充到 `RoomClientSession.hostCharacter` 中
- **AND** 后续 `selectedCharacter`、`AuroraBackground`、AI 消息渲染均优先使用该信息

#### Scenario: 后端未携带房主角色时房客回退

- **WHEN** 房客加入但 `RoomJoinResult` 中无任何 `hostCharacter*` 字段
- **THEN** `RoomClientSession.hostCharacter` 为 `null`，渲染时回退到本地 `npcCharacters`/`playerCharacters` 解析
- **AND** 不抛出错误，不静默使用错误数据

### Requirement: 房客全量 context 同步通道

系统 SHALL 在房客模式下提供主动拉取房间全量上下文的命令（`room_request_context`）与对应的 Tauri 事件（`room:context_snapshot`），用于在加入时与运行期兜底同步消息/成员/roundState/房主角色。

#### Scenario: 房客加入后主动拉取

- **WHEN** `handleRoomJoined` 成功填充 `RoomClientSession`
- **THEN** 前端立即调用 `roomRequestContext()` 主动拉取一次
- **AND** 房主模式的 `handleRoomJoined` 不调用此命令

#### Scenario: 收到 context_snapshot 事件时同步

- **WHEN** 房客前端收到 `room:context_snapshot` 事件
- **AND** `payload.conversationId === selectedConversationId()`
- **AND** 当前为房客会话（`activeRoomClientSession()` 为真）
- **THEN** 同步 `messages`、`members`、`roundState`
- **AND** 当 `payload.hostCharacterImageBase64 || payload.hostCharacterName` 存在时，更新 `RoomClientSession.hostCharacter`

#### Scenario: 房主跳过 context_snapshot 事件

- **WHEN** 房主前端收到 `room:context_snapshot` 事件
- **AND** `activeRoomClientSession()` 为 null
- **THEN** 直接 `return`，避免覆盖房主本地状态

## MODIFIED Requirements

（无向后不兼容的 MODIFIED Requirements；`RoomJoinResult.recentMessages` 字段保留以便向后兼容）

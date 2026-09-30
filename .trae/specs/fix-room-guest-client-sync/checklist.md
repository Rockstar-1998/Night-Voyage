# Checklist

## 后端（Task 1-3）

- [x] `RoomJoinResult` 新增 `host_character_image_base64`、`host_character_name`、`host_character_description`、`full_messages` 字段
- [x] `#[serde(alias = "recentMessages")]` 保留旧字段名兼容
- [x] `room_join` 命令路径在房主后端填充上述字段（从房主所选主控角色读取图片 base64/name/description；从 DB 读取全量消息）
- [x] `RoomMessage` enum 新增 `ContextSnapshot` variant
- [x] `RoomContextSnapshotPayload` flat 结构（`#[serde(rename_all = "camelCase")]`）
- [x] `network/mod.rs` 的 `event_name()` 与 `event_payload()` 中补充 `room:context_snapshot` Tauri 事件转发
- [x] `room_request_context` Tauri 命令实现（读取全量消息/成员/roundState/房主角色并广播 `ContextSnapshot`）
- [x] `MemberJoined` 广播失败时主动推送 `ContextSnapshot` 兜底

## 前端类型（Task 4）

- [x] `src/lib/backend/types.ts:736-745` `RoomJoinResult` 新增 4 个可选字段：`hostCharacterImageBase64`、`hostCharacterName`、`hostCharacterDescription`、`fullMessages`
- [x] `RoomJoinResult.recentMessages` 字段保留以兼容旧后端
- [x] `src/lib/backend/types.ts` 新增 `RoomHostCharacter` 接口（`name` / `description` / `imagePath` / `imageBase64`）
- [x] `src/lib/backend/types.ts` 新增 `RoomContextSnapshotEvent` 接口（`conversationId` / `messages` / `members` / `roundState` / 房主角色三字段）

## 前端 rooms.ts（Task 5）

- [x] `src/lib/backend/rooms.ts` 文件顶部 import 加入 `RoomContextSnapshotEvent` 类型
- [x] `src/lib/backend/rooms.ts` 新增 `listenRoomContextSnapshot(handler)`，监听 `room:context_snapshot` 事件
- [x] `src/lib/backend/rooms.ts` 新增 `roomRequestContext()`，调用 `room_request_context` Tauri 命令

## 前端 App.tsx（Task 6）

- [x] `src/App.tsx` 顶部 import 加入 `RoomHostCharacter`、`RoomContextSnapshotEvent`、`listenRoomContextSnapshot`、`roomRequestContext`
- [x] `RoomClientSession` 类型扩展，新增 `hostCharacter?: RoomHostCharacter | null` 字段
- [x] 新增 `remoteHostCharacter` memo（`activeRoomClientSession()?.hostCharacter ?? null`）
- [x] `selectedCharacter` memo 房客模式下优先返回 `remoteHostCharacter()`（使用 `as unknown as CharacterCard` 类型转换）
- [x] `AuroraBackground` 传参房客模式下优先使用 `roomClientSession()?.hostCharacter?.imageBase64`
- [x] `toChatMessage` AI 消息 `avatar` 房客模式下优先使用 `remoteHostCharacter()?.imageBase64`；`senderName` 在本地角色名缺失时回退到 `remoteHostCharacter()?.name`
- [x] `upsertStreamingAssistant` 新建 AI 消息时 `avatar` 优先使用 `remoteHostCharacter()?.imageBase64`，`senderName` 优先使用 `remoteHostCharacter()?.name`
- [x] `handleRoomJoined` 将 `RoomJoinResult` 中的 `hostCharacter*` 字段填充到 `RoomClientSession.hostCharacter`
- [x] `handleRoomJoined` 加入成功后调用 `roomRequestContext()` 主动拉取一次
- [x] `handleRoomJoined` 优先使用 `result.fullMessages ?? result.recentMessages ?? []` 填充消息列表
- [x] 事件注册区注册 `listenRoomContextSnapshot`，校验 `conversationId === selectedConversationId()` 与 `activeRoomClientSession()`，同步 messages/members/roundState
- [x] `listenRoomContextSnapshot` 事件携带 `hostCharacter*` 时更新 `RoomClientSession.hostCharacter`
- [x] `onCleanup` 清理区补充 `roomContextSnapshotUnlisten` 调用
- [x] 不修改 `currentAiCharacter`、`currentPlayerCharacter`、`hostMember` 等已有 memo 的逻辑
- [x] 不修改单人模式（`activeRoomClientSession()` 为 null）的渲染路径
- [x] 房主模式下 `listenRoomContextSnapshot` 跳过（`if (!activeRoomClientSession()) return`）
- [x] 不修改 `room:member_joined` / `room:member_left` / `room:stream_chunk` / `room:player_message` / `room:stream_retry` / `room:message_reset` 等其他房间事件监听器

## 验证

- [x] `npx tsc --noEmit` 修改文件（`App.tsx`、`backend/types.ts`、`backend/rooms.ts`）零诊断错误（pre-existing 错误均在无关文件中）
- [x] 移动端不在本次范围（`src-mobile/` 未实现多人房间功能）

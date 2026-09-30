# Tasks

- [x] Task 1: 后端扩展 `RoomJoinResult` 与 `room_join` 返回结构
  - [x] SubTask 1.1: 在 `RoomJoinResult` 中新增 `host_character_image_base64`、`host_character_name`、`host_character_description`、`full_messages` 字段（带 `#[serde(alias = "recentMessages")]` 兼容旧字段名）
  - [x] SubTask 1.2: 在 `room_join` 命令路径中填充上述字段（从房主当前 `selectedCharacter` 读取图片 base64、name、description；从 DB 读取全量消息替换 `recent_messages`）
  - [x] SubTask 1.3: 保持 `recent_messages` 字段序列化以兼容旧前端

- [x] Task 2: 后端新增 `room:context_snapshot` 事件与 `room_request_context` 命令
  - [x] SubTask 2.1: 在 `RoomMessage` enum 中新增 `ContextSnapshot` variant
  - [x] SubTask 2.2: 新增 `RoomContextSnapshotPayload` flat 结构（`#[serde(rename_all = "camelCase")]`）用于 Tauri 事件发射
  - [x] SubTask 2.3: 在 `network/mod.rs` 的 `event_name()` 与 `event_payload()` 中补充 `room:context_snapshot` 的 Tauri event 转发
  - [x] SubTask 2.4: 新增 `room_request_context` Tauri 命令：从房间上下文读取全量消息、成员、roundState、房主角色，广播 `ContextSnapshot` 给请求方

- [x] Task 3: 后端在 `MemberJoined` 广播失败时主动推送 `ContextSnapshot`
  - [x] SubTask 3.1: 在房主处理 `room_join` 时，若检测到 broadcast 失败（client connection lost 等），fallback 推一次 `ContextSnapshot` 给该 client
  - [x] SubTask 3.2: 兜底推送逻辑：构造 `RoomMessage::ContextSnapshot` 并直接发送给该 member 的 TCP 连接

- [x] Task 4: 前端扩展 `RoomJoinResult` 与新增类型
  - [x] SubTask 4.1: 在 `src/lib/backend/types.ts` 扩展 `RoomJoinResult`，新增 `hostCharacterImageBase64`、`hostCharacterName`、`hostCharacterDescription`、`fullMessages` 可选字段，保留 `recentMessages` 字段
  - [x] SubTask 4.2: 在 `src/lib/backend/types.ts` 新增 `RoomHostCharacter` 接口（name / description / imagePath / imageBase64）
  - [x] SubTask 4.3: 在 `src/lib/backend/types.ts` 新增 `RoomContextSnapshotEvent` 接口（conversationId / messages / members / roundState / 房主角色三字段）

- [x] Task 5: 前端新增 `listenRoomContextSnapshot` 与 `roomRequestContext`
  - [x] SubTask 5.1: 在 `src/lib/backend/rooms.ts` 新增 `listenRoomContextSnapshot(handler)`，监听 `room:context_snapshot` Tauri 事件
  - [x] SubTask 5.2: 在 `src/lib/backend/rooms.ts` 新增 `roomRequestContext()`，调用 `room_request_context` Tauri 命令
  - [x] SubTask 5.3: 在 `src/lib/backend/rooms.ts` 文件顶部 import 中加入 `RoomContextSnapshotEvent` 类型

- [x] Task 6: 前端 App.tsx 集成房主角色与 context snapshot
  - [x] SubTask 6.1: 在 `src/App.tsx` 顶部 import 中加入 `RoomHostCharacter`、`RoomContextSnapshotEvent`、`listenRoomContextSnapshot`、`roomRequestContext`
  - [x] SubTask 6.2: 扩展 `RoomClientSession` 类型，新增 `hostCharacter?: RoomHostCharacter | null` 字段
  - [x] SubTask 6.3: 新增 `remoteHostCharacter` memo（`activeRoomClientSession()?.hostCharacter ?? null`）
  - [x] SubTask 6.4: 修改 `selectedCharacter` memo：房客模式下优先返回 `remoteHostCharacter()`，房主模式保持原行为
  - [x] SubTask 6.5: 修改 `AuroraBackground` 传参：房客模式下优先使用 `roomClientSession()?.hostCharacter?.imageBase64`
  - [x] SubTask 6.6: 修改 `toChatMessage`：房客模式下 AI 消息 `avatar` 优先使用 `remoteHostCharacter()?.imageBase64`，`senderName` 在本地角色名缺失时回退到 `remoteHostCharacter()?.name`
  - [x] SubTask 6.7: 修改 `upsertStreamingAssistant`：新建 AI 消息时 `avatar` 优先使用 `remoteHostCharacter()?.imageBase64`，`senderName` 优先使用 `remoteHostCharacter()?.name`
  - [x] SubTask 6.8: 修改 `handleRoomJoined`：将 `RoomJoinResult` 中的 `hostCharacter*` 字段填充到 `RoomClientSession.hostCharacter`，并调用 `roomRequestContext()` 主动拉取一次
  - [x] SubTask 6.9: 在 `src/App.tsx` 事件注册区注册 `listenRoomContextSnapshot`：校验 `conversationId`、房客会话，同步 messages/members/roundState 并按需更新 `hostCharacter`
  - [x] SubTask 6.10: 在 `onCleanup` 中补充 `roomContextSnapshotUnlisten` 清理调用

# Task Dependencies

- Task 1、2、3 属于后端，由 backend 任务实现（已完成）
- Task 4、5、6 属于前端，本次实现
- Task 6 依赖 Task 4（需要 `RoomHostCharacter` / `RoomContextSnapshotEvent` 类型已定义）和 Task 5（需要监听函数已实现）

# Tasks

- [x] Task 1: 数据库迁移 — 新增 `guest_character_json` 列
  - [x] SubTask 1.1: 新建 `src-tauri/migrations/0038_conversation_member_guest_character.sql`，内容为 `ALTER TABLE conversation_members ADD COLUMN guest_character_json TEXT;`

- [x] Task 2: 后端 — 定义 `GuestCharacterCardPayload` 结构并扩展 `JoinRoom` 消息
  - [x] SubTask 2.1: 在 `src-tauri/src/network/mod.rs` 中定义 `GuestCharacterCardPayload` 结构（`name: String`、`description: String`、`tags: Vec<String>`、`base_sections: Vec<GuestCharacterBaseSection>`），使用 `#[serde(rename_all = "camelCase")]`
  - [x] SubTask 2.2: 定义 `GuestCharacterBaseSection` 结构（`section_key: String`、`title: Option<String>`、`content: String`）
  - [x] SubTask 2.3: 在 `RoomMessage::JoinRoom` variant 中新增 `character: Option<GuestCharacterCardPayload>` 字段

- [x] Task 3: 后端 — `RoomServer::start` join 流程写入 `guest_character_json`
  - [x] SubTask 3.1: 在 `RoomServer::start` 的 join 处理流程中（读取 `JoinRoom` 消息后），若 `character` 为 `Some`，将其序列化为 JSON 字符串
  - [x] SubTask 3.2: 校验 JSON 字符串长度不超过 256KB（256 * 1024 字节），超过时通过 `write_error_frame` 返回 `CHARACTER_TOO_LARGE` 错误并 return
  - [x] SubTask 3.3: 修改 `INSERT INTO conversation_members` 语句，新增 `guest_character_json` 列绑定

- [x] Task 4: 后端 — `RoomClient` 与 `room_join` 命令接受 `character` 参数
  - [x] SubTask 4.1: 修改 `RoomClient::new` 签名，新增 `character: Option<GuestCharacterCardPayload>` 参数
  - [x] SubTask 4.2: 修改 `RoomClient::connect`，在构造 `JoinRoom` 消息时携带 `character`
  - [x] SubTask 4.3: 修改 `src-tauri/src/commands/rooms.rs` 的 `room_join` 命令，新增 `character: Option<GuestCharacterCardPayload>` 参数，透传到 `RoomClient::new`

- [x] Task 5: 后端 — Prompt Compiler 加载房客角色卡并生成 PlayerBase block
  - [x] SubTask 5.1: 在 `ConversationCompileContext` 结构体中新增 `guest_characters: Vec<CharacterCompileData>` 字段
  - [x] SubTask 5.2: 修改 `load_conversation_compile_context`：在 `conversation_type = "online"` 时，额外查询所有 `member_role = 'member'` 且 `guest_character_json IS NOT NULL` 的成员数据
  - [x] SubTask 5.3: 新增 `load_guest_character_compile_data(json: &str) -> Option<CharacterCompileData>` 函数，将 `guest_character_json` 反序列化为 `CharacterCompileData`（`character_id` 使用 `member_id` 的负值以避免与 `character_cards.id` 冲突）
  - [x] SubTask 5.4: 修改 `compile_prompt`：在 `player_character_data` 的 PlayerBase block 生成之后，遍历 `context.guest_characters`，为每项调用 `build_player_base_block_for_guest` 生成独立的 PlayerBase block
  - [x] SubTask 5.5: 新增 `build_player_base_block_for_guest(character_data: &CharacterCompileData) -> Option<PromptBlock>` 函数，与 `build_player_base_block` 逻辑一致，但 title 设为 `format!("Player Base — {}", character_data.name)`

- [x] Task 6: 前端 — 新增 `GuestCharacterCardPayload` 类型与 `roomJoin` 参数
  - [x] SubTask 6.1: 在 `src/lib/backend/types.ts` 中新增 `GuestCharacterBaseSection` 接口（`sectionKey: string`、`title?: string`、`content: string`）
  - [x] SubTask 6.2: 在 `src/lib/backend/types.ts` 中新增 `GuestCharacterCardPayload` 接口（`name: string`、`description: string`、`tags: string[]`、`baseSections: GuestCharacterBaseSection[]`）
  - [x] SubTask 6.3: 修改 `src/lib/backend/rooms.ts` 的 `roomJoin` 函数，payload 新增可选 `character?: GuestCharacterCardPayload` 字段

- [x] Task 7: 前端 — `JoinRoomModal` 新增角色卡选择器
  - [x] SubTask 7.1: 修改 `JoinRoomModal` 组件 props，新增 `playerCharacters: CharacterCard[]` 参数
  - [x] SubTask 7.2: 在 `JoinRoomModal` 中新增 `selectedCharacterId` signal 与角色卡选择器 UI（下拉或卡片列表，从 `props.playerCharacters` 中选择）
  - [x] SubTask 7.3: 选择角色卡时，自动将 `displayName` 设为角色卡 `name`（用户仍可手动修改）
  - [x] SubTask 7.4: 修改 `handleJoin`：若选中了角色卡，构造 `GuestCharacterCardPayload`（从 `CharacterCard` 映射 name / description / tags / baseSections），传入 `roomJoin` 调用
  - [x] SubTask 7.5: 在 `src/App.tsx` 中将 `playerCharacters` 传给 `JoinRoomModal` 组件

- [x] Task 8: 编译验证与回归检查
  - [x] SubTask 8.1: `cargo build` 确认后端编译通过
  - [x] SubTask 8.2: `npx tsc --noEmit` 确认修改文件零新增诊断错误
  - [x] SubTask 8.3: 确认单人模式（single）prompt 编译路径不受影响（`guest_characters` 仅在 online 模式查询）
  - [x] SubTask 8.4: 确认未携带角色卡的房客仍可正常加入（`character: None` 路径）

# Task Dependencies

- Task 2 依赖 Task 1（迁移文件先存在）
- Task 3 依赖 Task 2（需要 `GuestCharacterCardPayload` 结构先定义）
- Task 4 依赖 Task 2（需要 `GuestCharacterCardPayload` 结构先定义）
- Task 5 依赖 Task 1（需要 `guest_character_json` 列存在）和 Task 2（需要结构定义）
- Task 6 独立于后端，可与 Task 2-5 并行
- Task 7 依赖 Task 6（需要前端类型先定义）
- Task 8 依赖 Task 1-7 全部完成

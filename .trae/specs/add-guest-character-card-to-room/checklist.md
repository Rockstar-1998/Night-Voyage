# Checklist

## 数据库迁移

- [x] `src-tauri/migrations/0038_conversation_member_guest_character.sql` 文件存在且内容为 `ALTER TABLE conversation_members ADD COLUMN guest_character_json TEXT;`
- [x] 应用启动时迁移自动执行，`conversation_members` 表新增 `guest_character_json` 列
- [x] 迁移不会破坏既有数据（纯新增列，无 schema 变更冲突）

## 后端协议层（network/mod.rs）

- [x] `GuestCharacterCardPayload` 结构体定义存在，字段为 `name: String`、`description: String`、`tags: Vec<String>`、`base_sections: Vec<GuestCharacterBaseSection>`，标注 `#[serde(rename_all = "camelCase")]`
- [x] `GuestCharacterBaseSection` 结构体定义存在，字段为 `section_key: String`、`title: Option<String>`、`content: String`
- [x] `RoomMessage::JoinRoom` variant 新增 `character: Option<GuestCharacterCardPayload>` 字段
- [x] `JoinRoom.character` 为 `Option`（向后兼容：未携带角色卡的房客仍能加入）
- [x] `RoomServer::start` join 流程在读取 `JoinRoom` 后，若 `character.is_some()`，将其序列化为 JSON 字符串
- [x] JSON 字符串长度 > 256KB（256 * 1024 字节）时通过 `write_error_frame` 返回 `CHARACTER_TOO_LARGE` 错误并 return
- [x] `INSERT INTO conversation_members` 语句新增 `guest_character_json` 列绑定（character 为 None 时绑定 NULL）
- [x] `RoomClient::new` 签名新增 `character: Option<GuestCharacterCardPayload>` 参数
- [x] `RoomClient::connect` 在构造 `JoinRoom` 消息时携带 `character` 字段

## 后端命令层（commands/rooms.rs）

- [x] `room_join` Tauri 命令新增 `character: Option<GuestCharacterCardPayload>` 参数
- [x] `room_join` 将 `character` 透传到 `RoomClient::new`
- [x] 命令在 `lib.rs` 的 `tauri::generate_handler!` 中注册无需变更（参数变更不影响注册）

## 后端 Prompt Compiler（services/prompt_compiler.rs）

- [x] `ConversationCompileContext` 结构体新增 `guest_characters: Vec<CharacterCompileData>` 字段
- [x] `load_conversation_compile_context` 在 `conversation_type = "online"` 时额外查询所有 `member_role = 'member' AND is_active = 1 AND guest_character_json IS NOT NULL` 的成员数据
- [x] `load_conversation_compile_context` 在 `conversation_type = "single"` 时**不**查询 `guest_character_json`（保持现有行为）
- [x] 新增 `load_guest_character_compile_data(json: &str) -> Option<CharacterCompileData>` 函数，将 JSON 反序列化为 `CharacterCompileData`
- [x] `load_guest_character_compile_data` 中 `character_id` 使用 `member_id` 的负值（避免与 `character_cards.id` 冲突）
- [x] 新增 `build_player_base_block_for_guest(character_data: &CharacterCompileData) -> Option<PromptBlock>` 函数
- [x] `build_player_base_block_for_guest` 的 title 为 `format!("Player Base — {}", character_data.name)`
- [x] `build_player_base_block_for_guest` 的 `PromptBlockSource::Player { character_id }` 使用 guest 的 character_id
- [x] `build_player_base_block_for_guest` 的 `required: true`、`role: System`、`priority: 250`
- [x] `compile_prompt` 在房主 PlayerBase block 生成之后，遍历 `context.guest_characters` 为每项调用 `build_player_base_block_for_guest` 生成独立 PlayerBase block
- [x] 多个 PlayerBase block 在 `system_blocks` 中按生成顺序排列（房主在前，房客按查询顺序）

## 前端类型与 API（src/lib/backend/）

- [x] `src/lib/backend/types.ts` 新增 `GuestCharacterBaseSection` 接口（`sectionKey: string`、`title?: string`、`content: string`）
- [x] `src/lib/backend/types.ts` 新增 `GuestCharacterCardPayload` 接口（`name: string`、`description: string`、`tags: string[]`、`baseSections: GuestCharacterBaseSection[]`）
- [x] `src/lib/backend/rooms.ts` 的 `roomJoin` 函数 payload 新增可选 `character?: GuestCharacterCardPayload` 字段

## 前端 UI（JoinRoomModal.tsx + App.tsx）

- [x] `JoinRoomModal` 组件 props 新增 `playerCharacters: CharacterCard[]` 参数
- [x] `JoinRoomModal` 中新增角色卡选择器 UI（下拉或卡片列表）
- [x] 选择角色卡时自动填充 `displayName`（用户仍可手动修改）
- [x] `handleJoin` 在选中角色卡时构造 `GuestCharacterCardPayload` 并传入 `roomJoin`
- [x] `handleJoin` 在未选中角色卡时不传 `character`（或传 `undefined`）
- [x] `App.tsx` 中将 `playerCharacters` 透传给 `JoinRoomModal`
- [x] 未选中角色卡时加入按钮仍可点击（角色卡为可选）

## 编译与回归

- [x] `cargo build` 通过（无新增编译错误）
- [x] `npx tsc --noEmit` 无新增 TypeScript 诊断错误（已有的 pre-existing 错误不受影响）
- [x] 单人模式（`conversation_type = "single"`）的 prompt 编译路径不受影响
- [x] 未携带角色卡的房客（`character: None`）仍能正常加入房间
- [x] 携带角色卡的房客加入后，房主端 prompt 编译生成的 `system_blocks` 中包含该房客的 PlayerBase block
- [x] 两位房客同时携带角色卡时，`system_blocks` 中包含两个标题不同的 PlayerBase block（`"Player Base — {name1}"`、`"Player Base — {name2}"`）

## 边界约束验证

- [x] `character_cards` 表结构与 `character_card_base_sections` 表结构未被修改
- [x] `PlayerBase` block 的 priority 仍为 250、`required: true`
- [x] 现有 `JoinSuccess` / `ContextSnapshot` / `MemberJoined` 等 variant 字段未被修改
- [x] 未引入新的 HTTP 服务或文件传输机制（仅通过 TCP 帧内联 JSON 传输）
- [x] guest_character_json 超过 256KB 时返回 `CHARACTER_TOO_LARGE` 错误并拒绝加入

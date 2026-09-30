# 房客携带人设卡加入房间 Spec

## Why

当前房客加入多人模式房间时只能填写显示名称（`JoinRoom` 仅携带 `display_name` + `passphrase`），房客没有任何角色卡数据。Prompt Compiler 的 `PlayerBase` block 仅从房主成员的 `player_character_id` 加载（[prompt_compiler.rs:1287-1290](file:///d:/data/Night/Voyage/src-tauri/src/services/prompt_compiler.rs#L1287-L1290) 中 `WHERE member_role = 'host'`），AI 完全不知道房客是谁、性格如何、背景怎样。需要让房客加入时携带自己的人设卡，且该卡内容必须注入到发送给 LLM 的 prompt 中。

## What Changes

- **新增数据库迁移 `0038_conversation_member_guest_character.sql`**：在 `conversation_members` 表新增 `guest_character_json TEXT` 列，存储房客携带的角色卡 JSON 数据（name / description / tags / base_sections）。
- **扩展 `RoomMessage::JoinRoom`**：新增 `character: Option<GuestCharacterCardPayload>` 字段，房客在加入时携带自己的角色卡数据（不依赖房主 DB 的 `character_cards` 表，因为房客的卡不在房主 DB 中）。
- **修改 `RoomServer::start` join 处理流程**：当 `JoinRoom.character` 存在时，将其序列化为 JSON 写入 `conversation_members.guest_character_json`。
- **修改 `room_join` Tauri 命令**：新增 `character` 参数，透传到 `RoomClient::connect` 的 `JoinRoom` 消息中。
- **修改 `RoomClient::connect` 与 `RoomClient::new`**：接受 `character` 参数，在 `JoinRoom` 消息中携带。
- **修改 Prompt Compiler**：
  - `load_conversation_compile_context` 在 online 模式下加载所有活跃成员的角色卡数据（房主走 `player_character_id` → `character_cards` 表；房客走 `guest_character_json` → 反序列化）。
  - 新增 `load_guest_character_compile_data` 函数，从 `guest_character_json` 反序列化为 `CharacterCompileData`。
  - `compile_prompt` 在 online 模式下为每位有角色卡数据的成员各生成一个 `PlayerBase` block（标题区分不同玩家，如 `"Player Base — {name}"`）。
- **修改前端 `JoinRoomModal`**：新增玩家角色卡选择器（从本地 `playerCharacters` 列表选择），加入时将选中卡片的 name / description / tags / baseSections 作为 `character` 参数发送。
- **修改前端 `roomJoin` 函数**：接受 `character` 参数。
- **单人模式不受影响**：所有 guest character 逻辑仅在 `conversation_type = "online"` 路径生效。

## Impact

- Affected specs:
  - `player-character-binding-and-chat-avatars` — PlayerBase 从仅房主扩展到所有 online 成员
  - `remove-examples-prefill-add-player-base` — PlayerBase block 来源从单一扩展到多成员
  - `implement-multiplayer-room-mode` — JoinRoom 协议扩展
  - `fix-room-guest-client-sync` — 房客数据同步范围扩展
- Affected code:
  - `src-tauri/migrations/0038_conversation_member_guest_character.sql` — 新建迁移
  - `src-tauri/src/network/mod.rs` — `RoomMessage::JoinRoom` 新增字段；`RoomServer::start` join 流程写入 `guest_character_json`；`RoomClient::new` / `connect` 接受 character
  - `src-tauri/src/commands/rooms.rs` — `room_join` 命令新增 `character` 参数
  - `src-tauri/src/services/prompt_compiler.rs` — `ConversationCompileContext` 新增 `guest_characters: Vec<CharacterCompileData>`；`load_conversation_compile_context` 加载所有成员角色；`compile_prompt` 为每位成员生成 PlayerBase block
  - `src/components/JoinRoomModal.tsx` — 新增角色卡选择器 UI
  - `src/lib/backend/rooms.ts` — `roomJoin` 接受 `character` 参数
  - `src/lib/backend/types.ts` — 新增 `GuestCharacterCardPayload` 接口

## 边界与约束

- **不修改** `character_cards` 表结构或 `character_card_base_sections` 表结构——房客角色卡以 JSON 内联方式存储，不写入房主的 `character_cards` 表。
- **不修改** `PlayerBase` block 的 priority（仍为 250）和 `required: true` 属性。
- **不修改** 单人模式（`conversation_type = "single"`）的 prompt 编译路径。
- **不修改** 现有 `JoinSuccess` / `ContextSnapshot` / `MemberJoined` 等 variant 的字段定义（仅扩展 `JoinRoom`）。
- **不引入** 新的 HTTP 服务或文件传输机制——角色卡数据通过 TCP 帧内联传输（JSON），图片 base64 不纳入 prompt（prompt 只需要文本数据；图片同步由 `fix-room-guest-client-sync` 的 `host_character_image_base64` 机制处理）。
- **guest_character_json 大小限制**：JSON 序列化后不超过 256KB（足够容纳 name + description + tags + 5 个 base_section），超过时拒绝加入并返回明确错误。
- **向后兼容**：`JoinRoom.character` 为 `Option`，未携带角色卡的房客仍可加入（仅显示名称，不注入 PlayerBase block）。

---

## ADDED Requirements

### Requirement: GuestCharacterCardPayload 数据结构

系统 SHALL 定义 `GuestCharacterCardPayload` 结构，用于房客在加入房间时携带自己的角色卡文本数据。

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GuestCharacterCardPayload {
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub base_sections: Vec<GuestCharacterBaseSection>,
}
```

```typescript
export interface GuestCharacterCardPayload {
  name: string;
  description: string;
  tags: string[];
  baseSections: { sectionKey: string; title?: string; content: string }[];
}
```

#### Scenario: 房客携带完整角色卡

- **WHEN** 房客选择了本地玩家角色卡并加入房间
- **THEN** `JoinRoom` 消息的 `character` 字段 SHALL 包含该卡的 name / description / tags / baseSections
- **AND** 房主后端 SHALL 将其序列化为 JSON 存入 `conversation_members.guest_character_json`

#### Scenario: 房客未携带角色卡

- **WHEN** 房客未选择角色卡直接加入
- **THEN** `JoinRoom.character` SHALL 为 `None`
- **AND** `conversation_members.guest_character_json` SHALL 为 `NULL`
- **AND** Prompt Compiler SHALL 不为该成员生成 PlayerBase block

### Requirement: JoinRoom 消息扩展

系统 SHALL 在 `RoomMessage::JoinRoom` variant 中新增 `character: Option<GuestCharacterCardPayload>` 字段。

#### Scenario: 携带角色卡的 JoinRoom

- **WHEN** 房客发送 `JoinRoom { display_name, passphrase, character: Some(...) }`
- **THEN** 房主 `RoomServer` SHALL 在 `INSERT INTO conversation_members` 时将 `character` 序列化为 JSON 写入 `guest_character_json` 列

#### Scenario: JSON 超过 256KB

- **WHEN** `character` 序列化后的 JSON 字符串长度超过 256KB
- **THEN** 房主 SHALL 返回 `Error { code: "CHARACTER_TOO_LARGE", message: "角色卡数据过大（超过 256KB），请精简后重试" }` 并拒绝加入

### Requirement: 房客角色卡数据加载（Prompt Compiler）

系统 SHALL 在 online 模式的 prompt 编译中加载所有活跃成员的角色卡数据，为每位有角色卡数据的成员生成独立的 PlayerBase block。

#### Scenario: 房主有 player_character_id，房客有 guest_character_json

- **WHEN** 编译 online 会话的 prompt，房主成员有 `player_character_id`，房客成员有 `guest_character_json`
- **THEN** 编译器 SHALL 为房主生成一个 PlayerBase block（从 `character_cards` 表加载）
- **AND** 编译器 SHALL 为房客生成一个 PlayerBase block（从 `guest_character_json` 反序列化）
- **AND** 两个 block 的 title SHALL 区分不同玩家（如 `"Player Base — {name}"`）

#### Scenario: 房客未携带角色卡

- **WHEN** 编译 online 会话的 prompt，某房客成员的 `guest_character_json` 为 `NULL`
- **THEN** 编译器 SHALL 不为该成员生成 PlayerBase block

#### Scenario: 单人模式不受影响

- **WHEN** 编译 single 会话的 prompt
- **THEN** 编译器 SHALL 仅从房主的 `player_character_id` 加载 PlayerBase（与现有行为一致）
- **AND** 不查询 `guest_character_json`

### Requirement: 房客角色卡 PlayerBase block 标题

系统 SHALL 在为房客生成 PlayerBase block 时，将标题设为 `"Player Base — {member_name}"`，以区分不同玩家的角色卡。

#### Scenario: 两位房客携带角色卡

- **WHEN** 房客 A（name="雁"）和房客 B（name="煜秋"）都携带角色卡
- **THEN** system_blocks 中 SHALL 包含两个 PlayerBase block，标题分别为 `"Player Base — 雁"` 和 `"Player Base — 煜秋"`

### Requirement: JoinRoomModal 角色卡选择器

系统 SHALL 在 `JoinRoomModal` 中新增玩家角色卡选择器，房客可在加入房间前选择自己的角色卡。

#### Scenario: 房客选择角色卡后加入

- **WHEN** 房客在选择器中选中一张玩家角色卡并点击"加入房间"
- **THEN** `roomJoin` 调用 SHALL 携带 `character` 参数（包含 name / description / tags / baseSections）
- **AND** 加入成功后房客的显示名称 SHALL 为角色卡的 `name`

#### Scenario: 房客不选择角色卡

- **WHEN** 房客未选择角色卡
- **THEN** 加入按钮 SHALL 仍可点击（角色卡为可选）
- **AND** `roomJoin` 调用 SHALL 不携带 `character` 参数（或为 `undefined`）

#### Scenario: 房客手动填写显示名称与角色卡名称不一致

- **WHEN** 房客选择了角色卡但手动修改了显示名称输入框
- **THEN** 显示名称 SHALL 以手动输入为准（显示名称是独立字段，不强制等于角色卡名称）
- **AND** `character.name` SHALL 仍为角色卡的原始名称（prompt 中使用角色卡名称）

## MODIFIED Requirements

### Requirement: load_conversation_compile_context（来自 remove-examples-prefill-add-player-base）

原 spec 规定 `load_conversation_compile_context` 仅查询房主成员的 `player_character_id`。修改为：在 `conversation_type = "online"` 时，额外查询所有活跃成员的 `guest_character_json`，返回 `guest_characters: Vec<CharacterCompileData>`。

### Requirement: compile_prompt PlayerBase 注入（来自 remove-examples-prefill-add-player-base）

原 spec 规定仅为房主 `player_character_id` 生成一个 PlayerBase block。修改为：在 online 模式下，为 `player_character_data` 和 `guest_characters` 中的每项各生成一个 PlayerBase block，标题区分玩家。

### Requirement: JoinRoom 消息（来自 implement-multiplayer-room-mode）

原 spec 规定 `JoinRoom` 仅携带 `display_name` 和 `passphrase`。修改为：新增 `character: Option<GuestCharacterCardPayload>` 可选字段。

### Requirement: room_join 命令（来自 implement-multiplayer-room-mode）

原 spec 规定 `room_join` 接受 `host_address`、`port`、`display_name`。修改为：新增 `character: Option<GuestCharacterCardPayload>` 参数。

## REMOVED Requirements

（无移除项）

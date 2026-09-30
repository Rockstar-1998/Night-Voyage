# Tasks

- [x] Task 1: 后端 — 会话创建时自动从玩家角色卡获取 display_name
  - [x] SubTask 1.1: 修改 `conversations_create` 命令，将 `host_display_name` 改为 `Option<String>`（可选），当为空时从 `host_player_character_id` 对应的角色卡查询 `name` 自动填充
  - [x] SubTask 1.2: 修改 `host_player_character_id` 为必填字段（`i64` 而非 `Option<i64>`），添加校验
  - [x] SubTask 1.3: 在创建 host member 的 SQL 中使用自动获取的 display_name

- [x] Task 2: 后端 — 支持会话中切换玩家角色卡
  - [x] SubTask 2.1: 确认 `conversation_members_update` 命令已支持更新 `player_character_id`
  - [x] SubTask 2.2: 修改 `conversation_members_update`，当 `player_character_id` 更新时，自动从角色卡查询 `name` 并更新 `display_name`

- [x] Task 3: 前端 — 移除房主显示名输入框，新增玩家角色卡选择器
  - [x] SubTask 3.1: 在 `NewChatModal.tsx` 中移除"房主显示名"输入框
  - [x] SubTask 3.2: 在 `NewChatModal.tsx` 中新增玩家角色卡选择器（使用 `playerCharacters` 列表）
  - [x] SubTask 3.3: 修改 `CreateConversationPayload`：移除 `hostDisplayName`，`hostPlayerCharacterId` 改为必填
  - [x] SubTask 3.4: 修改提交逻辑：`hostDisplayName` 自动从选中的玩家角色卡 `name` 获取，`hostPlayerCharacterId` 使用选中的玩家角色卡 ID

- [x] Task 4: 前端 — 聊天消息使用角色卡头像和昵称
  - [x] SubTask 4.1: 在 App.tsx 中，加载会话时同时获取 AI 角色卡和玩家角色卡数据（从 `npcCharacters` 和 `playerCharacters` 中按 ID 查找）
  - [x] SubTask 4.2: 修改 `toChatMessage` 函数，接受 AI 角色卡和玩家角色卡参数，AI 消息使用角色卡 `name` 和 `imagePath`，玩家消息使用玩家角色卡 `name` 和 `imagePath`
  - [x] SubTask 4.3: 修改流式消息创建（`upsertAssistantMessage`），使用 AI 角色卡的 `name` 替代硬编码 `"CHAT A.I+"`
  - [x] SubTask 4.4: 修改用户消息创建，使用玩家角色卡的 `name` 和 `imagePath`

- [x] Task 5: 前端 — 会话中切换玩家角色卡的 UI
  - [x] SubTask 5.1: 在聊天界面的会话设置区域添加玩家角色卡切换功能
  - [x] SubTask 5.2: 调用 `conversationMembersUpdate` 更新 `playerCharacterId`
  - [x] SubTask 5.3: 切换后更新本地状态中的角色卡引用，使新消息使用新的头像和昵称

- [x] Task 6: 验证
  - [x] SubTask 6.1: 确认新建会话时必须选择玩家角色卡
  - [x] SubTask 6.2: 确认 AI 消息显示角色卡头像和昵称
  - [x] SubTask 6.3: 确认玩家消息显示玩家角色卡头像和昵称
  - [x] SubTask 6.4: 确认切换玩家角色卡后新消息使用新的头像和昵称

# Task Dependencies

- Task 1 和 Task 2 可并行（后端改动）
- Task 3 依赖 Task 1（前端需要适配新的后端接口）
- Task 4 依赖 Task 1（需要角色卡数据可用）
- Task 5 依赖 Task 2 和 Task 4
- Task 6 依赖所有其他任务

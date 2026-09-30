# Tasks

- [x] Task 1: 后端 — `conversations_create` 支持开场消息插入
  - [x] 1.1: 在 `conversations_create` 命令中新增 `opening_message_index: Option<i64>` 参数
  - [x] 1.2: 创建会话后，若 `opening_message_index` 有效，查询角色卡的 `firstMessages`，取出对应消息
  - [x] 1.3: 在 round 1 中插入 `role=assistant` 消息，设置 round 1 为 `completed`，创建 round 2（`collecting`）
  - [x] 1.4: 在 `ConversationCreateResult` 中返回开场消息信息（或确保现有消息加载逻辑能覆盖）

- [x] Task 2: 前端类型 — `CreateConversationPayload` 新增 `openingMessageIndex` 字段
  - [x] 2.1: 在 `src/lib/backend.ts` 的 `CreateConversationPayload` 中新增 `openingMessageIndex?: number`

- [x] Task 3: 前端 UI — NewChatModal 新增开场消息选择区域
  - [x] 3.1: 在 Step 2 中，当 `selectedCharacter()?.firstMessages` 非空时，渲染开场消息选择列表
  - [x] 3.2: 新增 `selectedOpeningIndex` 信号，默认为 0（选中第一条），支持选择"不发送"（设为 -1）
  - [x] 3.3: 每条开场消息以可点击卡片展示，选中时高亮，内容截断预览
  - [x] 3.4: 提交时将 `openingMessageIndex` 传入 `CreateConversationPayload`

- [x] Task 4: 前端逻辑 — `handleCreateConversation` 传递开场消息索引
  - [x] 4.1: `NewChatModal` 的 `handleSubmit` 和 `handleCreateRoom` 中将 `selectedOpeningIndex()` 传入 payload
  - [x] 4.2: `handleCreateConversation` 接收并透传到 `conversationsCreate`

- [ ] Task 5: 验证 — 单人模式与联机模式开场消息功能
  - [ ] 5.1: 单人模式创建含开场消息的会话，验证聊天界面显示开场消息
  - [ ] 5.2: 联机模式创建含开场消息的会话，验证开场消息显示且后续发言从 round 2 开始
  - [ ] 5.3: 选择"不发送开场消息"时，行为与修改前一致

# Task Dependencies
- [Task 2] depends on [Task 1] (类型定义需与后端参数对齐)
- [Task 3] depends on [Task 2] (UI 需要使用新的 payload 字段)
- [Task 4] depends on [Task 3] (逻辑层需要 UI 层的信号)
- [Task 5] depends on [Task 4] (验证需要完整流程)

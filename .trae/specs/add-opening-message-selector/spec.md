# 开场消息选择与自动发送 Spec

## Why
创建会话后聊天界面为空，没有角色卡定义的开场消息（firstMessages）。用户需要在创建会话时能选择一条开场消息，创建后自动以角色身份发送到聊天中，让对话有自然的起始点。

## What Changes
- **NewChatModal** Step 2 新增「开场消息」选择区域：当所选角色卡有 `firstMessages` 时，展示列表供用户选择一条（或"不发送开场消息"）
- `CreateConversationPayload` 新增 `openingMessageIndex?: number` 字段，传递用户选择的开场消息索引
- **后端** `conversations_create` 命令新增 `opening_message_index: Option<i64>` 参数；创建会话后，若该参数有效，自动在 round 1 中以 host character 身份插入一条 assistant 消息
- 单人模式：直接插入开场消息，round 状态设为 `completed`
- 联机模式：插入开场消息作为 round 1 的 assistant 消息，round 状态设为 `completed`，后续玩家发言从 round 2 开始

## Impact
- Affected specs: 会话创建流程、消息提交流程
- Affected code:
  - `src/components/NewChatModal.tsx` — 新增开场消息选择 UI
  - `src/lib/backend.ts` — `CreateConversationPayload` 新增字段
  - `src-tauri/src/commands/conversations.rs` — `conversations_create` 新增参数与开场消息插入逻辑
  - `src/App.tsx` — `handleCreateConversation` 传递开场消息索引

## ADDED Requirements

### Requirement: 开场消息选择 UI
系统 SHALL 在新建会话 Step 2 中，当所选角色卡包含 `firstMessages` 且长度 > 0 时，展示开场消息选择区域。

#### Scenario: 角色卡有多条开场消息
- **WHEN** 用户在 Step 2 选择了含有多条 firstMessages 的角色卡
- **THEN** 显示开场消息选择列表，每条消息以卡片形式展示，默认选中第一条
- **AND** 提供"不发送开场消息"选项

#### Scenario: 角色卡无开场消息
- **WHEN** 用户选择的角色卡 firstMessages 为空数组
- **THEN** 不显示开场消息选择区域，创建会话时不发送开场消息

#### Scenario: 单人模式选择开场消息
- **WHEN** 用户选择单人会话模式并选择了一条开场消息
- **THEN** 创建会话后，该消息以角色（assistant）身份自动出现在聊天界面

#### Scenario: 联机模式选择开场消息
- **WHEN** 用户选择联机会话模式并选择了一条开场消息
- **THEN** 创建会话后，该消息以角色（assistant）身份自动出现在聊天界面，round 1 标记为 completed，后续玩家发言从 round 2 开始

### Requirement: 后端开场消息自动插入
系统 SHALL 在 `conversations_create` 命令中支持 `opening_message_index` 参数，当该参数有效时，自动在 round 1 中插入一条 assistant 消息。

#### Scenario: 有效的 opening_message_index
- **WHEN** `opening_message_index` 为非负整数且小于角色卡的 firstMessages 长度
- **THEN** 在 round 1 中插入一条 `role=assistant`、`content=firstMessages[index]` 的消息
- **AND** round 1 状态设为 `completed`，`active_assistant_message_id` 指向该消息
- **AND** 创建 round 2（状态为 `collecting`）供后续对话使用

#### Scenario: opening_message_index 为 None 或无效
- **WHEN** `opening_message_index` 为 None 或超出范围
- **THEN** 不插入开场消息，行为与当前一致（round 1 状态为 `collecting`，等待用户输入）

#### Scenario: 返回结果包含开场消息
- **WHEN** 开场消息被成功插入
- **THEN** `ConversationCreateResult` 中包含该消息的信息，前端可直接展示

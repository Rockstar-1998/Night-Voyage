# 玩家角色卡绑定与聊天头像/昵称真实化 Spec

## Why

当前聊天界面中 AI 和玩家的头像/昵称都是占位符（"CHAT A.I+"、"U"/"AI"），新建会话时还有一个手动填写的"房主显示名"字段。这些都不符合角色扮演的沉浸感需求——玩家显示名应由玩家角色卡决定，AI 头像/昵称应由 AI 角色卡决定。同时，会话需要明确知道当前选定的玩家角色卡，才能在 prompt 编译时注入 PlayerBase。

## What Changes

- **移除** 新建会话时的"房主显示名"输入框，`hostDisplayName` 改由玩家角色卡的 `name` 自动填充
- **新增** 新建会话时的"玩家角色卡"选择器，`host_player_character_id` 为必填项
- **修改** 聊天消息渲染：AI 消息的头像和昵称来自 AI 角色卡（`CharacterCard.imagePath` + `CharacterCard.name`）
- **修改** 聊天消息渲染：玩家消息的头像和昵称来自玩家角色卡（`CharacterCard.imagePath` + `CharacterCard.name`）
- **修改** `toChatMessage` 函数：从硬编码 `"CHAT A.I+"` 改为使用角色卡数据
- **修改** 流式消息创建：从硬编码 `"CHAT A.I+"` 改为使用角色卡数据
- **修改** 后端 `conversation_members.display_name`：创建会话时自动设为玩家角色卡的 `name`
- **BREAKING** `CreateConversationPayload.hostDisplayName` 字段语义变更：不再由用户手动输入，改为自动从玩家角色卡获取

## Impact

- Affected specs: remove-examples-prefill-add-player-base（PlayerBase 依赖 player_character_id 绑定）
- Affected code:
  - `src/components/NewChatModal.tsx` — 移除房主显示名输入框，新增玩家角色卡选择器
  - `src/App.tsx` — `toChatMessage` 和流式消息创建使用角色卡数据
  - `src/components/MessageItem.tsx` — 无需修改（已支持 avatar 和 senderName）
  - `src/lib/backend.ts` — `CreateConversationPayload` 接口调整
  - `src-tauri/src/commands/conversations.rs` — `host_display_name` 改为可选/自动填充
  - `src-tauri/src/models/mod.rs` — `CreateConversationPayload` 调整

## ADDED Requirements

### Requirement: 新建会话时选择玩家角色卡

系统 SHALL 在新建会话表单中提供玩家角色卡选择器，用户必须选择一张玩家角色卡才能创建会话。

#### Scenario: 用户选择玩家角色卡创建会话

- **WHEN** 用户在新建会话表单中选择了 AI 角色卡和玩家角色卡
- **THEN** `host_player_character_id` SHALL 被设置为所选玩家角色卡的 ID
- **AND** `host_display_name` SHALL 自动设为所选玩家角色卡的 `name`

#### Scenario: 用户未选择玩家角色卡

- **WHEN** 用户未选择玩家角色卡
- **THEN** 创建按钮 SHALL 被禁用

### Requirement: AI 消息使用角色卡头像和昵称

系统 SHALL 在聊天界面中用 AI 角色卡的 `imagePath` 和 `name` 渲染 AI 消息的头像和昵称。

#### Scenario: AI 角色卡有头像

- **WHEN** AI 消息被渲染且 AI 角色卡有 `imagePath`
- **THEN** 消息头像 SHALL 显示角色卡图片
- **AND** 消息昵称 SHALL 显示角色卡 `name`

#### Scenario: AI 角色卡无头像

- **WHEN** AI 消息被渲染且 AI 角色卡无 `imagePath`
- **THEN** 消息头像 SHALL 显示角色卡 `name` 的首字符

### Requirement: 玩家消息使用玩家角色卡头像和昵称

系统 SHALL 在聊天界面中用玩家角色卡的 `imagePath` 和 `name` 渲染玩家消息的头像和昵称。

#### Scenario: 玩家角色卡有头像

- **WHEN** 玩家消息被渲染且玩家角色卡有 `imagePath`
- **THEN** 消息头像 SHALL 显示玩家角色卡图片
- **AND** 消息昵称 SHALL 显示玩家角色卡 `name`

#### Scenario: 玩家角色卡无头像

- **WHEN** 玩家消息被渲染且玩家角色卡无 `imagePath`
- **THEN** 消息头像 SHALL 显示玩家角色卡 `name` 的首字符

### Requirement: 会话中切换玩家角色卡

系统 SHALL 允许用户在已有会话中切换玩家角色卡。切换后，新消息使用新角色卡的头像和昵称，旧消息保持不变。

#### Scenario: 用户切换玩家角色卡

- **WHEN** 用户在会话设置中切换了玩家角色卡
- **THEN** `conversation_members.player_character_id` SHALL 更新为新角色卡 ID
- **AND** `conversation_members.display_name` SHALL 更新为新角色卡 `name`
- **AND** 后续新消息使用新角色卡的头像和昵称

## MODIFIED Requirements

### Requirement: CreateConversationPayload

`CreateConversationPayload` SHALL 移除 `hostDisplayName` 字段的手动输入，改为自动从 `hostPlayerCharacterId` 对应的角色卡获取。`hostPlayerCharacterId` SHALL 为必填字段。

### Requirement: 后端会话创建

后端 `conversations_create` 命令 SHALL 接受 `host_player_character_id: i64`（必填），并自动从角色卡表查询 `name` 作为 `display_name` 写入 `conversation_members`。

### Requirement: toChatMessage 函数

`toChatMessage` 函数 SHALL 接受角色卡数据参数，AI 消息的 `senderName` 使用 AI 角色卡 `name`，`avatar` 使用 AI 角色卡 `imagePath`；玩家消息的 `senderName` 使用玩家角色卡 `name`，`avatar` 使用玩家角色卡 `imagePath`。

## REMOVED Requirements

### Requirement: 房主显示名手动输入

**Reason**: 玩家显示名应由玩家角色卡决定，不需要手动输入。
**Migration**: 新建会话表单移除"房主显示名"输入框，`hostDisplayName` 自动从玩家角色卡获取。已有会话的 `display_name` 保持不变。

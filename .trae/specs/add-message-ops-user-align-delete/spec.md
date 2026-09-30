# 消息操作增强 / 用户消息对齐 / 会话删除 Spec

## Why

当前消息缺少编辑、重新回复（swipe 版本切换）和分支操作，用户无法修正已发送的内容或在多个 AI 回复版本间切换；单人模式下用户消息头部被添加了不必要的玩家名前缀；AI 帮助按钮占据输入栏空间但未接入功能；用户消息与 AI 消息视觉上无区分；会话删除功能后端已实现但前端未接入。

## What Changes

- 新增消息操作按钮组：编辑消息内容、重新回复（生成新 swipe 版本）、选择回复版本（左右切换 swipe）、会话分支
- 单人模式下移除请求体中用户消息的 `玩家名: ` 前缀
- 删除聊天输入栏左侧的 AI 帮助按钮
- 用户消息右对齐（头像在右，内容靠右）
- 前端接入会话删除功能

## Impact

- Affected specs: 无已有 spec 直接受影响
- Affected code:
  - `src/components/MessageItem.tsx` — 消息操作按钮组、用户消息右对齐布局
  - `src/components/ChatInputBar.tsx` — 移除 AI 帮助按钮
  - `src/components/ChatArea.tsx` — 传递消息操作回调
  - `src/App.tsx` — 消息操作处理函数、会话删除
  - `src/components/SessionSidebar.tsx` — 会话删除 UI
  - `src/lib/backend.ts` — 新增消息编辑、swipe 切换命令封装
  - `src-tauri/src/commands/chat.rs` — 新增 `messages_update_content`、`messages_switch_swipe` Tauri 命令
  - `src-tauri/src/commands/chat.rs` — 修改 `build_aggregated_user_content` 单人模式逻辑

---

## ADDED Requirements

### Requirement: 消息编辑

系统 SHALL 允许用户编辑已发送的消息内容。

#### Scenario: 编辑用户消息

- **WHEN** 用户点击用户消息上的编辑按钮
- **THEN** 消息内容区 SHALL 变为可编辑的文本框，预填充当前消息内容
- **AND** 文本框下方 SHALL 显示"保存"和"取消"按钮
- **AND** 用户修改内容后点击"保存"，系统 SHALL 调用后端 `messages_update_content` 命令更新消息
- **AND** 保存后文本框 SHALL 恢复为格式化渲染视图

#### Scenario: 编辑 AI 消息

- **WHEN** 用户点击 AI 消息上的编辑按钮
- **THEN** 与编辑用户消息行为一致，允许修改 AI 回复内容

#### Scenario: 后端消息更新命令

- **THEN** 后端 SHALL 暴露 `messages_update_content` Tauri 命令
- **AND** 命令接收 `message_id: i64` 和 `content: String`
- **AND** 命令 SHALL 更新 `messages` 表中对应记录的 `content` 字段
- **AND** 若消息有 `message_content_parts`，SHALL 同步更新可见文本部分

---

### Requirement: 重新回复（Swipe 版本生成与切换）

系统 SHALL 支持对 AI 消息生成新的回复版本并在版本间切换。

#### Scenario: 重新回复

- **WHEN** 用户点击 AI 消息上的重新回复按钮
- **THEN** 系统 SHALL 调用现有的 `regenerate_round_internal` 逻辑生成新的 swipe 版本
- **AND** 新版本 SHALL 自动成为当前显示版本

#### Scenario: 选择回复版本

- **WHEN** AI 消息存在多个 swipe 版本（`swipeIndex > 0` 或同轮次有多条 assistant 消息）
- **THEN** 消息底部 SHALL 显示版本切换器：`◀ 版本 N/M ▶`
- **AND** 点击 ◀ 或 ▶ SHALL 切换到相邻版本
- **AND** 切换版本时 SHALL 调用后端 `messages_switch_swipe` 命令更新轮次的 `active_assistant_message_id`

#### Scenario: 后端 swipe 切换命令

- **THEN** 后端 SHALL 暴露 `messages_switch_swipe` Tauri 命令
- **AND** 命令接收 `round_id: i64` 和 `target_message_id: i64`
- **AND** 命令 SHALL 更新 `message_rounds` 表的 `active_assistant_message_id` 为目标消息 ID
- **AND** 命令 SHALL 返回切换后的消息内容

#### Scenario: 前端 swipe 版本展示

- **THEN** 前端 SHALL 在加载消息时识别同一轮次的多个 swipe 版本
- **AND** 仅显示当前活跃版本（`active_assistant_message_id` 对应的消息）
- **AND** 版本切换器显示当前版本号和总版本数

---

### Requirement: 会话分支

系统 SHALL 支持从某条消息创建会话分支。

#### Scenario: 创建分支

- **WHEN** 用户点击消息上的分支按钮
- **THEN** 系统 SHALL 创建一个新会话，复制原会话的绑定信息（角色卡、世界书、预设、API 档案）
- **AND** 新会话 SHALL 包含从会话开始到该消息（含）的所有历史消息
- **AND** 新会话标题 SHALL 为 `原标题 (分支)`
- **AND** 系统 SHALL 自动切换到新创建的分支会话

#### Scenario: 后端分支命令

- **THEN** 后端 SHALL 暴露 `conversations_fork` Tauri 命令
- **AND** 命令接收 `conversation_id: i64` 和 `up_to_message_id: i64`
- **AND** 命令 SHALL 创建新会话并复制消息历史
- **AND** 命令 SHALL 返回新会话的 ID

---

### Requirement: 消息操作按钮组

系统 SHALL 在每条消息上显示操作按钮组，使用图标按钮。

#### Scenario: 用户消息操作按钮

- **WHEN** 用户 hover 用户消息
- **THEN** 消息右上角 SHALL 显示操作按钮组：编辑（Pencil 图标）、分支（GitFork 图标）

#### Scenario: AI 消息操作按钮组

- **WHEN** 用户 hover AI 消息
- **THEN** 消息右上角 SHALL 显示操作按钮组：编辑（Pencil 图标）、重新回复（RefreshCw 图标）、分支（GitFork 图标）
- **AND** 当存在多个 swipe 版本时，SHALL 额外显示版本切换器

#### Scenario: 按钮显示逻辑

- **AND** 操作按钮组 SHALL 在非 hover 状态下透明度为 0，hover 时渐变到可见
- **AND** 流式消息（`isStreaming=true`）SHALL 不显示操作按钮

---

### Requirement: 单人模式移除玩家名前缀

系统 SHALL 在单人模式下不在用户消息前添加 `玩家名: ` 前缀。

#### Scenario: 单人模式发送消息

- **WHEN** 会话类型为 `single` 且用户发送消息
- **THEN** `build_aggregated_user_content` SHALL 直接返回用户输入内容，不添加 `显示名: ` 前缀
- **AND** 放弃发言时 SHALL 仍返回 `本轮放弃发言`（无玩家名前缀）

#### Scenario: 联机模式不受影响

- **WHEN** 会话类型为 `online`
- **THEN** `build_aggregated_user_content` SHALL 保持现有行为，继续添加 `显示名: ` 前缀

---

### Requirement: 删除 AI 帮助按钮

系统 SHALL 从聊天输入栏中移除 AI 帮助按钮。

#### Scenario: 输入栏布局

- **THEN** 聊天输入栏 SHALL 仅包含文本输入区域和发送按钮
- **AND** `onAiHelp` prop 和 `BrainCircuit` 图标导入 SHALL 被移除

---

### Requirement: 用户消息右对齐

系统 SHALL 将用户消息渲染为右对齐布局。

#### Scenario: 用户消息布局

- **WHEN** 消息的 `sender` 为 `'user'`
- **THEN** 消息外层容器 SHALL 右对齐（`flex flex-row-reverse` 或等效布局）
- **AND** 头像 SHALL 显示在右侧
- **AND** 内容区 SHALL 靠右对齐（`text-right` 或 `items-end`）
- **AND** 发送者名称行 SHALL 靠右对齐

#### Scenario: AI 消息布局不变

- **WHEN** 消息的 `sender` 为 `'ai'`
- **THEN** 消息 SHALL 保持现有的左对齐布局

---

### Requirement: 会话删除

系统 SHALL 在前端接入会话删除功能。

#### Scenario: 删除会话 UI

- **WHEN** 用户在会话列表中右键点击或长按某个会话
- **THEN** SHALL 显示删除选项
- **AND** 点击删除后 SHALL 显示确认对话框："确定要删除会话「{标题}」吗？此操作不可撤销。"
- **AND** 用户确认后 SHALL 调用 `conversationsDelete` 命令

#### Scenario: 删除后状态处理

- **WHEN** 删除的会话是当前选中的会话
- **THEN** 系统 SHALL 清空消息列表
- **AND** 系统 SHALL 将 `selectedConversationId` 设为 `null`
- **AND** 系统 SHALL 刷新会话列表

#### Scenario: 后端级联删除

- **THEN** 后端 `conversations_delete` 命令 SHALL 确保级联删除所有关联数据
- **AND** 关联表包括：`message_rounds`、`messages`、`message_content_parts`、`message_tool_calls`、`conversation_members`、`round_member_actions`、`agent_runs`、`agent_drafts`、`plot_summaries`、`character_state_overlays`

---

## MODIFIED Requirements

### Requirement: MessageItem 组件

`MessageItem` 组件 SHALL 新增消息操作按钮组（编辑、重新回复、分支），用户消息右对齐，AI 消息增加 swipe 版本切换器。

### Requirement: ChatInputBar 组件

`ChatInputBar` 组件 SHALL 移除 AI 帮助按钮，仅保留文本输入和发送按钮。

### Requirement: build_aggregated_user_content 函数

`build_aggregated_user_content` 函数 SHALL 根据会话类型决定是否添加玩家名前缀：联机模式添加，单人模式不添加。

### Requirement: conversations_delete 命令

`conversations_delete` 命令 SHALL 确保级联删除所有关联表数据。

## REMOVED Requirements

无移除项。本阶段为纯增量扩展。

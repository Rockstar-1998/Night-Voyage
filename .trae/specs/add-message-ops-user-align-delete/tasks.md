# Tasks

## 一、后端新增命令

- [x] Task 1: 新增 `messages_update_content` Tauri 命令
  - [x] SubTask 1.1: 在 `chat.rs` 中将 `update_message_content` 私有函数改造为公开 Tauri 命令，接收 `message_id: i64` 和 `content: String`
  - [x] SubTask 1.2: 若消息有 `message_content_parts`，同步更新可见文本部分
  - [x] SubTask 1.3: 在 `main.rs` 中注册新命令

- [x] Task 2: 新增 `messages_switch_swipe` Tauri 命令
  - [x] SubTask 2.1: 在 `chat.rs` 中新增命令，接收 `round_id: i64` 和 `target_message_id: i64`
  - [x] SubTask 2.2: 更新 `message_rounds` 表的 `active_assistant_message_id` 为目标消息 ID
  - [x] SubTask 2.3: 返回切换后的消息内容（UiMessage 格式）
  - [x] SubTask 2.4: 在 `main.rs` 中注册新命令

- [x] Task 3: 新增 `conversations_fork` Tauri 命令
  - [x] SubTask 3.1: 在 `conversations.rs` 中新增命令，接收 `conversation_id: i64` 和 `up_to_message_id: i64`
  - [x] SubTask 3.2: 创建新会话，复制原会话的绑定信息（host_character_id、world_book_id、preset_id、provider_id、conversation_type、chat_mode）
  - [x] SubTask 3.3: 复制从会话开始到目标消息（含）的所有消息到新会话
  - [x] SubTask 3.4: 新会话标题设为 `原标题 (分支)`
  - [x] SubTask 3.5: 返回新会话 ID
  - [x] SubTask 3.6: 在 `main.rs` 中注册新命令

- [x] Task 4: 修改 `build_aggregated_user_content` 单人模式逻辑
  - [x] SubTask 4.1: 函数新增 `conversation_type` 参数
  - [x] SubTask 4.2: 当 `conversation_type == "single"` 时，直接返回用户内容（不添加 `显示名: ` 前缀）
  - [x] SubTask 4.3: 当 `conversation_type == "online"` 时，保持现有行为
  - [x] SubTask 4.4: 更新所有调用 `build_aggregated_user_content` 的地方，传入 `conversation_type`

- [x] Task 5: 修复 `conversations_delete` 级联删除
  - [x] SubTask 5.1: 在删除 conversations 记录前，显式删除 `agent_drafts`（若有 agent_runs 关联）
  - [x] SubTask 5.2: 显式删除 `agent_runs`
  - [x] SubTask 5.3: 显式删除 `character_state_overlays`
  - [x] SubTask 5.4: 显式删除 `plot_summaries`
  - [x] SubTask 5.5: 依赖数据库 `ON DELETE CASCADE` 约束处理 `message_rounds` → `messages` → `message_content_parts`/`message_tool_calls`、`conversation_members` → `round_member_actions` 的级联

## 二、前端消息操作

- [x] Task 6: 在 `backend.ts` 中封装新后端命令
  - [x] SubTask 6.1: 新增 `messagesUpdateContent(messageId: number, content: string)` 函数
  - [x] SubTask 6.2: 新增 `messagesSwitchSwipe(roundId: number, targetMessageId: number)` 函数
  - [x] SubTask 6.3: 新增 `conversationsFork(conversationId: number, upToMessageId: number)` 函数

- [x] Task 7: 改造 `MessageItem.tsx` — 消息操作按钮组与用户消息右对齐
  - [x] SubTask 7.1: 新增 props：`onEdit`、`onRegenerate`、`onFork`、`swipeInfo?: { current: number; total: number }`、`onSwitchSwipe`
  - [x] SubTask 7.2: 用户消息布局改为右对齐：外层 `flex-row-reverse`，头像在右，内容区 `items-end`
  - [x] SubTask 7.3: AI 消息保持左对齐不变
  - [x] SubTask 7.4: 添加操作按钮组（hover 时显示）：用户消息 — 编辑 + 分支；AI 消息 — 编辑 + 重新回复 + 分支
  - [x] SubTask 7.5: AI 消息添加 swipe 版本切换器：`◀ 版本 N/M ▶`，仅当 `swipeInfo.total > 1` 时显示
  - [x] SubTask 7.6: 编辑模式：点击编辑后内容区变为 textarea，显示保存/取消按钮
  - [x] SubTask 7.7: 流式消息不显示操作按钮

- [x] Task 8: 在 `ChatArea.tsx` 中传递消息操作回调
  - [x] SubTask 8.1: 新增 props：`onEditMessage`、`onForkMessage`、`onSwitchSwipe`
  - [x] SubTask 8.2: 计算 swipeInfo：按 roundId 分组 AI 消息，统计每轮的 swipe 版本数
  - [x] SubTask 8.3: 传递 swipeInfo 和回调给 MessageItem

- [x] Task 9: 在 `App.tsx` 中实现消息操作处理函数
  - [x] SubTask 9.1: 实现 `handleEditMessage`：调用 `messagesUpdateContent`，更新本地消息状态
  - [x] SubTask 9.2: 实现 `handleForkMessage`：调用 `conversationsFork`，创建分支会话并切换
  - [x] SubTask 9.3: 实现 `handleSwitchSwipe`：调用 `messagesSwitchSwipe`，更新本地消息内容
  - [x] SubTask 9.4: 传递回调到 DesktopView → ChatArea → MessageItem

## 三、删除 AI 帮助按钮

- [x] Task 10: 从 `ChatInputBar.tsx` 移除 AI 帮助按钮
  - [x] SubTask 10.1: 移除 `onAiHelp` prop
  - [x] SubTask 10.2: 移除 `BrainCircuit` 图标导入和按钮 JSX
  - [x] SubTask 10.3: 移除 App.tsx 中传入的 `onAiHelp` prop（若有）

## 四、会话删除

- [x] Task 11: 在 `SessionSidebar.tsx` 中添加会话删除 UI
  - [x] SubTask 11.1: 每个会话卡片添加删除按钮（hover 时显示，Trash2 图标）
  - [x] SubTask 11.2: 点击删除后显示确认对话框
  - [x] SubTask 11.3: 确认后调用 `conversationsDelete`
  - [x] SubTask 11.4: 若删除的是当前选中会话，清空消息列表并将 selectedConversationId 设为 null
  - [x] SubTask 11.5: 刷新会话列表

# Task Dependencies

- Task 6 depends on Task 1, Task 2, Task 3（前端封装依赖后端命令）
- Task 7 depends on Task 6（MessageItem 操作依赖前端命令封装）
- Task 8 depends on Task 7（ChatArea 依赖 MessageItem 新 props）
- Task 9 depends on Task 6, Task 8（App 处理函数依赖命令和组件）
- Task 4, Task 5, Task 10, Task 11 可并行执行
- Task 1, Task 2, Task 3 可并行执行（均为独立后端命令）

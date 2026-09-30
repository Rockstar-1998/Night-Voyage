# 消息删除 / 强制结束回复 / AI 回复状态栏 Spec

## Why

当前聊天界面缺少三项关键交互能力：
1. 用户无法删除已发送的单条消息（无论是自己的输入还是 AI 的回复），只能删除整个会话。
2. AI 正在流式回复时，用户无法主动中断，必须等待流结束或报错。
3. AI 回复过程中没有任何状态反馈，用户不知道当前处于「连接 API」「AI 处理中」还是「正在接收回复」阶段。

## What Changes

- 新增单条消息删除功能：用户消息和 AI 消息均可删除，支持确认对话框。
- 新增强制结束 AI 回复功能：在 AI 流式回复期间，用户可点击发送按钮强制中断。
- 新增 AI 回复状态栏：在发送按钮位置用动态图标展示当前阶段（连接/处理/回复）。
- 后端新增消息删除命令和流中断机制。

## Impact

- Affected specs: 无已有 spec 直接受影响
- Affected code:
  - `src/components/MessageItem.tsx` — 新增删除按钮
  - `src/components/ChatInputBar.tsx` — 发送按钮状态动效、强制结束功能
  - `src/components/ChatArea.tsx` — 传递删除回调
  - `src/App.tsx` — 删除消息处理、流中断处理、回复状态管理
  - `src/lib/backend.ts` — 新增消息删除命令封装
  - `src-tauri/src/commands/chat.rs` — 新增 `messages_delete`、`abort_round_stream` Tauri 命令
  - `src-tauri/src/services/chat_service.rs` — 新增消息删除和流中断服务逻辑
  - `src-tauri/src/services/stream_processor.rs` — 支持可中断的流处理
  - `src-tauri/src/repositories/message_repository.rs` — 新增消息删除查询
  - `src-tauri/src/repositories/round_repository.rs` — 新增流中断状态更新
  - `src-tauri/src/lib.rs` — 注册新命令

---

## ADDED Requirements

### Requirement: 删除单条消息

系统 SHALL 允许用户删除任意单条消息（包括用户消息和 AI 消息）。

#### Scenario: 删除用户消息

- **WHEN** 用户 hover 用户消息
- **THEN** 操作按钮组 SHALL 显示删除按钮（Trash2 图标）
- **AND** 点击删除按钮后 SHALL 弹出确认对话框："确定要删除这条消息吗？此操作不可撤销。"
- **AND** 用户确认后 SHALL 调用后端删除该消息并移除前端显示

#### Scenario: 删除 AI 消息

- **WHEN** 用户 hover AI 消息
- **THEN** 操作按钮组 SHALL 显示删除按钮（Trash2 图标）
- **AND** 点击删除按钮后 SHALL 弹出确认对话框
- **AND** 用户确认后 SHALL 调用后端删除该消息并移除前端显示

#### Scenario: 后端消息删除命令

- **THEN** 后端 SHALL 暴露 `messages_delete` Tauri 命令
- **AND** 命令接收 `message_id: i64`
- **AND** 命令 SHALL 删除 `messages` 表中对应记录
- **AND** 命令 SHALL 级联删除该消息的 `message_content_parts` 和 `message_tool_calls`
- **AND** 若删除的是某轮次的 active_assistant_message，SHALL 更新 `message_rounds` 的 `active_assistant_message_id` 为同轮次的其他 assistant 消息（若有），否则设为 NULL

---

### Requirement: 强制结束 AI 回复

系统 SHALL 允许用户在 AI 正在流式回复时强制中断。

#### Scenario: 强制结束流式回复

- **WHEN** AI 正在流式回复（`isStreaming=true`）
- **THEN** 发送按钮 SHALL 变为停止按钮（Square 图标）
- **AND** 点击停止按钮 SHALL 调用后端 `abort_round_stream` 命令
- **AND** 前端 SHALL 立即将消息的 `isStreaming` 设为 `false`
- **AND** 已接收的内容 SHALL 保留，未接收的内容 SHALL 丢弃

#### Scenario: 后端流中断命令

- **THEN** 后端 SHALL 暴露 `abort_round_stream` Tauri 命令
- **AND** 命令接收 `round_id: i64`
- **AND** 命令 SHALL 将对应轮次的 `message_rounds.status` 从 `streaming` 改为 `aborted`
- **AND** 命令 SHALL 通知正在进行的流处理任务停止接收新数据
- **AND** 命令 SHALL 保留已生成的消息内容，不删除消息记录

#### Scenario: 流中断状态展示

- **WHEN** 流被强制中断后
- **THEN** 消息上的 badge SHALL 显示 "已中断" 而不是 "Assistant"
- **AND** 消息内容 SHALL 保留已接收的部分

---

### Requirement: AI 回复状态栏

系统 SHALL 在 AI 回复过程中通过发送按钮的动效展示当前阶段。

#### Scenario: 状态阶段定义

- **THEN** AI 回复过程 SHALL 分为三个阶段：
  1. **connecting**: 正在连接 API 并发送请求
  2. **processing**: AI 正在处理信息（等待首个 token）
  3. **responding**: 正在接收回复内容

#### Scenario: 状态图标动效

- **WHEN** 状态为 `connecting`
- **THEN** 发送按钮 SHALL 显示 `Globe`（internet）图标，并带有脉冲/呼吸动效
- **WHEN** 状态为 `processing`
- **THEN** 发送按钮 SHALL 显示 `Loader2` 图标，并带有旋转动效
- **WHEN** 状态为 `responding`
- **THEN** 发送按钮 SHALL 显示三个圆点浮动动效（使用 CSS animation）

#### Scenario: 状态流转

- **WHEN** 用户点击发送后
- **THEN** 状态 SHALL 立即变为 `connecting`
- **AND** 当收到首个 `text_delta` 事件时，状态 SHALL 变为 `responding`
- **AND** 当收到 `message_stop` 或流中断时，状态 SHALL 恢复为默认（显示 SendHorizontal 图标）
- **AND** 若连接失败或超时，状态 SHALL 恢复为默认并显示错误

#### Scenario: 状态与按钮禁用

- **THEN** 在 `connecting` 和 `processing` 阶段，输入框 SHALL 仍可编辑但发送按钮不可点击（显示停止按钮替代）
- **AND** 在 `responding` 阶段，用户 SHALL 可通过点击停止按钮中断回复

---

## MODIFIED Requirements

### Requirement: MessageItem 组件

`MessageItem` 组件 SHALL 在操作按钮组中新增删除按钮（Trash2 图标），位于现有按钮之后。

### Requirement: ChatInputBar 组件

`ChatInputBar` 组件 SHALL 根据 `replyStatus` prop 改变发送按钮的图标和动效：
- 默认状态：SendHorizontal 图标
- connecting 状态：Globe 图标 + 脉冲动效
- processing 状态：Loader2 图标 + 旋转动效
- responding 状态：三个圆点浮动动效
- 任意活跃状态：点击按钮触发 `onAbort` 而非发送

### Requirement: App.tsx 状态管理

App.tsx SHALL 新增 `replyStatus` 信号（`'idle' | 'connecting' | 'processing' | 'responding'`），并在流事件监听中更新该状态。

## REMOVED Requirements

无移除项。本阶段为纯增量扩展。

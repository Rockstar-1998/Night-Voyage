# Tasks

## 一、后端新增命令

- [ ] Task 1: 新增 `messages_delete` Tauri 命令
  - [ ] SubTask 1.1: 在 `message_repository.rs` 中新增 `delete_message` 函数，删除消息及其关联的 content_parts 和 tool_calls
  - [ ] SubTask 1.2: 在 `chat_service.rs` 中新增 `delete_message` 服务函数，处理 active_assistant_message_id 的重新指向逻辑
  - [ ] SubTask 1.3: 在 `commands/chat.rs` 中新增 `messages_delete` Tauri 命令，接收 `message_id: i64`
  - [ ] SubTask 1.4: 在 `lib.rs` 中注册新命令

- [ ] Task 2: 新增 `abort_round_stream` Tauri 命令
  - [ ] SubTask 2.1: 在 `round_repository.rs` 中新增 `mark_aborted` 函数，将轮次状态设为 `aborted`
  - [ ] SubTask 2.2: 在 `chat_service.rs` 中新增 `abort_round_stream` 服务函数
  - [ ] SubTask 2.3: 在 `stream_processor.rs` 中支持可中断的流处理（通过共享状态或信号机制）
  - [ ] SubTask 2.4: 在 `commands/chat.rs` 中新增 `abort_round_stream` Tauri 命令
  - [ ] SubTask 2.5: 在 `lib.rs` 中注册新命令

## 二、前端消息删除

- [ ] Task 3: 在 `backend.ts` 中封装 `messagesDelete` 函数
  - [ ] SubTask 3.1: 新增 `messagesDelete(messageId: number)` 函数，调用 `messages_delete` 命令

- [ ] Task 4: 改造 `MessageItem.tsx` — 新增删除按钮
  - [ ] SubTask 4.1: 新增 `onDelete` prop
  - [ ] SubTask 4.2: 在用户消息和 AI 消息的操作按钮组中都添加删除按钮（Trash2 图标）
  - [ ] SubTask 4.3: 点击删除按钮时显示确认对话框
  - [ ] SubTask 4.4: 确认后调用 `onDelete` 回调
  - [ ] SubTask 4.5: 流式消息（`isStreaming=true`）不显示删除按钮

- [ ] Task 5: 在 `ChatArea.tsx` 中传递删除回调
  - [ ] SubTask 5.1: 新增 `onDeleteMessage` prop
  - [ ] SubTask 5.2: 传递给 MessageItem

- [ ] Task 6: 在 `App.tsx` 中实现消息删除处理
  - [ ] SubTask 6.1: 实现 `handleDeleteMessage`：调用 `messagesDelete`，从本地消息列表移除
  - [ ] SubTask 6.2: 传递回调到 DesktopView 和 MobileView

## 三、前端强制结束回复

- [ ] Task 7: 在 `backend.ts` 中封装 `abortRoundStream` 函数
  - [ ] SubTask 7.1: 新增 `abortRoundStream(roundId: number)` 函数

- [ ] Task 8: 改造 `ChatInputBar.tsx` — 发送按钮状态动效与停止功能
  - [ ] SubTask 8.1: 新增 `replyStatus: 'idle' | 'connecting' | 'processing' | 'responding'` prop
  - [ ] SubTask 8.2: 新增 `onAbort` prop
  - [ ] SubTask 8.3: 根据 `replyStatus` 改变按钮图标：
    - idle: SendHorizontal
    - connecting: Globe + 脉冲动效（animate-pulse）
    - processing: Loader2 + 旋转动效（animate-spin）
    - responding: 三个圆点浮动动效（自定义 CSS）
  - [ ] SubTask 8.4: 非 idle 状态时，点击按钮触发 `onAbort` 而非发送
  - [ ] SubTask 8.5: 非 idle 状态时，输入框仍可编辑但发送逻辑被禁用

- [ ] Task 9: 在 `App.tsx` 中实现回复状态管理和强制结束
  - [ ] SubTask 9.1: 新增 `replyStatus` 信号，默认 `'idle'`
  - [ ] SubTask 9.2: 在 `handleSend` 开始时设置 `replyStatus` 为 `'connecting'`
  - [ ] SubTask 9.3: 在 `listenLlmStreamEvent` 中：
    - 收到首个 `text_delta` 时设为 `'responding'`
    - 收到 `message_stop` 时恢复 `'idle'`
  - [ ] SubTask 9.4: 在 `listenStreamError` 中恢复 `'idle'`
  - [ ] SubTask 9.5: 实现 `handleAbortReply`：调用 `abortRoundStream`，将当前流消息的 `isStreaming` 设为 `false`
  - [ ] SubTask 9.6: 传递 `replyStatus` 和 `onAbort` 到 ChatInputBar

## 四、MobileView 适配

- [ ] Task 10: 在 `MobileView.tsx` 中传递新增 props
  - [ ] SubTask 10.1: 传递 `onDeleteMessage` 回调到 ChatArea
  - [ ] SubTask 10.2: 传递 `replyStatus` 和 `onAbort` 到 ChatInputBar

# Task Dependencies

- Task 3 depends on Task 1
- Task 4 depends on Task 3
- Task 5 depends on Task 4
- Task 6 depends on Task 3, Task 5
- Task 7 depends on Task 2
- Task 8 depends on Task 7
- Task 9 depends on Task 7, Task 8
- Task 10 depends on Task 6, Task 9
- Task 1 和 Task 2 可并行执行

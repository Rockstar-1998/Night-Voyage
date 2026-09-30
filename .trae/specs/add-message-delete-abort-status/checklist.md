# Checklist

## 后端新增命令

- [x] `messages_delete` Tauri 命令存在且可删除消息
- [x] 删除消息时级联删除 `message_content_parts` 和 `message_tool_calls`
- [x] 删除 active_assistant_message 时正确更新 `message_rounds.active_assistant_message_id`
- [x] `abort_round_stream` Tauri 命令存在且可中断流
- [x] 中断流时将轮次状态设为 `aborted`
- [x] 流处理任务可正确响应中断信号
- [x] 新命令已在 `lib.rs` 中注册

## 前端消息删除

- [x] `backend.ts` 封装了 `messagesDelete` 函数
- [x] 用户消息 hover 时显示删除按钮
- [x] AI 消息 hover 时显示删除按钮
- [x] 点击删除按钮显示确认对话框
- [x] 确认后消息从前端列表移除
- [x] 流式消息不显示删除按钮
- [x] ChatArea 正确传递 `onDeleteMessage` 回调
- [x] App.tsx 实现了 `handleDeleteMessage`

## 前端强制结束回复

- [x] `backend.ts` 封装了 `abortRoundStream` 函数
- [x] AI 流式回复时发送按钮变为停止按钮（danger 色调）
- [x] 点击停止按钮调用后端中断命令
- [x] 中断后消息 `isStreaming` 设为 `false`
- [x] 已接收内容保留

## AI 回复状态栏

- [x] `replyStatus` 状态管理正确（idle/connecting/processing/responding）
- [x] connecting 状态：Globe 图标 + 脉冲动效
- [x] processing 状态：Loader2 图标 + 旋转动效
- [x] responding 状态：三个圆点浮动动效
- [x] 收到首个 text_delta 时从 connecting 转为 responding
- [x] 收到 message_stop 或错误时恢复 idle
- [x] 发送按钮在非 idle 状态下点击触发中断而非发送

## MobileView 适配

- [x] MobileView 传递了 `onDeleteMessage` 到 ChatArea
- [x] MobileView 传递了 `replyStatus` 和 `onAbort` 到 ChatInputBar

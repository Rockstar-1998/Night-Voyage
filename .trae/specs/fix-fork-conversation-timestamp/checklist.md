# Checklist

## 时间戳格式修复 ✅

- [x] `conversations_fork` 中 `conversations` 表的 `created_at`/`updated_at` 使用 `now_ts()` 绑定
- [x] `conversations_fork` 中 `conversation_members` 表的 `created_at`/`updated_at` 使用 `now_ts()` 绑定
- [x] `conversations_fork` 中 `message_rounds` 表的 `created_at`/`updated_at` 使用 `now_ts()` 绑定
- [x] 分支会话的 `conversations_list` 返回的 `updated_at` 为有效 Unix 时间戳（非 0）

## 成员 ID 映射修复 ✅

- [x] 分支会话的消息 `member_id` 指向分支会话自身的成员记录
- [x] 原会话删除后，分支会话的消息仍能正确显示 `display_name`

## active_assistant_message_id 修复 ✅

- [x] `conversations_fork` 为每个包含 assistant 消息的轮次设置 `active_assistant_message_id`
- [x] 无 assistant 消息的轮次 `active_assistant_message_id` 保持 NULL
- [x] `messages_list` 的 `is_active_in_round` 计算对分支会话正确工作

## 前端错误处理修复 ✅

- [x] `refreshConversationContext` 失败时输出 `console.error` 日志
- [x] `refreshConversationContext` 失败时消息列表设为空数组
- [x] `refreshConversationContext` 失败时 `currentRoundState` 设为 null

## 功能验证 ✅

- [x] 点击分支会话后消息正常加载
- [x] `round_state_get` 对分支会话不再报错
- [x] `cargo check` 编译通过

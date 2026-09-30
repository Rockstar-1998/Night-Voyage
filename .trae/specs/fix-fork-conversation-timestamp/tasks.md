# Tasks

## 一、修复时间戳格式 ✅（已完成）

- [x] Task 1: 修复 `conversations_fork` 中 `conversations` 表插入的时间戳
  - [x] SubTask 1.1: 将 `datetime('now'), datetime('now')` 替换为 `?, ?` 占位符
  - [x] SubTask 1.2: 在执行前调用 `now_ts()` 获取当前时间戳，绑定到占位符

- [x] Task 2: 修复 `conversations_fork` 中 `conversation_members` 表插入的时间戳
  - [x] SubTask 2.1: 将 `datetime('now'), datetime('now')` 替换为 `?, ?` 占位符
  - [x] SubTask 2.2: 绑定 `now_ts()` 返回值到占位符

- [x] Task 3: 修复 `conversations_fork` 中 `message_rounds` 表插入的时间戳
  - [x] SubTask 3.1: 将 `datetime('now'), datetime('now')` 替换为 `?, ?` 占位符
  - [x] SubTask 3.2: 绑定 `now_ts()` 返回值到占位符

## 二、修复成员 ID 映射 ✅（已完成）

- [x] Task 4: 在 `conversations_fork` 中建立原成员 ID → 分支成员 ID 的映射
  - [x] SubTask 4.1: 插入分支成员后，查询分支会话的所有成员，按 `member_role` + `display_name` + `join_order` 与原会话成员建立映射
  - [x] SubTask 4.2: 复制消息时，使用映射表将 `member_id` 替换为分支会话的新成员 ID
  - [x] SubTask 4.3: 若映射失败（找不到对应成员），保留原 `member_id` 作为降级处理

## 三、修复 active_assistant_message_id 缺失 ✅（已完成）

- [x] Task 6: 在 `conversations_fork` 中为每个轮次设置 `active_assistant_message_id`
  - [x] SubTask 6.1: 在每个轮次的消息复制完成后，查询该轮次中最后一条 `role='assistant'` 且 `is_hidden=0` 的消息 ID
  - [x] SubTask 6.2: 将该 ID 更新到 `message_rounds.active_assistant_message_id`
  - [x] SubTask 6.3: 若轮次无 assistant 消息，保持 `active_assistant_message_id` 为 NULL

## 四、修复前端错误吞噬 ✅（已完成）

- [x] Task 7: 修复 `refreshConversationContext` 错误吞噬问题
  - [x] SubTask 7.1: 在 `refreshConversationContext` 中添加 `try/catch` 处理
  - [x] SubTask 7.2: 在 catch 中输出 `console.error` 日志
  - [x] SubTask 7.3: 在 catch 中将消息列表设为空数组、`currentRoundState` 设为 null

## 五、验证 ✅（已完成）

- [x] Task 5: 编译验证（上一轮已完成）
  - [x] SubTask 5.1: 运行 `cargo check` 确认编译通过

- [x] Task 8: 重新编译验证
  - [x] SubTask 8.1: 运行 `cargo check` 确认编译通过

# Task Dependencies

- Task 6 依赖 Task 4（需要先完成消息复制才能设置 active_assistant_message_id）
- Task 7 独立于 Task 6（前端修复）
- Task 8 依赖 Task 6, Task 7

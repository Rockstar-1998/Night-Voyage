# Tasks

- [x] Task 1: 修改 `flatten_request_to_legacy_chat_messages` 为每层独立 system 消息
  - [x] SubTask 1.1: 将合并逻辑（`join("\n\n")` + 单条 system 消息）替换为逐条推送 `role: "system"` 消息

- [x] Task 2: 更新测试用例
  - [x] SubTask 2.1: 更新 `adapter_keeps_history_outside_system` 测试，验证多个 system block 生成多个 system 消息
  - [x] SubTask 2.2: 新增测试验证空 system 不产生 system 消息

- [x] Task 3: 验证
  - [x] SubTask 3.1: `cargo check` 编译通过
  - [x] SubTask 3.2: `cargo test` 通过

# Task Dependencies

- Task 2 依赖 Task 1
- Task 3 依赖 Task 1、Task 2

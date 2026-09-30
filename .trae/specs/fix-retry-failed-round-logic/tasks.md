# Tasks

- [x] Task 1: 修改 `retry_failed_round` 使用 `spawn_stream_task` 替代 `spawn_retry_worker`
  - [x] SubTask 1.1: 在 `chat_service.rs` 的 `retry_failed_round` 函数中，调用 `spawn_stream_task` 替代 `spawn_retry_worker`
  - [x] SubTask 1.2: 确保重试前正确清理失败状态（清空消息内容、重置轮次状态为 streaming）
- [x] Task 2: 删除不再需要的重试专用代码
  - [x] SubTask 2.1: 删除 `stream_processor.rs` 中的 `spawn_retry_worker` 函数
  - [x] SubTask 2.2: 删除 `stream_processor.rs` 中的 `run_retry_worker` 函数
  - [x] SubTask 2.3: 删除 `stream_processor.rs` 中的 `stream_openai_retry_response` 函数
  - [x] SubTask 2.4: 删除 `stream_processor.rs` 中的 `stream_anthropic_retry_response` 函数
  - [x] SubTask 2.5: 删除 `RETRY_BACKOFF_SECS` 常量
  - [x] SubTask 2.6: 删除 `AppState` 中的 `retry_workers` 字段
- [x] Task 3: 构建验证
  - [x] SubTask 3.1: 运行 `cargo check`，确保无编译错误

# Task Dependencies

- Task 2 依赖于 Task 1（先替换再删除）
- Task 3 依赖于 Task 1 和 Task 2

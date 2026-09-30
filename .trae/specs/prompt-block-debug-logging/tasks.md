# Tasks

- [x] Task 1: Anthropic 请求省略 top_k 参数

  - [x] SubTask 1.1: 在 `provider_adapter.rs` 中找到 `build_anthropic_http_request` 或等效函数
  - [x] SubTask 1.2: 当 `provider_kind = "anthropic"` 时，在构建请求体的 JSON 时省略 `top_k` 字段（或设为 `Option` 并在 `None` 时不序列化）
  - [x] SubTask 1.3: 验证 OpenAI 兼容请求仍包含 `top_k`

- [x] Task 2: Debug 日志包含 PromptBlock 元数据

  - [x] SubTask 2.1: 找到 `save_llm_debug_log` 函数调用点
  - [x] SubTask 2.2: 在日志中为每个 system block 记录其 `kind`、`source`、`priority`、`required` 等元数据
  - [x] SubTask 2.3: 验证日志输出包含结构化 block 信息

- [x] Task 3: 验证编译通过

  - [x] SubTask 3.1: 运行 `cargo check` 确认无编译错误
  - [x] SubTask 3.2: 发送测试请求验证日志格式

# Task Dependencies

- Task 1 和 Task 2 可并行执行
- Task 3 依赖 Task 1 和 Task 2

# Tasks

- [ ] Task 1: 后端事件结构与前端监听器骨架
  - [ ] SubTask 1.1: 在 `src-tauri/src/models/mod.rs` 新增 `MemoryBackendErrorEvent { conversation_id, round_id, operation: String, strategy: Option<String>, error: String }`，camelCase 序列化
  - [ ] SubTask 1.2: 在 `src/lib/backend.ts` 新增 `MemoryBackendErrorEvent` 接口与 `listenMemoryError` 函数（监听 `llm-memory-error` 事件）
  - [ ] SubTask 1.3: `cargo check` 与 `tsc --noEmit` 验证骨架编译通过

- [ ] Task 2: 启动期错误状态记录与暴露
  - [ ] SubTask 2.1: 在 `src-tauri/src/lib.rs` 的 `AppState` 新增 `pub mem0_init_error: Option<String>` 字段
  - [ ] SubTask 2.2: 重写 setup 钩子：`build_memory_service` 失败时把错误字符串存入 `mem0_init_error`，注释从"degrades to None"改为"explicitly disabled, callers must report"
  - [ ] SubTask 2.3: 新增 Tauri 命令 `mem0_init_status() -> { available: bool, error: Option<String> }`，注册到 invoke_handler
  - [ ] SubTask 2.4: 前端 `backend.ts` 新增 `mem0InitStatus` invoke 封装

- [ ] Task 3: 真实健康检查实现
  - [ ] SubTask 3.1: 在 `mem0_rs.rs` 实现 `health()`：复用配置的 embedding base_url + api_key，向 `{base_url}/v1/embeddings`（或正确路径）发送 1-token POST 请求，校验 HTTP 200 且响应 JSON 含 `data` 数组
  - [ ] SubTask 3.2: 失败时返回 `MemoryServiceError::Backend(...)` 包含状态码与 URL
  - [ ] SubTask 3.3: 在 `build_memory_service` 构造成功后调用 `health()`，若失败则把 `Backend(...)` 错误冒泡（构造返回 `Err`），由 setup 钩子按 Task 2 流程处理

- [ ] Task 4: `load_retrieved_detail_blocks` 改为显式错误
  - [ ] SubTask 4.1: 移除函数文档"yields an empty Vec without erroring"，改为"returns Err when memory service is None in mem0 mode"
  - [ ] SubTask 4.2: 移除 `if !mem0_active { return Vec::new(); }` 静默分支，改为 `if !mem0_active { return Ok(Vec::new()); }`（关闭 mem0 时返回空是显式决策）
  - [ ] SubTask 4.3: `memory_service` 为 `None` 且 `mem0_active=true` 时返回 `Err("mem0 mode requested but memory service unavailable: {init_error}")`
  - [ ] SubTask 4.4: 函数签名改为 `async fn load_retrieved_detail_blocks(...) -> Result<Vec<PromptBlock>, String>`
  - [ ] SubTask 4.5: 单策略 search 失败时记录到 `debug.errors` 并 `app.emit("llm-memory-error", MemoryBackendErrorEvent { strategy: Some(...), ... })`，不终止循环
  - [ ] SubTask 4.6: 删除 `eprintln!("... degrading to empty")` 注释

- [ ] Task 5: `compile_prompt` 错误冒泡
  - [ ] SubTask 5.1: `compile_prompt` 调用 `load_retrieved_detail_blocks` 时使用 `?` 传播错误
  - [ ] SubTask 5.2: `stream_processor.rs` 接收 `compile_prompt` 错误后通过 `llm-stream-error` 事件通知 UI，不发送 LLM 请求
  - [ ] SubTask 5.3: 验证 mem0 模式下 `memory_service = None` 时发送消息会立即在 UI 看到"mem0 mode requested but memory service unavailable"错误

- [ ] Task 6: `run_memory_extraction_task` 显式上报
  - [ ] SubTask 6.1: `memory_service.add()` 失败时通过 `app.emit("llm-memory-error", MemoryBackendErrorEvent { operation: "add", ... })` 通知 UI
  - [ ] SubTask 6.2: 保留 `eprintln` 用于 stderr 调试，但事件通知是主路径
  - [ ] SubTask 6.3: 删除函数文档"all failures degrade to `eprintln!` logs"，改为"failures emit llm-memory-error event"

- [ ] Task 7: `parse_records` 异常记录
  - [ ] SubTask 7.1: 修改 `parse_records` 签名返回 `(Vec<MemoryRecord>, Vec<String>)`，第二个 Vec 是被跳过条目的原始 JSON
  - [ ] SubTask 7.2: `Mem0RsProvider::search` 把跳过记录通过 `eprintln!` 输出（adapter 层无法访问 debug 报告，至少不能静默）
  - [ ] SubTask 7.3: 调用方（`load_retrieved_detail_blocks`）不直接消费跳过记录，但 debug 报告的 search response 已包含完整原始 JSON，可事后审计

- [ ] Task 8: 前端 UI 错误展示
  - [ ] SubTask 8.1: `App.tsx` 注册 `listenMemoryError` 监听器，收到事件时设置 `memoryError` signal
  - [ ] SubTask 8.2: `ChatArea` 顶栏新增错误条：当 `memoryError` 非空时显示"记忆{operation}失败：{error}"，可手动关闭
  - [ ] SubTask 8.3: 应用启动时调用 `mem0InitStatus`，若 `available=false` 则在 SettingsArea 显示错误原因并禁用 mem0 选项
  - [ ] SubTask 8.4: `onCleanup` 中调用 unlisten

- [ ] Task 9: 删除静默降级注释与冗余代码路径
  - [ ] SubTask 9.1: 删除 `lib.rs:21-23` "degrades gracefully" 注释
  - [ ] SubTask 9.2: 删除 `lib.rs:41-43` "degrades to None. It can be (re)built later on demand" 注释与对应 `.ok()` 吞异常逻辑（改为 `match` 显式记录错误）
  - [ ] SubTask 9.3: 删除 `memory_providers/mod.rs:86` "callers can degrade gracefully" 注释
  - [ ] SubTask 9.4: 删除 `prompt_compiler.rs:2284-2289` "yields an empty Vec without erroring" 注释
  - [ ] SubTask 9.5: 删除 `prompt_compiler.rs:2375-2378` "degrading to empty" eprintln
  - [ ] SubTask 9.6: 删除 `chat_service.rs:49` "all failures degrade to `eprintln!` logs" 注释

- [ ] Task 10: 编译与端到端验证
  - [ ] SubTask 10.1: `cargo check` 通过
  - [ ] SubTask 10.2: `tsc --noEmit` 通过（仅预存错误允许）
  - [ ] SubTask 10.3: 启动应用，确认未配置 embedding provider 时启动后 UI 显示"MEM0 初始化失败"错误
  - [ ] SubTask 10.4: 在 mem0 模式会话发送消息，确认 UI 顶栏显示"记忆检索失败：[EMBED_001]..."而非静默继续
  - [ ] SubTask 10.5: 确认 `llm_debug_logs/llm_mem0_cid*_rid*.json` 仍记录完整步骤
  - [ ] SubTask 10.6: 确认非 mem0 模式会话不受影响（stateless/legacy 正常工作）

# Task Dependencies

- Task 1（事件骨架）是 Task 4、5、6、8 的前置依赖
- Task 2（启动错误状态）依赖 Task 1
- Task 3（健康检查）独立，可与 Task 2 并行，但 Task 2.2 的 build_memory_service 失败处理需要 Task 3 完成
- Task 4（load_retrieved_detail_blocks）依赖 Task 1
- Task 5（compile_prompt 冒泡）依赖 Task 4
- Task 6（写入上报）依赖 Task 1
- Task 7（parse_records）独立
- Task 8（前端 UI）依赖 Task 1、Task 2
- Task 9（清理注释）独立，可在最后统一处理
- Task 10（验证）依赖所有前置任务

# 并行化建议

- 第一批并行：Task 1、Task 3、Task 7
- 第二批：Task 2、Task 4（依赖 1）
- 第三批并行：Task 5、Task 6（依赖 4/1）、Task 8（依赖 1+2）
- 第四批：Task 9（独立清理）
- 最后：Task 10

# Checklist

## 事件骨架验证

- [ ] `models/mod.rs` 定义 `MemoryBackendErrorEvent`，含 `conversation_id`、`round_id`、`operation`、`strategy: Option<String>`、`error` 字段，camelCase 序列化
- [ ] `lib/backend.ts` 定义 `MemoryBackendErrorEvent` 接口与 `listenMemoryError` 函数
- [ ] 事件名统一为 `llm-memory-error`

## 启动期错误状态验证

- [ ] `AppState` 新增 `mem0_init_error: Option<String>` 字段
- [ ] setup 钩子中 `build_memory_service` 失败时把错误字符串存入 `mem0_init_error`，不再 `.ok()` 吞异常
- [ ] 新增 `mem0_init_status` 命令返回 `{ available: bool, error: Option<String> }`
- [ ] `lib.rs` 中无 "degrades gracefully"、"degrades to None"、"can be (re)built later on demand" 注释
- [ ] `memory_providers/mod.rs` 中无 "callers can degrade gracefully" 注释

## 真实健康检查验证

- [ ] `Mem0RsProvider::health()` 实现真实 embedding 端点探测
- [ ] `health()` 失败时返回 `Err(MemoryServiceError::Backend(...))` 含 HTTP 状态码与 URL
- [ ] `health()` 不再无条件返回 `Ok(true)`
- [ ] `build_memory_service` 在构造成功后调用 `health()`，失败则返回 `Err`

## 检索失败显式上报验证

- [ ] `load_retrieved_detail_blocks` 签名改为 `Result<Vec<PromptBlock>, String>`
- [ ] 函数文档无 "yields an empty Vec without erroring" 表述
- [ ] `mem0_active=false` 时返回 `Ok(Vec::new())`（显式决策）
- [ ] `memory_service = None` 且 `mem0_active=true` 时返回 `Err("mem0 mode requested but memory service unavailable: {init_error}")`
- [ ] 单策略 search 失败时 `app.emit("llm-memory-error", ...)` 发射事件，不终止循环
- [ ] 无 `eprintln!("... degrading to empty")` 输出
- [ ] `PromptCompileDebugReport` 含 errors 字段记录失败策略

## compile_prompt 错误冒泡验证

- [ ] `compile_prompt` 用 `?` 传播 `load_retrieved_detail_blocks` 错误
- [ ] `stream_processor.rs` 接收编译错误后通过 `llm-stream-error` 通知 UI，不发送 LLM 请求
- [ ] mem0 模式下 `memory_service = None` 时发消息，UI 立即看到错误而非静默等待

## 写入失败显式上报验证

- [ ] `run_memory_extraction_task` 文档无 "all failures degrade to `eprintln!` logs"
- [ ] `memory_service.add()` 失败时 `app.emit("llm-memory-error", ...)` 发射事件
- [ ] `eprintln` 可保留用于 stderr 调试，但事件通知是主路径

## parse_records 异常记录验证

- [ ] `parse_records` 返回 `(Vec<MemoryRecord>, Vec<String>)` 或等价结构
- [ ] 被跳过的条目通过 `eprintln!` 输出原始 JSON
- [ ] 不再使用 `filter_map` 静默丢弃

## 前端 UI 错误展示验证

- [ ] `App.tsx` 注册 `listenMemoryError` 监听器
- [ ] `ChatArea` 顶栏在 `memoryError` 非空时显示错误条
- [ ] 错误条可手动关闭
- [ ] 应用启动时调用 `mem0InitStatus`，`available=false` 时 SettingsArea 显示错误原因并禁用 mem0 选项
- [ ] `onCleanup` 调用 unlisten

## 编译与运行验证

- [ ] `cargo check` 通过，无 error
- [ ] `tsc --noEmit` 通过（仅预存错误允许）
- [ ] 未配置 embedding provider 时启动应用，UI 显示"MEM0 初始化失败"错误
- [ ] 在 mem0 模式会话发送消息，UI 顶栏显示"记忆检索失败：[EMBED_001]..."而非静默继续
- [ ] `llm_debug_logs/llm_mem0_cid*_rid*.json` 仍记录完整步骤
- [ ] 非 mem0 模式会话不受影响（stateless/legacy 正常工作）

## 零回退原则验证

- [ ] 全代码库 grep "degrade" 无 mem0 相关命中
- [ ] 全代码库 grep "silently" 无 mem0 相关命中
- [ ] `MemoryService::search` 任何失败路径都有 UI 可见反馈
- [ ] `MemoryService::add` 任何失败路径都有 UI 可见反馈
- [ ] `AppState.memory_service = None` 时 mem0 模式会话发消息会立即报错，不发送 LLM 请求

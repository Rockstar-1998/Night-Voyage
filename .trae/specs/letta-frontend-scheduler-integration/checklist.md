# Checklist

- [x] `src-tauri/src/commands/letta.rs` 存在且实现全部 8 个命令
- [x] 命令参数名与前端 `letta.ts` 的 invoke payload key 完全一致（`providerId`、`conversationId`、`agentId`、`engineKind`）
- [x] `letta_get_provider_detail` 返回的对象字段为 camelCase（`providerKind`、`baseUrl`、`apiKey`、`modelName`、`maxTokens`、`maxContextTokens`），且包含 `api_key` 明文
- [x] `letta_server_start` 在 sidecar 已运行时不重复启动，直接返回当前 info
- [x] `letta_server_start` 启动后异步执行健康检查，不阻塞命令返回
- [x] `letta_server_stop` 正确 kill 子进程并清空 child/url
- [x] `letta_save_agent_id` / `letta_get_agent_id` / `letta_set_engine_kind` 正确读写 `conversations` 表的 `engine_kind` 与 `letta_agent_id` 列
- [x] `letta_get_agent_id` 在字段为 NULL 时返回 `null`（而非空串或错误）
- [x] 所有命令的错误返回信息中反斜杠已替换为正斜杠
- [x] `AppState` 包含 `letta_sidecar` 字段并在 `setup` 中初始化
- [x] `invoke_handler!` 注册全部 8 个新命令
- [x] 缓存目录解析结果落在 `D:\software_cache` 体系（sidecar.log、letta.db、Python 环境均写入该目录）
- [x] `cargo check` 在 `src-tauri/` 下通过，无编译错误
- [x] `npm run build` 通过，前端构建无回归
- [x] 未引入静默回退 / 兜底伪成功（零回退原则）
- [x] sidecar 启动/安装均为异步，不阻塞 UI 主线程（使用 spawn_blocking 包装同步调用）

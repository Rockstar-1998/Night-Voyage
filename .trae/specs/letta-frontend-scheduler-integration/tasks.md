# Tasks

- [x] Task 1: 创建 `src-tauri/src/commands/letta.rs` 命令层
  - [x] SubTask 1.1: 定义 `ApiProviderDetail` 序列化结构体（camelCase rename，含 api_key），可放入 `models/mod.rs` 或命令文件内
  - [x] SubTask 1.2: 定义 `LettaServerInfo` 序列化结构体 `{ url: String, running: bool }`
  - [x] SubTask 1.3: 实现 `letta_server_status` 命令：读 `AppState.letta_sidecar` 的 child/url
  - [x] SubTask 1.4: 实现 `letta_server_start` 命令：若已运行直接返回；否则 `start_sidecar` + 存 child/url + 异步 `health_check` + 返回 info
  - [x] SubTask 1.5: 实现 `letta_server_stop` 命令：取出 child 并 kill，清空 url
  - [x] SubTask 1.6: 实现 `letta_setup` 命令：调用 `ensure_python_env` + `ensure_run_letta_script`
  - [x] SubTask 1.7: 实现 `letta_get_provider_detail` 命令：查询 `api_providers` 表，复用 `load_provider_secret` 的 SQL 与列名
  - [x] SubTask 1.8: 实现 `letta_save_agent_id` / `letta_get_agent_id` / `letta_set_engine_kind` 三个会话引擎绑定命令
  - [x] SubTask 1.9: 所有错误信息中反斜杠替换为正斜杠（防 JSON 解析问题，项目硬约束）

- [x] Task 2: 修改 `src-tauri/src/lib.rs` 集成 sidecar 状态与命令注册
  - [x] SubTask 2.1: 在 `AppState` 增加 `pub letta_sidecar: std::sync::Mutex<services::letta_sidecar::LettaSidecarState>`
  - [x] SubTask 2.2: `setup` 中初始化 `letta_sidecar: Mutex::new(LettaSidecarState::default())`
  - [x] SubTask 2.3: 在 `invoke_handler!` 注册全部 8 个新命令
  - [x] SubTask 2.4: 确认 `services` 模块已 `pub mod letta_sidecar`（已存在，核对即可）

- [x] Task 3: 缓存路径合规性核对
  - [x] SubTask 3.1: 核对 `resolve_cache_dir()` 返回值是否落在 `D:\software_cache` 体系
  - [x] SubTask 3.2: 修正为 `D:\software_cache\letta`，保证 sidecar.log/letta.db/Python 环境均写入该目录

- [x] Task 4: 编译验证
  - [x] SubTask 4.1: 运行 `cargo check`（在 `src-tauri/`）验证后端编译通过
  - [x] SubTask 4.2: 运行 `npm run build` 验证前端仍构建通过

- [x] Task 5: 修复 reqwest::blocking 在 tokio runtime 内 panic 的运行时风险
  - [x] SubTask 5.1: `letta_server_start` 用 `tokio::task::spawn_blocking` 包装 `start_sidecar` 调用
  - [x] SubTask 5.2: `letta_setup` 用 `tokio::task::spawn_blocking` 包装 `ensure_python_env` + `ensure_run_letta_script` 调用
  - [x] SubTask 5.3: 给 reqwest 增加 `blocking` feature（Cargo.toml）

# Task Dependencies
- [Task 2] 依赖 [Task 1]（命令函数需先存在才能注册）
- [Task 4] 依赖 [Task 1] + [Task 2] + [Task 3]
- [Task 3] 可与 [Task 1] 并行（仅核对/修正 sidecar 服务路径逻辑）
- [Task 5] 依赖 [Task 1]（修改已创建的命令文件）

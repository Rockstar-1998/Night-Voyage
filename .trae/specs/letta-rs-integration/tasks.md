# Tasks

- [x] Task 1: 回退当前未提交的 Letta 相关改动
  - [x] SubTask 1.1: `git checkout HEAD -- .` 回退所有工作区改动
  - [x] SubTask 1.2: `cargo check` 确认回退后编译通过

- [x] Task 2: 添加 letta-rs crate 依赖
  - [x] SubTask 2.1: 在 `src-tauri/Cargo.toml` 中添加 `letta = { path = "../letta-rs" }` 本地路径依赖
  - [x] SubTask 2.2: `cargo check` 确认依赖解析成功

- [x] Task 3: 重写 letta_sidecar.rs — 使用 run_letta.py 启动
  - [x] SubTask 3.1: 添加 `normalize_path()` 函数处理 Windows UNC 前缀
  - [x] SubTask 3.2: 添加 `resolve_letta_cache_dir()` 动态路径解析（exe 同级目录 → app_data_dir）
  - [x] SubTask 3.3: 添加 `RUN_LETTA_PY` 常量（内嵌 run_letta.py 脚本内容）
  - [x] SubTask 3.4: 添加 `ensure_run_letta_script()` 写入脚本到缓存目录
  - [x] SubTask 3.5: 重写 `LettaSidecar::new(app)` 接受 AppHandle 解析缓存目录
  - [x] SubTask 3.6: 重写 `start()` 使用 `python run_letta.py port host` 启动
  - [x] SubTask 3.7: 重写 `resolve_python_path()` 使用动态路径
  - [x] SubTask 3.8: 保留健康检查逻辑，改用 `letta-rs` HealthApi
  - [x] SubTask 3.9: 移除 `sqlite_uri_for()` 和硬编码路径常量

- [x] Task 4: 删除 letta_client.rs，改用 letta-rs
  - [x] SubTask 4.1: 删除 `src-tauri/src/services/letta_client.rs`
  - [x] SubTask 4.2: 从 `services/mod.rs` 移除 `letta_client` 模块注册

- [x] Task 5: 重写 letta_stream.rs — 使用 letta-rs MessageApi
  - [x] SubTask 5.1: 使用 `letta::MessageApi::create_stream()` 替代手写 SSE 解析
  - [x] SubTask 5.2: 消费 `StreamingEvent` 枚举转译为现有前端事件
  - [x] SubTask 5.3: 保留 `spawn_letta_stream_task()` 签名和事件契约不变

- [x] Task 6: 重写 letta.rs 命令 — 使用 letta-rs API
  - [x] SubTask 6.1: 重写 `letta_server_status` 使用 `letta::HealthApi::check()`
  - [x] SubTask 6.2: 重写 `letta_agent_init` 使用 `letta::AgentApi::create()`
  - [x] SubTask 6.3: 重写 `letta_agent_delete` 使用 `letta::AgentApi::delete()`
  - [x] SubTask 6.4: 重写 `letta_setup` — 下载 Python embeddable → 安装 pip/setuptools/wheel/aiosqlite → `pip install letta==0.8.8` → 验证
  - [x] SubTask 6.5: 重写 `letta_save_export` / `letta_save_restore` 使用动态路径
  - [x] SubTask 6.6: 保留 `letta_server_start` / `letta_server_stop` 命令签名

- [x] Task 7: 更新 lib.rs — AppState 和命令注册
  - [x] SubTask 7.1: 更新 `AppState.letta_sidecar` 初始化为 `LettaSidecar::new(&app_handle)`
  - [x] SubTask 7.2: 保留 `on_page_load` 中 sidecar 自动启动逻辑
  - [x] SubTask 7.3: 确认所有 letta 命令注册到 invoke_handler

- [x] Task 8: 前端适配
  - [x] SubTask 8.1: 确认 `backend.ts` 中 Letta 相关类型和函数签名不变
  - [x] SubTask 8.2: 确认 SettingsArea.tsx LettaSettingsPanel 正常工作
  - [x] SubTask 8.3: 确认 App.tsx 中 Letta 模式发送消息流程不变

- [x] Task 9: 验证
  - [x] SubTask 9.1: `cargo check` 通过
  - [x] SubTask 9.2: `npm run build` 通过
  - [ ] SubTask 9.3: 手动测试：初始化 Letta → sidecar 启动 → 创建 agent → 发送消息

# Task Dependencies
- [Task 2] depends on [Task 1] — 需要先回退再添加新依赖
- [Task 3] depends on [Task 2] — sidecar 需要 letta-rs
- [Task 4] depends on [Task 2] — 删除旧客户端需要新客户端就绪
- [Task 5] depends on [Task 2, Task 4] — 流式消息需要 letta-rs 且旧客户端已删除
- [Task 6] depends on [Task 2, Task 3, Task 4] — 命令需要 sidecar + letta-rs
- [Task 7] depends on [Task 3, Task 6] — AppState 需要新的 sidecar 初始化
- [Task 8] depends on [Task 6] — 前端需要后端命令就绪
- [Task 9] depends on [Task 7, Task 8] — 验证需要全部完成

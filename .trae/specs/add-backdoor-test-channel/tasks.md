# Tasks

- [x] Task 1: 在 `Cargo.toml` 中添加 `axum` 依赖
  - [x] SubTask 1.1: 添加 `axum = "0.8"` 到 dependencies

- [x] Task 2: 创建后门模块 `src-tauri/src/backdoor/`
  - [x] SubTask 2.1: 创建 `src-tauri/src/backdoor/mod.rs`，定义模块结构和共享状态（`BackdoorState`：包含 `SqlitePool` 引用、`AppHandle` 引用、启动时间戳）
  - [x] SubTask 2.2: 创建 `src-tauri/src/backdoor/handlers.rs`，实现三个 HTTP handler：
    - `health_handler` — 读取 `BackdoorState` 中的启动时间戳，返回 `{"status": "ready", "uptime_ms": ...}`
    - `providers_handler` — 查询数据库 `api_providers` 表，返回档案列表
    - `chat_test_handler` — 执行完整对话测试流程（创建会话 → 发送消息 → 等待 round 完成 → 返回结果 → 异步清理）

- [x] Task 3: 在 `lib.rs` 中集成后门服务器
  - [x] SubTask 3.1: 在 `lib.rs` 中 `mod backdoor;` 声明模块
  - [x] SubTask 3.2: 在 `setup` 闭包中，数据库初始化完成后，启动后门 HTTP 服务器（`tokio::spawn`）
  - [x] SubTask 3.3: 将 `SqlitePool` 和 `AppHandle` 传入 `BackdoorState`，记录启动时间戳

- [x] Task 4: 实现对话测试核心逻辑
  - [x] SubTask 4.1: 在 `chat_test_handler` 中查询可用的 API 档案（无档案时返回错误）
  - [x] SubTask 4.2: 查询或创建最小测试角色卡（名称 "BackdoorTest"），确保有可用的角色卡用于创建会话
  - [x] SubTask 4.3: 调用 `ChatService::submit_input` 发送测试消息
  - [x] SubTask 4.4: 轮询 `RoundRepository::load_state` 等待 round 状态变为 `completed` 或 `failed`（超时 60 秒）
  - [x] SubTask 4.5: 收集结果（assistant 消息内容、耗时、round 状态），构建响应
  - [x] SubTask 4.6: 异步清理测试会话（`tokio::spawn` 调用 `conversations_delete` 逻辑）

- [x] Task 5: 创建 Python 基准测试脚本 `scripts/startup_benchmark.py`
  - [x] SubTask 5.1: 实现命令行参数解析（`--mode debug|release`、`--runs N`、`--port PORT`）
  - [x] SubTask 5.2: 实现冷启动逻辑：终止已有进程 → 启动可执行文件 → 记录 T0
  - [x] SubTask 5.3: 实现就绪探测：轮询 `GET /health` 直到返回 `ready`，记录 T1
  - [x] SubTask 5.4: 实现对话测试：调用 `POST /backdoor/chat-test`，记录 T2
  - [x] SubTask 5.5: 实现报告输出：冷启动耗时、对话可用耗时、LLM 响应耗时
  - [x] SubTask 5.6: 实现多次运行和平均值计算
  - [x] SubTask 5.7: 实现 debug 模式支持（先启动 Vite，再启动 tauri dev）

- [x] Task 6: 验证端到端流程
  - [x] SubTask 6.1: 启动应用，确认 `GET /health` 返回 `ready`
  - [x] SubTask 6.2: 确认 `GET /backdoor/providers` 返回正确的 API 档案列表
  - [x] SubTask 6.3: 确认 `POST /backdoor/chat-test` 能完成完整对话测试并返回计时数据
  - [x] SubTask 6.4: 运行 `python scripts/startup_benchmark.py --mode release --runs 1` 确认脚本正常工作

# Task Dependencies

- Task 2 依赖 Task 1（需要 axum 依赖）
- Task 3 依赖 Task 2（需要后门模块）
- Task 4 依赖 Task 2、Task 3（需要 BackdoorState 和 handler 框架）
- Task 5 依赖 Task 3（需要后门 API 可用）
- Task 6 依赖 Task 4、Task 5（需要完整功能）

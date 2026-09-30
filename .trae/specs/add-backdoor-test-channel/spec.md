# 后门测试通道 Spec

## Why

Night Voyage 启动时间过长（Vite 冷启动可达 6+ 分钟），但目前缺少自动化手段来精确测量从冷启动到应用完全可用（含 LLM 对话功能）的端到端耗时。需要一个"后门"通道，让外部脚本能够启动程序、检测就绪状态、测试对话功能，从而精确量化启动性能并为后续优化提供基准数据。

## What Changes

- 在 Rust 后端新增轻量 HTTP 服务器（`axum`），随 Tauri 应用启动，监听 `127.0.0.1:17530`，提供后门 API
- 后门 API 端点：`GET /health`（就绪探测）、`GET /backdoor/providers`（列出 API 档案）、`POST /backdoor/chat-test`（端到端对话测试）
- 新增 Python 基准测试脚本 `scripts/startup_benchmark.py`，实现冷启动 → 就绪探测 → 对话测试 → 计时分析的完整流程
- 在 `Cargo.toml` 中添加 `axum` 依赖

## Impact

- Affected specs: 无既有 spec 受影响
- Affected code:
  - `src-tauri/Cargo.toml` — 新增 `axum` 依赖
  - `src-tauri/src/lib.rs` — 在 `setup` 中启动后门 HTTP 服务器
  - `src-tauri/src/backdoor/` — 新增后门模块（mod.rs、handlers.rs）
  - `scripts/startup_benchmark.py` — 新增基准测试脚本

---

## ADDED Requirements

### Requirement: 后门 HTTP 服务器

系统 SHALL 在 Tauri 应用启动时，在 `127.0.0.1` 上启动一个轻量 HTTP 服务器（默认端口 17530，可通过环境变量 `NIGHT_VOYAGE_BACKDOOR_PORT` 覆盖），仅接受来自 localhost 的连接。

#### Scenario: 应用启动时后门服务器就绪

- **WHEN** Tauri 应用完成 `setup`（数据库初始化完成）
- **THEN** 后门 HTTP 服务器 SHALL 在配置端口上开始监听
- **AND** `GET /health` 返回 `{"status": "ready", "uptime_ms": <毫秒数>}`

#### Scenario: 端口被占用

- **WHEN** 配置的端口已被占用
- **THEN** 后门服务器 SHALL 打印错误日志但不阻塞应用启动
- **AND** 应用正常运行，仅后门功能不可用

#### Scenario: 非本地连接拒绝

- **WHEN** 收到来自非 `127.0.0.1` 的连接
- **THEN** 服务器 SHALL 拒绝该连接

### Requirement: 就绪探测端点

系统 SHALL 提供 `GET /health` 端点，返回应用是否完全就绪。

#### Scenario: 应用已就绪

- **WHEN** 数据库已初始化且后门服务器正在监听
- **THEN** `GET /health` 返回 HTTP 200，响应体为 `{"status": "ready", "uptime_ms": <从 setup 开始计算的毫秒数>}`

#### Scenario: 应用尚未就绪

- **WHEN** 数据库尚未初始化完成
- **THEN** `GET /health` 返回 HTTP 503，响应体为 `{"status": "initializing"}`

### Requirement: API 档案查询端点

系统 SHALL 提供 `GET /backdoor/providers` 端点，返回已配置的 API 档案列表。

#### Scenario: 查询 API 档案

- **WHEN** 调用 `GET /backdoor/providers`
- **THEN** 返回 HTTP 200，响应体为 `{"providers": [{"id": <id>, "name": "<name>", "providerKind": "<kind>", "modelName": "<model>"}]}`

### Requirement: 端到端对话测试端点

系统 SHALL 提供 `POST /backdoor/chat-test` 端点，执行完整的对话测试流程：创建测试会话 → 发送测试消息 → 等待 LLM API 响应 → 返回计时数据。

#### Scenario: 对话测试成功

- **WHEN** 调用 `POST /backdoor/chat-test`，请求体为 `{"providerId": <id>, "testMessage": "ping"}`（`providerId` 可选，缺省时使用第一个可用档案）
- **THEN** 系统创建一个测试会话（使用已有的角色卡和预设，或创建最小化的测试用角色卡和预设）
- **AND** 发送测试消息
- **AND** 等待 LLM 流式响应完成（监听 `chat-round-state` 事件直到 round 状态变为 `completed` 或 `failed`）
- **AND** 返回 HTTP 200，响应体包含：
  ```json
  {
    "ok": true,
    "conversationId": <id>,
    "roundId": <id>,
    "assistantMessageId": <id>,
    "assistantContent": "<响应文本预览>",
    "totalMs": <从发送消息到收到完整响应的毫秒数>,
    "roundStatus": "completed"
  }
  ```

#### Scenario: 对话测试失败（无可用 API 档案）

- **WHEN** 调用 `POST /backdoor/chat-test` 但数据库中没有 API 档案
- **THEN** 返回 HTTP 400，响应体为 `{"ok": false, "error": "no_api_provider"}`

#### Scenario: 对话测试失败（LLM 响应超时）

- **WHEN** LLM API 在 60 秒内未返回完整响应
- **THEN** 返回 HTTP 200，响应体为 `{"ok": false, "error": "timeout", "totalMs": 60000, "roundStatus": "streaming"}`

#### Scenario: 对话测试失败（LLM 返回错误）

- **WHEN** LLM API 返回错误或 round 状态变为 `failed`
- **THEN** 返回 HTTP 200，响应体为 `{"ok": false, "error": "<错误信息>", "totalMs": <耗时>, "roundStatus": "failed"}`

### Requirement: 启动基准测试脚本

系统 SHALL 提供 Python 脚本 `scripts/startup_benchmark.py`，实现冷启动到对话可用的端到端计时。

#### Scenario: 执行 Release 模式基准测试

- **WHEN** 运行 `python scripts/startup_benchmark.py --mode release`
- **THEN** 脚本执行以下步骤：
  1. 终止所有已运行的 `night-voyage.exe` 进程（确保冷启动）
  2. 记录启动时间戳 `T0`
  3. 启动 release 版本可执行文件
  4. 轮询 `GET /health` 直到返回 `ready`（记录就绪时间戳 `T1`）
  5. 调用 `POST /backdoor/chat-test` 发送测试消息（记录对话完成时间戳 `T2`）
  6. 终止测试进程
  7. 输出报告：
     - 冷启动耗时：`T1 - T0`
     - 对话可用耗时：`T2 - T0`
     - LLM 响应耗时：`T2 - T1`

#### Scenario: 执行 Debug 模式基准测试

- **WHEN** 运行 `python scripts/startup_benchmark.py --mode debug`
- **THEN** 脚本执行与 release 相同的流程，但启动 debug 版本（需要先启动 Vite dev server，再启动 `tauri dev`）

#### Scenario: 多次运行取平均

- **WHEN** 运行 `python scripts/startup_benchmark.py --mode release --runs 3`
- **THEN** 脚本执行 3 次完整的冷启动测试
- **AND** 输出每次的详细计时和平均值

#### Scenario: 指定后门端口

- **WHEN** 运行 `python scripts/startup_benchmark.py --mode release --port 18000`
- **THEN** 脚本使用指定端口连接后门 API

### Requirement: 测试会话自动清理

系统 SHALL 在对话测试完成后自动清理测试创建的会话数据。

#### Scenario: 测试完成后清理

- **WHEN** 对话测试端点返回结果后
- **THEN** 系统自动删除测试创建的会话及其所有关联数据（消息、轮次、成员）
- **AND** 清理操作不阻塞响应返回（异步执行）

## MODIFIED Requirements

无修改项。

## REMOVED Requirements

无移除项。

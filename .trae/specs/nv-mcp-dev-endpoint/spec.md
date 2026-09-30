# 开发期 MCP 端点（nv-mcp-dev-endpoint）

## 1. 目标与定位

为 Night Voyage 桌面后端提供一个**由运行中应用自身承载**的 MCP（Model Context Protocol）端点，使代理进程能够用标准 MCP 工具调用，对**真实运行实例**做只读查证与受控写入，并让写入结果经由真实事件通道即时反映到真实 UI。

定位边界：

- 这是**开发期诊断通道**，不是产品功能。编译期限定 `all(desktop, debug_assertions)`，发行版与 Android 构建不含任何相关代码。
- 它是**后端能力的另一个入口**，不是第二套实现。工具处理器只做参数解包与结果序列化，业务语义一律调用既有 `services`/`repositories` 函数。
- 它替代此前被废除的平行 JS 实现（`mcp-test-server`：自写 buy_item/门禁/负重、不触后端、不触真实库、并生成合成截图，对真实应用零证伪力）。

形态与机器上既有的 `claireon`（UE 编辑器，`127.0.0.1:55286/mcp`）、`unity`（`127.0.0.1:8080/mcp`）一致：**GUI 应用自监听本地 MCP 端点**，代理侧以 HTTP 连接器接入。

## 2. 新增能力

| 组件 | 路径 | 职责 |
|------|------|------|
| MCP 端点模块 | `src-tauri/src/mcp/mod.rs` | 监听 `127.0.0.1:55287`，解析 HTTP/1.1，校验 token，分派 JSON-RPC 方法 |
| JSON-RPC 协议层 | `src-tauri/src/mcp/protocol.rs` | 请求/响应结构；`initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call` |
| 工具层 | `src-tauri/src/mcp/tools.rs` | `McpTool` trait + 首批 6 个工具的 schema 与处理器 |

工具清单（全部操作真实库或真实服务）：

| 工具名 | 参数 | 真实调用目标 |
|--------|------|--------------|
| `nv_db_info` | — | 报告实际生效的库路径与 conversations / messages / session_states 行数 |
| `nv_conversations_list` | — | `SELECT id, character_id, title, created_at, updated_at FROM conversations` |
| `nv_session_state_raw` | `sessionId` | 返回 `session_states.state_json` **原始字符串**与长度，不做任何解析或修补 |
| `nv_session_state_get` | `sessionId` | `agent_runtime::load_session_state`，即与前端 `session_game_state_get` 完全同一条路径（含 serde 契约校验） |
| `nv_tool_call_execute` | `sessionId`, `toolName`, `argumentsJson` | `agent_runtime::execute_tool_call`，含确定性门禁、持久化与 `broadcast_hud_patch` 真实广播 |
| `nv_session_state_reset` | `sessionId` | `agent_runtime::reset_session_state` + `broadcast_hud_patch`；由 serde 序列化生成符合契约的状态，是修复存量坏数据的唯一合规路径 |
| `nv_messages_list` | `sessionId`, `limit` | `SELECT id, role, created_at, length(content) FROM messages` |

## 3. 运作实现

### 3.1 生命周期

1. `lib.rs` 的 `setup` 在 `db::init_pool` 成功后，向 `tauri::async_runtime` 派生 MCP 监听任务；**监听失败不阻断应用启动**，以 `dbg_eprintln!` 显式报告端口占用等错误（MCP 是开发工具，不是产品启动前提）。
2. 监听绑定 `127.0.0.1:55287`，仅回环，不绑定 `0.0.0.0`。
3. 首次启动生成 32 位十六进制 token，写入 `D:\software_cache\night-voyage-mcp.token`；**文件已存在则读取复用**，保证 token 跨重启稳定，连接器配置一次即可长期有效。

### 3.2 请求处理

```
POST /mcp  (Header: X-NV-Token)
  ├─ token 不匹配            → 401 + JSON-RPC error -32001
  ├─ 非单对象 JSON-RPC 载荷  → 200 + JSON-RPC error -32600
  ├─ method 未知             → 200 + JSON-RPC error -32601
  └─ method 已知
       ├─ 无 id（通知）      → 202 Accepted，空体
       └─ 有 id
            ├─ initialize            → protocolVersion 回显客户端值，capabilities.tools
            ├─ ping                  → {}
            ├─ tools/list            → 全量工具 schema
            └─ tools/call
                 ├─ 工具名不存在    → isError=true + 可用工具名
                 ├─ 处理器返回 Err  → isError=true + 错误原文
                 └─ 成功            → content[0].text 为处理器返回值
```

### 3.3 错误语义（对齐 C2）

- 工具处理器一律 `Result<String, String>`，**禁止 `unwrap_or` / `.ok()` / 默认成功兜底**。
- `nv_session_state_get` 遇到坏数据（如 `missing field unitWeight`）**必须原样上抛为 `isError=true`**——这正是要暴露给使用者的信号，不允许退化成空面板或默认状态。
- 所有跨进程错误消息把反斜杠替换为正斜杠，与既有 IPC 约定一致。

## 4. 旧模块改动

| 文件 | 改动 | 兼容性 |
|------|------|--------|
| `src-tauri/src/lib.rs` | 新增 `#[cfg(all(desktop, debug_assertions))] mod mcp;`；`setup` 内派生监听任务 | 不改动任何既有 command、事件、状态容器；release / mobile 构建走 cfg 剥离，产物无差异 |
| `src-tauri/Cargo.toml` | 新增直接依赖 `hyper`(server,http1)、`hyper-util`(tokio)、`http-body-util`、`bytes` | 四者均已在 `Cargo.lock` 中作为 Tauri 传递依赖存在，**不引入新的 crate 版本线与重复 major** |

未改动：`commands/*`、`services/*`、`repositories/*`、`db/*`、`models/*`、前端全部代码。

## 5. 系统协作

- **SQLite**：复用 `db::init_pool` 已建立的 `SqlitePool`（WAL、`busy_timeout=5s`），与应用同一连接池来源、同一路径，因此 MCP 与 UI 看到的是同一份数据；并发写由 SQLite WAL 保证。
- **事件总线**：`nv_tool_call_execute` 走的 `execute_tool_call` 内部持有真 `AppHandle`，`broadcast_hud_patch` 因此是真实广播，前端 `PersistentHudContainer` 的 `session:hud_state_patch` 监听会实时收到增量补丁。
- **前端**：零参与。MCP 端点不新增任何 Tauri command，前端无法也无需感知其存在（C1 保持）。

## 6. 蓝图与预设影响

无。MCP 端点不读写 `presets` / `blueprint_graph` / `preset_schemas` / `preset_ui_layouts`，不参与 `prompt_compiler` 的编译流程，也不改变任何蓝图节点的语义或拓扑。它是旁观通道，不是执行链路的一环。

## 7. 用户侧实操与调试闭环

- **用户如何使用**：无需主动操作。以 debug 构建正常启动客户端即自动开启端点。代理侧连接信息由 `D:\software_cache\night-voyage-mcp.token` 提供。
- **调试与观测**：`nv_session_state_raw` 与 `nv_session_state_get` 成对使用，可直接对照"库里的原始字节"与"经 serde 契约解析的结果"，从而把"数据坏了"与"渲染坏了"两类故障彻底分离——这正是 9/18 故障的判别手段。
- **门禁回放**：`nv_tool_call_execute` 传入超重或金币不足的购买参数，会返回门禁拦截原文且**不落库**（`buy_item` 在门禁判定失败时于 `save_session_state` 之前返回），可在真实 HUD 上复现拦截而不污染存档。
- **人工干预路径**：修复坏数据后调用 `nv_tool_call_execute`（如 `get_player_stats`）触发一次真实广播，HUD 立即反映，无需重启客户端。

## 8. 约束合规

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 逻辑全在 Rust；端点不是 Tauri command，前端零参与 |
| C2 Zero-Fallback Errors | √ | 工具处理器禁兜底；坏数据原样上抛；无 `.ok()` / `unwrap_or` 默认成功 |
| C3 Responsiveness | √ | 监听在 `async_runtime` 独立任务；每连接 `tokio::spawn`；不触碰 UI 线程 |
| C4 AI UI Isolation | √ | 不生成、不注入任何 UI |
| C5 Mobile Frontend Independence | √ | 不涉及前端，PC 与移动端代码均未改动 |
| C6 Project Cache Location | √ | token 落 `D:\software_cache`，不向系统盘写缓存 |
| C7 PC/Android Coverage | √ | 端点定位为开发期诊断通道而非产品功能，故**刻意**只在桌面 debug 构建存在；Android 构建经 cfg 剥离，不存在"为单端开后门"的问题 |

## 9. 风险与上报

- 风险点：端点具备读写玩家存档的能力，若监听地址或鉴权失效，同机任意进程可篡改游戏状态。
- 影响范围：仅本机；仅 debug 构建；发行版与移动端不含该代码。
- 建议的修正方向：已采取三重收敛——绑定 `127.0.0.1` 回环、强制 `X-NV-Token`、编译期限制到 `all(desktop, debug_assertions)`。后续若需在 release 演示，应引入显式编译开关并在同表登记例外，而不是放宽现有约束。

## 10. 已知限制

- 首批 7 个工具覆盖"库 → 会话状态（读原始 / 读解析 / 重置）→ 消息 → ToolCall 执行"主链；蓝图编译链路（`preview_blueprint_with_session`）、mem0 记忆检索、联机房间状态尚未暴露，按实际调试需要滚动新增（新增即在此表补行）。
- JSON-RPC 批量请求（数组载荷）按不支持处理并显式报错，不静默丢弃。

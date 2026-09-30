# Night Voyage 开发期 MCP：应用内端点 + stdio 代理

## 1. 目标与边界

开发期 MCP 的目标只有一个：让 Agent 会话能以**真实后端路径**操作运行中的 Night Voyage 客户端，
并且在界面上留下可观测的结果。它由两层构成：

1. **应用内端点**（`src-tauri/src/mcp/`）：随客户端进程启动，监听 `127.0.0.1:55287/mcp`，
   8 个业务工具直调既有 `services` / `repositories`；
2. **stdio 代理**（`scripts/nv_mcp_stdio_proxy.mjs`）：由 Agent 宿主 spawn 的 Node 进程，
   在 stdin/stdout 上跑 MCP，把业务工具透传到应用内端点，并自行实现客户端进程的
   启动 / 关闭 / 重启三个生命周期工具。

分层理由（两条硬约束共同决定）：

- **业务语义必须在进程内**。`services/agent_runtime.rs::execute_tool_call` 需要 `&AppHandle`
  才能 `broadcast_hud_patch`；独立进程改得动数据、改不动界面，因此无法驱动现场演示。
- **工具清单必须与客户端存活性解耦**。http 型连接器只有在 Agent 会话启动那一刻客户端已运行
  才能完成握手；客户端晚起，工具清单永远进不了会话的 deferred 工具索引，且会话中途信任 /
  刷新连接器无效。stdio 代理由宿主 spawn，存活与客户端无关。

**设计红线**：两层都只做参数解包与结果序列化。业务语义 100% 下沉到既有 `services` /
`commands` 实现；代理不重写门禁、不重算负重、不自己拼 `DataContainer`。在 `mcp/` 内重写
校验、事务或默认值即视为违规。

**环境基准**：唯一操作对象是真实实例库
`D:\data\Night Voyage\.cache\instances\instance-a\night-voyage.sqlite3`。
`resolve_db_path` 三个来源（`NIGHT_VOYAGE_DB_PATH` → **exe 同目录** → `app_data_dir`）中，
实例 exe 命中的是 exe 同目录分支，因此从实例目录启动客户端无需任何环境变量。
不另建隔离库、不铺空夹具。

## 2. 工具清单（11 = 8 业务 + 3 生命周期）

### 2.1 应用内端点的 8 个业务工具

全部位于 `src-tauri/src/mcp/tools.rs`，实现 `McpTool`（`name` / `description` /
`input_schema` / `call`）。

| 工具 | 入参 | 下沉到 |
|---|---|---|
| `nv_db_info` | 无 | `db::resolve_db_path` + 三张表 `count(*)` |
| `nv_conversations_list` | 无 | `SELECT id, character_id, title, created_at, updated_at FROM conversations` |
| `nv_session_state_raw` | `sessionId:int` | `SELECT state_json, updated_at FROM session_states`（不解析、不修补） |
| `nv_session_state_get` | `sessionId:int` | `agent_runtime::load_session_state`（与前端 `session_game_state_get` 同一路径） |
| `nv_tool_call_execute` | `sessionId:int, toolName:str, argumentsJson:str` | `agent_runtime::execute_tool_call`（门禁 + 持久化 + HUD 广播） |
| `nv_session_state_reset` | `sessionId:int` | `agent_runtime::reset_session_state` + `broadcast_hud_patch` |
| `nv_messages_list` | `sessionId:int, limit?:int` | `SELECT ... FROM messages WHERE conversation_id = ?`（默认 50） |
| `nv_screenshot` | `outputPath?:str` | Win32 `BitBlt` 实抓窗口 → PNG（Windows 专用） |

`nv_screenshot` 的成像路径：取 webview 窗口 `main` 的 `hwnd` → 最小化则
`ShowWindow(SW_RESTORE)` + `SetForegroundWindow` → 等 250ms 让系统合成这一帧 →
`GetWindowRect` → **`GetDC(None)` 取屏幕 DC** → `CreateCompatibleDC` / `CreateCompatibleBitmap`
→ `BitBlt(SRCCOPY)` → `GetDIBits`（32bpp `BI_RGB`，正 `biHeight` 为自下而上 DIB）→
翻行并 BGRA→RGBA、alpha 置 255 → `png::Encoder` 写盘，默认落
`D:\software_cache\nv-screenshot-<时间戳>.png`。源必须取屏幕 DC：窗口 DC 对 WebView2 的
GPU 合成内容会产出黑图。

### 2.2 代理层的 3 个生命周期工具

| 工具 | 入参 | 行为 |
|---|---|---|
| `nv_app_start` | `instance?: 'a' \| 'b'`（默认 `a`） | 已在运行则不重复启动；否则以 `.cache\instances\instance-<k>\night-voyage.exe` 为目标、**以 exe 同目录为 cwd** 启动（detached + unref），轮询端点就绪（上限 90s） |
| `nv_app_stop` | 无 | 未运行则直接返回；否则 `taskkill /IM night-voyage.exe`，8s 内未落则 `/F` 强杀 |
| `nv_app_restart` | `instance?: 'a' \| 'b'` | stop + start，返回两阶段结果 |

启动 cwd 取 exe 同目录是刻意的：`resolve_db_path` 由此命中实例自己的真实库。
`taskkill` 回显为 GBK，按 `gb18030` 解码。

## 3. 运作机制

### 3.1 一次控制链的时序

```
Agent 会话 ──stdio──> nv_mcp_stdio_proxy.mjs
                        │ tools/list  → 返回 11 个工具的静态契约
                        │ tools/call(业务) → 原始 socket 探活
                        │                    ├─ 未监听 → 「程序未启动」(isError)
                        │                    └─ 监听   → HTTP POST /mcp (X-NV-Token)
                        │                                └─ 应用内端点 → services → SQLite
                        │                                     └─ broadcast_hud_patch → 界面刷新
                        └ tools/call(nv_app_*) → spawn / taskkill 客户端进程
```

### 3.2 错误语义（C2 零静默回退）

- 业务工具返回 `Result<String, String>`；`Err` 以 `isError: true` **原文**透出，
  禁止 `unwrap_or` 默认成功、禁止 `.ok()` 吞错。
- 代理透传时不改写客户端的 `isError` 结果；客户端未监听时统一返回「程序未启动」，
  **不降级、不返回缓存数据、不伪造成功**。
- 生命周期工具失败（exe 不存在、超时未就绪、强杀仍在线）一律 `isError: true` 并给出具体原因。

### 3.3 传输与并发

- 端点：hyper，`POST /mcp` JSON-RPC 2.0，方法 `initialize` / `notifications/initialized` /
  `ping` / `tools/list` / `tools/call`；鉴权头 `X-NV-Token`（令牌落
  `D:\software_cache\night-voyage-mcp.token`）。传输依赖均来自既有 `Cargo.lock`
  （hyper / hyper-util / http-body-util / bytes 本就是 Tauri 传递依赖），无新增依赖树。
- 代理：stdin/stdout 换行分隔 JSON-RPC；日志只走 stderr（stdout 是协议通道）。
  请求按到达顺序**串行**处理——生命周期工具会改变端点存活性，与业务工具并发会让后发请求
  打到正在退出的进程上。stdin 关闭时等待在途请求落地再退出，不直接 `exit(0)`。

## 4. 旧模块改动

| 文件 | 改动 |
|---|---|
| `src-tauri/src/mcp/tools.rs` | 8 个业务工具；`nv_screenshot` 与抓屏函数以 `#[cfg(windows)]` 限定 |
| `src-tauri/src/lib.rs` | 端点启动块与 `mod mcp` 的 cfg 由 `debug_assertions` 扩为 `any(debug_assertions, feature = "mcp-dev")` |
| `src-tauri/Cargo.toml` | 新增 `[features] mcp-dev = []`；`windows` 0.61 / `png` 0.17 提升为直接依赖（版本取自既有 lock，与 tauri 2.11.2 共用 windows 0.61.3） |
| `scripts/build_dual_release.bat` | `tauri build` 调用末尾加 `%*`，使 `--features=mcp-dev` 可透传 |
| `scripts/nv_mcp_stdio_proxy.mjs` | 新增：stdio 代理（Node，零第三方依赖） |
| `~/.workbuddy/mcp.json` | 连接器 `night-voyage-dev-mcp` 注册为 `type: stdio`（宿主 spawn 代理） |

既有 service、命令层、前端均无改动。默认 release 构建不含端点；带端点的实例由
`build_dual_release.bat --features=mcp-dev` 产出。

## 5. 系统协作

- 代理 → 应用内端点 → `services::agent_runtime` / `db` → SQLite；与前端共用同一条后端路径，
  不存在第二套实现。
- `nv_tool_call_execute` / `nv_session_state_reset` 的结果经 `broadcast_hud_patch`
  实时反映到运行中的界面，`nv_screenshot` 前后对比即为其可观测证据。
- 端点编译门 `#[cfg(all(desktop, any(debug_assertions, feature = "mcp-dev")))]`：
  Android 与默认发行版均不含该模块；生命周期工具属 PC 开发期监督能力。

## 6. 蓝图与预设影响

无。本变更不触碰蓝图节点、拓扑连线、门禁语义与预设导入路径。

## 6.1 前端挂载：MCP 调试台（C10）

同样的工具能力必须在前端真实界面上可点。`src/components/hud/McpDebugPanel.tsx`
（挂载点：`App.tsx` 根渲染，紧随 `AgentDebugDrawer`，单实例）提供：

| 按钮 | 调用的后端命令 | 与 MCP 工具的关系 |
|---|---|---|
| 会话列表 | `conversations_list` | = `nv_conversations_list` |
| 消息列表 | `messages_list` | = `nv_messages_list` |
| 读取状态 | `session_game_state_get` | = `nv_session_state_get` |
| 重置状态 (HUD) | `session_game_state_reset` | = `nv_session_state_reset`（同样广播 HUD） |
| ToolCall 执行区 | `session_tool_call_execute` | = `nv_tool_call_execute`（同门禁/持久化/广播） |

- ToolCall 执行区含 `toolName` 输入与 `argumentsJson` 文本域，均由使用者填入；
  组件**不内置任何游戏数据或预设参数**（C11）。契约名等可选值的真实数据源（如契约名列表命令）
  出现后，再按滚动开发挂 UI。
- 前端按钮与 MCP 工具走**同一条 service 路径**（同一批 `#[tauri::command]` →
  `services::agent_runtime`），不存在第二套实现；因此无论从按钮还是从 MCP 触发，
  门禁拦截、落库、HUD 增量广播行为完全一致。
- 所有失败在输出区显式红显（C2）；未选会话时点会话级按钮显式报「未选中任何会话」，不静默。
- 生命周期工具（启动/关闭/重启客户端）属于外部监督者能力，不挂进应用自身界面；
  `nv_db_info` / `nv_session_state_raw` / `nv_screenshot` 是代理侧观测工具，
  前端等价物分别是「读取状态」的解析视图与 HUD 本身。
- 双端说明：本面板落在 PC 前端（`src/`）；移动端（`src-mobile/`）为独立项目，
  所依赖的后端命令完全共享，后续按同一命令清单补齐移动端面板即可（C7 剩余平台风险）。

## 7. 用户侧实操与调试闭环

- **接入**：Agent 宿主按 `mcp.json` spawn 代理，任何会话都能拿到 11 个工具；
  配置改动需重启宿主才生效（deferred 工具索引是会话启动快照）。
- **起步**：`nv_db_info` 先看端点连的是不是 instance-a 的真实库，再动手；未启动先
  `nv_app_start`。
- **观测**：`nv_screenshot` 落 PNG 到 `D:\software_cache`，执行前后各抓一张即可肉眼核对
  HUD 是否刷新。抓屏取的是屏幕像素，窗口被其它窗口遮挡时会拍到遮挡物——先让客户端置前。
- **门禁回放**：`buy_item` 的金币不足 / 超重拦截以 `isError` 原文返回，含差额与上限数值。
- **修复坏状态**：`session_states` 不合 camelCase 契约时，唯一合规修复路径是
  `nv_session_state_reset`（走真实 `reset_session_state` 由 serde 生成），禁止手写 JSON 塞库。

## 8. 约束合规

| 约束 | 合规 | 说明 |
|---|---|---|
| C1 Frontend Render-Only | √ | 逻辑全在后端与代理层，前端零改动 |
| C2 Zero-Fallback Errors | √ | 未启动即报「程序未启动」；业务错误原文透出；无吞错、无降级 |
| C3 Responsiveness | √ | 端点跑在独立 tokio 任务；抓屏是同步阻塞操作，刻意放在普通函数内不进 async 状态机 |
| C4 AI UI Isolation | √ | 不涉及 AI 生成 UI 层 |
| C5 Mobile Frontend Independence | √ | 不动前端 |
| C6 Project Cache Location | √ | 抓图与令牌均落 `D:\software_cache`；代理自身不写缓存 |
| C7 PC/Android Coverage | √ | 端点与代理均为 desktop 开发期能力，Android 无单端后门 |
| C8 MCP-Only Acceptance | √ | 验收只用 MCP 集成工具逐步演示真实客户端；无脚本执行、无自测工具 |
| C9 MCP Rolling Development | √ | 工具按滚动开发落地，每个工具落地即现场演示；无一次性工具 |
| C10 MCP Demo Front-Mount | √ | 演示能力已挂载为前端「MCP 调试台」按钮，与 MCP 工具同一条命令路径 |
| C11 No Hardcoded Data | √ | 面板不内置任何游戏数据/预设参数；契约名与参数由使用者输入 |

## 9. 风险与已知限制

- **尚无建会话能力**：端点不能创建会话。空库无法仅凭 MCP 走到完整 UI 流程，
  演示需先在界面里打开一个既有会话（真实环境已有 #30 / #33 / #34）。
- `nv_screenshot` 依赖窗口真实可见：最小化会先还原并置前；被其它窗口遮挡时抓到的是遮挡物。
- 代理启动的客户端随代理进程存活而存活；宿主退出后的存活行为未验证。
- 代理为 Node 脚本：在受限执行环境里若 `node.exe` 被安全策略拦截，**由宿主 spawn 的代理
  不受影响**，但沙箱内无法直接以 node 驱动，需用连接器工具。
- 既有产品缺陷登记：`X01`（`agent_runtime.rs:88-89` 的 `arguments_json.unwrap_or(空对象)`
  吞掉 JSON 解析错误，误报「缺少 item_id 参数」）、`X02`（`models/game_state.rs` 空背包
  `total_weight()` 返回 `-0.0` 并落库）、`write_text` 只改内存不落库不广播却回报「已更新」。
  三者与本变更无关，等独立决策。

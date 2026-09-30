# HANDOFF 状态交接：跑团 Agent 蓝图驱动化与 MCP 验收（M1–M5）

> **真相源（任务规划 + 验收依据）**：[`plans/agent-system-architecture-plan.md`](plans/agent-system-architecture-plan.md)
> ——《Night Voyage 跑团 Agent 与游戏机制系统架构与实施规范》。本文一切交付物以该文档
> **第 10 章「实施落地步骤与验收标准」**（Milestone 1–5、验收指标 1–5）为唯一验收依据；
> 演示脚本 S1–S5（搭建）/ P1–P10（演示）是这些验收指标的操作化序列。
> **架构约束**：[`AGENTS.md`](AGENTS.md) C1–C11 全部有效，违反即验收不通过。

---

## 一、验收纪律（不可协商，违反即拒绝）

1. **只允许使用 MCP**（C8）：
   - 一切操作与取证只经集成 MCP 连接器工具对**真实运行中的客户端**执行
     （`nv_app_restart` / `nv_db_info` / `nv_conversations_list` / `nv_messages_list` /
     `nv_session_state_get` / `nv_session_state_raw` / `nv_session_state_reset` /
     `nv_tool_call_execute` / `nv_screenshot` / 新增 `nv_preset_gate_select` /
     `nv_blueprint_get` / `nv_blueprint_save`）；
   - **不接受任何脚本文件**（`.py` / `.mjs` / `.ps1` / `.bat`）的执行结果作为验收依据；
     不接受 `selftest` / 自测报告 / "测试全通过"类结论。
   - 已知机制：MCP 工具的 deferred 索引是**会话启动快照**——中途新增的 MCP 工具
     必须**新开会话**才会进入工具索引；连接器晚起同理。
2. **不可伪造**（C2 + C11）：零静默回退、零硬编码数据、零"看起来能用的占位实现"。
   界面上出现的可选值必须来自真实数据源（后端命令/数据库/契约定义）。
3. **不可拿现有会话交差**：演示用的预设、蓝图、会话必须**从 0 现场搭建或现场修改**，
   每一步由用户当场看到真实界面/真实数据变化；直接宣称"已有成果已跑通"一律拒绝。
4. **允许修改现有蓝图**：演示允许在现有预设/蓝图上做修改（改节点配置、连线、Gate 选择），
   前提是**功能行为必须由蓝图产生**——改蓝图则行为变，这是"非硬编码"的硬证据。
5. **C10 前端挂载**：每个用于验收的 MCP 能力，必须同时以**界面可点按钮/面板**存在
   （调用同一条后端命令），让用户能亲手触发并看到界面变化。
6. **构建**：必须走 `scripts\build_dual_release.bat --features mcp-dev`
   （两个独立参数；无参数构建不含 MCP 端点）。`cargo check` 校验一律带 `--features mcp-dev`，
   否则 mcp 模块不被编译、错误被漏掉。

## 二、当前系统状态（截至交接）

**已验证可用（MCP 实测，真实客户端 instance-a）**
- 客户端界面：常驻 HUD（gold/weight/hp/mp/背包网格）、底部输入条、[时序调试] 按钮、
  [MCP] 调试台（AgentDebugDrawer：泳道 / 容器 / 工具 / 骰点 / 禁词五个页签）全部就位。
- buy_item 全链路（当前走**内置契约**路径）：扣金币、加负重、合并入库、HUD 实时刷新
  （`nv_screenshot` 逐张留证）。
- 金币不足门禁拦截正确：gold=5 买 unit_price=50 → 「【门禁拦截 - 金币不足】…购买未执行」，
  状态容器零篡改。
- ToolPlan 契约校验已实现：`ToolPlan.parameters_schema`（来自蓝图 ToolDefinition 节点）+
  `validate_args_against_schema`（required + 基本类型），执行前强制校验；
  手工触发（MCP 工具/抽屉按钮）与模型自动调用走同一条 `resolve_tool_plan → execute_tool_call_with_plan` 链。

**关键缺口（验收核心，未完成）**
- **buy_item 目前走的是 Rust 内置契约 = 硬编码路径**，不满足"功能由蓝图写出"的硬标准。
  蓝图驱动路径已经打通但**尚未被演示**：V2.2 预设里 buy_item 整链
  （ToolDefinition→ConditionGate→Calculator→ToolReturn）挂在 `n_rpg_engine_gate`
  （group_gate）的 `inventory_trade` 选项后方，**只有选中该选项才编译出 ToolPlan**。
  验证顺序：勾选 `inventory_trade`（预设 Gate 面板，或 `nv_preset_gate_select`）→
  缺 `unit_price` 的 buy_item 应被蓝图契约拦下报错（而非扣 0 成交）→
  用 `nv_blueprint_save` 改蓝图里的门禁/扣减表达式 → 同一调用行为随之变化 →
  用 `nv_blueprint_get` 取回图逐节点对照。
- P3（调试抽屉泳道条目）、P5（骰点/禁词面板）、P6（Nudge 纠偏，需真实模型轮次）、
  P7（剧本流水线 draft→critique→refiner）、P8（导演-演员，Gate 切 `director_actor`）、
  P9（Schema 保留层数裁剪）、P10（双端锚点隔离）均**未演练**。

## 三、已修复的代码缺陷（本轮发现）

| 编号 | 位置 | 缺陷 | 修复 |
|---|---|---|---|
| F1 | `src/components/debug/AgentDebugDrawer.tsx` | 手动 ToolCall 的参数预填是硬编码 `{"item_id":"health_potion","count":1,"cost":50,"weight":2}`，且参数名与真实契约（`unit_price`/`unit_weight`）不符（C11） | 预填清空 + 占位说明；直接执行会收到后端契约校验返回的真实 required 清单 |
| B3 | `src-tauri/src/services/agent_runtime.rs`、`models/tool_plan.rs` | ToolCall 参数不按契约 `parameters_schema` 校验，缺 `unit_price` 照常成交、扣 0 金币 | `ToolPlan` 增加 `parameters_schema`（collect_tool_plan 从 ToolDefinition 节点带入）；新增 `validate_args_against_schema`，执行前强制校验；手工触发路径改为先 `resolve_tool_plan`，命中即与模型自动调用同链，蓝图解析失败按错误上抛（不静默降级） |
| B4 | `src-tauri/src/mcp/tools.rs` | `PrintWindow` 从 `Win32::Graphics::Gdi` 导入——windows 0.61.3 里它在 `Win32::Storage::Xps`；且 `Cargo.toml` 缺 `Win32_Storage_Xps` feature、`PRINT_WINDOW_FLAGS` 类型包装缺失、`BOOL` 判定误用 `is_ok()` | 修正 import + feature + 类型包装 + `as_bool()`。此前所有不带 `--features mcp-dev` 的 `cargo check` 都编译不到 mcp 模块，错误被长期掩盖 |
| B5 | `src-tauri/src/mcp/tools.rs` | `NvBlueprintGet` / `NvBlueprintSave` 是**从未编译通过的死代码**：引用了不存在的 `NormalizeBlueprintGraphInput` 结构与 `services::presets::PresetService` 26 参数 update；且从未注册进 `all_tools()` | 改为调用真实存在的 `normalize_blueprint_graph(String)` + 定向 UPDATE `presets.blueprint_graph`（预设不存在时报错）；注册进工具表。前端等价物：蓝图编辑器的保存按钮 |
| B6 | `src-tauri/src/models/blueprint.rs` | `InvokeSchemaConfig` 只认 `schema_id`，而存量图（V2.2 预设文件）存的是改名前的 `schemaId` → 预设 27 整图加载失败 `missing field schema_id` | `#[serde(alias = "schemaId")]`（仅存量兼容；两个名字都没有仍按缺字段报错，不猜测填充） |
| B7 | `scripts/build_dual_release.bat` | 用法注释示例 `"--features mcp-dev"`（引号含空格）会被 tauri CLI 拒绝；且原脚本 `%*` 转发缺失导致参数被整体丢弃 | 修正注释为两个独立参数写法；`call npm run tauri build -- --no-bundle %*`。**注意：该 bat 为 LF 行尾、必须保持纯 ASCII**——中文注释曾引发 cmd 按 GBK 解析吞换行、整脚本错乱 |

## 四、现存占位符与未修缺陷（接手者必读）

| 编号 | 位置 | 现象 | 状态 |
|---|---|---|---|
| X01 | `agent_runtime.rs`（历史记录） | `arguments_json` 解析失败曾被 `unwrap_or(空对象)` 吞掉 → 误报"缺少 item_id" | 已在 `execute_tool_call*` 路径改为原文报错；**需全面排查其余调用点** |
| X02 | `models/game_state.rs` | 空背包 `total_weight()` 返回 `-0.0` → 落库与 HUD 显示 `-0.0kg` | 未修 |
| X03 | `write_text` 契约 | 只改内存不落库不广播，却回报"已更新" | 未修（占位实现，属 C2 违规候选） |
| X04 | 会话 #30 预设蓝图 | 编译报错 `branch node n_branch_3_angh missing required port: out_single`（此前被内置契约兜住不可见，改为上抛后暴露） | 未修：需修复该预设蓝图的 Branch 节点连线 |
| X05 | 义体维护套件重复条目 | `id=cyber_maint_kit` 与 `id=义体维护套件` 两条同名物品并存（历史脏数据，两次购买按 id 合并导致） | 未修：可用 `nv_session_state_reset` 重置后重演 |
| X06 | 移动端 tsconfig | `npx tsc --noEmit -p tsconfig.json` 在移动端有既存类型错误 | 未修，不阻塞桌面端 |

## 五、接手后的推进顺序（建议）

1. 构建带端点实例：`scripts\build_dual_release.bat --features mcp-dev`；
2. **新开会话**让 MCP 工具索引刷新（含 `nv_preset_gate_select` / `nv_blueprint_get` / `nv_blueprint_save`）；
3. 预设 Gate 面板勾选 `inventory_trade`（或 `nv_preset_gate_select`）→ 激活蓝图工具链；
4. 按"改蓝图 → 行为变"三步法完成蓝图驱动证据链（见"关键缺口"）；
5. 修 X03（write_text 落库+广播）与 X04（#30 预设 Branch 连线）；
6. 按 S1–S5 从 0 搭建演示资产 → P1–P10 全链路演示（每步 MCP + 截图留证）；
7. 全部验收指标对照 `plans/agent-system-architecture-plan.md` 第 10 章逐条核销。

## 六、环境备忘

- 真实实例：`D:\data\Night Voyage\.cache\instances\instance-a\night-voyage.exe`
  （exe 同目录 `night-voyage.sqlite3` 即真实库；`%APPDATA%\com.nightvoyage.app` 是废弃残留）。
- MCP 端点 `127.0.0.1:55287`，令牌 `D:\software_cache\night-voyage-mcp.token`；
  本机有 `HTTP_PROXY`，端点探活须绕代理（stdio 代理 `scripts/nv_mcp_stdio_proxy.mjs` 已处理）。
- 沙箱内 `node.exe` 与 `python.exe` 均被安全策略黑名单拦截（Bash 报 PROGRAM BLOCKED），
  **不要尝试**；构建/验证用 PowerShell 工具 + bat。
- 构建产物时间戳是"构建是否生效"的唯一判据（`instances/instance-a/night-voyage.exe` mtime）。

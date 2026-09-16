# Walkthrough: 深度排查与彻底清理占位假日志、修复 session_game_state 状态管理

## 1. 改动摘要

| 文件 | 函数/模块 | 改动内容 |
|------|-----------|----------|
| `src-tauri/src/commands/game_state.rs` | `session_game_state_get`, `session_game_state_save`, `session_game_state_reset`, `session_tool_call_execute` | 将 `db: State<'_, SqlitePool>` 修正为 `state: State<'_, AppState>`，从 `state.db` 获取连接池，消除 Tauri command 找不到 managed `SqlitePool` 的运行时崩溃。 |
| `src-tauri/src/commands/ui_layout.rs` | `preset_ui_layout_create`, `preset_ui_layout_list`, `preset_ui_layout_get`, `preset_ui_layout_delete` | 同样将 `db: State<'_, SqlitePool>` 修正为 `state: State<'_, AppState>`，规范化数据库状态依赖。 |
| `src/components/debug/AgentDebugDrawer.tsx` | `AgentDebugDrawer` | 彻底拔除初始写死的 5 条静态 Mock 测试事件（Prompt 倒序裁剪、ToolCall 调度、ConditionGate 判定、Calculator 执行、HUD 增量补丁），初始化 `timeline` 为 `[]` 并补充空态说明；增加“清空流水”控制按钮；将禁词校验测试接入实时事件泳道；挂载 Tauri `session:hud_state_patch` 增量事件监听，实现真实动作流按需流水记录。 |
| `src-mobile/components/MobileAgentDebugModal.tsx` | `MobileAgentDebugModal` | 彻底移除静态写死的 4 条演示卡片，引入动态 `timeline` 响应式状态、空态回退与“清空流水”能力；接入 `session:hud_state_patch` 真实增量事件监听与交互事件记录。 |

## 2. 全工程深度排查结论

为了迎接全量验收，本次对整个项目进行了地毯式静态扫描与排查：
1. **组件库排查**：对 `src/components/debug/`、`src/components/hud/`、`src/components/schema/`、`src/components/blueprint/nodes/`（含 `CalculatorNode`、`ConditionGateNode`、`ToolDefinitionNode`、`ToolReturnNode`、`UiLayoutConfigNode`、`InvokeSchemaNode`）以及移动端 `src-mobile/components/` 进行了全面代码审查，确认除上述抽屉中用于预览样式的 5 条/4 条静态列表外，其余组件均采用干净的初始空状态（`{}`、`[]`、`null`），**未残留任何其他虚假日志或伪造运行记录**。
2. **后端服务排查**：核查 `src-tauri/src/services/agent_runtime.rs`、`src-tauri/src/services/agent_guards.rs` 及 `src-tauri/src/services/prompt_compiler.rs`。确认倒序滑动裁剪（Reverse Sliding Pruner）、Aho-Corasick 禁词检定、SplitMix64 D20 骰点与原子 ToolCall 运算器均为实际编译的底层引擎实现，无任何伪造数据插桩。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端调试抽屉仅负责渲染数据容器快照与时序事件，所有数据库读写与规则判定均在 Rust 端执行。 |
| C2 Zero-Fallback Errors | √ | 彻底修复 Tauri State 依赖，明确报出并清除 unmanaged 状态，禁止静默吞没异常。 |
| C3 Responsiveness | √ | 事件监听使用异步卸载机制，无任何阻塞主线程操作。 |
| C4 AI UI Isolation | √ | 本次改动不涉及 AI 动态沙箱外溢，仅调整宿主内部调试工具。 |
| C5 Mobile Frontend Independence | √ | PC 端 (`src/components/debug/AgentDebugDrawer.tsx`) 与 移动端 (`src-mobile/components/MobileAgentDebugModal.tsx`) 保持完全独立的代码实现与组件树，零跨端耦合。 |
| C6 Project Cache Location | √ | 编译与缓存均保持在既定目录，未向系统盘写入任何临时文件。 |
| C7 PC/Android Coverage | √ | PC 端和移动端的调试组件同步进行了假日志剔除、真实事件绑定与清空流水功能对齐。 |

## 4. 验收记录

1. **Rust 后端编译**：
   - 命令：`cargo check --manifest-path src-tauri/Cargo.toml`
   - 结果：通过（退出码 0，dev profile target(s) 3.86s，无类型或生命周期错误）。
2. **PC 前端类型检查**：
   - 命令：`npx tsc --noEmit -p tsconfig.json`
   - 结果：通过（退出码 0，零类型错误）。
3. **移动端前端类型检查**：
   - 命令：`npx tsc --noEmit -p tsconfig.mobile.json`
   - 结果：通过（退出码 0，零类型错误）。
4. **功能验收效果**：
   - 打开调试抽屉时不再报 `state not managed for field db` 红色错误；
   - 抽屉初始化时呈现清爽的空态说明（“暂无运行时动作流水记录”），不再有未经操作却凭空出现的假日志；
   - 支持一键“清空流水”以便反复多轮次调试观察；
   - 当收到真实 `session:hud_state_patch` 或进行手动 ToolCall / 骰点 / 禁词校验时，泳道按时序动态追加记录。

## 5. 已知限制或后续待办

- 无。全工程伪造占位日志已彻底肃清，状态管理与事件流均已全通路对齐规范。

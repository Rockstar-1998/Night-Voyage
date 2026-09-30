# HANDOFF 状态交接：不可知化核心重构 M1（契约去硬化）

> **真相源**：`.trae/specs/agnostic-core-redesign/spec.md`（v5，Mermaid 思维导图版）
> ——用户架构决策（2026-09-27）："只提供容器与计算器，不要提供具体功能，默认为具体功能不可知化"。
> 三条不变量：I1 语义上移 / I2 显式失败 / I3 机制正交。里程碑 M1–M6。
> 上游计划：`plans/agent-system-architecture-plan.md`（§1–§10 有效）。
> 架构约束：`AGENTS.md` C1–C11 全部有效。

---

## 一、任务背景（本轮会话决策链）

1. **MCP 连接器检修**（已完成并提交 `8e30381`/`c023a63`/`f3a1fe5`）：ZCode 两级配置 args 空格拆断 + Settings 页回写 `enabled:false` 两次覆盖，均已修复；stdio 代理挂载 3 个蓝图工具（14 工具）。
2. **验收推进中发现内置契约越权**：`agent_runtime.rs` 的 `execute_builtin_tool` 携带 7 个硬编码业务工具（buy_item 完整交易流、use_item 回血 30 规则、unit_price 缺省 0 等），蓝图未定义时静默兜底——历史验收证据全部走的这条硬编码路径。
3. **审计扩大**：计划 §7.1 的 5 个编排节点类型（AgentModeSwitch/DirectorConfig/ActorDefinition/ScriptwriterPipeline/BannedWordsConfig）**从未实现**，现行实现靠硬编码 `AGENT_GATE_NODE_ID="n_agent_gate"` + 代码常量驱动；Nudge 重试 2 次、锚点 50 字、禁词内置词库全在代码里。
4. **用户裁定重设计**：Rust 只提供容器与计算器；具体功能不可知化；每个机制必须有"蓝图配置样例 + 非硬编码判据"；覆盖计划全文；世界书读取/派发经 Querier 跨域读原语走白名单命令。
5. **Spec 经 5 轮迭代定稿**（用户验收通过），M1 开工。

## 二、当前进度：M1 代码已全部落地并构建通过，验收完成 2/5 项

### 已完成的代码改动（工作区，未提交）

| 文件 | 改动 |
|---|---|
| `src-tauri/src/models/blueprint.rs` | 新增 4 节点类型：`Inspector`（容器读）/`Querier`（跨域读）/`BannedWordsConfig`（词库+Nudge 参数，serde 缺省=计划行为）/`ScriptwriterPipeline`（stages/anchor_tail_chars/blackout_marker）；`BannedWordsConfig: Default` |
| `src-tauri/src/models/tool_plan.rs` | `ToolStep::Inspect/Query`；`StepContext`（inspect/query 上下文）；点路径求值 `resolve_dotted`；字符串模板 `render_string_template`/`render_args_template`；`render_return_template` 改为"点路径优先、操作数表达式兜底"（旧模板兼容）；`run_tool_plan` 签名增加 `query_exec: &dyn Fn(&str,&Value)->Result<Value,String>` 回调；新增 3 个测试（inspect 模板/query 回调/scratchpad 缺键报错） |
| `src-tauri/src/services/action_bridge.rs`（新） | 白名单存取（settings 表 key `action_bridge.command_whitelist`，默认空=未注册显式报错）；`invoke` 白名单校验+分发；`query_world_book_entries` 按会话世界书检索（标题/正文/关键词包含匹配，limit 1-50） |
| `src-tauri/src/commands/action_bridge.rs`（新） | `action_bridge_whitelist_get/set` 两个 Tauri 命令（已注册进 lib.rs） |
| `src-tauri/src/services/blueprint_executor.rs` | 链合法类型 +inspector +querier；traverse 对 Inspector/Querier 上主流程报 `ChainOnlyNodeOnMainFlow`、对两个编排资产节点惰性透传（要求有出边保持连通）；`extract_orchestration_configs` 全图提取（同类复数硬错）；错误变体 ×2；token 计算 match 补 4 臂 |
| `src-tauri/src/services/agent_runtime.rs` | **删除 `execute_builtin_tool` 整体（约 200 行）**；两处 None 兜底臂改为显式报错 `蓝图未定义契约「{tool}」…`；`run_tool_plan` 接入 action_bridge（block_on 桥接，无连接持有死锁风险）；新增 `load_blueprint_configs_for_conversation`（会话→预设→图→编排配置提取） |
| `src-tauri/src/services/agent/nudge.rs`（重写） | `NudgeGuard::new(max_retries, instruction_template)` 参数化（D-1）；模板 `{hits}`/`{remaining}` 占位渲染；3 个测试（额度 0 立即放弃等） |
| `src-tauri/src/services/agent_guards.rs` | **删除内置 24 条默认词库与 OnceLock 自动机**（D-6）；`BannedWordsFilter::from_words(words)`——词库即过滤全集，未配置=空过滤 |
| `src-tauri/src/services/agent/orchestrator.rs` | 流水线入口加载 ScriptwriterPipeline 节点配置（缺失显式报错）；尾锚/涂黑标记改用 `pipeline_cfg.anchor_tail_chars`/`blackout_marker`（D-2） |
| `src-tauri/src/services/stream_processor.rs` | 单模型路径：回合开始加载 `banned_config`（失败按统一失败路径收尾）；`NudgeGuard` 带参构造；禁词过滤 `from_words(&banned_config.words)`；泳道文案用 `nudge_guard.max_retries()`；流水线终稿扫描同样走节点词库 |
| `src-tauri/src/commands/game_state.rs` | `agent_validate_banned_words` 签名改为 `(state, session_id, text)`——词库来自会话预设节点（D-6） |
| `src-tauri/src/commands/world_books.rs` | `world_book_entry_get` 改 `pub(crate)`（action_bridge 复用） |
| `src-tauri/src/mcp/tools.rs` | `nv_tool_call_execute` 描述去名词化 |
| `src-tauri/src/commands/blueprint.rs` | gate_dto match 补 4 臂；预览 steps 补 Inspect/Query 两分支（`inspect: kind key` / `query: cmd (白名单命令)`） |
| `src/lib/backend/game_state.ts` | `agentValidateBannedWords(sessionId, text)` 新签名 |
| `src/components/debug/AgentDebugDrawer.tsx` | 禁词按钮带 sessionId、无会话时阻断提示 |

### 构建与测试（真实输出）

- `cargo check --features mcp-dev`：**Finished（0 error）**。
- `cargo test --features mcp-dev --lib`：**141 passed / 1 failed**。唯一失败 `provider_adapter::tests::openai_http_request_rejects_non_text_content`（断言 `error.contains("纯文本")`）为**存量工作区问题**——该文件相对 HEAD 有 121 行前序会话未提交改动，M1 未触碰，勿在本任务顺手修。
- `scripts/build_dual_release.bat --features mcp-dev`：**成功**（release 3m58s；instance-a exe = 2026-09-27 21:15:13，已重启验证 pid 26880）。

### 实机验收（MCP 直调，已完成 2 项）

1. ✅ **未定义契约显式报错**：会话 34（预设 26 无 buy_item）调 buy_item → `蓝图未定义契约「buy_item」——…请在蓝图中定义该契约后重试`（修复前同一调用静默扣 60 金币入库，此为核心证据）。
2. ✅ **蓝图编译错误如实上抛**：会话 35（预设 27，inventory_trade 已勾选）→ `tool call chain reaches node n_tool_buy_item of type ToolDefinition; only calculator / condition_gate / inspector / querier / tool_return are allowed`（错误文案已含新链类型）。

### M1 验收门剩余 3 项（下会话继续，见 §三）

## 三、下会话接手清单（按序执行）

1. **M1 收尾验收**（spec §7 M1 验收门）：
   - 标准库读链资产导入演示：向预设 27（或测试预设）写入 §2.1 的 check_inventory 链（ToolDefinition→Inspector→ToolReturn），界面/抽屉调用成功——**读原语资产可用性**；
   - Querier 白名单取数演示：设置表登记 `query_world_book_entries`（`INSERT INTO settings` 或 M4 前先用 SQL/MCP），建 search_world_book 链，导演模式或抽屉调用返回真实世界书条目；
   - 改 BannedWordsConfig/锚点 config → 行为变（词库增删、max_nudge_retries、anchor_tail_chars 各一例）。
2. **Walkthrough + 提交**：按 AGENTS.md 写 `Walkthrough/YYYYMMDD-HHmm-不可知化M1契约去硬化-修改.md`（约束审计表 C1–C11；C8 说明：已做 MCP 实机验收 2 项，剩余 3 项验收后补录），`git add` 上述 §二 全部文件后提交推送。**提交前注意**：工作区还有大量前序会话未提交改动（provider_adapter.rs 等），只 add M1 清单内文件。
3. **M2 预设 27 修复**（spec §2.2 diff）：删 4 条 ToolDefinition 串联边；加 `n_tool_buy_item.out→n_gate_gold.in`；`n_gate_gold.expression:"50"→"total_cost"`；`n_calc_gold_deduct.operand_a:"50"→"total_cost"`；check_inv 链尾接 Inspector+ToolReturn；use_item/inspect_item 空链。验收判据：expression 在 "50"↔"total_cost" 切换 → 同一调用放行/被拦（界面实测留证）。
4. **M3 编排节点资产化**：落地 AgentModeSwitch/DirectorConfig/ActorDefinition 节点类型 + tools 引用编译校验（`tools:Vec<String>` 引用图中 tool_name，缺失硬错）；D-3（删 `AGENT_GATE_NODE_ID`，按类型发现+唯一性校验）；D-5（director_actor 提示词载体审计）；D-4（MAX_TOOL_ROUNDS_PER_TURN 入编排节点 config）；蓝图编辑器新节点表单（双端）。
5. **M4 动作通道**：ActionButton 控件 + 白名单设置页（命令已就绪：`action_bridge_whitelist_get/set`）+ 沙箱 postMessage 桥（双端）。
6. **M5 产物通道**：SchemaDefinition.card 扩展 + 卡片渲染 + 待确认两态（双端）。
7. **M6 标准库资产 + 终验**：编辑器「导入片段」按钮 + 计划 §10 指标 1–5 核销。

## 四、已知问题与风险

| 编号 | 问题 | 状态 |
|---|---|---|
| H1 | provider_adapter 测试失败（存量，非 M1） | 待前序任务处理 |
| H2 | 前序会话 X01–X06 未修（X03 write_text 落库 / X04 预设 22 branch 断线等），见旧 HANDOFF | M2/M3 顺带或单列 |
| H3 | 禁词词库清空后，存量预设（22/26/27 均无 BannedWordsConfig 节点）**禁词过滤为空**——这是 I1 的显式预期行为，不是回归；创作者需在蓝图加节点配置词库 | 设计如此，需在 M3 编辑器表单就绪后引导 |
| H4 | `run_tool_plan` 的 query_exec 用 `block_on` 桥接异步——当前无连接持有故安全；M3 若在事务内执行工具链需重新评估 | 记录在案 |
| H5 | 预设 27 的 13 个单选 Gate 已在本会话用 GUI 勾选过（channel=cot 等存于 preset_gate_selections），会话 35 已绑预设 27 | 现状可用 |

## 五、环境备忘

- 分支 `feat/agent-system-architecture`；工作区含 M1 全部改动（§二清单）+ 前序会话改动，**均未提交**。
- 客户端运行中：instance-a pid 26880（M1 新 exe，端点 127.0.0.1:55287）。
- MCP 连接器：ZCode 用户级+工作区配置已修（`enabled:true`，args 完整）；**勿在 Settings→MCP 手动开关**（会回写覆盖文件）。14 工具含 `nv_preset_gate_select`/`nv_blueprint_get`/`nv_blueprint_save`。
- 构建必须 `scripts\build_dual_release.bat --features mcp-dev`（两个独立参数）；cargo 全路径 `D:/data/Night Voyage/.cache/cargo/bin/cargo.exe` + `CARGO_HOME=D:/data/Night Voyage/.cache/.cargo`。
- GUI 操作工具（模拟鼠标/键盘/截图）：`D:\software_cache\nv-gui\nvgui.ps1`（cmd: info/focus/shot/click/dclick/drag/scroll/paste/key；坐标=窗口客户区像素，4K 屏窗口 1942×1243）。
- 会话/预设：#30=预设22（branch 断线 X04）、#33/#34=预设26、#35=预设27（本会话 GUI 新建，单人+stateless+预设27+岩田九陵，gate 已全选+inventory_trade ✓）。
- 白名单初始为空（设计）；测试 Querier 前需登记：`INSERT INTO settings (key,value) VALUES ('action_bridge.command_whitelist','["query_world_book_entries"]')`。
- 沙箱内 node.exe/python.exe 被安全策略拦截，用 PowerShell 工具；shell 内 PowerShell 管道符需转义。

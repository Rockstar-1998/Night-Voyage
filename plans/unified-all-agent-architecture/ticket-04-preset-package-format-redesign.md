# [工单 04] 预设代码化交换格式与双向 AST 编译器设计 (Preset Code Format & Bidirectional AST Compiler)

**Ticket Label**: `wayfinder:task`  
**Parent Map**: `plans/unified-all-agent-architecture/map.md`  
**Status**: `Unblocked / Frontier`

---

## Question

在坚守 SQLite 本地数据库作为应用唯一运行时存储权威（`presets` 表）的前提下，如何淘汰单体 3500 行 JSON（`.nvpreset.json`）这一反 AI 的外部分发与协作格式？如何设计一套基于 TypeScript 语法子集（`.nv.ts`）的声明式代码化交换规范，并通过 Rust 原生极速 AST 解析器（`oxc_parser`，零 Node.js 外部依赖，全跨平台覆盖 PC 与 Android）实现“**SQLite 图数据 $\longleftrightarrow$ TypeScript 代码**”的双向无损编译，使 AI 能够通过代码以高可读性、零幻觉的方式辅助人类编辑蓝图？

---

## Context & Key Decisions

1. **存储架构分层：SQLite 存物理核心，TypeScript 作交换介质**：
   - **数据库持久层 (SQLite)**：`presets` 表中的 `blueprint_graph` 字段继续作为引擎运行时的权威数据源。桌面与移动端沙箱在启动、索引、会话加载时不依赖外部文件系统，维持最高性能。
   - **交互与分发层 (TypeScript `.nv.ts`)**：外部分发（文件导入/导出）、Git 版本控制、以及 AI 辅助编辑的 MCP 通信，全部统一升级为高紧凑度的 `.nv.ts` 代码文件。
   - 人类在 SolidJS 画布上用可视化图形拖拽修改，AI 在代码编辑器中用 TypeScript 逻辑修改，两者通过后端的双向编译器看同一套系统。

2. **TypeScript DSL 声明式语法规范 (`@night-voyage/blueprint`)**：
   规范化定义高层宏、状态绑定、能力池与管线流动的 TS 声明模式，彻底消除散落的 UUID 与无意义的二维坐标：
   ```typescript
   import { definePreset, Macro, Agent, Tools } from "@night-voyage/blueprint";

   // 1. 状态与 UI 契约绑定
   export const state = definePreset.state({
     stats: { credits: 1000, sanity: 85, hp: 100 },
     inventory: [{ id: "potion_hp", name: "生命药水", count: 2 }],
     layout: "rpg_hud_v3",
   });

   // 2. 逻辑宏定义 (UE5 Macro 映射)
   export const BuyItemRule = Macro.define({
     name: "购买校验与结算规则宏",
     inputs: { cost: "number", item_id: "string" },
     outputs: ["pass", "fail"],
     execute(ctx, { cost, item_id }, { pass, fail }) {
       if (ctx.stats.credits >= cost) {
         ctx.stats.credits -= cost;
         return pass("购买成功");
       }
       return fail("信用点不足");
     },
   });

   // 3. 全局工具能力池
   export const tools = [
     Tools.define({
       name: "buy_item",
       description: "在商店中购买道具",
       schema: { item_id: "string", cost: "number" },
       handler: BuyItemRule,
     }),
   ];

   // 4. 执行管线
   export default definePreset.pipeline(({ mode, prompt, flow }) => {
     prompt.system("你拥有主权蓝图拓扑编排能力...");
     flow.branch("single_pass", () => {
       prompt.include("宏: 思维链规则");
       prompt.include("宏: 正文规则");
       return Agent.singlePass({ maxSteps: 1, tools: [tools.buy_item] });
     });
   });
   ```

3. **Rust 原生极速 AST 编译器（零 Node.js 依赖）**：
   - 依赖选型：引入纯 Rust 编写的现代化前端工具链 `oxc_parser`（速度比 SWC 快数倍，完全支持直接交叉编译至 Android ARM64 与 Windows x86_64，无任何 C/C++ 动态链接痛点）。
   - **反向序列化 (`BlueprintGraph -> TypeScript`)**：
     - 当用户点击“导出代码预设”或 AI 触发 MCP 查询时，Rust 遍历图结构与宏字典，将其拓扑还原为语义清晰的 TypeScript 源码，行数从 3500+ 行缩减至 100~200 行。
   - **前向编译 (`TypeScript -> BlueprintGraph -> SQLite`)**：
     - 当导入 `.nv.ts` 代码时，`oxc_parser` 在纯内存中解析 AST，静态提取 `definePreset.state`、`Macro.define`、`Tools.define` 与 `flow.branch` 等高层声明；
     - 校验引脚类型与宏引用的合法性；
     - 通过内置的自动拓扑布局算法（Dagre 算法）为节点生成合理的视觉坐标；
     - 构造成完整的 `BlueprintGraph` 结构，原子化 `UPDATE presets SET blueprint_graph = ?` 写入 SQLite。

4. **MCP 工具链标准化**：
   - 新增 MCP 工具 `nv_preset_export_code(preset_id) -> String`：以代码格式向 Agent 呈现预设全貌；
   - 新增 MCP 工具 `nv_preset_import_code(preset_id, code_ts) -> Result<(), String>`：接收 Agent 修改后的代码，经由 AST 编译后写回 SQLite，并向前端发射 `blueprint:refreshed` 事件实时更新视图。

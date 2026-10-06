# Night Voyage 不可知化核心重构（M1–M5）验收功能完整文档

> **定位**：不可知化核心重构全部已验收功能的完整使用与开发文档——覆盖机制原理、资产定义方法（定义载体）、编辑器操作、数据契约、验收判据与实机证据。
> **真相源**：[`.trae/specs/agnostic-core-redesign/spec.md`](../.trae/specs/agnostic-core-redesign/spec.md)（设计）· [`AGENTS.md`](../AGENTS.md)（C1–C11 约束）· [`Walkthrough/`](../Walkthrough/)（逐里程碑验收留痕）
> **架构裁定**（2026-09-27）："我们只提供容器与计算器，不要提供具体功能，默认为具体功能不可知化。"
> **验收裁定补充**：① 每个机制给 Mermaid 思维导图与非硬编码判据（改资产→行为变、零代码）；② 覆盖计划全文；③ 每个模式与功能必须说明"如何从蓝图定义"，**定义载体缺失按硬编码论处**。

---

## 目录

1. [架构总览：容器与计算器即边界](#1-架构总览)
2. [M1/M2 · L2 契约解释器与标准库契约子图](#2-m1m2--l2-契约解释器与标准库契约子图)
3. [M2 · buy_item 工具全回路（主证据链）](#3-m2--buy_item-工具全回路)
4. [M3 · L5 编排节点资产化](#4-m3--l5-编排节点资产化)
5. [M4 · L3 动作通道（ActionButton）](#5-m4--l3-动作通道actionbutton)
6. [M5 · L4 产物通道（Schema 产物卡）](#6-m5--l4-产物通道schema-产物卡)
7. [编辑器与定义载体总表](#7-编辑器与定义载体总表)
8. [数据契约速查表（serde 字段名）](#8-数据契约速查表)
9. [创作者实操：从零搭建全链路](#9-创作者实操从零搭建全链路)
10. [MCP 验收工具与实操规范](#10-mcp-验收工具与实操规范)
11. [已知限制](#11-已知限制)
12. [验收证据索引](#12-验收证据索引)

---

## 1. 架构总览

### 1.1 机制分层

```
L1 容器与计算器   DataContainer / Calculator / ConditionGate        （基础层，先行实现）
L2 契约解释器     ToolPlan 编译/校验/执行 + Inspector / Querier      （M1/M2）
L3 动作通道       ActionButton + 命令白名单 + action_bridge 沙箱桥   （M4）
L4 产物通道       Schema card 产物卡（InvokeSchema / 命令结果两来源） （M5）
L5 编排机制       导演-演员 / 剧本流水线 / Nudge 的资产化节点         （M3）
```

四层互不感知（不变量 I3）：层间无业务类型 import，新增功能域零代码改动。

### 1.2 三条不变量

| 编号 | 不变量 | 判据 |
|---|---|---|
| I1 语义上移 | 业务与玩法语义只存在于资产层（蓝图节点 config、UI 布局、Schema、白名单设置）；源码出现业务名词或玩法常量即违规 | 源码 grep 为零；每机制附非硬编码判据 |
| I2 显式失败 | 资产未定义 = 显式报错；零兜底零降级（C2） | 未定义契约/未注册白名单/引用不存在均显式报错 |
| I3 机制正交 | 容器计算器、动作通道、产物通道、编排机制四层互不感知 | 层间无业务类型 import |

### 1.3 定义载体原则（裁定③）

每个模式与功能必须说明"如何从蓝图定义"，**定义载体缺失按硬编码论处**。本重构的全部机制语义载体：

| 机制 | 定义载体 |
|---|---|
| 工具契约与执行链 | 蓝图节点（ToolDefinition / Inspector / Querier / Calculator / ConditionGate / ToolReturn）连线 |
| 编排架构与参数 | 蓝图节点（AgentModeSwitch / DirectorConfig / ActorDefinition / ScriptwriterPipeline / BannedWordsConfig）+ Gate 面板选择 |
| HUD 布局与控件（含 ActionButton） | **UI 设计器**（可视化表单，`preset_ui_layouts` 资产） |
| 结构化输出与产物卡 | **Schema 编辑器**（含 card 配置区，`preset_schemas` 资产） |
| 动作命令白名单 | **设置 → 动作白名单页**（`settings` 表 `action_bridge.command_whitelist`） |

**禁止**绕过编辑器直接改库造资产——验收必须操作真实运行中的系统（C8），资产必须经真实界面编辑逻辑创建。

### 1.4 非硬编码判据方法论

每个机制的验收判据统一为：**修改资产 → 行为即变，零代码改动**。例如改 HUD 控件的 label/command → 界面行为变；改 Schema card 的按钮文案 → 产物卡按钮变；白名单移除命令 → 点击显式报错。

---

## 2. M1/M2 · L2 契约解释器与标准库契约子图

### 2.1 机制

ToolPlan 编译/校验/执行是 Agent 模式的工具回路核心。M1 将"读原语"资产化为两个新链节点，废除内置 `execute_builtin_tool` 与 `None` 兜底臂（显式报错，I2）；M2 以预设 27 的 `buy_item` 修复为主证据打通完整回路。

- **Inspector（容器读原语）**：读取 `DataContainer` 指定片段，结果写入链上下文 `inspect`，ToolReturn 模板以 `{inspect.<字段>}` 引用。
- **Querier（跨域读原语）**：经 action_bridge **白名单代理**调用既有 Tauri 命令（如世界书检索），JSON 结果写入链上下文 `query`。机制不知道目标域——域语义全在节点的 `command` 与 `args_template`（蓝图资产）。

合法链类型：`tool_definition → inspector / querier / calculator / condition_gate → tool_return`。

### 2.2 标准库读类契约子图（check_inventory）

```
ToolDefinition(check_inventory) ──> Inspector(inspect_kind="inventory") ──> ToolReturn(return_template="背包清单…{inspect…}")
```

同构导出：`get_player_stats`（inspect_kind=stats）、`inspect_item`（item + key_expr=args.item_id）、`read_text`（scratchpad + key_expr=args.key）。

### 2.3 如何从蓝图定义

在蓝图编辑器中（预设详情页 →「编辑蓝图」）：

1. 拖入 `ToolDefinition` 节点：填 `tool_name`（如 check_inventory）、`description`、`parameters_schema`（JSON Schema）；
2. 拖入 `Inspector` 节点：`inspect_kind` 选 inventory / stats / item / scratchpad；item 与 scratchpad 需填 `key_expr`（点路径，如 `args.item_id`）；
3. 拖入 `ToolReturn` 节点：`return_template` 用 `{inspect.*}` / `{query.*}` / `{args.*}` / `{stats.*}` 占位；
4. 按链类型连线（ToolDefinition.out → Inspector.in → ToolReturn.in）；
5. 剪断链 = 空链（仅校验注册，不执行）。

### 2.4 非硬编码判据（已实测）

- 改 `return_template` → 回执即变；
- 剪断链 → 空链仅校验；
- 内置删除后，此链是 check_inventory 的唯一实现；
- expression 在常量与表达式间切换 → 同一调用放行/被拦，唯一变量是图配置。

---

## 3. M2 · buy_item 工具全回路

### 3.1 修复后的链（预设 27 主证据）

```
ToolDefinition(buy_item, required: item_id/unit_price)
  ──> ConditionGate(n_gate_gold, expression=total_cost)  ──blocked──> ToolReturn(交易失败回执，数据零篡改)
  │ pass
  ──> Calculator(扣金币, target=stats.gold, op=减, operand_a=total_cost)
  ──> Calculator(add_item, item_def=缺省物，运行期被调用参数覆盖)
  ──> ToolReturn(成功回执)
```

关键修复：删除 4 条串联边（结构非法）；金币门禁与扣减常量 `50` → `total_cost`（`unit_price × count`，spec §2.0 求值器）；check_inventory 链尾接 §2 标准库资产。

### 3.2 求值器（resolve_operand）

数值表达式位（Calculator/ConditionGate/数值参数）支持：`args.<k>`、`stats.<k>`、`total_cost=unit_price×count`、`added_weight`、四则、clamp。
字符串模板位（ToolReturn/args_template）支持 `{表达式}` 占位，上下文栈：`card.<k>`（卡内）→ `inspect`（容器读）→ `query`（跨域读）→ 调用参数 → `stats.<k>`。

### 3.3 非硬编码判据（已实测）

expression 在 `"50"` ↔ `"total_cost"` 间切换 → 同一调用放行/被拦，唯一变量是图配置（零代码）。

---

## 4. M3 · L5 编排节点资产化

### 4.1 五个资产化节点（`models/blueprint.rs`）

| 节点 | 职责 | 关键 config 字段 |
|---|---|---|
| `AgentModeSwitch` | 智能体架构选择（缺省值）+ 子代理工具循环轮次上限 | `default_mode`（single/director_actor/scriptwriter）、`max_tool_rounds`（缺省 5） |
| `DirectorConfig` / `ActorDefinition` | 导演-演员模式的导演参数与角色定义 | 角色设定、台词纸条装配（视界裁剪） |
| `ScriptwriterPipeline` | 剧本流水线阶段数组（drafter→critic→refiner 接力） | `stages[]{stage, workspace_key, prompt, tools[]}`、`anchor_tail_chars`（50）、`blackout_marker`（Layer 1 锚点涂黑） |
| `BannedWordsConfig` | 禁词词库与 Nudge 自纠参数 | `words[]`（过滤全集，代码零内置词库）、`max_nudge_retries`（缺省 2）、`nudge_instruction_template`（含 `{hits}`/`{remaining}` 占位） |

### 4.2 定义载体与校验

- 全部在**蓝图编辑器**节点表单中配置（M3 落地编辑器表单）；
- 子代理/各阶段 `tools` 字段 = 对图中 ToolDefinition `tool_name` 的**引用数组**，**编译期校验存在，缺失硬错**（引用即资产，防悬空）；
- 架构选择走 Gate 面板（按节点 id 查 `preset_gate_selections`），`default_mode` 仅为未选中时的缺省。

### 4.3 非硬编码判据（已实测）

改 tools/persona/anchor/词库 → 行为变；世界书筛选派发按 §2A.5 演示（导演筛选→纸条→演员只见派发内容）。

---

## 5. M4 · L3 动作通道（ActionButton）

### 5.1 机制总览

```
[UI 设计器资产: ActionButton 控件]
   config: { command, args_template, result_schema_id }
        │ 用户点击
        ▼
[前端 actionBridgeInvoke(conversationId, command, args)]        src/lib/backend/actionBridge.ts
        │ Tauri command
        ▼
[action_bridge_invoke] ──> [白名单校验 ensure_allowed]          services/action_bridge.rs
        │ 未注册 → 显式报错（I2，附当前白名单摘要）                    settings 表: action_bridge.command_whitelist
        ▼ 注册
[dispatch 注册表: 命令名 → 既有命令实现]
   ├─ get_character_detail      角色卡读取
   ├─ create_world_book_entry   会话世界书写入
   └─ query_world_book_entries  世界书检索
        │
        ▼ 结果 JSON
[result_schema_id 指向 Schema 资产?] ──是──> 按 Schema.card 渲染产物卡（L4 贯通）
        │ 否
        ▼ JSON 文本回显
```

注册表是**基础设施接线**（把白名单命令名接到既有命令实现）；域语义仍在蓝图/UI 资产的命令名与参数模板里（C11）。

### 5.2 定义载体（三处，全部为真实界面）

> **位置依据**：原始实现文档（[`plans/agent-system-architecture-plan.md`](../plans/agent-system-architecture-plan.md)）为**预设中心**架构——创作者的全部资产管理（结构化 Schema 管理、UI 设计器、蓝图编辑器）均挂在预设详情页（计划 §9.1/§9.2），应用级设置页仅承担终端用户配置。动作白名单治理的是本预设 ActionButton / 产物卡按钮 / Querier 引用的命令，管理面板据此挂在**预设详情页工具栏「动作白名单」**（2026-10-04 依用户裁定从应用设置页迁入；spec.md:290"设置页一处管理"条款由用户裁定按计划文档覆盖）。白名单数据本体仍存 `settings` 表 `action_bridge.command_whitelist`（全局注册表，默认空 = 动作件/Querier 调用前显式报错，I2）。

1. **UI 设计器**（预设详情页 →「UI 设计器」）：
   - 控件调色板 →「+ 动作按钮 ActionButton」；
   - 配置表单：`命令（command）`（文本输入，提示须在白名单注册）、`结果卡 SCHEMA（result_schema_id）`（**下拉，数据源 = 该预设 `preset_schemas` 真实资产**，C11）、`参数模板（args_template）`（键值对增删，值支持 `{stats.x}` / `{schema.x}` / `{flags.x}` / 裸名占位）；
   - 保存 →「绑定到当前会话」（写入 `session_ui_layouts`）。
2. **设置 → 动作白名单页**：逐条登记/移除命令名。空白名单 = 默认安全态（所有动作件点击显式报错）。
3. 占位符上下文：HUD 快照（stats/schema 投影/flags）。

### 5.3 运行时行为

- 控件渲染：`LayoutTreeNode`（PC Shadow DOM HUD）与 `MobileLayoutTree`（移动端，C5 独立实现）各有 `actionButton` 分支，纯渲染（C1）；
- 点击 → `action_bridge_invoke` → 白名单校验 → dispatch → 结果 JSON；
- `result_schema_id` 非空时：`presetSchemaGet(schemaId)` → 有 `card` 则按字段物理顺序渲染产物卡（两态徽标直接为"已确认"）。

### 5.4 验收判据与实测（全部 PASS）

| 判据 | 实测 |
|---|---|
| 改 label / command / args_template → 行为变，零代码 | label 改「查看 NPC 档案」即变；args character_id 5→999 点击显式报错（no rows） |
| 白名单移除 → 点击显式报错 | 红色报错「命令 get_character_detail 未在动作白名单注册（当前白名单: [...]）」 |
| 点击全链 | 查看角色 → 白名单 → 命令 → 结果按 `result_schema_id` 渲染产物卡 |
| 白名单设置页 | 空名单默认安全态；UI 逐条登记即时生效（写 settings 表） |
| 占位符注入 | `{name}`/`{cardType}` 注入 create_world_book_entry，真实落库 |

---

## 6. M5 · L4 产物通道（Schema 产物卡）

### 6.1 机制总览

产物卡 = Schema 资产的 `card` 扩展。两个来源、三处渲染：

```
来源 A: 蓝图 InvokeSchema(schema_id) 的 LLM 结构化输出 ──> 消息流卡片
         （字段名集合与某 card Schema 精确匹配时命中）
来源 B: L3 命令结果（result_schema_id 指向）          ──> HUD 结果卡 / 移动端卡

渲染规则（C1 纯渲染）:
  · 字段物理排序（Schema.fields 顺序）即卡片展示顺序
  · 标题 = values[card.titleField]
  · 待确认（pending）→ 任一动作执行成功 → 已确认（confirmed）
  · 卡片按钮: label + command（白名单校验）+ argsTemplate（{字段名} 占位取自卡片字段值）
```

### 6.2 数据契约（`models/schema.rs`，serde camelCase）

```rust
pub struct SchemaDefinition {
    // …原有字段…
    #[serde(default)]
    pub card: Option<SchemaCardConfig>,   // 迁移 0049: preset_schemas.card_json TEXT
}
pub struct SchemaCardConfig {
    pub title_field: String,              // 卡片标题取哪个字段的值
    #[serde(default)]
    pub actions: Vec<SchemaCardAction>,
}
pub struct SchemaCardAction {
    pub label: String,                    // 按钮文案
    pub command: String,                  // 须在动作白名单注册
    pub args_template: Vec<(String, String)>,  // (参数名, 模板)；模板支持 {字段名}
}
```

### 6.3 定义载体：Schema 编辑器「产物卡配置」区

预设详情页 →「Schema 管理」编辑器：

1. 填 Schema 名称与字段列表（物理排序 = 卡片字段顺序）；
2. 开启**产物卡配置（SCHEMA CARD 扩展）**开关；
3. 选 `卡片标题字段（title_field）`（下拉 = 本 Schema 字段列表）；
4. 「+ 添加卡片按钮」：填按钮文案、命令（须在白名单注册）、参数模板（键值对，值支持 `{字段名}` 占位）；
5. 保存 → `card_json` 落库（迁移 0049 列）；`preset_schema_get` 完整读回。

### 6.4 三处渲染实现

| 场景 | 组件 | 命中条件 |
|---|---|---|
| PC 消息流 | `MessageItem.schemaCard` → `SchemaCardView` | 结构化输出字段名集合与某 card Schema 字段集合**完全一致**（排序后逐一相等） |
| PC HUD 结果卡 | `LayoutTreeNode.ActionButtonView` → `SchemaCardView` | 动作件 config.result_schema_id 指向的 Schema 有 card |
| 移动端 | `MobileChatView` → `MobileSchemaCard`（C5 独立实现，同一 action_bridge 链路） | 同消息流命中条件 |

### 6.5 验收判据与实测（全部 PASS）

| 判据 | 实测 |
|---|---|
| card 持久化 | 编辑器保存的 card_json 完整落库并读回（schema_1a1059a81ca_1） |
| 全链持久化 | 产物卡点击「加入到世界书」→ 白名单 → create_world_book_entry（args 由 {name}/{cardType} 注入）→ world_book_entries 真实落库（id=562），UI 回显 `{"entryId":562,…}` |
| 显式失败 | 后端 INSERT 参数错误被 trigger_mode CHECK 约束显式拦截（I2 实证，已修复） |
| 字段物理排序 | 卡片按 Schema.fields 顺序渲染 |

---

## 7. 编辑器与定义载体总表

| 资产 | 编辑器入口 | 存储位置 | 生成 ID 格式 |
|---|---|---|---|
| HUD 布局（含 ActionButton 控件） | 预设详情 →「UI 设计器」 | `preset_ui_layouts.layout_json` | `uil_<hex>_<n>` |
| 结构化 Schema（含产物卡 card） | 预设详情 →「Schema 管理」 | `preset_schemas.fields_json` + `card_json`（迁移 0049） | `schema_<hex>_<n>` |
| 动作命令白名单 | 预设详情 →「动作白名单」 | `settings['action_bridge.command_whitelist']` | —（JSON 数组） |
| 工具契约与执行链 | 蓝图编辑器（节点连线） | `presets.blueprint_graph` | 节点 id |
| 会话布局绑定 | 设计器「绑定到当前会话」 | `session_ui_layouts`（迁移 0048） | — |

> 2026-10-04 修复：UI 设计器打开弹窗时现自动加载布局列表（此前需手动点「刷新列表」，易误判为无定义）。

---

## 8. 数据契约速查表

前端（TS，camelCase）与后端（Rust，serde rename_all=camelCase）字段名一致：

```ts
// HUD 布局（types.ts）
type WidgetType = 'statBar' | 'inventorySlotGrid' | 'dataLabel' | 'badge' | 'avatarFrame' | 'actionButton';
interface WidgetDefinition {
  id: string; widgetType: WidgetType; label: string; dataBinding: string;
  config?: Record<string, any>;   // actionButton: { command, args_template: Record<string,string>, result_schema_id }
  style?: Record<string, string>;
}

// Schema 产物卡（types.ts）
interface SchemaDefinition { /* … */ card?: SchemaCardConfig | null; }
interface SchemaCardConfig { titleField: string; actions: SchemaCardAction[]; }
interface SchemaCardAction { label: string; command: string; argsTemplate: Array<[string, string]>; }

// 蓝图 M3 节点 config（blueprint.rs，serde camelCase）
InspectorConfig   { inspectKind: 'inventory'|'stats'|'item'|'scratchpad'; keyExpr?: string }
QuerierConfig     { command: string; argsTemplate: Map<string,Value> }
BannedWordsConfig { words: string[]; maxNudgeRetries: number; nudgeInstructionTemplate: string }
ScriptwriterStage { stage: 'drafter'|'critic'|'refiner'; workspaceKey: string; prompt: string; tools: string[] }
AgentModeSwitchConfig { defaultMode: 'single'|'director_actor'|'scriptwriter'; maxToolRounds: number }
```

后端新增 Tauri 命令：

```
action_bridge_invoke(conversationId, command, args) -> Value   // 白名单校验 + 分发
action_bridge_whitelist_get() -> { commands: string[] }
action_bridge_whitelist_set(commands: string[]) -> void
```

dispatch 注册表当前登记：`query_world_book_entries` / `get_character_detail` / `create_world_book_entry`（新增可代理命令在 `services/action_bridge.rs::dispatch` 登记一行）。

---

## 9. 创作者实操：从零搭建全链路

以「查看角色 → 产物卡 → 加入世界书」为例（已实机验收的完整路径）：

1. **建 Schema**（预设 #26 详情 → Schema 管理）：
   - 名称 `character_detail`，字段 `name` / `cardType` / `description`（string，内联气泡）；
   - 开启「产物卡配置」→ title_field=name → 添加卡片按钮：文案「加入到世界书」、命令 `create_world_book_entry`、参数 `title={name}`、`content={cardType}:{description}` → 保存。
2. **建布局**（→ UI 设计器）：
   - 新建布局 → 「+ 数据标签 DataLabel」（label=金币，绑定 stats.gold）→ 「+ 动作按钮 ActionButton」（label=查看角色，command=get_character_detail，结果卡下拉选 character_detail，参数 character_id=5）→ 保存 → 绑定到当前会话。
3. **登记白名单**（设置 → 动作白名单）：`get_character_detail`、`create_world_book_entry`、`query_world_book_entries`。
4. **验证**：进入会话 → HUD 出现金币与「查看角色」→ 点击 → 产物卡（标题=name 值，字段按 Schema 顺序）→ 点击「加入到世界书」→ 世界书新增条目，卡片转「已确认」。

---

## 10. MCP 验收工具与实操规范

- **C8 硬性要求**：验收只用 MCP 操作真实运行中的系统；演示形式限 **① 模拟鼠标点击真实界面按钮** 或 **② MCP 控制前端按钮**（同款处理路径且界面可见）；**不接受脚本文件执行结果**、不接受纯后端操作内部数据、不接受"测试全通过"结论。
- 工具清单（`night-voyage-dev-mcp`，stdio 代理 `scripts/nv_mcp_stdio_proxy.mjs`，端点 127.0.0.1:55287）：
  - 生命周期：`nv_app_start` / `nv_app_stop` / `nv_app_restart`（instance a/b，exe 同目录定位真实库）
  - 数据：`nv_db_info` / `nv_conversations_list` / `nv_messages_list` / `nv_session_state_raw` / `nv_session_state_get` / `nv_session_state_reset` / `nv_tool_call_execute`
  - 蓝图：`nv_blueprint_get` / `nv_blueprint_save` / `nv_preset_gate_select`
  - 界面：`nv_screenshot`（窗口实抓 PNG）
- 环境要点：连接器注册于宿主用户级 MCP 配置；令牌 `D:\software_cache\night-voyage-mcp.token`；客户端未运行时业务工具返回「程序未启动」（不静默降级）。
- 本轮整改红线：**验收资产必须经真实界面编辑逻辑创建**（定义载体缺失按硬编码论处）；禁用脚本直写运行库造资产。

---

## 11. 已知限制

1. **消息流产物卡截图留痕受限**：`MessageItem.schemaCard` 匹配代码已落地；实机留痕受存量「会话 pane 生命周期」缺陷阻塞（会话切换后消息列表冻结/串台、偶发 "No messages yet"，已用无种子数据对照验证与本轮改动无关），建议立项修复后补截图。
2. **待确认两态为前端会话内状态**：HUD 结果卡路径默认 confirmed；跨重启审计需引入 card 实例表（spec 未强制，未做）。
3. **UI 设计器布局树**：根画布一层平铺为当前表单形态；容器嵌套编辑已有但未展开子节点表单。
4. **沙箱桥 C4**：动作经 action_bridge 白名单信封；postMessage 宿主桥后续按需补。
5. **dispatch 注册表**：新命令需在 `services/action_bridge.rs::dispatch` 登记一行（基础设施接线，域语义仍在资产）。

---

## 12. 验收证据索引

| 里程碑 | Walkthrough 留痕 |
|---|---|
| M1 契约去硬化 | `20260928-1352-不可知化M1契约去硬化-新功能增加.md` |
| M2 预设27蓝图修复 | `20260928-1345-不可知化M2预设27蓝图修复-修改.md` |
| M3 编排节点资产化 | `20260929-2340-不可知化M3编排节点资产化-新功能增加.md` |
| M4/M5 后端模型 | `20260929-2355-不可知化M4M5动作与产物通道后端-新功能增加.md` |
| **M4/M5 前端落地与实机验收（含整改）** | **`20261004-不可知化M4M5动作与产物通道前端落地与实机验收-新功能增加-含整改.md`**（含违规整改记录、全库审计附录、编辑器实况截图索引） |

整改备忘（详见 20261004 篇"违规与整改"）：早期验收曾以脚本直写运行库造资产（定义载体缺失 + C8 违规），已删除全部脚本资产与工具脚本，全部资产经编辑器重建并重新验收 PASS。

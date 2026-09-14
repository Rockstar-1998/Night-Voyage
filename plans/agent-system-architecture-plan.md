# Night Voyage 跑团 Agent 与游戏机制系统架构与实施规范

> **定位**: Night Voyage Agent 体系与 RPG 规则/数值/背包机制及常驻 UI 引擎核心技术规范与实施指南  
> **技术基准**: Tauri 2.0 + Rust 后端核心 + SolidJS 双端宿主（PC `src/` / 移动端 `src-mobile/`）  
> **核心规范**: [`AGENTS.md`](file:///d:/data/Night%20Voyage/AGENTS.md)（C1 前端纯渲染、C2 零静默回退、C3 响应性保护、C4 AI UI 隔离、C5 双端独立、C7 双端覆盖）

---

## 1. 架构总览：三态记忆基石与 Agent 游戏引擎执行分流

Night Voyage 运行在双层状态架构之上：底层是已有的**三态会话记忆基础设施**，上层是可自由插拔的**会话推进执行管线**与**常驻响应式 UI 表现层**。

```
                    ┌───────────────────────── 玩家输入 ─────────────────────────┐
                    │                                                             │
                    ▼                                                             ▼
       [0. 底层三态记忆基石 (Session Memory Modes)]              [1. 上层执行管线 (Execution Pipelines)]
                    │                                                             │
    ┌───────────────┼───────────────┐                             ┌───────────────┴───────────────┐
    ▼               ▼               ▼                             ▼                               ▼
 STATELESS        LEGACY          MEM0                     Standard 标准推进             Agent 跑团游戏机制引擎
(无状态感知)    (经典滑动窗口)  (向量与实体检索)           (现存 stream_processor)        (自主推演/ToolCall/背包/运算器)
    │               │               │                             │                               │
    └───────────────┼───────────────┘                             │       ┌───────────────────────┼───────────────────────┐
                    ▼                                             │       ▼                       ▼                       ▼
           [蓝图 ModeSwitch 节点]                                 │  [自定义 ToolCall]      [背包与数值状态机]      [多角色/剧本流水线]
     (out_stateless / out_legacy / out_mem0)                      │  (蓝图可视化声明)       (运算器/超重/金币拦截)  (导演-演员/审阅润色)
                    │                                             │       │                       │                       │
                    └─────────────────────────────────────────────┴───────┴───────────────────────┴───────────────────────┘
                                                                                                  │
                                                                                                  ▼
                                                                             [2. 常驻响应式 HUD 表现层 (Persistent UI)]
                                                                               (脱离单条消息气泡 / 原地毫秒级响应更新)
```

### 1.1 三态会话记忆基石（Session Memory Baseline）
系统原生的记忆层由三套独立演化的机制构成，受蓝图 `ModeSwitch` 节点（或 `Constant(source="memory_mode")`）调度：
1. **`STATELESS`（无状态感知模式）**：单回合纯净上下文，不读取也不累加任何长程历史消息，适用于独立跑团模组、轻量 NPC 对话或完全依靠即时状态机驱动的场景；
2. **`LEGACY`（经典滑动窗口记忆模式）**：基于 Token 预算的滑动截断，保留最近 $N$ 轮历史对话作为短期记忆；
3. **`MEM0`（向量与实体图谱记忆模式）**：外挂本地向量数据库与实体抽取服务，跨会话、跨轮次进行语义相关性检索注入。

### 1.2 会话推进层：Standard 标准单次生成 vs. Agent 跑团游戏机制引擎
* **Standard 标准单次推进**：直通现存 `stream_processor`，走由 `ModeSwitch` 决定的三态记忆流，0 额外状态机开销，原有管线 100% 保持不变；
* **Agent 跑团游戏机制引擎**：在底层三态记忆的上下文之上，激活 Rust 内存调度器，承载**自定义 ToolCall 蓝图定义、背包与数值状态机、确定性运算器与规则门禁、常驻响应式 UI 数据驱动，以及多角色视界隔离调度**。

---

## 2. 状态容器与纯内存变量工作区（State Container & In-Memory Workspace）

为了支持背包系统、金币消费、负重结算等确定性 RPG 逻辑，系统在运行时维护结构化的游戏状态容器，与文本流转工作区正交解耦。

### 2.1 结构化游戏状态机（Structured Game State Container）
每个会话在 SQLite 与 Rust 内存中维护一份 `GameState` 实例，提供纳秒级快速计算：
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GameState {
    /// 基础数值属性（如 hp, max_hp, mp, gold, weight, max_weight）
    pub stats: HashMap<String, f64>,
    /// 背包物品列表
    pub inventory: Vec<InventoryItem>,
    /// 临时状态标志位 / 剧情进度变量 / 任务状态
    pub flags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub count: i64,
    pub unit_weight: f64,
    pub unit_price: f64,
    pub icon: Option<String>,
    pub properties: HashMap<String, String>,
}
```
* **单次结算持久化**：回合内由于 ToolCall 引发的多次数值增减与道具拾取，全部在内存 `GameState` 中瞬时完成；仅当本回合最终消息 `commit` 时，最新的 `GameState` 快照以 JSON 写入 SQLite `session_states` 表；
* **双向对齐**：当前状态自动格式化为系统提示块（如 `【玩家状态】金币: 150 | 负重: 18.5/30.0kg | 背包: 铁剑*1, 治疗药水*2`），注入到大模型输入上下文中。

### 2.2 纯内存文本工作区（In-Memory Text Workspace）
针对多智能体协同（导演委派、审阅润色），系统维护独立的 `HashMap<String, String>`：
* 将虚拟文本变量（`draft`、`critique`、`final`）映射在内存堆中；
* 暴露 `read_text`、`write_text` 工具供 LLM 自主修改；
* 零磁盘 I/O，回合结束随生命周期自动 Drop。

---

## 3. 蓝图高级跑团功能体系：ToolCall 定义、运算器与背包规则门禁

蓝图不仅是 Prompt 汇编器，更是**跑团规则图与游戏逻辑引擎**。创作者可在蓝图中可视化定义 Agent 可调用的工具、运算器与判定门禁。

```
大模型发起 ToolCall: buy_item { item_id: "iron_sword", count: 1, unit_price: 50, unit_weight: 10 }
                     │
                     ▼
       ┌─────────────────────────────┐
       │ ToolDefinition: buy_item    │ ──> 解析参数: item_id="iron_sword", count=1, price=50, weight=10
       └──────────────┬──────────────┘
                      ▼
       ┌─────────────────────────────┐
       │ Calculator: 预结算运算器    │ ──> 计算: total_cost = 1*50 = 50, added_weight = 1*10 = 10
       └──────────────┬──────────────┘
                      ▼
       ┌─────────────────────────────┐
       │ ConditionGate: 金币充足门禁 │ ──[False: 拦截]──> [ToolReturn 阻断回执: "金币不足! 差额 20 金币"]
       │ (gold >= total_cost)        │
       └──────────────┬──────────────┘
                      ▼ [True: 放行]
       ┌─────────────────────────────┐
       │ ConditionGate: 超重判定门禁 │ ──[False: 拦截]──> [ToolReturn 阻断回执: "背包超重! 无法携带"]
       │ (weight + added <= max_w)   │
       └──────────────┬──────────────┘
                      ▼ [True: 放行]
       ┌─────────────────────────────┐
       │ Calculator: 执行状态变更    │ ──> 真实扣除: gold -= 50; 增加道具: inventory.add("iron_sword", 1)
       └──────────────┬──────────────┘     自动重算: weight += 10
                      ▼
       ┌─────────────────────────────┐
       │ ToolReturn: 成功回执返回    │ ──> 吐出: "购买成功: 已获得铁剑*1, 剩余金币 100, 负重 28/30kg"
       └──────────────┬──────────────┘
                      ├──────────────────────────┐
                      ▼                          ▼
             回传大模型继续剧情叙事         实时驱动常驻 HUD 原地刷新 (第 4 节)
```

### 3.1 `ToolDefinition` 节点（自定义 ToolCall 契约定义）
创作者在蓝图中直接声明暴露给 LLM 的函数调用规范：
* **节点配置参数**：
  * `tool_name`：唯一标识符（如 `buy_item`、`use_item`、`craft_equipment`、`cast_spell`）；
  * `description`：工具功能描述，供大模型决策是否调用；
  * `parameters_schema`：JSON Schema 对象，定义参数字段类型、默认值与说明（如 `item_id: string`, `count: integer`, `unit_price: number`, `unit_weight: number`）；
* **引脚**：
  * 输入引脚：接收触发流；
  * `on_called`：当大模型输出该工具调用时激活下游分支；
  * `params_out`：导出参数数据包供下游运算器读取。

### 3.2 `Calculator` 节点（确定性数值与背包运算器）
拒绝让大模型自由算数（防止算错金币或随意凭空造物），所有数值变更均由 Rust 确定性执行：
1. **数值算术模式（Math Operation）**：
   * 支持表达式配置：`target_var = expr`；
   * 支持运算符：`+`、`-`、`*`、`/`、`%`、`min`、`max`、`clamp`；
   * 示例：`gold = gold - total_cost`，`hp = clamp(hp + 50, 0, max_hp)`；
2. **背包管理模式（Inventory Operation）**：
   * `add_item(id, name, count, unit_weight, unit_price)`：
     * 若背包中已有相同 `id`，则累加 `count`；
     * 若无相同 `id`，插入新物品条目；
   * `remove_item(id, count)`：
     * 扣除指定数量；若数量归零则彻底从列表中清除；
   * `recompute_weight()`：
     * 自动遍历背包所有条目计算 $\sum (count \times unit\_weight)$，原子更新全局 `weight` 变量。

### 3.3 `ConditionGate` 节点（确定性规则判定与动作拦截门禁）
作为游戏规则的绝对防线，对状态进行布尔断言：
* **判定表达式**：
  * 金币校验：`gold >= total_cost`；
  * 负重超标校验：`weight + added_weight <= max_weight`；
  * 背包格子槽位校验：`inventory.len() < max_slots`；
  * 道具数量校验：`inventory.find(item_id).count >= required_count`；
* **双出口分支**：
  * `pass`（放行）：条件成立时走此分支，流向实际变更运算器；
  * `blocked`（拦截）：条件不满足时**阻断一切状态修改**，流向错误回执生成。

### 3.4 `ToolReturn` 节点（结果装配与大模型恢复）
将运算器成功结果或门禁拦截信息封装为标准 `ToolResult`：
* **模板化文本**：
  * 拦截失败模板：`"【系统规则提示】操作失败：金币不足！当前持有金币 {{gold}}，购买所需 {{total_cost}}，交易取消。"`；
  * 拦截超重模板：`"【系统规则提示】操作失败：超重！当前负重 {{weight}}kg，放入该物品后将达 {{new_weight}}kg（上限 {{max_weight}}kg）。你拿不动更多东西了。"`；
  * 成功模板：`"【系统执行成功】已使用治疗药水*1，生命值恢复 50 点，当前生命值: {{hp}}/{{max_hp}}，背包剩余药水: {{remain_count}}。"`；
* **执行器动作**：将格式化文本回传给大模型，驱动 Agent 在下一轮生成中必须基于客观的“成功”或“被系统拒绝”继续推进对话。

---

## 4. 常驻响应式 UI 引擎与可视化 UI 模板编辑器 (Persistent Reactive HUD & UI Designer)

传统方案将结构化数据卡片随最新消息追加在对话流末尾，导致三大顽疾：
1. **视线滚动脱靶**：长对话向上滚动后，玩家无法即时查阅当前生命值与装备；
2. **状态冗余与过期误导**：历史消息下方残留着数十张过期的卡片，无法确定哪一张代表当前真实状态；
3. **DOM 膨胀与重绘瓶颈**：每轮复制冗余卡片导致长会话滑动卡顿。

Night Voyage 确立 **“常驻响应式 HUD（Persistent Reactive HUD）”** 架构，UI 永久停靠在会话特定锚点，由 `GameState` 驱动原地增量刷新。

```
                               ┌─── PC: 右侧固定仪表盘 (RightDock)
                               ├─── PC: 顶部吸顶折叠栏 (TopSticky)
  [会话视口常驻挂载锚点] ───────┼─── PC: 画中画悬浮窗 (FloatingHUD)
                               ├─── Mobile: 顶部吸顶栏 + 下拉抽屉 (TopHUD)
                               └─── Mobile: 输入框上方微型条 (BottomSticky)
                                         ▲
                                         │ 监听轻量补丁事件 (session:hud_state_patch)
                                         │ 纳秒级原地响应式局部刷新
┌────────────────────────────────────────┴────────────────────────────────────────┐
│ Rust 后端数据源 (Single Source of Truth: GameState)                             │
│ ├─ stats: { hp: 85/100, mp: 40/50, gold: 240, weight: 19.5/30 }                │
│ ├─ inventory: [ { id: "sword", count: 1 }, { id: "potion", count: 3 } ]        │
│ └─ flags: { location: "风盔城酒馆", weather: "暴风雪", quest: "寻找失踪的信使" }  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▲
                                         │ ToolCall / Calculator 确定性更新
                               [Agent 蓝图执行管线]
```

### 4.1 可视化 UI 模板编辑器（UI Template Designer）
创作者在预设管理或蓝图编辑器中打开 UI 设计器，对当前预设的常驻界面进行可视化装配：
1. **预置低代码组件库（Built-in Block Library）**：
   * **`StatBar`（动态数值条）**：支持血条（红）、蓝条（蓝）、体力条（绿）、负重条（黄/红超重渐变），自动根据 `val / max` 计算百分比并带流光平滑动画；
   * **`InventoryGrid`（背包网格组件）**：可配置格子数（如 $4 \times 5$）、道具图标、数量角标、品质框颜色，鼠标悬停/点击弹出属性气泡；
   * **`AttributeList`（属性名值对）**：整齐排列四维属性（力量/敏捷/体质/智力）、金币、声望值；
   * **`QuestTracker`（任务目标看板）**：展示当前主线/支线任务与阶段勾选框；
   * **`SceneBanner`（场景横幅）**：展示当前地点名称、天气图标、时间与危险度评级。
2. **沙箱隔离自由代码模式（Custom HTML + Tailwind Template，严格 C4 约束）**：
   * 针对极客创作者，支持编写自定义 HTML + Tailwind 布局模板；
   * **运行隔离**：自定义模板强制在 `iframe`（或 `Shadow DOM`）沙箱内运行，样式与脚本物理级隔离，杜绝污染 SolidJS 宿主；
   * **通信桥**：沙箱仅通过 `window.postMessage` 接收后端派发的只读 `GameState` 快照，零直接 DOM/宿主 API 访问权。

### 4.2 ToolCall 与状态变更的原地响应式数据绑定（Reactive In-Place Binding）
UI 模板通过表达式直接绑定到 `GameState` 的特定字段：
* 绑定语法：
  * 插值文本：`{{stats.gold}} G`、`{{flags.location}}`；
  * 进度条比例：`percent = (stats.hp / stats.max_hp) * 100`；
  * 列表循环：`#each inventory as item -> <ItemSlot item={item} />`。
* **增量更新链路**：
  1. 大模型输出 `ToolCall: buy_item`；
  2. 蓝图 `Calculator` 节点修改内存 `GameState`；
  3. 后端生成轻量 JSON Patch，通过 Tauri Event 发射 `session:hud_state_patch`；
  4. 前端常驻 HUD 组件订阅该事件，基于 SolidJS 细粒度 Signal **原地定向触发受影响 DOM 节点的最小更新**；
  5. 聊天消息列表正常流式追加文本，常驻 HUD 在侧边/顶部平滑变动数值，实现零干扰、零卡死。

### 4.3 双端常驻挂载锚点与交互规范（Docking & Layout Positioning）
* **PC 端（`src/`）支持三类停靠模式**：
  * **`RightDock`（右侧常驻仪表盘，默认推荐）**：占据聊天区右侧独立侧栏（宽 280~320px），支持完整展示属性看板与大容量背包网格，与中间消息流互不挤压；
  * **`TopSticky`（顶部吸顶折叠栏）**：横跨聊天窗口顶部，高度 48px，精简展示血条、金币与地点，点击右侧小箭头可下拉展开大面板；
  * **`FloatingHUD`（画中画悬浮窗）**：半透明毛玻璃浮层，创作者或玩家可自由拖拽位置、最小化为悬浮球。
* **移动端（`src-mobile/`，C5 独立设计，严禁复用 PC 组件）**：
  * **`TopHUD`（吸顶精简条）**：固定在移动端标题栏下方，高 36px，仅显示核心 HP/金币；
  * **`BottomSticky`（输入框上附着条）**：紧贴在手机输入框上方，显示即时状态；
  * **全屏抽屉联动**：点击移动端常驻条上的 `[背包]` 或 `[属性]` 图标，从底部滑出独立的全屏 Bottom Sheet 供触控查阅。

---

## 5. 核心 Agent 模式执行时序与多智能体编排

### 5.1 模式 A：导演-演员模式（Director-Actor / Return-mode Subagent）
* **核心职责**：消除 NPC “全知视角”，确保演员仅拥有局部记忆与角色设定；
* **执行时序**：
  1. 导演 Agent 获取世界观与玩家输入，判定需要 NPC（如酒馆老板）出场；
  2. 调度器进行**视界裁剪（Context Pruning）**，剥离全局信息，仅将老板人设与当前场景输入生成极窄提示词；
  3. 演员 Subagent 执行并提交台词与动作（`task_return`）；
  4. 导演端停用涂黑算法，按**结构化槽位（Slot Assembly）**（开场环境 + 演员台词 + 推进描写）拼装定稿并 `commit`。

### 5.2 模式 B：剧本流水线模式（Scriptwriter / Handoff 接力模式）
* **核心职责**：长篇小说文学精修，消除单次生成的人设漂移与机械文风；
* **执行时序**：
  1. 初稿写手（Drafter）生成情节草稿并存入内存变量 `draft`；
  2. Handoff 移交审阅者（Critic），对比世界观输出批注 `critique`；
  3. Handoff 移交终稿润色者（Refiner），激活 **Layer 1 锚点涂黑机制**（前文稳定段落替换为 `[前文背景已锁定]`，保留末尾 50 字尾锚防复读旧文），完成终稿输出。

### 5.3 跑团确定性门禁引擎
1. **确定性 D20 骰点检定**：
   * Agent 发起 `dice_roll { kind: "d20", dc: 15, modifier: 3 }`；
   * Rust CSPRNG 随机生成 $1 \sim 20$ 整数，判定 `roll + modifier >= dc`；
   * 结果回传大模型，同时向前端广播不可篡改的检定卡片。
2. **毫秒级 Aho-Corasick 禁词拦截与 Nudge 自纠**：
   * 在 Agent `commit` 时，Rust 毫秒级扫描禁用词库；
   * 命中则阻断提交（最多重试 2 次），注入高优先级合成 Critic Nudge：`"【门禁退回】检测到禁用词汇 [...]，请重构句式重新提交"`。

---

## 6. 蓝图节点规格与连线实战拓扑

### 6.1 节点扩展清单（`src-tauri/src/models/blueprint.rs`）
```rust
pub enum NodeType {
    // 现有基础节点
    Start, End, Prompt, SchemaField, MutexGate, GroupGate, ModeSwitch, RoleSwitch,
    Constant, Branch, SamplingParamsOpenAi, SamplingParamsAnthropic,
    // 新增高级 Agent 与游戏机制节点
    ToolDefinition,
    Calculator,
    ConditionGate,
    ToolReturn,
    AgentModeSwitch,
    DirectorConfig,
    ActorDefinition,
    ScriptwriterPipeline,
    BannedWordsConfig,
    // 新增常驻 UI 配置节点
    UILayoutConfig,
}
```

### 6.2 背包系统与常驻 UI 实战连线拓扑（商店购买、门禁校验与 HUD 刷新）

```
[Start] ──> [Prompt: 基础世界规则] ──> [UILayoutConfig: 挂载 RightDock 背包/血条] ──> [Agent 推理]
                                                                                            │
                                                                                            ▼ 当 Agent 输出 buy_item ToolCall
┌───────────────────────────────────────────────────────────────────────────────────────────┴────────────────────────────────┐
│ 蓝图 ToolCall 处理拓扑                                                                                                     │
│                                                                                                                            │
│  [ToolDefinition: buy_item]                                                                                                │
│       │ (params: item_id, count, unit_price, unit_weight)                                                                  │
│       ▼                                                                                                                    │
│  [Calculator: 预计算总价与总重]                                                                                            │
│       │ (vars: cost = count * unit_price, add_w = count * unit_weight)                                                      │
│       ▼                                                                                                                    │
│  [ConditionGate: 检查金币 (gold >= cost)]                                                                                  │
│       ├─ [blocked 拦截] ──> [ToolReturn: "金币不足，差额: {{cost - gold}}"] ────────┐                                      │
│       └─ [pass 放行]                                                                │                                      │
│            ▼                                                                        │                                      │
│       [ConditionGate: 检查超重 (weight + add_w <= max_weight)]                      │                                      │
│            ├─ [blocked 拦截] ──> [ToolReturn: "背包超重! 无法负重更多道具"] ────────┼──> [回传 Agent]                       │
│            └─ [pass 放行]                                                           │                                      │
│                 ▼                                                                   │                                      │
│            [Calculator: 实际扣除与物品入包]                                         │                                      │
│                 ├─ gold = gold - cost                                               │                                      │
│                 ├─ inventory.add(item_id, count)                                    │                                      │
│                 └─ weight = weight + add_w                                          │                                      │
│                 ├───────────────────────────────────────────────────────────────────┼──> [驱动常驻 HUD 原地刷新道具与金币]  │
│                 ▼                                                                   │                                      │
│            [ToolReturn: "购买成功! 已获得道具，剩余金币: {{gold}}，负重: {{weight}}"]─┘                                      │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. 现有系统配合与代码改动点清单

### 7.1 零破坏配合机理
1. **三态记忆基石无缝兼容**：
   * 现有 `ModeSwitch` 节点输出端口（`out_stateless` / `out_legacy` / `out_mem0`）原样保留，作为上下文装配层的前置通道；
   * Agent 推进模式无论在单轮、滑动窗口还是向量记忆下，均能无缝挂载。
2. **Prompt 编译器（`prompt_compiler.rs`）**：
   * 基础 System Prompt 与角色档案依然调用 `compile_prompt`，保持宏替换与世界书触发机制 100% 稳定。
3. **原有单条消息 SchemaField 保持向下兼容**：
   * 对于旧预设中用于消息底部的临时批注，保留现有 `MessageFormatRenderer`；
   * 新增的常驻 UI 依托独立的全局 `session_states` 事件驱动，二者各司其职、互不干扰。

### 7.2 极简代码改动插槽
1. **`models/blueprint.rs` & `blueprint_executor.rs`**：
   * 增加 `ToolDefinition`、`Calculator`、`ConditionGate`、`ToolReturn`、`UILayoutConfig` 节点定义；
2. **`stream_processor.rs` / `agent_runtime.rs`**：
   * 检测到模型返回 `tool_calls` 时，挂起当前流，在蓝图执行器中匹配对应分支，由 Rust 执行运算器与门禁判定，组装 `ToolResult` 恢复流；
3. **SQLite `session_states` 表**：
   * 增加存储 `game_state`（JSON 字符串）的列，与现有会话表绑定；
4. **前端宿主容器插槽（PC `src/components/` / 移动端 `src-mobile/components/`）**：
   * PC：在 `ChatArea.tsx` 右侧新增 `PersistentHudDrawer.tsx`；
   * Mobile：在 `MobileChatView.tsx` 顶部/底部新增 `MobilePersistentHud.tsx`。

---

## 8. 用户侧体验、蓝图操作与调试全流程实操指南

### 8.1 终端用户操作与界面感知流 (User Experience & Interaction)
1. **会话创建与模式选择（PC/Mobile `NewChatModal.tsx`）**：
   * 用户可自由选择记忆模式（`Stateless` / `Legacy` / `Mem0`）与推进模式（`Standard` / `Agent 跑团引擎`）；
   * 开启 Agent 跑团引擎且挂载 Mem0 时，弹出 Token 消耗红字安全提示。
2. **常驻 HUD 交互体验**：
   * 进入聊天后，界面右侧或顶部常驻显示当前角色的血条、金币、负重与背包；
   * 当大模型发起购买或使用道具时，常驻 HUD 上的数字与进度条伴随平滑过渡动画即时跳动，无视历史消息滚动位置；
   * 消息流气泡专注于纯净剧情文本叙事，彻底消灭冗余卡片。

### 8.2 蓝图实操使用流：创作者如何搭建背包、规则与常驻 UI
1. **设计常驻 UI 布局**：
   * 拖入 `UILayoutConfig` 节点，选择停靠锚点（PC: `RightDock`，Mobile: `TopHUD`）；
   * 在组件面板勾选 `StatBar (hp, gold, weight)` 与 `InventoryGrid`；
2. **配置 ToolCall 与规则运算**：
   * 拖出 `ToolDefinition: buy_item`，设置参数 `item_id, count, unit_price, unit_weight`；
   * 连接 `Calculator` 计算总价并连入 `ConditionGate` 校验金币与负重；
   * 拦截分支引脚连入 `ToolReturn` 填入失败提示；放行分支连入实际扣除并在属性中勾选 `sync_to_hud`；
3. **编译预览（Compile Preview）**：
   * 弹窗内可同时预览：汇编后的 LLM Function Calling JSON Schema、常驻 HUD 的实际渲染效果、以及拓扑图的 DFS 连通性。

### 8.3 全链路观测与调试体系（Agent Dev Inspector）
* **双端轻量抽屉**：PC 侧边抽屉（`Ctrl+Shift+D`）与移动端底部 Bottom Sheet，纯渲染监听后端 Trace 事件；
* **时序执行泳道**：精确展示 `ToolCall 发起 -> 预计算 -> 门禁判定结果 (Pass/Blocked) -> 状态生效 -> HUD 补丁广播` 毫秒级时间线；
* **游戏状态查看器（GameState Viewer）**：创作者可实时展开查看当前玩家的金币数、负重进度条、背包物品清单，并支持手动在线编辑变量进行单步断点调试。

---

## 9. 实施落地步骤与验收标准

```
实施里程碑:
┌────────────────────────────────────────┐
│ Milestone 1: 游戏状态机与纯内存工作区  │ ──> 结构化 GameState (数值/背包)、单次持久化
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 2: 蓝图 ToolCall 与运算门禁  │ ──> ToolDefinition/Calculator/ConditionGate/ToolReturn
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 3: 常驻响应式 HUD 与 UI 设计器│ ──> UILayoutConfig、组件库、PC/Mobile 常驻锚点原地刷新
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 4: 确定性门禁与 Agent 调度器 │ ──> Aho-Corasick 禁词 Nudge、确定性 D20、多智能体协同
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 5: 双端前台感知与调试观测器  │ ──> PC/Mobile 调试抽屉、背包状态查看器、编译预览
└────────────────────────────────────────┘
```

### 验收指标：
1. **常驻 UI 原地刷新验证**：
   * 执行道具购买、使用药水或扣除金币时，PC 侧边栏/移动端顶部常驻 HUD 上的数值与背包网格瞬时更新，**消息流正文不追加任何多余卡片**；
   * 滚动浏览历史消息时，常驻 HUD 牢固停靠在当前视口，状态始终与当前会话最新数值严格一致；
2. **背包规则完整性**：
   * 在金币不足时发起购买，系统 100% 触发 `ConditionGate` 拦截，金币与背包零变更，HUD 不变，大模型准确根据失败回执描写剧情；
   * 在背包超重时发起拾取，系统精准拦截并提示超重具体数值；
   * 正常购买时，金币准确扣减、负重累加、背包道具条目正确更新并成功写入 SQLite；
3. **三态记忆兼容性**：在 `STATELESS`、`LEGACY`、`MEM0` 模式下分别运行 Agent 跑团引擎与常驻 HUD，原有标准对话 100% 零破坏；
4. **沙箱安全与隔离（C4 约束）**：自定义 HTML/Tailwind 模板在 iframe/Shadow DOM 内运行，无法突破沙箱访问宿主 SolidJS 变量或全局 CSS。

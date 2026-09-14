# Night Voyage 跑团 Agent 与游戏机制系统架构与实施规范

> **定位**: Night Voyage Agent 体系与 RPG 规则/数值/背包机制核心技术规范与实施指南  
> **技术基准**: Tauri 2.0 + Rust 后端核心 + SolidJS 双端宿主（PC `src/` / 移动端 `src-mobile/`）  
> **核心规范**: [`AGENTS.md`](file:///d:/data/Night%20Voyage/AGENTS.md)（C1 前端纯渲染、C2 零静默回退、C3 响应性保护、C4 AI UI 隔离、C5 双端独立、C7 双端覆盖）

---

## 1. 架构总览：三态记忆基石与 Agent 游戏引擎执行分流

Night Voyage 运行在双层状态架构之上：底层是已有的**三态会话记忆基础设施**，上层是可自由插拔的**会话推进执行管线**。

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
```

### 1.1 三态会话记忆基石（Session Memory Baseline）
系统原生的记忆层由三套独立演化的机制构成，受蓝图 `ModeSwitch` 节点（或 `Constant(source="memory_mode")`）调度：
1. **`STATELESS`（无状态感知模式）**：单回合纯净上下文，不读取也不累加任何长程历史消息，适用于独立跑团模组、轻量 NPC 对话或完全依靠即时状态机驱动的场景；
2. **`LEGACY`（经典滑动窗口记忆模式）**：基于 Token 预算的滑动截断，保留最近 $N$ 轮历史对话作为短期记忆；
3. **`MEM0`（向量与实体图谱记忆模式）**：外挂本地向量数据库与实体抽取服务，跨会话、跨轮次进行语义相关性检索注入。

### 1.2 会话推进层：Standard 标准单次生成 vs. Agent 跑团游戏机制引擎
* **Standard 标准单次推进**：直通现存 `stream_processor`，走由 `ModeSwitch` 决定的三态记忆流，0 额外状态机开销，原有管线 100% 保持不变；
* **Agent 跑团游戏机制引擎**：在底层三态记忆的上下文之上，激活 Rust 内存调度器，承载**自定义 ToolCall 蓝图定义、背包与数值状态机、确定性运算器与规则门禁，以及多角色视界隔离调度**。

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
    /// 临时状态标志位 / 剧情进度变量
    pub flags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub count: i64,
    pub unit_weight: f64,
    pub unit_price: f64,
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
                      ▼
             回传大模型继续剧情叙事
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

## 4. 核心 Agent 模式执行时序与多智能体编排

### 4.1 模式 A：导演-演员模式（Director-Actor / Return-mode Subagent）
* **核心职责**：消除 NPC “全知视角”，确保演员仅拥有局部记忆与角色设定；
* **执行时序**：
  1. 导演 Agent 获取世界观与玩家输入，判定需要 NPC（如酒馆老板）出场；
  2. 调度器进行**视界裁剪（Context Pruning）**，剥离全局信息，仅将老板人设与当前场景输入生成极窄提示词；
  3. 演员 Subagent 执行并提交台词与动作（`task_return`）；
  4. 导演端停用涂黑算法，按**结构化槽位（Slot Assembly）**（开场环境 + 演员台词 + 推进描写）拼装定稿并 `commit`。

### 4.2 模式 B：剧本流水线模式（Scriptwriter / Handoff 接力模式）
* **核心职责**：长篇小说文学精修，消除单次生成的人设漂移与机械文风；
* **执行时序**：
  1. 初稿写手（Drafter）生成情节草稿并存入内存变量 `draft`；
  2. Handoff 移交审阅者（Critic），对比世界观输出批注 `critique`；
  3. Handoff 移交终稿润色者（Refiner），激活 **Layer 1 锚点涂黑机制**（前文稳定段落替换为 `[前文背景已锁定]`，保留末尾 50 字尾锚防复读旧文），完成终稿输出。

### 4.3 跑团确定性门禁引擎
1. **确定性 D20 骰点检定**：
   * Agent 发起 `dice_roll { kind: "d20", dc: 15, modifier: 3 }`；
   * Rust CSPRNG 随机生成 $1 \sim 20$ 整数，判定 `roll + modifier >= dc`；
   * 结果回传大模型，同时向前端广播不可篡改的检定卡片。
2. **毫秒级 Aho-Corasick 禁词拦截与 Nudge 自纠**：
   * 在 Agent `commit` 时，Rust 毫秒级扫描禁用词库；
   * 命中则阻断提交（最多重试 2 次），注入高优先级合成 Critic Nudge：`"【门禁退回】检测到禁用词汇 [...]，请重构句式重新提交"`。

---

## 5. 蓝图节点规格与连线实战拓扑

### 5.1 节点扩展清单（`src-tauri/src/models/blueprint.rs`）
```rust
pub enum NodeType {
    // 现有节点
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
}
```

### 5.2 背包系统实战连线拓扑（商店购买与超重/金币双门禁）

```
[Start] ──> [Prompt: 基础世界规则] ──> [SchemaField: 状态同步] ──> [Agent 推理]
                                                                        │
                                                                        ▼ 当 Agent 输出 buy_item ToolCall
┌───────────────────────────────────────────────────────────────────────┴────────────────────────────────┐
│ 蓝图 ToolCall 处理拓扑                                                                                 │
│                                                                                                        │
│  [ToolDefinition: buy_item]                                                                            │
│       │ (params: item_id, count, unit_price, unit_weight)                                              │
│       ▼                                                                                                │
│  [Calculator: 预计算总价与总重]                                                                        │
│       │ (vars: cost = count * unit_price, add_w = count * unit_weight)                                  │
│       ▼                                                                                                │
│  [ConditionGate: 检查金币 (gold >= cost)]                                                              │
│       ├─ [blocked 拦截] ──> [ToolReturn: "金币不足，差额: {{cost - gold}}"] ────────┐                  │
│       └─ [pass 放行]                                                                │                  │
│            ▼                                                                        │                  │
│       [ConditionGate: 检查超重 (weight + add_w <= max_weight)]                      │                  │
│            ├─ [blocked 拦截] ──> [ToolReturn: "背包超重! 无法负重更多道具"] ────────┼──> [回传 Agent]   │
│            └─ [pass 放行]                                                           │                  │
│                 ▼                                                                   │                  │
│            [Calculator: 实际扣除与物品入包]                                         │                  │
│                 ├─ gold = gold - cost                                               │                  │
│                 ├─ inventory.add(item_id, count)                                    │                  │
│                 └─ weight = weight + add_w                                          │                  │
│                 ▼                                                                   │                  │
│            [ToolReturn: "购买成功! 已获得道具，剩余金币: {{gold}}，负重: {{weight}}"]─┘                  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. 现有系统配合与代码改动点清单

### 6.1 零破坏配合机理
1. **三态记忆基石无缝兼容**：
   * 现有 `ModeSwitch` 节点输出端口（`out_stateless` / `out_legacy` / `out_mem0`）原样保留，作为上下文装配层的前置通道；
   * Agent 推进模式无论在单轮、滑动窗口还是向量记忆下，均能无缝挂载。
2. **Prompt 编译器（`prompt_compiler.rs`）**：
   * 基础 System Prompt 与角色档案依然调用 `compile_prompt`，保持宏替换与世界书触发机制 100% 稳定。
3. **结构化输出（Structured Output）与悬浮窗**：
   * 最终定稿提交的消息依然产出 JSON Schema 状态包，HUD 监听数据库变更驱动 SolidJS 纯渲染（C1 约束）。

### 6.2 极简代码改动插槽
1. **`blueprint_executor.rs` & `models/blueprint.rs`**：
   * 增加 `ToolDefinition`、`Calculator`、`ConditionGate`、`ToolReturn` 节点反序列化与图执行逻辑；
2. **`stream_processor.rs` / `agent_runtime.rs`**：
   * 检测到模型返回 `tool_calls` 时，挂起当前流，在蓝图执行器中匹配对应的 `ToolDefinition` 分支，由 Rust 执行运算器与门禁判定，组装 `ToolResult` 恢复流；
3. **SQLite `session_states` 表**：
   * 增加存储 `game_state`（JSON 字符串）的列，与现有会话表绑定。

---

## 7. 用户侧体验、蓝图操作与调试全流程实操指南

### 7.1 终端用户操作与界面感知流 (User Experience & Interaction)
1. **会话创建与模式选择（PC/Mobile `NewChatModal.tsx`）**：
   * 用户可自由选择记忆模式（`Stateless` / `Legacy` / `Mem0`）与推进模式（`Standard` / `Agent 跑团引擎`）；
   * 开启 Agent 跑团引擎且挂载 Mem0 时，弹出 Token 消耗红字安全提示。
2. **前台正文动态状态感知条**：
   * 实时纯渲染显示：`🎲 正在掷骰力量检定...`、`🎒 系统正在核算金币与负重...`、`🛡️ 背包超重拦截，正在打回大模型改写...`。

### 7.2 蓝图实操使用流：创作者如何搭建背包与规则工作流
1. **拖拽节点**：从节点菜单拖出 `ToolDefinition`，输入工具名 `buy_potion` 与参数 `count: 1, price: 20`；
2. **配置运算与门禁**：
   * 连接 `Calculator` 节点计算 `total = count * 20`；
   * 连接 `ConditionGate` 节点设定表达式 `gold >= total`；
   * `blocked` 引脚拉线至 `ToolReturn` 填入失败提示；`pass` 引脚拉线至 `Calculator` 执行扣款入包；
3. **编译预览（Compile Preview）**：
   * 点击预览窗口，能直观查看自动汇编出的 OpenAPI/JSON Schema ToolCall 契约文本、状态初值以及连线依赖树。

### 7.3 全链路观测与调试体系（Agent Dev Inspector）
* **双端轻量抽屉**：PC 侧边抽屉（`Ctrl+Shift+D`）与移动端底部 Bottom Sheet，纯渲染监听后端 Trace 事件；
* **时序执行泳道**：精确展示 `ToolCall 发起 -> 预计算 -> 门禁判定结果 (Pass/Blocked) -> 状态生效 -> 回执回传` 毫秒级时间线；
* **游戏状态查看器（GameState Viewer）**：创作者可实时展开查看当前玩家的金币数、负重进度条、背包物品清单，并支持手动在线编辑变量进行单步调试。

---

## 8. 实施落地步骤与验收标准

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
│ Milestone 3: 确定性门禁与 Agent 调度器 │ ──> Aho-Corasick 禁词 Nudge、确定性 D20、多智能体协同
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 4: 双端前台感知与调试观测器  │ ──> PC/Mobile 调试抽屉、背包状态查看器、编译预览
└────────────────────────────────────────┘
```

### 验收指标：
1. **背包规则完整性**：
   * 在金币不足时发起购买，系统 100% 触发 `ConditionGate` 拦截，金币与背包零变更，大模型准确根据失败回执描写剧情；
   * 在背包超重时发起拾取，系统精准拦截并提示超重具体数值；
   * 正常购买时，金币准确扣减、负重累加、背包道具条目正确更新并成功写入 SQLite；
2. **三态记忆兼容性**：在 `STATELESS`、`LEGACY`、`MEM0` 模式下分别运行 Agent 跑团引擎，上下文组装与记忆检索均正常运转，原有标准对话 100% 零破坏；
3. **纯内存无残留**：执行含多次 ToolCall 与状态变更的长回合，磁盘与 `D:\software_cache` 无任何过程临时碎文件生成。

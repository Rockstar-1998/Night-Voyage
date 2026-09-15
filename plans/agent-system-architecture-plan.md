# Night Voyage 跑团 Agent 与游戏机制系统架构与实施规范

> **定位**: Night Voyage Agent 体系、RPG 规则/数值/背包机制、非节点式 Schema 架构与全模式常驻 UI 引擎核心技术规范与实施指南  
> **技术基准**: Tauri 2.0 + Rust 后端核心 + SolidJS 双端宿主（PC `src/` / 移动端 `src-mobile/`）  
> **核心规范**: [`AGENTS.md`](file:///d:/data/Night%20Voyage/AGENTS.md)（C1 前端纯渲染、C2 零静默回退、C3 响应性保护、C4 AI UI 隔离、C5 双端独立、C7 双端覆盖）

---

## 1. 架构总览：三态记忆基石与状态管理双轨制

Night Voyage 运行在三层清晰解耦的状态架构之上：底层是已有的**三态会话记忆基础设施**，中层是**状态管理双轨制执行管线**，上层是普适所有模式的**常驻响应式 UI 表现层**。

```
                    ┌───────────────────────── 玩家输入 ─────────────────────────┐
                    │                                                             │
                    ▼                                                             ▼
       [0. 底层三态记忆基石 (Session Memory Modes)]              [1. 上层状态管理双轨制 (State Management Duality)]
                    │                                                             │
    ┌───────────────┼───────────────┐                    ┌────────────────────────┴────────────────────────┐
    ▼               ▼               ▼                    ▼                                                 ▼
 STATELESS        LEGACY          MEM0            【传统模式: Schema 覆写流】                       【Agent 模式: 数据容器 ToolCall 流】
(无状态感知)    (经典滑动窗口)  (向量与实体检索)     (适用 STATELESS / LEGACY)                        (适用 Director / Scriptwriter)
    │               │               │                    │                                                 │
    └───────────────┼───────────────┘                    ├─ 上下文: 完整塞入历史 Schema 数据               ├─ 上下文: 纯净叙事，无需复读全量背包/属性
                    ▼                                    ├─ 模型回复: 完整填充覆盖整张 Schema              ├─ 状态管理: 独立 Rust 内存 DataContainer
           [蓝图 ModeSwitch 节点]                        └─ 状态变更: 靠大模型覆写新数值                   └─ 状态变更: ToolCall 针对性 查看与修改
     (out_stateless / out_legacy / out_mem0)                     │                                                 │
                    │                                            │ (解析 Schema 字段)                              │ (ToolCall 增量更新)
                    └────────────────────────────────────────────┴────────────────────────┬────────────────────────┘
                                                                                          ▼
                                                                     [2. 全模式通用常驻响应式 HUD 表现层]
                                                                       (支持 STATELESS / LEGACY / Agent)
                                                                       (自由拖拽定位 / 容器嵌套 / 主题 / Shadow DOM 隔离 CSS)
```

### 1.1 三态会话记忆基石（Session Memory Baseline）
系统原生的记忆层由三套独立演化的机制构成，受蓝图 `ModeSwitch` 节点（或 `Constant(source="memory_mode")`）调度：
1. **`STATELESS`（无状态感知模式）**：单回合纯净上下文，不读取也不累加任何长程历史消息，适用于独立跑团模组、轻量 NPC 对话或完全依靠即时状态机驱动的场景；
2. **`LEGACY`（经典滑动窗口记忆模式）**：基于 Token 预算的滑动截断，保留最近 $N$ 轮历史对话作为短期记忆；
3. **`MEM0`（向量与实体图谱记忆模式）**：外挂本地向量数据库与实体抽取服务，跨会话、跨轮次进行语义相关性检索注入。

### 1.2 状态管理双轨制核心分工：Schema 覆写 vs. 数据容器 ToolCall
系统在状态流转上确立两条物理隔离、哲学完全不同的范式：

| 维度 | **传统单次模式（STATELESS / LEGACY）** | **Agent 跑团游戏机制引擎** |
| :--- | :--- | :--- |
| **状态载体** | **结构化 Schema（JSON Schema）** | **独立数据容器（`DataContainer` / `GameState`）** |
| **流转机制** | **上下文全量注入 + 回复覆写填充（Context Injection & Overwrite）** | **内存外部容器 + ToolCall 精准查看与修改（Inspect & Mutate）** |
| **输入机制** | 每一轮将历史累积的全部状态作为完整结构化上下文塞入 Prompt | 仅输入当前剧情与局部视界，无需在上下文中强塞全量数据字典 |
| **回复输出** | 模型必须在回复末尾重新生成整张 Schema，通过全量覆盖来更新状态 | 模型直接输出纯净文学叙事，**绝不复读或重新填充覆盖庞大 Schema** |
| **状态查看** | 大模型直接在上下文的 Prompt 历史 Schema 中静态阅读 | 大模型通过 `ToolCall: check_inventory / get_stats` **按需动态调阅** |
| **状态修改** | 依赖大模型“自觉”输出正确的新数值（极易算错金币、吞掉道具） | 通过 `ToolCall: buy_item / use_item` 由 Rust 运算器与门禁确定性执行 |
| **Token 效率**| 随背包物品和属性增多，每轮输入与输出 Token 呈线性恶性膨胀 | **极度节省 Token**：仅传输发生变动的几十 Token 参数，无多余复读 |
| **常驻 HUD** | `stream_processor` 解析覆写 Schema 字段 $\rightarrow$ 发射 Patch 刷新 HUD | ToolCall 触发数据容器变更 $\rightarrow$ 即刻发射 Patch 原地刷新 HUD |

---

## 2. 状态容器与纯内存变量工作区（DataContainer & In-Memory Workspace）

系统在运行时维护结构化的数据容器，专供 Agent 模式通过 ToolCall 进行纳秒级精准操作。

### 2.1 结构化数据容器（Structured DataContainer / GameState）
每个会话在 SQLite 与 Rust 内存中维护独立的容器实例：
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataContainer {
    /// 基础数值属性（如 hp, max_hp, mp, gold, weight, max_weight）
    pub stats: HashMap<String, f64>,
    /// 背包物品集合（支持根据 ID 增删查改）
    pub inventory: Vec<InventoryItem>,
    /// 临时状态标志位 / 剧情进度变量 / 任务线
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
* **ToolCall 原生接口**：
  * **查看类工具（Inspect Tools）**：向 LLM 暴露 `check_inventory()`、`get_player_stats()`、`inspect_item(item_id)`，LLM 仅在剧情需要时调阅数据容器内容；
  * **修改类工具（Mutate Tools）**：向 LLM 暴露 `add_item(id, count)`、`use_item(id)`、`deduct_gold(amount)`，由 Rust 确定性运算器执行原子扣减与增删；
* **单次结算持久化**：回合内由于多次 ToolCall 引发的数据容器变动全在内存瞬时执行；仅当本回合最终叙事文本 `commit` 时，最新的 `DataContainer` 快照单次持久化写入 SQLite `session_states` 表。

### 2.2 纯内存文本工作区（In-Memory Text Workspace）
针对多智能体协同（导演委派、审阅润色），系统维护独立的 `HashMap<String, String>`：
* 将虚拟文本变量（`draft`、`critique`、`final`）映射在内存堆中；
* 暴露 `read_text`、`write_text` 工具供 LLM 自主修改；
* 零磁盘 I/O，回合结束随生命周期自动 Drop。

---

## 3. 结构化 Schema 体系：传统模式的状态管理与独立非节点式编辑器

Schema 体系作为**传统单次推进模式（STATELESS / LEGACY）的状态管理载体**，彻底告别散落节点堆砌，确立为独立资产。

### 3.1 独立非节点式 Schema 编辑器（Non-Node Schema Editor）
创作者在预设配置界面或独立的 Schema 编辑模态框中直观维护数据结构，不再受图节点连线约束：
```
┌──────────────────────────── 独立 Schema 编辑器 (RPG 回合总结) ────────────────────────────┐
│ Schema ID: rpg_turn_summary       描述: 约束传统单次模式大模型每轮输出与状态覆写            │
├──────┬─────────────────┬──────────┬──────────┬─────────────────┬─────────────────┬──────────────┤
│ 排序 │ 字段名 (Field)   │ 类型     │ 必填     │ 展示目标        │ 数据库映射       │ 说明         │
├──────┼─────────────────┼──────────┼──────────┼─────────────────┼─────────────────┼──────────────┤
│ ≡ 1  │ thinking        │ string   │ [✓] 必选 │ InlineMessage   │                 │ 隐藏推演思维 │
│ ≡ 2  │ narrative       │ string   │ [✓] 必选 │ InlineMessage   │                 │ 叙事正文主句 │
│ ≡ 3  │ hp              │ number   │ [✓] 必选 │ PersistentHUD   │ world_variables │ 生命值覆写   │
│ ≡ 4  │ gold            │ number   │ [✓] 必选 │ PersistentHUD   │ world_variables │ 金币数覆写   │
│ ≡ 5  │ inventory_text  │ string   │ [ ] 可选 │ PersistentHUD   │ world_variables │ 简易道具摘要 │
└──────┴─────────────────┴──────────┴──────────┴─────────────────┴─────────────────┴──────────────┘
```
* **传统模式下的覆写运行流**：
  1. 上一轮生成的 Schema 字段值被完整塞入当前 Prompt 作为上下文；
  2. 大模型在回复末尾重新生成整张 Schema，将新的 `hp`、`gold` 输出覆盖上一轮；
  3. `stream_processor` 解析后，根据 `display_target` 将 `PersistentHUD` 字段发射补丁刷新常驻 HUD，将 `narrative`（`body: true`）流式推入消息气泡；
* **物理顺序严格对齐编辑器**：
  * 字段在生成的 JSON Schema `properties` 字典中的排列顺序、以及大模型流式输出与解析的顺序，**100% 严格依照该编辑器中的拖拽排序（上下移动）**，彻底消除原有蓝图图遍历导致的顺序不确定性与反转 Bug。

### 3.2 蓝图轻量按需调用：`InvokeSchema` 节点
蓝图画布中废除所有散落的 `SchemaField` 节点，收敛为单一的调用引脚：
* **节点类型**：`InvokeSchema`（`InvokeSchemaConfig { schema_id: String }`）；
* **按需激活机理**：
  * 仅当蓝图 DFS 执行流实际到达 `InvokeSchema` 节点时，执行器才读取指定 `schema_id` 的完整定义，并将其装配进本次编译的 `structured_output_schema`；
  * 若因前置分支判断（如走入不带结构化输出的轻量闲聊分支，或走入纯 ToolCall 数据容器驱动的 Agent 分支），该节点未被遍历，则**根本不激活任何 Schema**，彻底消除冗余开销。

---

## 4. 全模式常驻响应式 UI 引擎与可视化 UI 模板编辑器 (Universal Persistent Reactive HUD & UI Designer)

彻底摒弃“每轮回复底部追加临时卡片”的旧式设计，构建**跨 STATELESS、LEGACY 与 Agent 全模式通用、常驻视口、自由布局、主题丰富、多层容器、物理隔离的响应式 HUD**。

```
                               ┌─── PC: 右侧固定仪表盘 (RightDock)
                               ├─── PC: 顶部吸顶折叠栏 (TopSticky)
  [会话视口常驻挂载锚点] ───────┼─── PC: 自由浮动画中画 (FloatingHUD)
                               ├─── Mobile: 顶部吸顶栏 + 下拉抽屉 (TopHUD)
                               └─── Mobile: 输入框上方微型条 (BottomSticky)
                                         ▲
                                         │ 监听增量补丁事件 (session:hud_state_patch)
                                         │ 纳秒级原地局部刷新 (零全局重绘)
┌────────────────────────────────────────┴────────────────────────────────────────┐
│ 统一常驻 HUD 双驱动数据源 (Dual Data Sources)                                   │
│ ├─ 通道 A [Agent 模式]: ToolCall 针对性查看与修改 -> DataContainer 状态机       │
│ └─ 通道 B [STATELESS / LEGACY 模式]: 流式 JSON 解析 -> 覆写 Schema 状态字段提取 │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▲
                         [SolidJS 宿主内的 Shadow DOM 沙箱]
                         (预设主题 + 自定义 CSS 样式代码绝对隔离)
```

### 4.1 UI 设计器：自由布局、尺寸与多层容器组件 (Freeform Layout & Hierarchy)
创作者在设计器中对常驻面板进行直观的可视化拖拽、缩放与嵌套排布：
1. **容器层级系统（Container Hierarchy Tree）**：
   * **`RootCanvas`（根画布）**：配置视口尺寸、排版模式（`Absolute` 自由坐标拖拽 / `Flex` 弹性流式 / `Grid` 自适应网格）；
   * **`PanelContainer`（通用面板容器）**：自由配置坐标（`x, y`）、尺寸（`width, height`）、内边距、背景模糊、圆角；支持无限层级嵌套；
   * **`TabsContainer`（标签页容器）**：在同一区域划分“角色属性 | 背包道具 | 任务日志”等子标签页；
   * **`GridContainer`（道具/状态网格容器）**：自定义背包槽位网格行列数与固定像素尺寸。
2. **原子控件库（Interactive Widgets）**：
   * **`StatBar`（动态数值进度条）**：自由拉伸长宽（水平/垂直）；绑定数值（如 `stats.hp` 或 Schema 字段 `schema.hp`）；
   * **`InventorySlotGrid`（背包网格控件）**：绑定 `inventory` 列表，自动渲染物品图标、数量角标、品质框与详情气泡；
   * **`DataLabel` / `Badge`（数据标签与徽标）**：绑定表达式展示金币、等级、当前地点、天气环境；
   * **`AvatarFrame`（形象/状态框）**：显示玩家头像与即时 Buff 图标。

### 4.2 UI 设计器：主题系统与自定义 CSS 外观代码 (Themes & CSS Sandbox)
1. **预设主题资产库（Built-in Theme Presets）**：
   * **`Dark Fantasy`（黑金奇幻）**：羊皮纸底纹、哥特金属框线、暗金装饰、猩红血条；
   * **`Cyberpunk 2077`（赛博霓虹）**：荧光青绿、故障描边、等宽科技字体、高对比度深灰底板；
   * **`Minimal Ink`（极简水墨）**：宣纸质感底色、淡墨线条、朱砂印章点缀、古典留白；
   * **`Classic Tabletop`（经典跑团）**：复古木纹边框、拟物羊皮纸背景、古典衬线体。
2. **设计令牌（Design Tokens）**：
   * 提供可视化调色板调节核心变量：`--hud-bg-color`、`--hud-border-radius`、`--hud-font-family`、`--hud-accent` 等。
3. **自定义 CSS 样式注入与 C4 物理隔离（CSS Sandbox & Isolation）**：
   * 提供内置代码编辑器，允许创作者编写原生 CSS 样式规则覆盖任意类名；
   * **C4 硬性隔离红线**：
     * 自定义 CSS 与模板**绝对禁止直接注入 SolidJS 宿主全局 DOM**；
     * **技术落地基准**：常驻 HUD 模板容器强制挂载在 **`Shadow DOM`**（或隔离的 `iframe`）内部；
     * CSS 规则仅在 Shadow Root 内部生效，物理阻断样式泄露，100% 保护 SolidJS 宿主界面与动画引擎。

### 4.3 跨模式常驻 HUD 驱动链路对比
* **Agent 模式驱动链路**：
  * 大模型输出 `ToolCall: buy_item` $\rightarrow$ 蓝图 `Calculator` 变更内存 `DataContainer` $\rightarrow$ 后端发射 `session:hud_state_patch` $\rightarrow$ 常驻 HUD 基于 SolidJS Signal 毫秒级原地定向刷新对应组件；
  * 模型最终回复仅输出叙事文本，**不产生任何 Schema 输出与复读**；
* **STATELESS / LEGACY 模式驱动链路**：
  * Prompt 塞入历史 Schema $\rightarrow$ 模型流式输出新 Schema 全量填充 $\rightarrow$ `stream_processor` 解析并将标记为 `PersistentHUD` 的字段打包发射 `session:hud_state_patch` $\rightarrow$ 常驻 HUD 原地刷新；
  * 消息气泡仅呈现 `body: true` 叙事，彻底消灭历史消息底部的堆叠卡片。

---

## 5. 蓝图高级跑团功能体系：ToolCall 与数据容器管理

在 Agent 模式下，蓝图作为**数据容器的规则与运算控制器**，完全取代 Schema 承担游戏状态管理职责。

```
大模型查看容器: ToolCall: check_inventory {}
                     │
                     ▼
         [ToolDefinition: check_inventory]
                     │
                     ▼ 读取内存 DataContainer 道具列表
         [ToolReturn: "背包物品: 铁剑*1 (10kg), 金币: 150"] ──> 回传大模型辅助决策
                     │
大模型修改容器: ToolCall: buy_item { item_id: "iron_sword", count: 1, unit_price: 50, unit_weight: 10 }
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
       │ Calculator: 修改数据容器    │ ──> 真实扣除: gold -= 50; 增加道具: inventory.add("iron_sword", 1)
       └──────────────┬──────────────┘     自动重算: weight += 10
                      ▼
       ┌─────────────────────────────┐
       │ ToolReturn: 成功回执返回    │ ──> 吐出: "购买成功: 已获得铁剑*1, 剩余金币 100, 负重 28/30kg"
       └──────────────┬──────────────┘
                      ├──────────────────────────┐
                      ▼                          ▼
             回传大模型继续纯文本叙事       实时驱动常驻 HUD 原地刷新 (第 4 节)
             (大模型无需复读覆盖 Schema)
```

### 5.1 `ToolDefinition` 节点（自定义 ToolCall 契约定义）
* **查看类工具契约**：定义 `check_inventory`、`get_player_stats` 等读取接口；
* **修改类工具契约**：定义 `buy_item`、`use_potion`、`equip_armor` 等写入接口；
* 节点包含：`tool_name`、`description`、`parameters_schema`（JSON Schema），编译期注册为 LLM Function Calling。

### 5.2 `Calculator` 节点（确定性数值与容器修改运算器）
拒绝让大模型算数，所有数值与容器操作由 Rust 确定性执行：
1. **数值算术模式（Math Operation）**：
   * 支持运算：`+`、`-`、`*`、`/`、`%`、`min`、`max`、`clamp`；
   * 示例：`gold = gold - total_cost`，`hp = clamp(hp + 50, 0, max_hp)`；
2. **容器集合管理模式（Collection Operation）**：
   * `add_item(id, name, count, unit_weight, unit_price)`：累加 count 或追加条目；
   * `remove_item(id, count)`：扣减数量，归零清除；
   * `recompute_weight()`：原子更新全局 `weight` 变量。

### 5.3 `ConditionGate` 节点（确定性规则判定与动作拦截门禁）
* **判定表达式**：金币校验（`gold >= cost`）、负重校验（`weight + add_w <= max_w`）、格子槽位校验（`inventory.len() < max_slots`）；
* **双出口分支**：
  * `pass`（放行）：流向实际修改数据容器的运算器；
  * `blocked`（拦截）：完全阻断数据容器修改，流向错误回执。

### 5.4 `ToolReturn` 节点（结果装配与大模型恢复）
将运算器成功结果或门禁拦截信息封装为标准 `ToolResult` 回传大模型，强迫 Agent 基于客观事实继续推进纯文本叙事。

---

## 6. 核心 Agent 模式执行时序与多智能体编排

### 6.1 模式 A：导演-演员模式（Director-Actor / Return-mode Subagent）
* **核心职责**：消除 NPC “全知视角”，确保演员仅拥有局部记忆与角色设定；
* **执行时序**：
  1. 导演 Agent 获取世界观与玩家输入，裁定出场角色；
  2. 调度器进行**视界裁剪（Context Pruning）**，仅将该角色设定与即时台词纸条装配给演员 Subagent；
  3. 演员 Subagent 执行并提交局部台词（`task_return`）；
  4. 导演端按**结构化槽位（Slot Assembly）**（开场环境 + 演员台词 + 剧情推进）拼装定稿并 `commit`。

### 6.2 模式 B：剧本流水线模式（Scriptwriter / Handoff 接力模式）
* **核心职责**：长篇小说文学精修，消除单次生成的人设漂移与机械文风；
* **执行时序**：
  1. 初稿写手（Drafter）生成初稿并存入内存变量 `draft`；
  2. Handoff 移交审阅者（Critic）输出批注 `critique`；
  3. Handoff 移交终稿润色者（Refiner），激活 **Layer 1 锚点涂黑机制**（前文稳定段落替换为 `[前文背景已锁定]`，保留末尾 50 字尾锚防复读旧文），完成终稿输出。

### 6.3 跑团确定性门禁引擎
1. **确定性 D20 骰点检定**：
   * Rust CSPRNG 随机生成 $1 \sim 20$ 整数，判定 `roll + modifier >= dc`，广播不可篡改检定卡片；
2. **毫秒级 Aho-Corasick 禁词拦截与 Nudge 自纠**：
   * Commit 前毫秒级扫描词库，命中则阻断提交（最多重试 2 次），注入高优先级合成 Critic Nudge 改写指令。

---

## 7. 蓝图节点规格与连线实战拓扑

### 7.1 节点扩展清单（`src-tauri/src/models/blueprint.rs`）
```rust
pub enum NodeType {
    // 现有基础节点 (保留兼容)
    Start, End, Prompt, MutexGate, GroupGate, ModeSwitch, RoleSwitch,
    Constant, Branch, SamplingParamsOpenAi, SamplingParamsAnthropic,
    // 独立 Schema 调用节点 (仅传统模式或特定格式化需要时调用)
    InvokeSchema,
    // 高级 Agent 与游戏机制节点 (数据容器 ToolCall 管理)
    ToolDefinition,
    Calculator,
    ConditionGate,
    ToolReturn,
    AgentModeSwitch,
    DirectorConfig,
    ActorDefinition,
    ScriptwriterPipeline,
    BannedWordsConfig,
    // 常驻 UI 布局绑定节点
    UILayoutConfig,
}
```

### 7.2 实战连线拓扑（双轨制状态管理范例）

#### (1) Agent 模式下：ToolCall 管理数据容器与常驻 HUD 原地刷新（无 Schema 覆写）
```
[Start] ──> [Prompt: 基础世界观] ──> [UILayoutConfig: 挂载 RightDock 仪表盘] ──> [Agent 推理]
                                                                                      │
                                                                                      ▼ 当 Agent 发起 buy_item ToolCall
┌─────────────────────────────────────────────────────────────────────────────────────┴────────────────────────┐
│ 蓝图 ToolCall 处理拓扑                                                                                       │
│                                                                                                              │
│  [ToolDefinition: buy_item] ──> [Calculator: 预计算] ──> [ConditionGate: 检查金币] ──> [ConditionGate: 检查超重]  │
│                                                                                                │              │
│                                               ┌────────────────────────────────────────────────┘              │
│                                               ▼ (放行)                                                        │
│                                   [Calculator: 修改 DataContainer 容器] ──> [驱动常驻 HUD 原地刷新]            │
│                                               │                                                              │
│                                               ▼                                                              │
│                                   [ToolReturn: "购买成功!"] ──> [回传 Agent 继续纯文本叙事 (0 Schema 复读)]    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### (2) STATELESS / LEGACY 模式下：Schema 覆写流与常驻 HUD 挂载
```
[Start] ──> [ModeSwitch (out_stateless / out_legacy)]
                 │
                 ▼
         [InvokeSchema: status_summary_schema]
                 │ (塞入历史 Schema 上下文，回复时大模型全量填充覆写 Schema)
                 ▼
         [UILayoutConfig: 挂载 TopSticky 吸顶栏 + Dark Fantasy 主题]
                 │
                 ▼
         [End: 提交执行 stream_processor 单次推理]
                 │
                 ▼
   (流式输出正文入气泡，状态字段自动流向常驻 HUD 原地刷新，零消息垃圾卡片堆叠)
```

---

## 8. 现有系统配合与代码改动点清单

### 8.1 零破坏配合机理
1. **三态记忆基石无缝兼容**：
   * 现有 `ModeSwitch` 节点输出端口（`out_stateless` / `out_legacy` / `out_mem0`）原样保留，作为上下文装配层的前置通道。
2. **`stream_processor.rs` 双通道广播**：
   * 单次生成（`STATELESS` / `LEGACY`）：从模型输出的 Schema 字段中提取 `PersistentHUD` 字段发射补丁；
   * Agent 模式：在 ToolCall 运算器执行成功修改 `DataContainer` 后发射补丁，模型最终回复不再处理任何 Schema 字段。
3. **SQLite 持久化无缝扩展**：
   * 新增 `preset_schemas` 表存储独立 Schema 定义；
   * 新增 `session_states` 表存储各会话最新的 `DataContainer`（`GameState`）JSON 快照。

### 8.2 极简代码改动插槽
1. **`models/blueprint.rs` & `blueprint_executor.rs`**：
   * 增加 `InvokeSchema`、`ToolDefinition`、`Calculator`、`ConditionGate`、`ToolReturn`、`UILayoutConfig` 节点反序列化与图执行逻辑；
2. **`stream_processor.rs` / `agent_runtime.rs`**：
   * 区分双轨制：Agent 模式拦截 `tool_calls` 操作 `DataContainer`，传统模式解析 Schema 字段；
3. **前端双端宿主插槽**：
   * PC：`ChatArea.tsx` 挂载 `PersistentHudContainer.tsx`（内嵌 Shadow DOM）；
   * Mobile：`MobileChatView.tsx` 挂载 `MobilePersistentHud.tsx`。

---

## 9. 用户侧体验、蓝图操作与调试全流程实操指南

### 9.1 创作者：双轨制预设搭建实操
1. **搭建传统 Schema 覆写型预设（适用 STATELESS / LEGACY）**：
   * 在 Schema 编辑器定义字段（`hp`、`gold`），展示目标设为 `PersistentHUD`；
   * 蓝图连接 `InvokeSchema` 节点，模型每轮自动在回复时填充覆盖，常驻 HUD 自动原地更新；
2. **搭建 Agent 数据容器型预设（适用 RPG 深度游戏）**：
   * 无需配置复杂的全量状态 Schema；
   * 直接在蓝图定义 `ToolDefinition`（`check_inventory`, `buy_item`）与 `Calculator`；
   * 模型像真人玩家一样通过 ToolCall 读写数据容器，纯文本回复叙事，HUD 极速联动。

### 9.2 创作者：UI 设计器自由布局与主题定制实操
1. **容器与尺寸排版**：
   * 在 UI 设计器画布中拖入 `PanelContainer`，自由调整尺寸与坐标；
   * 绑定 `DataContainer` 变量（`stats.hp`）或 Schema 字段（`schema.hp`）；
2. **主题与自定义 CSS**：
   * 选择预设主题（`Dark Fantasy`、`Cyberpunk 2077` 等）或编写自定义 CSS；
   * 强制在 `Shadow DOM` 内隔离运行，宿主界面 100% 零受影响。

### 9.3 终端用户交互体验与调试排错
* **双轨制无缝体验**：无论进入哪种预设，玩家均享受统一的右侧/顶部常驻 HUD 体验；
* 打开 `[🐞 Agent 调试抽屉]`（`Ctrl+Shift+D`），时序泳道毫秒级回放 `ToolCall -> 数据容器修改 -> 门禁 -> HUD 补丁` 或 `Schema 流式解析 -> HUD 补丁` 全链路。

---

## 10. 实施落地步骤与验收标准

```
实施里程碑:
┌────────────────────────────────────────┐
│ Milestone 1: 独立 Schema 编辑器与调用  │ ──> 独立表单编辑器、拖拽排序对齐、InvokeSchema 节点
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 2: 数据容器与 ToolCall 引擎  │ ──> DataContainer 容器、ToolDefinition/Calculator/ConditionGate
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 3: 全模式常驻 HUD 与 UI 设计器│ ──> 自由布局/容器嵌套/主题切换/双轨制数据源贯通
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 4: 确定性门禁与 Agent 调度器 │ ──> Aho-Corasick 禁词自纠、确定性 D20、多智能体协同
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 5: 双端前台感知与全链路验证  │ ──> PC/Mobile 调试抽屉、全模式原地刷新、编译预览
└────────────────────────────────────────┘
```

### 验收指标：
1. **状态管理双轨制严格隔离**：
   * 传统模式（`STATELESS` / `LEGACY`）：每轮塞入历史 Schema，回复输出覆写 Schema 并驱动 HUD 原地刷新；
   * Agent 模式：通过 ToolCall 读写 `DataContainer`，最终回复**100% 为纯文本叙事，不产生任何 Schema 复读**，Token 消耗大幅降低；
2. **UI 设计器自由度与物理隔离（C4 约束）**：
   * 创作者在 UI 设计器中调整容器与控件的坐标（X/Y）与尺寸（W/H）忠实呈现；
   * 自定义 CSS 代码与主题在所有模式下均在 Shadow DOM 内部隔离生效，绝不污染外层 SolidJS 宿主样式；
3. **常驻 UI 原地刷新与零尾随卡片**：
   * 无论双轨制哪条路径，常驻 HUD 均原地刷新，消息气泡流不追加任何冗余卡片；
4. **背包规则确定性执行**：
   * 金币不足与超重时 100% 触发阻断拦截，数据容器零篡改。

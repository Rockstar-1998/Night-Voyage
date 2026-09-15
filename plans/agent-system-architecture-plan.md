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
    └───────────────┼───────────────┘                    ├─ 上下文: 塞入历史 Schema (按单个 Schema 保留层数) ├─ 上下文: 纯净剧情，通过 ToolCall 查看状态
                    ▼                                    ├─ 模型回复: 完整填充覆盖整张 Schema              ├─ 状态管理: 独立 Rust 内存 DataContainer (ToolCall 修改)
           [蓝图 ModeSwitch 节点]                        └─ 状态变更: 靠大模型覆写新数值                   └─ 终稿输出: 正文处理完毕后按 Schema 规范结构化输出
     (out_stateless / out_legacy / out_mem0)                     │                                                 │
                    │                                            │ (解析 Schema 字段)                              │ (ToolCall 增量更新 / 正文 Schema 提取)
                    └────────────────────────────────────────────┴────────────────────────┬────────────────────────┘
                                                                                          ▼
                                                                     [2. 全模式通用常驻响应式 HUD 表现层]
                                                                       (支持 STATELESS / LEGACY / Agent)
                                                                       (自由拖拽定位 / 默认玄青色主题 / 自定义 CSS 隔离于 Shadow DOM)
```

### 1.1 三态会话记忆基石（Session Memory Baseline）
系统原生的记忆层由三套独立演化的机制构成，受蓝图 `ModeSwitch` 节点（或 `Constant(source="memory_mode")`）调度：
1. **`STATELESS`（无状态感知模式）**：单回合纯净上下文，不读取也不累加任何长程历史消息，适用于独立跑团模组、轻量 NPC 对话或完全依靠即时状态机驱动的场景；
2. **`LEGACY`（经典滑动窗口记忆模式）**：基于 Token 预算的滑动截断，保留最近 $N$ 轮历史对话作为短期记忆；
3. **`MEM0`（向量与实体图谱记忆模式）**：外挂本地向量数据库与实体抽取服务，跨会话、跨轮次进行语义相关性检索注入。

### 1.2 状态管理双轨制核心分工：Schema 覆写 vs. 数据容器 ToolCall
系统在状态流转上确立两条物理隔离、职责清晰的执行范式：

| 维度 | **传统单次模式（STATELESS / LEGACY）** | **Agent 跑团游戏机制引擎** |
| :--- | :--- | :--- |
| **状态载体** | **结构化 Schema（JSON Schema）** | **独立数据容器（`DataContainer` / `GameState`）** |
| **流转机制** | **上下文全量注入 + 回复覆写填充（Context Injection & Overwrite）** | **内存外部容器 + ToolCall 精准查看与修改（Inspect & Mutate）** |
| **输入机制** | 将历史累积状态作为结构化上下文塞入 Prompt（**支持在单个 Schema 中配置「保留层数」倒序保留最新 $N$ 层，过远直接丢弃**） | 仅输入当前剧情与局部视界，大模型按需通过 ToolCall 查看数据容器，上下文不强塞全量数据字典 |
| **回复输出** | 模型必须在回复末尾重新生成整张 Schema，通过全量覆盖来更新状态 | **正文处理完毕后依然按照 Schema 规范进行结构化输出（如 thinking、narrative 等）**，但无需在 Schema 中重新生成与覆写整个庞大的业务背包数据 |
| **状态查看** | 大模型直接在上下文的 Prompt 历史 Schema 中静态阅读 | 大模型通过 `ToolCall: check_inventory / get_stats` **按需动态调阅** |
| **状态修改** | 依赖大模型“自觉”输出正确的新数值（极易算错金币、吞掉道具） | 通过 `ToolCall: buy_item / use_item` 由 Rust 确定性运算器与门禁原子执行 |
| **Token 效率**| 随对话轮次增加，开启单个 Schema 保留层数后锁定为常数级；未开启则线性膨胀 | **极度节省 Token**：仅传输发生变动的几十 Token 参数，终稿 Schema 仅用于规范正文，无业务数值覆写冗余 |
| **常驻 HUD** | **取决于定义时的行为**：Schema 字段定义为 `PersistentHUD` 并完成 UI 挂载后，`stream_processor` 解析覆写字段 $\rightarrow$ 发射 Patch 原地刷新，始终显示最新数据 | ToolCall 触发数据容器变更 $\rightarrow$ 即刻发射 Patch 原地刷新 HUD，与 UI 设计器自由排版联动 |

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
* **单次结算持久化**：回合内由于多次 ToolCall 引发的数据容器变动全在内存瞬时执行；仅当本回合最终正文处理完毕并通过 Schema 规范输出定稿时，最新的 `DataContainer` 快照单次持久化写入 SQLite `session_states` 表。

### 2.2 纯内存文本工作区（In-Memory Text Workspace）
针对多智能体协同（导演委派、审阅润色），系统维护独立的 `HashMap<String, String>`：
* 将虚拟文本变量（`draft`、`critique`、`final`）映射在内存堆中；
* 暴露 `read_text`、`write_text` 工具供 LLM 自主修改；
* 零磁盘 I/O，回合结束随生命周期自动 Drop。

---

## 3. 结构化 Schema 体系：传统模式的状态管理与独立非节点式编辑器

Schema 体系在系统中扮演双重核心职责：既是**传统单次推进模式（STATELESS / LEGACY）的状态管理载体**，也是 **Agent 模式在正文处理完毕后的结构化输出规范（Structure Output Schema）**。彻底告别散落节点堆砌，确立为独立资产。

### 3.1 独立非节点式 Schema 编辑器模型与交互布局 (Non-Node Schema Editor)
创作者在预设配置界面或独立的 Schema 编辑模态框中直观维护数据结构，不再受图节点连线约束：
```
┌──────────────────────────── 独立 Schema 编辑器 (RPG 回合总结) ────────────────────────────┐
│ Schema ID: rpg_turn_summary       描述: 约束传统单次模式大模型每轮输出与状态覆写            │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 当前 Schema 属性配置:                                                                        │
│ [⏳ 限制历史保留层数: ON ]  [保留层数: 3 ] ──> 仅对本 Schema 生效：从最新层倒数保留 3 层，更早丢弃 │
├──────┬─────────────────┬──────────┬──────────┬─────────────────┬─────────────────┬──────────────┤
│ 排序 │ 字段名 (Field)   │ 类型     │ 必填     │ 展示目标        │ 数据库映射       │ 说明         │
├──────┼─────────────────┼──────────┼──────────┼─────────────────┼─────────────────┬──────────────┤
│ ≡ 1  │ thinking        │ string   │ [✓] 必选 │ InlineMessage   │                 │ 隐藏推演思维 │
│ ≡ 2  │ narrative       │ string   │ [✓] 必选 │ InlineMessage   │                 │ 叙事正文主句 │
│ ≡ 3  │ hp              │ number   │ [✓] 必选 │ PersistentHUD   │ world_variables │ 生命值覆写   │
│ ≡ 4  │ gold            │ number   │ [✓] 必选 │ PersistentHUD   │ world_variables │ 金币数覆写   │
│ ≡ 5  │ inventory_text  │ string   │ [ ] 可选 │ PersistentHUD   │ world_variables │ 简易道具摘要 │
└──────┴─────────────────┴──────────┴──────────┴─────────────────┴─────────────────┴──────────────┘
```

#### 数据契约定义（`src-tauri/src/models/schema.rs`）
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SchemaDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    /// 单个 Schema 独立配置保留层数：None 表示不限制；Some(N) 表示从最新层倒数保留指定层数在上下文中，过远的历史直接丢弃
    pub retention_depth: Option<u32>,
    /// 字段列表（严格遵循编辑器拖拽物理排序；display_target 决定行为表现）
    pub fields: Vec<SchemaFieldDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SchemaFieldDefinition {
    pub name: String,
    pub field_type: SchemaFieldType,
    pub required: bool,
    /// 决定呈现行为：PersistentHUD 常驻视口 / InlineMessage 内联消息气泡
    pub display_target: DisplayTarget,
    pub db_mapping: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DisplayTarget {
    /// 常驻于会话视口中（根据 UI 设计器自由排版，始终原地渲染最新数据）
    PersistentHUD,
    /// 当前轮次内联消息气泡流（如正文叙事、思维链）
    InlineMessage,
}
```

### 3.2 常驻于会话中机制（取决于定义时的行为与布局绑定）
常驻行为并非全局机械开关，而是**由创作者在定义 Schema 字段时的展示目标（`display_target`）与 UI 模板编辑器的布局绑定共同决定的固有行为**：
* **定义为 `InlineMessage` 的字段行为**：
  * 作为当轮消息气泡的内容呈现（如 `narrative` 叙事文本、`thinking` 推演过程）；
  * 随历史对话自然滚动，留存在当次消息流中。
* **定义为 `PersistentHUD` 的字段行为**：
  * **联动 UI 编辑器自由定位排版**：
    * 创作者在 UI 模板编辑器中，可将该字段自由绑定至常驻视口容器中（PC 侧边仪表盘 `RightDock`、顶部吸顶折叠栏 `TopSticky`、自由浮动画中画 `FloatingHUD`，或移动端吸顶抽屉 `TopHUD` 等）；
    * 自由配置组件尺寸（W/H）、多层容器嵌套（Panel, Tabs, Grid）与挂载 Shadow DOM 隔离的自定义 CSS 代码；
  * **始终原地显示最新数据（局部高频更新）**：
    * `stream_processor` 流式解析该 Schema 字段后，提取标记为 `PersistentHUD` 的数据，直接向常驻视口发射 `session:hud_state_patch` 增量补丁；
    * 常驻视口通过细粒度响应式 Signal 原地刷新，始终向玩家展示该字段的最新数值，气泡流中不再堆叠冗余的垃圾状态卡片。

### 3.3 单个 Schema 保留层数控制与倒序裁剪机制（Per-Schema Retention Depth）
针对特定 Schema，创作者可在当前 Schema 属性中独立配置历史保留层数，彻底解决传统模式长对话场景下的 Token 膨胀：
* **配置为不限制（`retention_depth: None`）**：
  * 当前 Schema 的所有历史结构化输出全量塞入 Prompt 上下文（或受限于模型全局 Token 预算）。
* **配置为指定层数（`retention_depth: Some(N)`，要求正整数 $N \ge 1$）**：
  * **解决核心痛点**：传统模式在 50+ 轮长对话中，若每轮都全量塞入包含完整状态的 Schema，会导致上下文长度爆炸、Token 严重浪费与注意力稀释；
  * **倒序滑动裁剪执行逻辑（Reverse Sliding Pruner）**：
    1. `prompt_compiler.rs` 在装配上下文历史消息时，逆序遍历当前 Schema 的历史输出记录；
    2. **倒数保留最新 $N$ 层**：从最新一轮历史开始向前倒数，严格**仅提取最近 $N$ 层的该 Schema 历史数据**编译进当前 Prompt；
    3. **过远层级直接丢弃（Hard Pruning）**：距离最新轮次超过 $N$ 层的更久远 Schema 历史记录，直接从上下文注入队列中彻底丢弃，绝不送入大模型输入；
  * **确定性状态连续性保障**：
    * 例如配置 $N = 1$ 时，大模型上下文永远只注入上一轮的基线状态 Schema，既能完成当前轮次的状态覆写计算，又彻底将该 Schema 的历史 Token 开销锁定在 $O(1)$ 常数界内；
    * 单个 Schema 独立生效：创作者可对即时状态 Schema 设 $N=1$，对重要任务线 Schema 设 $N=5$ 或不限制，策略灵活精确；
    * 非法输入防护：前端表单强制要求正整数（$N \in \mathbb{N}^+$），输入非整数或 $\le 0$ 时实时阻断提示，符合 C2 零静默回退要求。

### 3.4 物理顺序严格对齐编辑器
字段在生成的 JSON Schema `properties` 字典中的排列顺序、以及大模型流式输出与解析的顺序，**100% 严格依照该编辑器中的拖拽排序（上下移动）**，彻底消除原有蓝图图遍历导致的顺序不确定性与反转 Bug。

### 3.5 蓝图轻量按需调用：`InvokeSchema` 节点
蓝图画布中废除所有散落的 `SchemaField` 节点，收敛为单一的调用引脚：
* **节点类型**：`InvokeSchema`（`InvokeSchemaConfig { schema_id: String }`）；
* **按需激活机理**：
  * 仅当蓝图 DFS 执行流实际到达 `InvokeSchema` 节点时，执行器才读取指定 `schema_id` 的完整定义，并将其装配进本次编译的 `structured_output_schema`；
  * 若因前置分支判断未遍历到该节点，则**根本不激活任何 Schema**，彻底消除冗余开销；
  * 在 Agent 模式下，`InvokeSchema` 专门用于约束大模型最终正文回复的结构化规范（如 thinking, narrative 等）。

---

## 4. 全模式常驻响应式 UI 引擎与可视化 UI 模板编辑器 (Universal Persistent Reactive HUD & UI Designer)

构建**跨 STATELESS、LEGACY 与 Agent 全模式通用、常驻视口、自由布局、项目默认玄青色、多层容器、物理隔离的响应式 HUD**。

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
│ ├─ 通道 A [Agent 模式]: ToolCall 修改 DataContainer -> 增量发射 Patch            │
│ └─ 通道 B [STATELESS / LEGACY 模式]: 定义为 PersistentHUD 的字段 -> 原地提取 Patch│
└────────────────────────────────────────┬────────────────────────────────────────┘
                                          ▲
                          [SolidJS 宿主内的 Shadow DOM 沙箱]
                          (默认玄青色主题 + 自定义 CSS 样式代码绝对隔离)
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
1. **项目默认预设主题（Built-in Preset Theme）**：
   * **仅提供项目默认的「玄青色」主题（Default Xuanqing Theme）**：以沉稳克制的玄青深色为底板，配以精致的微暗青金属边线、柔和层级阴影与高可读性字体排版，作为全模式常驻 HUD 开箱即用的工业级默认外观。
2. **其他风格全量由自定义 CSS 代码定义（Custom CSS）**：
   * 系统不预设繁杂冗余的主题包，所有个性化视觉样式（如羊皮纸奇幻风、暗夜赛博风、水墨古风等）**完全由创作者通过设计器内置的代码编辑器编写自定义 CSS 实现**；
   * 创作者可自由编写原生 CSS 选择器覆盖任意容器与原子控件类名。
3. **C4 物理隔离与 Shadow DOM 沙箱（CSS Sandbox & Isolation）**：
   * **硬性隔离红线**：自定义 CSS 代码**绝对禁止直接注入 SolidJS 宿主全局 DOM**；
   * **技术落地基准**：常驻 HUD 模板容器强制挂载在 **`Shadow DOM`**（或独立 `iframe`）内部；
   * 自定义 CSS 规则仅在 Shadow Root 内部生效，物理阻断样式泄露，100% 保护 SolidJS 宿主界面、动画与主线程。

### 4.3 跨模式常驻 HUD 驱动链路对比
* **Agent 模式驱动链路**：
  * 大模型在思考过程中输出 `ToolCall: buy_item` $\rightarrow$ 蓝图 `Calculator` 变更内存 `DataContainer` $\rightarrow$ 后端即刻发射 `session:hud_state_patch` $\rightarrow$ 常驻 HUD 原地定向刷新对应组件；
  * **正文处理完毕后，模型按照 Schema 规范结构化输出最终叙事文本**（如 `thinking`、`narrative`），Schema 不再冗余复读业务背包数值；
* **STATELESS / LEGACY 模式驱动链路**：
  * 当 Schema 字段定义为 `PersistentHUD` 并配置了 UI 布局：`stream_processor` 流式解析 Schema 字段后，提取对应字段发射 `session:hud_state_patch` $\rightarrow$ 常驻 HUD 在用户于 UI 设计器设定的位置原地刷新最新数据；
  * 消息气泡仅呈现定义为 `InlineMessage`（`body: true`）的叙事文本，彻底消灭历史消息底部的堆叠垃圾卡片。

---

## 5. 蓝图高级跑团功能体系：ToolCall 与数据容器管理

在 Agent 模式下，蓝图作为**数据容器的规则与运算控制器**，负责管理业务数值与背包状态，与负责正文结构化输出的 Schema 清晰分工。

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
       回传大模型继续后续生成              实时驱动常驻 HUD 原地刷新 (第 4 节)
       (正文处理完毕后按 Schema 输出)
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
将运算器成功结果或门禁拦截信息封装为标准 `ToolResult` 回传大模型，强迫 Agent 基于客观事实继续推进，并在正文处理完毕后按 Schema 规范格式化输出。

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
    // 独立 Schema 调用节点 (用于传统模式状态覆写或 Agent 最终回复正文结构化规范)
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

#### (1) Agent 模式下：ToolCall 管理数据容器与正文 Schema 规范输出
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
│                                   [ToolReturn: "购买成功!"] ──> [回传大模型处理正文]                         │
│                                                                             │                                │
│                                                                             ▼                                │
│                                                        [InvokeSchema: narrative_output_schema]               │
│                                                        (规范最终输出 thinking 与 narrative 槽位)             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### (2) STATELESS / LEGACY 模式下：Schema 覆写流与常驻 HUD 挂载
```
[Start] ──> [ModeSwitch (out_stateless / out_legacy)]
                 │
                 ▼
         [InvokeSchema: status_summary_schema]
                 │ (按单个 Schema 保留层数注入历史 Schema，输出覆写原地刷新 HUD)
                 ▼
         [UILayoutConfig: 挂载 TopSticky 吸顶栏 (默认玄青色主题)]
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
2. **`prompt_compiler.rs` 上下文装配插槽**：
   * 针对每个调用的 Schema，读取其独立的 `retention_depth`（保留层数）；
   * 从最新层倒序保留 $N$ 层历史 Schema 数据，超出层级硬丢弃，控制单次 Prompt 预算。
3. **`stream_processor.rs` 双通道广播**：
   * 传统模式（`STATELESS` / `LEGACY`）：从模型输出中提取 `display_target: PersistentHUD` 的字段发射补丁，`InlineMessage` 字段送入气泡流；
   * Agent 模式：ToolCall 运算器执行成功修改 `DataContainer` 后发射补丁，正文生成完毕后按 Schema 规范格式化流式推送到气泡；
4. **SQLite 持久化无缝扩展**：
   * 新增 `preset_schemas` 表存储独立 Schema 定义（包含独立 `retention_depth` 与字段 `display_target`）；
   * 新增 `session_states` 表存储各会话最新的 `DataContainer`（`GameState`）JSON 快照。

### 8.2 极简代码改动插槽
1. **`models/blueprint.rs` & `blueprint_executor.rs`**：
   * 增加 `InvokeSchema`、`ToolDefinition`、`Calculator`、`ConditionGate`、`ToolReturn`、`UILayoutConfig` 节点反序列化与图执行逻辑；
2. **`stream_processor.rs` / `agent_runtime.rs`**：
   * 区分双轨制：Agent 模式通过 ToolCall 拦截并操作 `DataContainer`，终稿执行正文 Schema 结构化提取；传统模式执行 Schema 状态覆写提取；
3. **前端双端宿主插槽**：
   * PC：`ChatArea.tsx` 挂载 `PersistentHudContainer.tsx`（内嵌 Shadow DOM）；
   * Mobile：`MobileChatView.tsx` 挂载 `MobilePersistentHud.tsx`。

---

## 9. 用户侧体验、蓝图操作与调试全流程实操指南

### 9.1 创作者：双轨制预设搭建实操
1. **搭建传统 Schema 覆写型预设（适用 STATELESS / LEGACY）**：
   * 在预设详情页点击“结构化 Schema 管理”，新建或编辑 Schema；
   * **配置该 Schema 独立属性**：若需要限制历史深度，开启【限制保留层数】并输入正整数 $N$（如 `1` 或 `3`），系统将从最新层倒数保留 $N$ 层上下文，更早的历史直接丢弃，彻底消除长文本下的 Token 恶性膨胀；
   * 在表格中定义字段：将需要在视口常驻的数值字段（如 `hp`、`gold`）的展示目标设置为 `PersistentHUD`，将正文叙事设为 `InlineMessage`；
   * 在 UI 设计器中自由排布容器并绑定上述 `PersistentHUD` 字段；
   * 蓝图连接 `InvokeSchema` 节点，模型每轮自动在回复时填充覆盖，常驻 HUD 自动原地更新；
2. **搭建 Agent 数据容器型预设（适用 RPG 深度游戏）**：
   * 在蓝图定义 `ToolDefinition`（`check_inventory`, `buy_item`）与 `Calculator` 操作数据容器；
   * 视口所需数值直接绑定 `DataContainer` 变量（如 `stats.hp`）；
   * 在正文输出引脚连接 `InvokeSchema`（定义 `thinking`、`narrative` 规范回复格式）；
   * 模型通过 ToolCall 读写数据容器，正文处理完毕后按 Schema 规范格式化输出，HUD 毫秒级原地刷新联动。

### 9.2 创作者：UI 设计器自由布局与主题定制实操
1. **容器与尺寸排版**：
   * 在 UI 设计器画布中拖入 `PanelContainer`，自由调整尺寸与坐标；
   * 绑定 `DataContainer` 变量（`stats.hp`）或 Schema 字段（`schema.hp`）；
2. **主题与自定义 CSS**：
   * 默认应用项目工业级「玄青色」主题（沉稳暗色与高对比度边框）；
   * 如需其他风格（奇幻羊皮纸、赛博霓虹等），切换至“自定义 CSS”代码编辑器编写 CSS 规则；
   * 样式强制在 `Shadow DOM` 内隔离运行，宿主界面 100% 零受影响。

### 9.3 终端用户交互体验与调试排错
* **双轨制无缝体验**：无论进入哪种预设，玩家均享受统一的右侧/顶部常驻 HUD 体验；
* 打开 `[🐞 Agent 调试抽屉]`（`Ctrl+Shift+D`），时序泳道毫秒级回放 `ToolCall -> 数据容器修改 -> 门禁 -> HUD 补丁` 或 `Schema 流式解析 -> HUD 补丁` 全链路。

---

## 10. 实施落地步骤与验收标准

```
实施里程碑:
┌────────────────────────────────────────┐
│ Milestone 1: 独立 Schema 编辑器与调用  │ ──> 独立表单编辑器、单个Schema保留层数、InvokeSchema 节点
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 2: 数据容器与 ToolCall 引擎  │ ──> DataContainer 容器、ToolDefinition/Calculator/ConditionGate
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 3: 全模式常驻 HUD 与 UI 设计器│ ──> 自由布局/容器嵌套/默认玄青色/自定义CSS沙箱/双轨制数据源贯通
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
1. **Schema 系统定义行为与单 Schema 保留层数保真**：
   * **常驻行为驱动**：Schema 字段定义为 `PersistentHUD` 并挂载 UI 布局后，结构化数据流向常驻视口原地刷新，气泡流不产生任何垃圾状态卡片；
   * **单个 Schema 保留层数限制**：针对单个 Schema 独立生效，输入强制要求正整数 $N \ge 1$（非法输入即刻阻断），`prompt_compiler` 严格从最新层倒数保留 $N$ 层该 Schema 历史状态，超出的更远历史 100% 丢弃；
2. **状态管理双轨制严格隔离与规范输出**：
   * 传统模式（`STATELESS` / `LEGACY`）：每轮塞入（受该 Schema 保留层数控制的）历史 Schema，回复输出覆写 Schema 并驱动 HUD 原地刷新；
   * Agent 模式：通过 ToolCall 读写 `DataContainer`，**正文处理完毕后依然按照 Schema 规范进行结构化输出（如 thinking、narrative）**，业务背包数据无需在 Schema 中重新复读覆盖，Token 消耗大幅降低；
3. **UI 设计器自由度与物理隔离（C4 约束）**：
   * 创作者在 UI 设计器中调整容器与控件的坐标（X/Y）与尺寸（W/H）忠实呈现；
   * 项目内置默认「玄青色」主题，所有其他风格均通过自定义 CSS 代码在 Shadow DOM 内部隔离生效，绝不污染外层 SolidJS 宿主样式；
4. **常驻 UI 原地刷新与零尾随卡片**：
   * 无论双轨制哪条路径，常驻 HUD 均原地刷新，消息气泡流不追加任何冗余状态卡片；
5. **背包规则确定性执行**：
   * 金币不足与超重时 100% 触发阻断拦截，数据容器零篡改。

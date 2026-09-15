# Night Voyage 跑团 Agent 与游戏机制系统架构与实施规范

> **定位**: Night Voyage Agent 体系、RPG 规则/数值/背包机制、非节点式 Schema 架构与全模式常驻 UI 引擎核心技术规范与实施指南  
> **技术基准**: Tauri 2.0 + Rust 后端核心 + SolidJS 双端宿主（PC `src/` / 移动端 `src-mobile/`）  
> **核心规范**: [`AGENTS.md`](file:///d:/data/Night%20Voyage/AGENTS.md)（C1 前端纯渲染、C2 零静默回退、C3 响应性保护、C4 AI UI 隔离、C5 双端独立、C7 双端覆盖）

---

## 1. 架构总览：三态记忆基石与执行分流全景

Night Voyage 运行在三层清晰解耦的状态架构之上：底层是已有的**三态会话记忆基础设施**，中层是可自由插拔的**会话推进执行管线与独立资产（Schema / 蓝图）**，上层是普适所有模式的**常驻响应式 UI 表现层**。

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
                    │                                             │       ▼                       ▼                       ▼
                    │                                             │  [独立非节点 Schema]    [GameState 容器]       [InvokeSchema 节点]
                    │                                             │  (独立表单编辑器定义)   (纯内存纳秒级运算)     (蓝图仅做按需调用)
                    │                                             │       │                       │                       │
                    │                                             └───────┼───────────────────────┴───────────────────────┘
                    │                                                     │ (解析 Schema 字段)    │ (ToolCall 变更)
                    └─────────────────────────────────────────────────────┼───────────────────────┘
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

### 1.2 会话推进层与常驻 UI 的全模式贯通
* **Standard 标准单次推进（涵盖 STATELESS 与 LEGACY）**：
  * 直通现存 `stream_processor`，走由 `ModeSwitch` 决定的三态记忆流，原有文本生成管线 100% 保持不变；
  * **常驻 HUD 原地刷新全支持**：当挂载结构化 Schema 时，模型流式输出的结构化字段不再作为冗余卡片死板堆叠在单条消息底部，而是被即时提取并推送到**常驻 HUD 表现层**原地刷新，同样支持主题与 Shadow DOM 隔离的自定义 CSS 样式；
* **Agent 跑团游戏机制引擎**：
  * 在底层三态记忆的上下文之上，激活 Rust 内存调度器，承载**自定义 ToolCall 蓝图定义、背包与数值状态机、确定性运算器与规则门禁、独立 Schema 按需调用、常驻响应式 UI 数据驱动，以及多角色视界隔离调度**。

---

## 2. 状态容器与纯内存变量工作区（State Container & In-Memory Workspace）

系统在运行时维护结构化的游戏状态容器，与多智能体文本流转工作区正交解耦。

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

## 3. 结构化 Schema 体系重构：独立非节点式编辑器与蓝图按需调用

蓝图画布彻底告别散落堆砌的单字段节点，将 Schema 确立为预设内的**独立结构化资产（Dedicated Structured Schema Asset）**。

### 3.1 独立非节点式 Schema 编辑器（Non-Node Schema Editor）
创作者在预设配置界面或独立的 Schema 编辑模态框中直观维护数据结构，不再受图节点连线约束：
```
┌──────────────────────────── 独立 Schema 编辑器 (RPG 回合总结) ────────────────────────────┐
│ Schema ID: rpg_turn_summary       描述: 约束大模型每轮输出结构化数值变动与剧情总结          │
├──────┬─────────────────┬──────────┬──────────┬─────────────────┬─────────────────┬──────────────┤
│ 排序 │ 字段名 (Field)   │ 类型     │ 必填     │ 展示目标        │ 数据库映射       │ 说明         │
├──────┼─────────────────┼──────────┼──────────┼─────────────────┼─────────────────┼──────────────┤
│ ≡ 1  │ thinking        │ string   │ [✓] 必选 │ InlineMessage   │                 │ 隐藏推演思维 │
│ ≡ 2  │ narrative       │ string   │ [✓] 必选 │ InlineMessage   │                 │ 叙事正文主句 │
│ ≡ 3  │ hp_delta        │ number   │ [ ] 可选 │ PersistentHUD   │ world_variables │ 生命值变动量 │
│ ≡ 4  │ gold_delta      │ number   │ [ ] 可选 │ PersistentHUD   │ world_variables │ 金币变动量   │
│ ≡ 5  │ acquired_items  │ array    │ [ ] 可选 │ PersistentHUD   │ world_variables │ 新获道具清单 │
└──────┴─────────────────┴──────────┴──────────┴─────────────────┴─────────────────┴──────────────┘
```
* **展示目标（Display Target）定向分流**：
  * `PersistentHUD`（默认）：**推送到会话常驻视口某处（右侧/顶部/浮窗）**，消息流内不追加冗余卡片，保持对话气泡仅展示叙事文本；
  * `InlineMessage`：随单条消息气泡内联展示（如思维链 `thinking` 折叠卡）；
  * `Both`：常驻 HUD 与消息气泡两者均显示；
  * `Hidden`：仅持久化入库或作为上下文记忆，前台不渲染。
* **物理顺序严格对齐编辑器**：
  * 字段在生成的 JSON Schema `properties` 字典中的排列顺序、以及大模型流式输出与解析的顺序，**100% 严格依照该编辑器中的拖拽排序（上下移动）**，彻底消除原有蓝图图遍历导致的顺序不确定性与反转 Bug；
* **层级与类型支持**：
  * 支持基本类型（`string`, `number`, `integer`, `boolean`）；
  * 支持复杂嵌套对象（`object`，可展开子字段树）与数组（`array`，可配置元素 Schema）；
  * 配置项包含：必填（`required`）、上下文字段保留（`context_included`）、数据库列映射（`db_mapping`）与展示偏好（`display: default_expanded, hide_label, body`）。

### 3.2 蓝图轻量按需调用：`InvokeSchema` 节点
蓝图画布中废除所有散落的 `SchemaField` 节点，收敛为单一的调用引脚：
* **节点类型**：`InvokeSchema`（`InvokeSchemaConfig { schema_id: String }`）；
* **按需激活机理**：
  * 仅当蓝图 DFS 执行流实际到达 `InvokeSchema` 节点时，执行器才读取指定 `schema_id` 的完整定义，并将其装配进本次编译的 `structured_output_schema`；
  * 若因前置分支判断（如走入不带结构化输出的轻量闲聊分支），该节点未被遍历，则**根本不激活任何 Schema**，模型退回自由 Markdown 输出，彻底消除冗余开销；
* **向后兼容性保证**：
  * 对旧版蓝图 JSON（内含散落 `SchemaField` 节点），蓝图编译器在加载时执行自动化规范化（Normalization）：自动提取所有 `SchemaField` 节点打包为默认 Schema 资产，并用一个 `InvokeSchema` 节点替换，原有连线与执行逻辑 100% 无缝平移。

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
│ ├─ 通道 A [Agent 模式]: ToolCall -> Calculator -> GameState 状态机              │
│ └─ 通道 B [STATELESS / LEGACY 模式]: 流式 JSON 解析 -> PersistentHUD 标记字段提取 │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▲
                         [SolidJS 宿主内的 Shadow DOM 沙箱]
                         (预设主题 + 自定义 CSS 样式代码绝对隔离)
```

### 4.1 UI 设计器：自由布局、尺寸与多层容器组件 (Freeform Layout & Hierarchy)
创作者在设计器中对常驻面板进行直观的可视化拖拽、缩放与嵌套排布：
1. **容器层级系统（Container Hierarchy Tree）**：
   * **`RootCanvas`（根画布）**：
     * 配置视口尺寸、排版模式（`Absolute` 自由坐标拖拽 / `Flex` 弹性流式 / `Grid` 自适应网格）；
   * **`PanelContainer`（通用面板容器）**：
     * 属性面板中自由配置：坐标（`x, y`）、尺寸（`width, height`）、内边距（`padding`）、对齐、背景模糊（`backdrop-blur`）；
     * 支持多层子容器自由嵌套；
   * **`TabsContainer`（标签页容器）**：
     * 支持将复杂面板划分为“角色属性 | 背包道具 | 任务日志”多个子标签，点击在同一容器内切换；
   * **`GridContainer`（道具/状态网格容器）**：
     * 配置网格行列数、单元格固定像素尺寸（如 48×48px）与自适应间距。
2. **原子控件库（Interactive Widgets）**：
   * **`StatBar`（动态数值进度条）**：
     * 自由拉伸长宽（水平/垂直）；绑定数值与最大值（如 `stats.hp / stats.max_hp`，或 Schema 字段 `schema.hp / schema.max_hp`）；支持渐变色（健康绿 -> 濒死红）；
   * **`InventorySlotGrid`（背包网格控件）**：
     * 自动绑定物品列表；渲染图标、数量角标、品质框，支持点击弹出详情气泡；
   * **`DataLabel` / `Badge`（数据标签与徽标）**：
     * 绑定表达式展示金币、等级、当前地点、天气环境；
   * **`AvatarFrame`（形象/状态框）**：
     * 显示玩家头像与即时 Buff 图标。

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

### 4.3 STATELESS 与 LEGACY 模式下的常驻 Schema 与主题支持
常驻 HUD 不仅服务于 Agent 模式，更全面覆盖 **`STATELESS`（无状态感知）与 `LEGACY`（滑动窗口记忆）** 基础模式：
1. **执行与数据流转时序**：
   ```
   [用户在 STATELESS / LEGACY 模式下输入]
              │
              ▼
   [蓝图 InvokeSchema 装配 JSON Schema]
              │
              ▼
   [LLM 单次流式输出结构化 JSON]
              │
              ▼
   [Rust stream_processor 流式解析]
              │
              ├─ 1. 正文字段 (body: true) ──────────> 流式推送到当前消息气泡展示纯文本
              │
              └─ 2. 状态字段 (display_target: PersistentHUD)
                    │
                    ▼
              [提取字段: hp_delta, gold_delta, world_variables, etc.]
                    │
                    ▼
              [发射 session:hud_state_patch 增量事件]
                    │
                    ▼
              [前端常驻 HUD 接收事件] ──> 在 Shadow DOM 内部原地响应式刷新数值/状态
                                          (无视聊天记录滚动位置，永不追加垃圾卡片)
   ```
2. **主题与自定义 CSS 表现一致性**：
   * 在 `STATELESS` 或 `LEGACY` 模式下，常驻 HUD 同样激活创作者在 UI 设计器中选定的主题（如 `Dark Fantasy` 羊皮纸框）和自定义 CSS 样式；
   * 宿主界面保持清爽，消息流专注纯净文字叙事，侧边或顶部的常驻 HUD 则实时反应最新的世界变量与数值状态。

### 4.4 双端常驻挂载锚点规范
* **PC 端（`src/`）**：
  * `RightDock`：聊天区右侧固定仪表盘（宽 280~340px，支持宽屏多容器平铺）；
  * `TopSticky`：顶部吸顶折叠栏（高 48px，支持一键下拉展开全量看板）；
  * `FloatingHUD`：画中画悬浮窗（可自由拖拽位置与最小化）。
* **移动端（`src-mobile/`，C5 独立设计，零代码耦合）**：
  * `TopHUD`：标题栏下方吸顶精简条（高 36px，展示核心 HP/金币，点击触发全屏 Bottom Sheet 抽屉）；
  * `BottomSticky`：输入框上方微型状态条。

---

## 5. 蓝图高级跑团功能体系：ToolCall 定义、运算器与背包规则门禁

蓝图不仅是 Prompt 汇编器，更是**跑团规则图与游戏逻辑引擎**。

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

### 5.1 `ToolDefinition` 节点（自定义 ToolCall 契约定义）
* **节点配置参数**：`tool_name`、`description`、`parameters_schema`（JSON Schema）；
* **引脚**：输入引脚、`on_called`（触发下游分支）、`params_out`（导出实参数据流）。

### 5.2 `Calculator` 节点（确定性数值与背包运算器）
拒绝让大模型自由算数，所有数值与状态变更由 Rust 确定性执行：
1. **数值算术模式（Math Operation）**：
   * 支持表达式配置：`target_var = expr`；运算符：`+`、`-`、`*`、`/`、`%`、`min`、`max`、`clamp`；
2. **背包管理模式（Inventory Operation）**：
   * `add_item(id, name, count, unit_weight, unit_price)`：累加 count 或追加条目；
   * `remove_item(id, count)`：扣减数量，归零清除；
   * `recompute_weight()`：原子更新全局 `weight` 变量。

### 5.3 `ConditionGate` 节点（确定性规则判定与动作拦截门禁）
* **判定表达式**：金币校验（`gold >= cost`）、负重校验（`weight + add_w <= max_w`）、格子槽位校验（`inventory.len() < max_slots`）；
* **双出口分支**：
  * `pass`（放行）：流向真实变更运算器；
  * `blocked`（拦截）：完全阻断状态修改，流向错误回执。

### 5.4 `ToolReturn` 节点（结果装配与大模型恢复）
将运算器成功结果或门禁拦截信息封装为标准 `ToolResult` 回传大模型，强迫 Agent 基于客观事实继续推进对话。

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
    // 重构的 Schema 调用节点 (废弃散落的 SchemaField)
    InvokeSchema,
    // 高级 Agent 与游戏机制节点
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

### 7.2 实战连线拓扑（双模式常驻 HUD 挂载范例）

#### (1) Agent 模式下：背包购买、规则门禁与 HUD 原地刷新
```
[Start] ──> [Prompt: 基础世界观] ──> [UILayoutConfig: 挂载 RightDock 仪表盘]
                                            │
                                            ▼
                                   [InvokeSchema: rpg_turn_summary] ──> [Agent 推理]
                                                                             │
                                                                             ▼ 当 Agent 发起 buy_item ToolCall
┌────────────────────────────────────────────────────────────────────────────┴────────────────────────────────┐
│ 蓝图 ToolCall 处理拓扑                                                                                      │
│                                                                                                             │
│  [ToolDefinition: buy_item] ──> [Calculator: 预计算] ──> [ConditionGate: 检查金币] ──> [ConditionGate: 检查超重] │
│                                                                                               │             │
│                                              ┌────────────────────────────────────────────────┘             │
│                                              ▼ (放行)                                                       │
│                                  [Calculator: 扣除金币 / 道具入包] ──> [驱动常驻 HUD 原地刷新]               │
│                                              │                                                              │
│                                              ▼                                                              │
│                                  [ToolReturn: "购买成功!"] ──> [回传 Agent 闭环叙事]                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### (2) STATELESS / LEGACY 模式下：轻量常驻 HUD 与主题挂载
```
[Start] ──> [ModeSwitch (out_stateless / out_legacy)]
                 │
                 ▼
         [InvokeSchema: status_summary_schema]
                 │
                 ▼
         [UILayoutConfig: 挂载 TopSticky 吸顶栏 + Dark Fantasy 主题]
                 │
                 ▼
         [End: 提交执行 stream_processor 单次推理]
                 │
                 ▼
   (流式输出正文入气泡，状态字段自动流向常驻 HUD 原地刷新，零垃圾卡片堆叠)
```

---

## 8. 现有系统配合与代码改动点清单

### 8.1 零破坏配合机理
1. **三态记忆基石无缝兼容**：
   * 现有 `ModeSwitch` 节点输出端口（`out_stateless` / `out_legacy` / `out_mem0`）原样保留，作为上下文装配层的前置通道。
2. **`stream_processor.rs` 双通道广播**：
   * 在单次生成（`STATELESS` / `LEGACY`）与 Agent 模式下，统一在解析出标记为 `PersistentHUD` 的结构化字段时，发射 `session:hud_state_patch` 事件，驱动前端常驻面板刷新。
3. **SQLite 持久化无缝扩展**：
   * 新增 `preset_schemas` 表存储独立 Schema 定义；
   * 新增 `session_states` 表存储各会话最新的 `GameState` JSON 快照。

### 8.2 极简代码改动插槽
1. **`models/blueprint.rs` & `blueprint_executor.rs`**：
   * 增加 `InvokeSchema`、`ToolDefinition`、`Calculator`、`ConditionGate`、`ToolReturn`、`UILayoutConfig` 节点反序列化与图执行逻辑；
2. **`stream_processor.rs` / `agent_runtime.rs`**：
   * 拦截模型 `tool_calls` 或结构化字段，发射 HUD 补丁，组装 `ToolResult` 恢复流；
3. **前端双端宿主插槽**：
   * PC：`ChatArea.tsx` 挂载 `PersistentHudContainer.tsx`（内嵌 Shadow DOM）；
   * Mobile：`MobileChatView.tsx` 挂载 `MobilePersistentHud.tsx`。

---

## 9. 用户侧体验、蓝图操作与调试全流程实操指南

### 9.1 创作者：独立 Schema 编辑器实操
1. 在预设详情页点击“结构化 Schema 管理”，新建或选择 `rpg_turn_summary`；
2. 在表格中点击“添加字段”，将 `narrative` 设为 `InlineMessage`，将 `hp`、`gold`、`inventory` 设为 `PersistentHUD`；
3. 保存后，在蓝图画布中仅需拖入一个 `InvokeSchema` 节点并下拉选中该 Schema 即可完成绑定。

### 9.2 创作者：UI 设计器自由布局与主题定制实操
1. **容器与尺寸排版**：
   * 在 UI 设计器画布中拖入 `PanelContainer`，拖拽控制把手调整尺寸为 300×450px，位置吸附右侧（PC `RightDock`）；
   * 在容器内拖入 `StatBar`（拉伸宽度为 100%）并数据绑定 `hp`；
   * 拖入 `InventorySlotGrid`，在右侧属性板设置 $4 \times 4$ 网格；
2. **主题与自定义 CSS**：
   * 在主题下拉菜单选择 `Dark Fantasy`，界面自动应用羊皮纸与暗金色调；
   * 切换至“Custom CSS”代码编辑器，输入 `.stat-bar { box-shadow: 0 0 10px rgba(255,0,0,0.5); }`，点击“实时预览”，Shadow DOM 内部即时热重载生效，宿主界面零受影响。

### 9.3 终端用户交互体验与调试排错
* **跨模式体验统一**：玩家无论在 `STATELESS`、`LEGACY` 还是 Agent 模式下聊天，右侧/顶部常驻 HUD 始终如一展示最新状态；
* 打开 `[🐞 Agent 调试抽屉]`（`Ctrl+Shift+D`），时序泳道毫秒级回放 `ToolCall -> 运算器 -> 门禁 -> HUD 补丁` 全链路。

---

## 10. 实施落地步骤与验收标准

```
实施里程碑:
┌────────────────────────────────────────┐
│ Milestone 1: 独立 Schema 编辑器与调用  │ ──> 独立表单编辑器、拖拽排序对齐、InvokeSchema 节点
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 2: 游戏状态机与运算门禁引擎  │ ──> GameState 容器、ToolDefinition/Calculator/ConditionGate
└──────────────────┬─────────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ Milestone 3: 全模式常驻 HUD 与 UI 设计器│ ──> 自由布局/容器嵌套/主题切换/STATELESS/LEGACY 贯通
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
1. **跨模式常驻 UI 原地刷新与零尾随卡片**：
   * 在 `STATELESS` 或 `LEGACY` 模式下，大模型输出的结构化字段 100% 流向常驻 HUD 原地刷新，**消息气泡流不追加任何冗余卡片**；
   * 滚动浏览历史消息时，常驻 HUD 牢固停靠在当前视口，状态始终与当前会话最新数值严格一致；
2. **UI 设计器自由度与物理隔离（C4 约束）**：
   * 创作者在 UI 设计器中调整容器与控件的坐标（X/Y）与尺寸（W/H）能准确保存并在会话中忠实呈现；
   * 自定义 CSS 代码与主题在 `STATELESS`、`LEGACY` 及 Agent 模式下均在 Shadow DOM 内部隔离生效，绝不污染外层 SolidJS 宿主样式；
3. **Schema 独立性与排序绝对对齐**：
   * 蓝图画布中仅有一个 `InvokeSchema` 节点，模型输出 JSON 的字段排列顺序 100% 严格依照 Schema 编辑器中的物理行排序；
4. **背包规则与三态记忆兼容性**：
   * 金币不足与超重时 100% 触发阻断拦截；在 `STATELESS`、`LEGACY`、`MEM0` 模式下均正常稳定运行。

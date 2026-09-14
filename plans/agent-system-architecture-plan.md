# Night Voyage 跑团 Agent 系统架构与实施规范

> **定位**: Night Voyage Agent 体系核心技术规范与实施指南  
> **技术基准**: Tauri 2.0 + Rust 后端核心 + SolidJS 双端宿主（PC `src/` / 移动端 `src-mobile/`）  
> **核心规范**: [`AGENTS.md`](file:///d:/data/Night%20Voyage/AGENTS.md)（C1 前端纯渲染、C2 零静默回退、C3 响应性保护、C4 AI UI 隔离、C5 双端独立、C7 双端覆盖）

---

## 1. 架构总览与三态会话分流

Night Voyage 坚持模式解耦原则，杜绝无节制的多代理开销，系统支持三套正交的会话推进模式：

```
玩家输入 ──> [预设蓝图 Router]
                 │
                 ├─ 0. Classic 传统模式 (默认) ──> [现存 stream_processor 单次生成]
                 │                                 (0 额外 Token, 0 额外延迟, 0 状态机开销)
                 │
                 ├─ 1. Director-Actor 导演模式 ──> [Rust 内存变量流 + 视界裁剪 + 演员委派 + 槽位拼装]
                 │                                 (消灭全知视角, 解决角色扮演代入感)
                 │
                 └─ 2. Scriptwriter 剧本模式  ──> [Rust 内存变量流 + 草稿/审阅/润色 Handoff 接力]
                                                   (长篇高质量文学创作, 消除设定漂移)
```

### 1.1 模式特性与风控红线
* **Classic 传统模式**：单次 Prompt 编译直通 LLM，可选挂载 Mem0 向量记忆或滑动窗口，原有调用链 100% 保持不变。
* **Token 组合风控红字警告**：当检测到用户开启 `Director` 或 `Scriptwriter` 模式，且叠加挂载长程向量记忆时，前端界面强制展示醒目红字警告，保障按次计费用户的知情权。

---

## 2. 纯内存变量工作区（In-Memory Variable Workspace）

系统在运行时为每个 Agent 回合分配独立的纯内存文本变量容器，消除磁盘 I/O 延迟与移动端文件权限隐患。

### 2.1 运行时机理
* **内存字典映射**：Rust 调度器在内存堆维护线程安全的 `HashMap<String, String>`，将大模型认知的虚拟文本文件（如 `draft`、`output`）映射为内存字符串键值对。
* **工具交互接口**：向 LLM 暴露标准化操作工具（`read_text`, `write_text`, `patch_text`, `list_keys`），模型输出工具调用时，Rust 拦截并直接在内存哈希表执行存取，耗时 $< 0.1$ms。
* **零磁盘与单次持久化**：
  * 中间过程（草稿、批注、修订）仅在内存中流转，不向磁盘写入任何临时文件；
  * 仅当前台 Agent 确认定稿并调用 `commit` 时，系统将最终成稿一次性写入 SQLite `messages` 表；
  * 回合结束，整个内存变量容器随生命周期销毁释放（Drop），无硬盘碎片残留，对 Android 移动端权限绝对友好。

---

## 3. 核心 Agent 模式执行时序与业务逻辑

### 3.1 模式 A：导演-演员模式（Director-Actor / Return-mode Subagent）

#### (1) 业务目标
消灭 NPC “全知视角”，确保场景中登场的角色仅拥有其个人视野与局部记忆，杜绝信息泄露与出戏。

#### (2) 完整执行时序与逻辑

```
[玩家输入] 
   │
   ▼
1. 导演 Agent (Director) 启动:
   - 全局视野: 读取世界大纲、全量设定集、长程剧情事实。
   - 规则判定: 评估玩家行为是否触发技能挑战，发起确定性 D20 骰点工具调用。
   - 裁定出场角色: 识别需要特定 NPC（如酒馆老板）做出即时反应。
   - 视界裁剪 (Context Pruning): 
     在全量世界书中仅剥离出该 NPC 的角色设定（性格、口癖、秘密），严禁将全局主线透露给演员。
   - 委派任务: 调用 agent.delegate(target: "tavern_owner", instruction: "你惧怕黑帮，撒谎敷衍；玩家说了: [...]")。
   │
   ▼
2. 调度器拦截并激活演员 Subagent (Actor):
   - 上下文装配: 调度器为演员生成极窄上下文（仅包含该角色卡 + 导演即时小纸条 + 玩家当前句子）。
   - 权限硬限制: 演员被赋予 exit_policy = TaskReturnRequired，剥夺 commit 提交权，仅允许使用 task_return。
   - 防自抄袭机制: 演员物理上拿不到前序长篇大纲与草稿，仅基于局部信息输出台词与微表情，天然免疫自抄袭。
   - 提交成果: 演员输出台词并调用 task_return { text: "‘客官，我只是开酒馆的，什么都不知道！’" }。
   │
   ▼
3. 导演收拢与结构化槽位拼装 (Slot Assembly):
   - 调度器将演员的输出作为 ToolResult 回传给导演。
   - 导演端停用涂黑算法，按结构化槽位拼装定稿:
     * 槽位 A (开场环境描写): 撰写酒馆环境与入场氛围；
     * 槽位 B (嵌入演员台词): 原样织入演员交回的台词与微表情；
     * 槽位 C (剧情推进行动): 紧接台词描写老板手抖擦杯子、急忙避开视线。
   - 导演调用 commit 完成终稿提交。
```

---

### 3.2 模式 B：剧本流水线模式（Scriptwriter / Handoff 接力模式）

#### (1) 业务目标
实现长篇小说级文学精修，通过多角色接力打磨，消除单次生成的设定漂移、情绪突兀与文风机械感。

#### (2) 完整执行时序与逻辑

```
[玩家行动] 
   │
   ▼
1. 初稿写手 (Drafter):
   - 根据大纲与情境快速构建情节发展与对话初稿。
   - 调用 write_text { key: "draft", content: "..." } 将初稿写入内存变量区。
   - 调用 agent.handoff { target: "critic", task: "审查人设连贯性、设定冲突与文风机械度" }。
   │
   ▼
2. 调度器交接与审阅者 (Critic) 启动:
   - 调度器将 Drafter 标记为 Transferred，无缝移交同一内存工作区。
   - Critic 从内存读取 key="draft"，对照世界观与角色档案进行一致性检查。
   - Critic 输出修改批注并写入内存: write_text { key: "critique", content: "..." }。
   - 调用 agent.handoff { target: "refiner", task: "结合批注实施终稿润色" }。
   │
   ▼
3. 终稿润色者 (Refiner) 与 Layer 1 涂黑防抄袭机制:
   - 涂黑算法生效机理:
     大模型在带全量长旧稿润色时极易逐字复读旧文。调度器在为 Refiner 组装输入时，
     将前序无需修改的稳定段落替换为 [前文背景已锁定]，仅保留最后 50 字尾锚用于上下文衔接。
   - Refiner 聚焦于针对批注的增量修改与后续续写，将成稿写入内存 key="final"。
   - Refiner 调用 commit { source_key: "final" } 发布终稿。
```

---

## 4. 跑团与文学质量确定性门禁引擎（Gate Engine）

所有质量与规则门禁均在 Rust 核心层通过确定性算法与循环拦截执行，严禁交由大模型自由发挥。

### 4.1 确定性 D20 骰点检定算法
* **触发方式**：Agent 发起 `ToolCall: dice_roll { kind: "d20", dc: 15, modifier: 3 }`。
* **执行机理**：
  1. Rust 底层调用密码学安全随机数发生器（CSPRNG）生成 $1 \sim 20$ 整数；
  2. 计算检定总值：`total = roll + modifier`；
  3. 比对目标难度（DC），计算确定性布尔值 `success = total >= dc`；
  4. 结构化结果回传大模型，强迫后续剧情必须依照客观结果发展；
  5. 同步向前端发射事件，绘制不可篡改的公开掷骰卡片。

### 4.2 确定性禁词毫秒级拦截与自动打回自纠（Banned Words Auto-Critic）
* **触发方式**：Agent 发起 `ToolCall: commit` 尝试发布正文时，调度器在实际写入数据库前挂起操作。
* **执行机理**：

```
LLM 发出 commit 请求
        │
        ▼
Rust 内存扫描 (Aho-Corasick 多模式串并发匹配，耗时 < 0.5ms)
        │
        ├─ [未命中禁词] ──> 放行写入 SQLite，流式推送前端，回合闭环。
        │
        └─ [命中禁词列表: 如 "深吸了一口气", "不可否认", "嘴角勾起微笑"]
                │
                ▼
           阻断本次 Commit!
                │
                ├─ 1. 检查重试计数: 当前 retry_count 是否 >= 2 (硬上限)
                │     - 若已超上限: 告警放行或记录审计日志，防止无限死循环耗费 Token。
                │
                └─ 2. 若未超上限:
                      - 暂存当前内存草稿；
                      - 向当前 Agent 注入合成的高优先级 Critic Nudge 提示:
                        "【门禁退回】文本中检测到禁用套话或违规词：['深吸了一口气', '不可否认']。
                         当前提交已被退回。请在保留剧情因果的前提下，
                         重构相关句式并彻底清除上述词汇，重新提交。"
                      - 驱动 Agent 进入下一轮自纠重写循环。
```

---

## 5. 预设蓝图（Preset Blueprint）编译与路由架构

蓝图坚守 **“执行分流器与 Prompt 汇编器（Router & Compiler）”** 定位，拒绝演化为带有数学运算或逻辑表达式的可视化编程语言。

### 5.1 节点扩展：`AgentModeSwitch` 节点
在 `src-tauri/src/models/blueprint.rs` 的 `NodeConfig` 中新增变体：
* **节点引脚**：
  * 输入引脚：接收上游流程（来自 `Start` 或前置判定节点）；
  * 输出引脚：
    * `out_classic`（传统单次生成分支，连接通用 Prompt 合并节点）；
    * `out_director`（导演模式分支，连接导演大纲与演员定义节点）；
    * `out_scriptwriter`（剧本模式分支，连接写手与审阅提示词节点）。
* **遍历裁定**：蓝图执行器在 DFS 遍历时，读取当前请求的 `context.session_mode`，直接命中对应引脚继续遍历，未选中的分支天然被死代码修剪（Dead Code Elimination）。

### 5.2 属性表单参数注入
创作者在蓝图节点属性面板中以表单形式配置控制参数：
1. **禁词列表（Banned Words）**：直接配置字符串数组，编译期提取注入 Rust `AhoCorasick` 匹配器；
2. **D20 规则与 DC 默认值**：配置检定开启状态与默认难度；
3. **Redaction 涂黑开关**：在剧本润色节点上勾选生效。

---

## 6. 现有系统配合与代码改动点清单

### 6.1 零破坏配合机理
1. **Prompt 编译器**：Agent 各轮次调用模型前，基础 System Prompt 与角色档案依然直接调用现有的 `prompt_compiler::compile_prompt`，100% 保持宏替换与世界书检索机制不变。
2. **Mem0 / Letta 记忆**：根 Agent 初始化时调用现有的 `MemoryService` 挂载全局记忆；委派给 NPC 演员时由调度器实施视界过滤。
3. **结构化输出（Structured Output）与悬浮窗**：
   * 运行中的草稿与批注在内存变量容器内自闭环；
   * 最终定稿提交的消息依然通过现有的 JSON Schema 吐出状态更新与剧情总结；
   * 悬浮窗/HUD 监听数据库变更与 EventBus 驱动纯渲染，与 Agent 工具调用协议零冲突。

### 6.2 极简代码改动点（仅 2 处插槽）
1. **`stream_processor.rs` / `chat_service.rs` 入口**：
   * 增加会话模式判断：
     * 若为 `Classic`：调用既有的 `stream_chat_direct`（原路径完全不变）；
     * 若为 `Director` / `Scriptwriter`：转交 `AgentRuntimeService` 执行对应调度循环。
2. **`models/chat.rs` 与 SQLite `messages` 表**：
   * 增加 `agent_run_id TEXT NULL` 字段，仅用于前端点击特定历史消息时，回放该回合的内存演进时间线。

---

## 7. 用户侧体验、蓝图操作与调试全流程实操指南

### 7.1 终端用户操作与界面感知流 (User Experience & Interaction)

#### (1) 会话创建与模式选择
* **新建会话入口**（PC `NewChatModal.tsx` / 移动端 `src-mobile/components/NewChatModal.tsx`）：
  * 在角色卡与预设选择面板下方，新增 **“推进模式（Agent Mode）”** 切换分段器：
    * `[传统模式 (Classic)]`：默认单次生成，极速、低 Token 消耗；
    * `[导演模式 (Director)]`：强化 NPC 独立视角与跑团真实感；
    * `[剧本模式 (Scriptwriter)]`：强化长篇小说精修与多轮打磨。
  * **Token 组合风控红字警告**：若用户选择了“导演模式”或“剧本模式”，且预设中启用了长程向量记忆（Mem0），界面即时高亮展示醒目红字警告：
    > ⚠️ 当前模式将产生多次子代理交互与多轮润色推理，每回合 Token 消耗约为传统模式的 2~4 倍，请按需使用。
* **输入态与运行态动态感知**：
  * 当用户在输入框（`ChatInputBar.tsx`）发送指令后，输入框进入提交锁定期，正文气泡显示 **Agent 实时状态条（Agent Status Bar）**：
    * 状态 A：`🎲 正在进行力量检定 (DC 15)...`（D20 骰点中）
    * 状态 B：`🎭 导演正在调度演员【酒馆老板】进行视角推演...`（Subagent 演员执行中）
    * 状态 C：`✍️ 初稿已生成，审阅者正在核查人设一致性...`（Handoff 流转中）
    * 状态 D：`🛡️ 检测到禁用词汇，正在触发自纠润色 (第 1/2 次)...`（Aho-Corasick Nudge 自纠中）
  * 状态流转均通过 Tauri 后端轻量事件（`agent:status_update`）驱动双端前端纯渲染（C1 约束），不阻塞主界面。

---

### 7.2 蓝图实操使用流：如何通过蓝图构建 Agent 工作流 (Blueprint Authoring Workflow)

蓝图作为“分流路由与 Prompt 汇编器”，创作者可通过节点拓扑自由编排 Agent 的流转规则与角色视界。

#### (1) 新增节点库规格
1. **`AgentModeSwitch` 节点**：
   * **输入引脚**：`flow_in`（接收前置 Start 节点或通用前置处理）。
   * **输出引脚**：
     * `out_classic`：连接传统模式的 Prompt 组装线；
     * `out_director`：连接导演配置节点（`DirectorConfig`）；
     * `out_scriptwriter`：连接流水线写手配置节点（`ScriptwriterPipeline`）。
2. **`DirectorConfig` 节点**：
   * 表单参数：导演大纲提示词模板、最大委派演员上限（默认 3）、是否启用 D20 检定规则。
   * 引脚：`actors_in`（连接多个 `ActorDefinition` 节点）。
3. **`ActorDefinition` 节点**：
   * 表单参数：角色绑定 ID（如 `tavern_owner`）、角色局部设定卡、视界裁剪隔离等级（Strict / Normal）。
4. **`ScriptwriterPipeline` 节点**：
   * 表单参数：
     * `critic_rules`：审阅维度配置（人设/情节/违禁词/行文节奏）；
     * `enable_redaction`：布尔开关，是否对 Refiner 开启锚点涂黑防复读；
     * `max_handoff_turns`：流水线流转上限（默认 3 轮）。
5. **`BannedWordsConfig` 节点（或全局挂载属性）**：
   * 表单参数：禁词文本列表（换行分隔，支持导入 `.txt` 词库）、违规重试上限（默认 2 次）。

#### (2) 蓝图连线搭建实战拓扑（以跑团酒馆场景为例）

```
[Start 节点]
      │
      ▼
[AgentModeSwitch 节点]
      │
      ├─ (引脚 1: out_classic) ───────────────────────────> [Classic SystemPrompt 合并] ──> [End 节点]
      │
      ├─ (引脚 2: out_director) 
      │       │
      │       ▼
      │   [Director 节点: 配置世界线与大纲]
      │       │
      │       ├── (引脚: actor_slots) ──> [Actor 节点: 酒馆老板 (只知后厨秘密)]
      │       ├── (引脚: actor_slots) ──> [Actor 节点: 赏金猎人 (只知悬赏目标)]
      │       └── (引脚: rules) ───────> [D20 Rule: 力量/交涉检定]
      │                                   │
      │                                   └───> [Slot Assembly 槽位拼装] ────────────> [End 节点]
      │
      └─ (引脚 3: out_scriptwriter)
              │
              ▼
          [Drafter 初稿节点: 快速起承转合]
              │ (Handoff 连线)
              ▼
          [Critic 审阅节点: 人设/情节审查]
              │ (Handoff 连线)
              ▼
          [Refiner 润色节点: 开启涂黑防抄袭]
              │
              └───> [Banned Words 门禁过滤] ──────────────────────────────────────────> [End 节点]
```

#### (3) 蓝图编译预览实操 (Blueprint Compile Preview)
创作者在蓝图编辑界面点击 **“编译预览（Compile Preview）”**：
1. **模式选择器**：弹窗顶部下拉框可实时切换 `Classic` / `Director` / `Scriptwriter`；
2. **分段编译输出展示**：
   * `Classic` 预览：直接展示单段合流后的 System Prompt 与 Macro 替换结果；
   * `Director` 预览：树状展示 `[Director System Prompt]`、`[Actor: tavern_owner Pruned Prompt]`、`[Slot Template]`；
   * `Scriptwriter` 预览：按时序展示 `[Step 1: Drafter Prompt]`、`[Step 2: Critic Prompt]`、`[Step 3: Refiner Prompt (含涂黑锚点占位)]`；
3. **死分支提示**：预览界面会将当前未选中的分支灰度弱化，直观呈现 DFS 死代码消除效果。

---

### 7.3 调试与全链路观测体系 (Debugging & Observability for Creators)

为保证创作者与极客用户能清晰定位 Agent 运行过程中的决策偏差，系统在双端提供纯渲染的 **Agent 调试与观测抽屉（Agent Dev Inspector）**。

#### (1) 调试面板唤起与双端布局
* **PC 端**：点击聊天主界面右上角的 `[🐞 Agent 调试]` 图标，从右侧滑出半透明抽屉（支持热键 `Ctrl+Shift+D` 切换）；
* **移动端**：点击标题栏右侧操作菜单中的 `[调试面板]`，以底部浮层抽屉（Bottom Sheet）呈现；
* **前端纯渲染保障**：调试面板只监听 Tauri 后端广播的 `agent:trace_event` 事件，绝不拉取庞大持久化记录，零主线程卡顿。

#### (2) 核心调试组件与观测维度
1. **时序执行泳道（Execution Timeline）**：
   * 采用时间线节点直观展示当前回合的生命周期：
     * `[00.00s] Director Started`
     * `[00.85s] ToolCall: dice_roll { kind: "d20", dc: 15 } -> Result: 17 (Success)`
     * `[01.20s] ToolCall: delegate(target: "tavern_owner") -> Subagent Spawned`
     * `[02.40s] Actor Finished -> TaskReturn { text: "..." } (Pruned Context: 350 tokens)`
     * `[03.10s] Commit Requested -> Aho-Corasick Scan Passed (0.2ms)`
     * `[03.15s] Message Committed to DB`
2. **纯内存变量查看器（InMemory Workspace Inspector）**：
   * 创作者可实时点击查看当前回合内存哈希表中的所有虚拟键值：
     * `key: "draft"`：初稿全文（带行号高亮）；
     * `key: "critique"`：审阅批注建议；
     * `key: "final"`：润色成稿；
   * 提供差异比对视图（Diff View），直观比对草稿与润色稿的改动。
3. **禁词拦截与自纠日志回放（Banned Word Nudge Inspector）**：
   * 当触发禁词拦截时，调试面板高亮显示黄色警示卡片：
     * 标红指出命中的违规词列表及所在上下文位置；
     * 展示后台自动注入大模型的 Critic Nudge 提示词原文；
     * 展示第 1 次与第 2 次重写生成的文本变化，以及重写耗时。
4. **单步调试与异常人工干预（Step-by-Step & Manual Intervention）**：
   * **单步断点模式（Pause between Steps）**：在预设调试设置中勾选“开启单步确认”，Agent 在每次 Handoff 接力或演员委派前自动暂停，等待创作者点击 `[继续下一步]`；
   * **超限熔断干预**：当禁词重试超过 2 次上限时，界面弹出应急干预对话框，提供两个安全选项：
     * `[一键清除禁词并放行]`：调度器自动通过正则替换将禁词替换为同义词或通配符后强制 Commit；
     * `[直接采纳当前版本]`：以当前最新稿件入库，跳过本次门禁。

---

## 8. 实施落地步骤与验收标准

```
实施里程碑:
┌───────────────────────────────┐
│ Milestone 1: 内存变量工作区   │ ──> 验证内存键值读写、虚拟工具映射、0 磁盘 I/O
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│ Milestone 2: 确定性门禁引擎   │ ──> 验证 Aho-Corasick 禁词拦截、自纠 Nudge 循环、确定性 D20
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│ Milestone 3: 双模式调度流转   │ ──> 验证导演视界裁剪/槽位拼装、剧本 Handoff 接力/局部涂黑
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│ Milestone 4: 蓝图节点与双端   │ ──> 验证 AgentModeSwitch 分流、参数注入、PC/Mobile 纯渲染抽屉
└───────────────────────────────┘
```

### 验收指标：
1. **纯内存无残留验证**：执行包含多次工具交互与演员委派的长回合后，检查本地磁盘与 `D:\software_cache`，确认**没有任何过程碎文件生成**；
2. **场景表现验证**：
   * 导演模式下，验证演员准确理解玩家当前台词，无因信息涂黑造成的语境丢失；
   * 剧本模式下，验证润色模型在处理长草稿时，受涂黑锚点约束不再逐字复读旧文；
3. **禁词硬拦截验证**：在模型输出中诱导出现禁词时，确认系统在 Commit 前精准拦截并触发自动改写，最终入库文本 100% 消除该禁词；
4. **前台与调试链路闭环验证**：
   * 验证 `NewChatModal` 模式切换与 Token 风控红字提示正常运作；
   * 验证蓝图编辑器中 `AgentModeSwitch` 节点的连线保存与编译预览准确输出对应分支结果；
   * 验证 PC 端与移动端调试面板能完整回放运行时间线、内存变量及禁词 Nudge 记录。


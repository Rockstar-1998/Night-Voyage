AI:The user wants me to read the plan file first to update my understanding, then discuss the three-layer overlap issue without modifying code. Let me read the plan file.

信息已更新。现在我理解了当前架构：MEM0 已作为独立模式与 stateless 互斥，不再是"叠加层"。

但你提到的"省钱方案（stateless）应该同一轮内写剧情总结 + 世界变量更新"——这与当前 plan 的 stateless 架构图有出入。让我确认一下代码实际行为。
好的，我现在更新了信息。计划已经实施了——MEM0 已经作为全权接管动态记忆层的模式存在了。让我整理一下当前的真实状态：

1. **memory_mode 字段**：已替代 `plot_summary_mode` + `mem0_enabled`
2. **两种模式**：
   - `stateless`（默认，省钱方案）：PresetRule + CharacterBase + PlayerBase + WorldBookMatch + RecentHistory(全量) + CurrentUser
   - `mem0`（记忆质量优先）：PresetRule + CharacterBase + PlayerBase + WorldBookMatch + RetrievedDetail(多策略查询) + CurrentUser，无 PlotSummary/CharacterStateOverlay/RecentHistory
3. **写入侧**：
   - stateless：stream 完成后 spawn plot_summary + character_state_overlay 生成任务（同一轮内，无额外费用）
   - mem0：stream 完成后仅 spawn memory_extraction_task

但是用户的问题还没完——用户说要讨论「三层重叠区」的问题，防止 SQLite 反复修改。但是现在计划已经把三层重叠问题解决了——通过互斥模式（stateless vs mem0）的方式。

但用户说"你先记着，不要修改代码，我们需要把三层重叠区的问题定下来"——这说明用户认为还有遗留问题需要讨论。然后用户又说"请先更新一下你的信息，你的信息已经过时了"。

所以用户的意思是：
1. 我之前回答的 MEM0 与 PlotSummary/RecentHistory 冲突的分析已经过时了
2. 现在的方案是 MEM0 作为独立模式，与 stateless 互斥
3. 用户提到的"三层重叠区"——在 stateless 模式下也存在吗？让我重新审视

重新看 plan 中的架构图：
- stateless 模式：PresetRule + CharacterBase + PlayerBase + WorldBookMatch + **RecentHistory (全量)** + CurrentUser
  - 没有 PlotSummary 和 CharacterStateOverlay！
- mem0 模式：PresetRule + CharacterBase + PlayerBase + WorldBookMatch + RetrievedDetail + CurrentUser
  - 没有 RecentHistory、PlotSummary、CharacterStateOverlay

等等，stateless 模式说"纯多轮对话，无任何记忆/总结"——但 plan 中 Task 4 的 stream_processor 逻辑是：
- mem0_active → 仅 spawn memory_extraction_task
- 否则 → 如果 plot_summary_enabled → spawn plot_summary + character_state_overlay

但 plot_summary_mode 已经被删除了！Task 6.5 中说删除或转发。而 plan 末尾的修改清单里说 `plot_summaries.rs — load_plot_summary_mode 改为从 memory_mode 推导`——这意味着 stateless 模式下 plot_summary_enabled 会返回什么？

根据 plan 中 stateless 模式的架构图，stateless 模式应该没有 PlotSummary 层。所以 `load_plot_summary_mode` 在 stateless 下应该返回 disabled。

但用户在前一条消息中说：
"原有的几个层作为省钱方案存在，具体效果是同一轮对话中，正文编写完毕后写剧情总结，且提供世界变量更新指令，从而达到无额外轮次对话产生的费用"

这说明用户的心智模型中，stateless 模式（"省钱方案"）应该**仍然包含** PlotSummary 和 CharacterStateOverlay（WorldVariable）！但当前 plan 的架构图中 stateless 模式只有 RecentHistory 全量，没有 PlotSummary。

这就是用户说的"三层重叠区问题"——当前 plan 中 stateless 模式的设计可能与用户预期不符。

让我重新理解用户的意图：
- 用户认为省钱方案（stateless）应该：正文编写完毕后写剧情总结 + 世界变量更新指令，无额外轮次费用
- 也就是说，stateless 模式应该有 PlotSummary + WorldVariable，通过复用正文生成的 LLM 调用来更新这些层
- 而 RecentHistory 应该配合这两层（只保留未总结的部分）

但当前 plan 的 stateless 模式只有 RecentHistory 全量——这与用户描述不符。

等等，让我再仔细读一下 plan 的架构图：
```
无状态模式 (memory_mode = 'stateless'):
  PresetRule + CharacterBase + PlayerBase + WorldBookMatch
  + RecentHistory (全量) + CurrentUser
```

这里说 RecentHistory 是"全量"。而 stream 完成后会有 plot_summary + character_state_overlay 生成任务（如果 plot_summary_enabled）。

但 plot_summary_mode 字段已经删除了，load_plot_summary_mode 现在从 memory_mode 推导。如果推导逻辑是"stateless → disabled"，那 stateless 模式就只有 RecentHistory 全量，没有 PlotSummary。如果推导逻辑是"stateless → ai"，那 stateless 模式就有 PlotSummary。

从 plan 的架构图看，stateless 模式应该没有 PlotSummary。但用户说"原有的几个层作为省钱方案存在"——这与 plan 不符。

所以用户说"三层重叠区的问题"可能指的是：
1. 当前 plan 中 stateless 模式设计是否正确？
2. stateless 模式下是否应该有 PlotSummary + WorldVariable？
3. 如果有，这三层如何配合避免重叠？

用户要我"把三层重叠区的问题定下来，以防止未来SQLITE数据库因反复修改而频繁重建"——这意味着用户想要在修改代码前，先把 stateless 模式下三层的配合机制设计好，避免数据库 schema 反复改。

现在我需要：
1. 承认我的信息已过时
2. 基于 plan 更新后的状态，重新分析三层重叠区问题
3. 识别当前 plan 中 stateless 模式设计与用户描述的差异
4. 帮用户把问题定下来

让我先确认当前代码的实际状态——特别是 stateless 模式下 PlotSummary 和 CharacterStateOverlay 是否会触发。我需要读代码确认。

实际上用户说"不要修改代码"——所以我只需要分析，不改代码。但我需要读代码来确认当前状态。

让我先回答用户，说明我的信息已更新，然后指出当前 plan 中 stateless 模式设计与用户描述的差异，以及三层重叠区在 stateless 模式下是否还存在。

实际上，用户的核心诉求是：
1. 更新我的信息（已完成，读了 plan）
2. 把"三层重叠区"的问题定下来

由于 plan 已经把 MEM0 与 stateless 互斥了，三层重叠区问题在 mem0 模式下不存在（mem0 模式只有 RetrievedDetail 一层动态层）。但在 stateless 模式下，如果按用户描述"正文编写完毕后写剧情总结，且提供世界变量更新指令"，那 stateless 模式就有 PlotSummary + WorldVariable + RecentHistory 三层，这三层的重叠区问题需要定下来。

让我先确认代码中 stateless 模式下这三层的实际行为。我需要读 prompt_compiler.rs 和 stream_processor.rs 的关键部分。

但用户说"不要修改代码，我们需要把三层重叠区的问题定下来"——所以这是一个设计讨论，不是代码修改。我应该基于 plan 和代码现状，把问题梳理清楚，提出设计方案。

让我先读关键代码确认 stateless 模式下的实际行为。

确认了。当前代码逻辑是：
- `load_plot_summary_mode` 从 `memory_mode` 推导
- `mem0` → 返回 `"ai"`（这样会触发 PlotSummary 加载？！）
- `stateless` → 返回 `"disabled"`

等等，这里有问题！`mem0` 模式下 `load_plot_summary_mode` 返回 `"ai"`，这意味着 PlotSummary 会被启用？但 plan 的架构图说 mem0 模式没有 PlotSummary。

让我再读 prompt_compiler.rs 的 compile_prompt 看看门控逻辑。实际上 plan Task 3.2 中说：
```rust
let plot_summary_enabled = !mem0_active && load_plot_summary_mode(...) != DISABLED;
```

所以即使 `load_plot_summary_mode` 返回 "ai"，但 `!mem0_active` 会把它短路掉。所以 mem0 模式下确实不会加载 PlotSummary。

但 stateless 模式下：
- `mem0_active = false`
- `load_plot_summary_mode` 返回 "disabled"（因为 stateless → disabled）
- 所以 `plot_summary_enabled = !false && ("disabled" != "disabled") = true && false = false`

所以 stateless 模式下 PlotSummary 也是禁用的！这与用户描述的"省钱方案应该有剧情总结"不符。

当前代码实际状态：
- stateless：只有 RecentHistory 全量，无 PlotSummary、无 WorldVariable、无 RetrievedDetail
- mem0：只有 RetrievedDetail，无 PlotSummary、无 WorldVariable、无 RecentHistory

用户想要的状态（根据"原有的几个层作为省钱方案存在，同一轮对话中正文编写完毕后写剧情总结且提供世界变量更新指令"）：
- stateless（省钱方案）：应该有 PlotSummary + WorldVariable + RecentHistory（未总结部分）
- mem0（质量优先）：只有 RetrievedDetail

所以当前代码与用户预期不符！stateless 模式被设计成"纯无记忆"，但用户希望 stateless 是"省钱的传统方案"——用 PlotSummary + WorldVariable 替代 MEM0，通过同一轮 LLM 调用顺带生成。

这就是用户说的"三层重叠区问题"——在 stateless 模式下，PlotSummary + WorldVariable + RecentHistory 三层如何配合，避免内容重叠。

让我再确认一下，用户说的"原有的几个层"指的是哪些层。根据 plan：
- PlotSummary（第 5c 层）
- CharacterStateOverlay/WorldVariable（第 5b 层）
- RecentHistory（第 8 层）

用户希望 stateless 模式下这三层共存，且：
1. 正文编写完毕后，同一轮 LLM 调用顺带写剧情总结 + 世界变量更新指令
2. 无额外轮次费用
3. 三层不重叠（RecentHistory 只保留未总结的部分，PlotSummary 覆盖已总结的部分，WorldVariable 维护当前状态）

而当前代码把 stateless 模式做成了"纯无记忆"——这可能是临时简化，用户现在要把它修正回来。

让我把这个差异和三层重叠区的设计问题梳理清楚，呈现给用户。我应该先回答用户，不要修改代码，而是把问题设计清楚。让我准备一个清晰的设计文档式回答。

关键设计问题：
1. stateless 模式的语义重定义：从"纯无记忆"改为"传统省钱方案"
2. 三层在 stateless 模式下的协作机制
3. 数据库 schema 是否需要调整

让我检查一下当前数据库 schema 是否支持 stateless 模式重新启用 PlotSummary + WorldVariable。

实际上 plot_summary_mode 字段已被删除（Task 2 的 0035 迁移），现在用 memory_mode。如果要区分"stateless 无记忆"和"stateless 省钱方案（带 PlotSummary）"，需要新的 schema 设计。

但用户说"原有的几个层作为省钱方案存在"——这意味着 stateless 模式应该**默认**就包含 PlotSummary + WorldVariable？还是需要有第三个模式？

让我重新理解用户的意图：
- 用户认为有两个模式：stateless（省钱）和 mem0（质量）
- stateless 模式 = 原来的 PlotSummary + WorldVariable + RecentHistory 配合方案
- mem0 模式 = MEM0 全权接管

如果是这样，那当前代码的问题是：stateless 模式被错误地实现成了"纯无记忆"，而应该是"省钱方案"。

但 plan 的架构图明确写了 stateless 是"纯多轮对话，无任何记忆/总结"。这与用户现在说的"原有的几个层作为省钱方案存在"矛盾。

所以用户现在改变了想法——当初做 plan 时把 stateless 设计成"纯无记忆"，但现在用户认为 stateless 应该是"省钱方案"（带 PlotSummary + WorldVariable）。

这就是用户说的"三层重叠区问题"——需要重新设计 stateless 模式下三层的配合。

让我把这个分析呈现给用户，并提议三种可能的方案：
1. 三模式：stateless（纯无记忆）/ legacy（省钱方案：PlotSummary+WorldVariable+RecentHistory）/ mem0（质量优先）
2. 两模式重定义：stateless（省钱方案，默认开启 PlotSummary+WorldVariable）/ mem0（质量优先）
3. 当前 plan 的设计：stateless（纯无记忆）/ mem0（质量优先），但 stateless 也可手动开启 PlotSummary

用户说要"把三层重叠区的问题定下来，以防止未来SQLITE数据库因反复修改而频繁重建"——所以重点是数据库 schema 设计要一次到位。

我应该用 AskUserQuestion 来确认用户想要哪种模式划分，因为这直接影响数据库 schema。

不，用户说"不要修改代码"且"把问题定下来"——用户想要的是讨论和设计，不是立即提问。我应该先把问题分析清楚，呈现给用户，让用户决策。

让我准备一个完整的分析。实际上我应该先验证我对当前代码的理解是否正确——读 prompt_compiler.rs 的 compile_prompt 看看 stateless 模式的门控。让我读关键部分。
确认了关键差异。当前代码的 `load_plot_summary_mode` 逻辑是：`stateless → disabled`、`mem0 → ai`（被 `!mem0_active` 短路）。也就是说 **stateless 模式下 PlotSummary 和 WorldVariable 都被关闭了**，只剩 RecentHistory 全量。

这与你的描述不符。你说"原有的几个层作为省钱方案存在，同一轮内写剧情总结 + 世界变量更新"——这意味着 stateless 应该是**传统省钱方案**，而不是"纯无记忆"。

让我把问题定下来。

---

## 当前代码 vs 你的预期

| 维度 | 当前代码（plan 已实施） | 你的预期 |
|---|---|---|
| stateless 语义 | "纯多轮对话，无任何记忆/总结" | "省钱方案：PlotSummary + WorldVariable + RecentHistory 配合" |
| stateless 下 PlotSummary | 禁用 | 启用（同一轮 LLM 调用顺带生成） |
| stateless 下 WorldVariable | 禁用 | 启用（同一轮 LLM 调用顺带更新） |
| stateless 下 RecentHistory | 全量 | 仅未总结部分（已总结轮次剔除） |
| 三层重叠区处理 | 不存在（三层全关） | 需要定义：PlotSummary 覆盖远期，RecentHistory 覆盖近期，WorldVariable 维护当前状态 |

---

## 三层重叠区设计问题（需要定下来）

### 问题 1：stateless 模式的语义重定义

当前 plan 把 stateless 做成"纯无记忆"，但你的本意是"省钱方案"。两种选项：

**选项 A（推荐）**：重定义 stateless 语义
- `stateless` = 省钱方案（PlotSummary + WorldVariable + RecentHistory 配合，默认开启）
- `mem0` = 质量优先（MEM0 全权接管）
- 不需要第三个模式，不需要改数据库 schema（`memory_mode` 字段不变）

**选项 B**：三模式
- `stateless` = 纯无记忆（保留当前语义）
- `legacy` = 省钱方案（PlotSummary + WorldVariable + RecentHistory）
- `mem0` = 质量优先
- 需要扩展 `memory_mode` 的合法值，但不需要改 schema 结构

### 问题 2：三层在 stateless 模式下的协作机制

无论选 A 还是 B，都需要定义三层在 stateless 模式下的协作：

```
stateless 模式编译时：
┌─────────────────────────────────────────────────────┐
│ 第 5c 层 PlotSummary  (priority 500)              │
│   - 覆盖：已总结的远期轮次                          │
│   - 数据源：plot_summaries 表                       │
│   - 生成时机：每 N 轮触发一次（WINDOW_SIZE=5）       │
├─────────────────────────────────────────────────────┤
│ 第 5b 层 WorldVariable (priority 400)             │
│   - 覆盖：当前角色/世界权威状态                     │
│   - 数据源：character_state_overlays 表            │
│   - 生成时机：每轮正文生成后顺带更新                 │
├─────────────────────────────────────────────────────┤
│ 第 8 层 RecentHistory  (priority 800)              │
│   - 覆盖：未总结的近期轮次                          │
│   - 数据源：messages + message_rounds 表            │
│   - 剔除规则：summarized_round_ids 中的轮次不注入    │
└─────────────────────────────────────────────────────┘

无重叠区：
- 已总结轮次 → PlotSummary 覆盖，RecentHistory 剔除
- 当前状态 → WorldVariable 覆盖（权威），PlotSummary 不含当前状态
- 近期原文 → RecentHistory 独占
```

### 问题 3：写入侧的"同一轮顺带生成"

你提到"正文编写完毕后写剧情总结，且提供世界变量更新指令，从而达到无额外轮次对话产生的费用"。

当前代码的写入侧是**分离的**：
- `spawn_plot_summary_processing_task` — 每 N 轮触发一次独立 LLM 调用
- `spawn_character_state_overlay_generation_task` — 每轮触发独立 LLM 调用
- 这两个都是**额外的 LLM 调用**，不是"同一轮顺带"

如果要实现"同一轮顺带"，有两条路径：

**路径 1（低成本）**：保持当前独立 spawn，但复用同一 provider 的批处理
- 不改 LLM 调用结构，只是并行触发
- 仍会产生额外 token 费用（虽然比正文小）

**路径 2（高成本但真正省钱）**：在正文生成的 LLM 调用中，要求模型同时输出结构化 JSON
- 正文流式输出的同时，在最终 message 中附带 `<plot_summary_update>` 和 `<world_variable_update>` 标签
- stream_processor 解析这些标签，写入对应表
- 真正零额外费用
- 但需要改 preset 的 system prompt + 流解析逻辑

### 问题 4：撤回与三层同步（方案 A 的延伸）

之前讨论的"撤回时清空 MEM0 记忆"（方案 A）只针对 mem0 模式。stateless 模式下撤回的影响范围：

| 层 | 撤回后的行为 | 是否需要额外处理 |
|---|---|---|
| PlotSummary | 已总结的轮次被撤回 → 摘要可能引用已删除内容 | 需要：撤回时删除引用已删除轮次的 summary |
| WorldVariable | 角色状态可能基于已撤回的对话更新 → 状态过期 | 需要：撤回时回滚到上一版状态 |
| RecentHistory | 自动跟随（撤回即删除消息） | 无需额外处理 |

---

## 需要你决策的关键问题

在动代码之前，需要先把这几个问题定下来（避免 SQLite 反复改）：

1. **模式划分**：选项 A（重定义 stateless）还是选项 B（三模式）？
2. **写入侧**：路径 1（独立 spawn 并行）还是路径 2（同一轮 JSON 标签）？
3. **撤回同步**：stateless 模式下撤回时，PlotSummary 和 WorldVariable 是否需要同步回滚？

你先决策这三个问题，我再出具体的 schema 稳定性评估和实施计划。**不会动代码。**
human:stateless ：纯多轮对话，无任何记忆/总结，适用于短期对话与长上下文模型，第 5c 层 PlotSummary不预留SQLITE字段，第 5b 层 WorldVariable每轮对话都预留SQLITE字段，每轮对话都可安全分支或溯回，是否使用看对话预设是否定义，第 8 层 RecentHistory不存在，或者说全量保存。 
 legacy：第 5c 层 PlotSummary每轮对话都预留SQLITE字段，每轮对话都可安全分支或溯回，第 5b 层 WorldVariable每轮对话都预留SQLITE字段，每轮对话都可安全分支或溯回，是否使用看对话预设是否定义，第 8 层 RecentHistory由设置决定保留多少层原文。 
 MEM0：原则上无PlotSummary、WorldVariable、RecentHistory层，历史上下文全量由MEM0托管，使用“存档”回溯制，即最新20轮的SQLITE数据库会被复制成副本，分支或溯回时直接切换到之前的SQLITE文件，20轮以外的对话无法分支或溯回。
AI:让我整理一下用户对三种模式的定义。这是关键的设计决策，我需要把信息整理清楚，并且不做代码修改，仅确认理解。

用户的定义：

**stateless（纯多轮对话）**：
- 无任何记忆/总结
- 适用于短期对话与长上下文模型
- 第 5c 层 PlotSummary：不预留 SQLITE 字段
- 第 5b 层 WorldVariable：每轮对话都预留 SQLITE 字段，每轮对话都可安全分支或溯回，是否使用看对话预设是否定义
- 第 8 层 RecentHistory：不存在，或者说全量保存

**legacy（省钱方案）**：
- 第 5c 层 PlotSummary：每轮对话都预留 SQLITE 字段，每轮对话都可安全分支或溯回
- 第 5b 层 WorldVariable：每轮对话都预留 SQLITE 字段，每轮对话都可安全分支或溯回，是否使用看对话预设是否定义
- 第 8 层 RecentHistory：由设置决定保留多少层原文

**MEM0（质量优先）**：
- 原则上无 PlotSummary、WorldVariable、RecentHistory 层
- 历史上下文全量由 MEM0 托管
- 使用"存档"回溯制：最新 20 轮的 SQLITE 数据库会被复制成副本，分支或溯回时直接切换到之前的 SQLITE 文件
- 20 轮以外的对话无法分支或溯回

关键观察：
1. 三种模式并存，需要扩展 `memory_mode` 合法值为 `stateless | legacy | mem0`
2. WorldVariable 在 stateless 和 legacy 中都是"每轮预留字段"——意味着需要新的 schema 设计来支持每轮快照
3. PlotSummary 在 legacy 中是"每轮预留字段"——这与当前实现（按 batch window 5 轮触发）不同
4. MEM0 模式引入"存档"机制——SQLITE 文件级别快照，20 轮上限
5. "是否使用看对话预设是否定义"——意味着 WorldVariable 层是 preset 可控的

这是个重要的设计转折点。我需要：
1. 确认理解
2. 把每个模式下的 schema 稳定性问题列清楚
3. 指出潜在的设计风险
4. 不动代码

让我详细分析每个模式下的数据需求。

### stateless 模式
- conversations 表只需 `memory_mode = 'stateless'`
- 不需要 plot_summaries 表的字段
- 需要 WorldVariable 每轮快照表（如果预设启用）
- RecentHistory 直接读 messages/message_rounds 表（全量）

### legacy 模式
- 需要 PlotSummary 每轮快照表
- 需要 WorldVariable 每轮快照表
- RecentHistory 由设置决定（已有 max_recent_history_tokens 等）

### MEM0 模式
- 不需要 PlotSummary/WorldVariable/RecentHistory
- 需要"存档"机制：SQLite 文件快照
- 最新 20 轮在主数据库
- 超过 20 轮的部分，需要有机制把当前数据库"快照"成副本

关键 schema 设计问题：

1. **每轮预留字段**是什么意思？
   - 选项 a：每次写入新行（每轮一条记录）
   - 选项 b：在现有表加 round_id 字段
   - 选项 c：单独的快照表

2. **"是否使用看对话预设是否定义"**意味着：
   - WorldVariable 在 preset 层有开关
   - 即使处于 stateless/legacy 模式，是否启用 WorldVariable 由 preset 决定

3. **MEM0 的"存档"机制**：
   - SQLite 文件复制副本——这需要 Tauri 侧的文件操作
   - 切换 SQLite 文件意味着 connection pool 要重载
   - 这是个重大架构决策

4. **回溯/分支的语义**：
   - stateless/legacy：每轮都可安全分支或溯回（通过 round_id 索引）
   - MEM0：只能回溯到"存档点"（每 20 轮一个存档）

我需要把这些都整理出来，让用户确认理解，并指出风险点。不动代码。

让我组织一下回复。先确认理解，再列出关键设计点和风险。
收到。这是一个比之前 plan 更精细的三模式设计。我先把理解确认下来，再列出需要在动代码前定下来的 schema 稳定性问题。**不动代码。**

---

## 三模式定义（确认理解）

| 层 | stateless | legacy | mem0 |
|---|---|---|---|
| 第 5c PlotSummary | 不预留字段 | 每轮预留字段（可分支/溯回） | 不存在 |
| 第 5b WorldVariable | 每轮预留字段（可分支/溯回），preset 可控开关 | 同左 | 不存在 |
| 第 8 RecentHistory | 全量（无上限） | 由设置决定窗口大小 | 不存在（全量由 MEM0 托管） |
| 撤回/分支粒度 | 每轮 | 每轮 | "存档"级（20 轮一个快照） |
| 适用场景 | 短期对话 / 长上下文模型 | 省钱方案（传统） | 质量优先 |

关键扩展点：
- `memory_mode` 合法值从 `stateless | mem0` 扩展为 `stateless | legacy | mem0`
- WorldVariable 启用与否由 **preset 层开关**控制（与 `memory_mode` 正交）
- MEM0 模式引入 SQLite 文件级快照机制

---

## 需要在动代码前定下来的问题（避免 SQLite 反复改）

### 问题 1：WorldVariable 的"每轮预留字段"具体结构

当前 `character_state_overlays` 表是按 batch 触发的（每次 AI 生成时新增一条记录）。"每轮预留字段"意味着每轮对话都有一个对应的 WorldVariable 快照。需要决定表结构：

**选项 A**：新增 `round_id` 列到 `character_state_overlays`
```sql
ALTER TABLE character_state_overlays ADD COLUMN round_id INTEGER;
-- 每个 round 一行，回溯时按 round_id 查询
```

**选项 B**：新建独立的 `world_variable_snapshots` 表
```sql
CREATE TABLE world_variable_snapshots (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  round_id INTEGER NOT NULL,
  payload TEXT NOT NULL,  -- JSON: { 关键字: 值 }
  source TEXT,  -- 'ai' | 'manual'
  created_at INTEGER,
  UNIQUE(conversation_id, round_id)
);
```

**选项 C**：直接复用 `message_rounds` 表加 `world_variables` JSON 列
```sql
ALTER TABLE message_rounds ADD COLUMN world_variables TEXT;
-- 每轮自带一个 world_variables 快照字段
```

**风险**：选项 A 修改现有表结构；选项 B 增加新表但隔离干净；选项 C 把 world variable 与 message_rounds 绑定，schema 最稳定但耦合度最高。

### 问题 2：PlotSummary 的"每轮预留字段"

当前 `plot_summaries` 表按 batch window（5 轮一批）触发。legacy 模式要"每轮预留字段"——是改成每轮一条 summary，还是保留 batch 但加 round_id 索引？

**选项 A**：每轮一条 summary
- `plot_summaries` 表加 `round_id` 列，每轮都生成（即使内容是"无变化"）
- 优点：回溯精确
- 缺点：写入放大（每轮一次 LLM 调用）

**选项 B**：保留 batch 触发，但每轮写入"占位行"
- 每轮 INSERT 一条 `status='pending'`，等 batch 触发时 UPDATE 为 `completed`
- 优点：写入轻量
- 缺点：占位行无实际内容

**选项 C**：保持当前 batch 逻辑，PlotSummary 不"每轮预留"
- 仅在 batch 边界（每 5 轮）有 summary
- 用户"每轮预留字段"的含义是 schema 上**有 round_id 列**，不是每轮都写入
- 回溯时：撤回到第 N 轮，删除 `round_id > N` 的所有 summary + 重新触发该 batch

### 问题 3：MEM0 模式的"存档"机制

"最新 20 轮 SQLITE 数据库会被复制成副本"——这是文件级快照。需要决定：

**选项 A**：每 20 轮全量复制 SQLite 文件
- 实现：在 `app_data_dir` 下建 `mem0_snapshots/{conversation_id}/round_{N}.db`
- 切换：关闭当前 connection → 复制快照覆盖主 db → 重开 connection
- 优点：实现简单
- 缺点：每次快照几百 MB；切换时短暂阻塞

**选项 B**：WAL 模式 + 增量 checkpoint
- 用 SQLite WAL 模式，每 20 轮做一次 checkpoint
- 快照仅存 WAL 文件
- 优点：快照小
- 缺点：实现复杂

**选项 C**：放弃文件级快照，改用逻辑级快照
- 每 20 轮把 `messages` + `message_rounds` 表导出为 JSON 存档
- 切换时清空表 + 导入 JSON
- 优点：跨平台、易调试
- 缺点：MEM0 自身的向量库也要同步快照

### 问题 4：MEM0 模式下"撤回"与撤回触发"存档切换"的语义

MEM0 模式下撤回一个轮次，是：
- **A**：不允许撤回到 20 轮以前（直接拒绝）
- **B**：允许撤回到 20 轮以前，但代价是丢失中间所有轮次（切换到旧快照）
- **C**：20 轮以内撤回走原逻辑（删除消息），20 轮以前撤回走快照切换

### 问题 5：模式切换时的数据迁移

会话从 `stateless → legacy` 时：
- 已有消息保留
- 需要为过去的轮次补生成 PlotSummary 吗？还是从切换点开始累计？

会话从 `legacy → mem0` 时：
- 已有的 PlotSummary 和 WorldVariable 数据保留还是清空？
- MEM0 是否需要回填过去的对话？

### 问题 6：preset 层的 WorldVariable 开关

"是否使用看对话预设是否定义"——意味着 preset 表需要新增字段：

```sql
ALTER TABLE presets ADD COLUMN world_variable_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ADD COLUMN world_variable_schema TEXT;  -- JSON: 定义哪些变量
```

还是走现有的 preset_blocks 机制（已有 system prompt 文本约束），不新增独立字段？

---

## 我的建议（仅参考，等你决策）

为了 schema 稳定性，我倾向于：

1. **问题 1（WorldVariable）**：选项 B（独立表 `world_variable_snapshots`）—— 隔离最干净，未来加字段不污染现有表
2. **问题 2（PlotSummary）**：选项 C（保留 batch，schema 上加 `round_id` 列但不每轮写入）—— 避免写入放大
3. **问题 3（MEM0 存档）**：选项 A（文件级快照）—— 实现最直接，性能问题后续优化
4. **问题 4（MEM0 撤回）**：选项 C（分层处理）—— 20 轮内灵活，超出走快照
5. **问题 5（模式切换迁移）**：不补生成，从切换点开始累计 —— 简单
6. **问题 6（preset 开关）**：新增 `world_variable_enabled` 字段 —— 显式优于隐式

但这些都是建议，最终决策权在你。请先回答这 6 个问题，我再出最终的实施计划。
human:1.mem0说的是最新X轮以内每一轮都存一次快照，而不是每X轮存一次，X的值由设置定义，默认20. 
 2.问题 1：WorldVariable 的"每轮预留字段"具体结构：重写这部分，将WorldVariable与character_state_overlays合并，直接复用 message_rounds 表加 world_variables JSON 列。 
 3.问题 2：PlotSummary 的"每轮预留字段"：保留 batch 触发，但每轮写入"占位行" 
 4.问题 3：MEM0 模式的"存档"机制：全量复制 SQLite 文件，下一轮对话开始时的瞬间，将当前使用的DB文件存一份副本，不要在对话刚结束时保存副本，否则用户可能会微调回复内容导致信息不一致，回溯或分支时：关闭当前 connection → 寻找对应副本并rename → 重开 connection。 
 5.问题 4：MEM0 模式下"撤回"与撤回触发"存档切换"的语义：不允许撤回到 X轮以前（直接拒绝）。 
 6.问题 5：模式切换时的数据迁移：不允许切换。 
 7.问题 6：preset 层的 WorldVariable 开关：新增字段，顺带在下一轮时总结preset能控制到的SQLITE API。
AI:让我整理用户对 6 个问题的决策：

1. **MEM0 快照机制澄清**：是"最新 X 轮以内每一轮都存一次快照"，而不是每 X 轮一次。X 由设置定义，默认 20。这意味着每轮都要做一次快照（在下一轮开始时）。

2. **问题 1（WorldVariable）**：重写这部分，将 WorldVariable 与 character_state_overlays 合并，直接复用 message_rounds 表加 world_variables JSON 列。这是选项 C 的强化版——不仅复用 message_rounds，还要把 character_state_overlays 合并进来。

3. **问题 2（PlotSummary）**：保留 batch 触发，但每轮写入"占位行"。选项 B。

4. **问题 3（MEM0 存档）**：全量复制 SQLite 文件，下一轮对话开始时的瞬间保存副本（不是对话结束时），防止用户微调回复导致不一致。回溯时：关闭 connection → rename 副本 → 重开 connection。

5. **问题 4（MEM0 撤回）**：不允许撤回到 X 轮以前（直接拒绝）。

6. **问题 5（模式切换迁移）**：不允许切换模式。

7. **问题 6（preset 开关）**：新增字段，顺带在下一轮总结 preset 能控制到的 SQLITE API。

我需要把这些决策整理成最终的设计文档，然后列出 schema 稳定性评估。让我先确认理解，然后给出最终的 schema 设计。

关键点：
- 用户在问题 1 中说"将WorldVariable与character_state_overlays合并"——这意味着要废弃 character_state_overlays 表，把它的功能合并到 message_rounds 表的 world_variables 列
- 用户在问题 7 中提到"顺带在下一轮时总结preset能控制到的SQLITE API"——这是一个新任务，需要在下一轮对话中总结 preset 能控制哪些 SQLITE API

我需要：
1. 确认理解用户的决策
2. 给出最终的 schema 设计
3. 列出"下一轮需要总结 preset 能控制的 SQLITE API"这个待办

不动代码。
收到。决策清晰，我把最终设计整理出来，并把"下一轮总结 preset 能控制到的 SQLITE API"作为待办记下。**不动代码。**

---

## 最终设计（基于你的决策）

### Schema 变更总览

| 变更 | 类型 | 影响表 |
|---|---|---|
| `memory_mode` 合法值扩展 | 语义扩展（不改 schema） | `conversations` |
| 新增 `world_variables` JSON 列 | 加列 | `message_rounds` |
| PlotSummary 每轮占位行 | 加列 | `plot_summaries` |
| preset 新增 WorldVariable 开关 | 加列 | `presets` |
| character_state_overlays 表 | 废弃（数据迁移到 message_rounds.world_variables） | — |
| MEM0 快照机制 | 新增设置项 | `settings` |

---

### 1. `message_rounds` 表 — 合并 WorldVariable + character_state_overlays

```sql
-- migration: 0036_message_rounds_world_variables.sql
ALTER TABLE message_rounds ADD COLUMN world_variables TEXT;
-- 语义: JSON 字符串，形如 {"location":"酒馆","npc_mood":"愤怒","quest_main":"已接取"}
-- 来源: 由 preset.world_variable_enabled 控制是否启用 AI 更新
--       由 preset.world_variable_schema 定义变量 schema
-- 每轮都预留此字段，未启用时为 NULL
```

**迁移逻辑**（在 migration 中执行）：
- 从 `character_state_overlays` 表读取现有数据
- 按 `(conversation_id, round_id)` 聚合
- 转换为 JSON 写入 `message_rounds.world_variables`
- 删除 `character_state_overlays` 表（或保留为只读归档，但停止写入）

**回溯语义**：
- 撤回到第 N 轮 → `DELETE FROM message_rounds WHERE round_id > N` → `world_variables` 自动跟随（每轮自带快照）
- 分支到第 N 轮 → 复制 N 及之前的所有 `message_rounds` 行 → 各自独立演化

### 2. `plot_summaries` 表 — 每轮占位行

```sql
-- migration: 0037_plot_summaries_per_round.sql
ALTER TABLE plot_summaries ADD COLUMN round_id INTEGER;
-- 语义: 该 summary 覆盖到的最后一个 round_id
-- 触发:
--   - 每轮结束时 INSERT 一条 status='pending' 的占位行
--   - batch 触发（每 5 轮）时 UPDATE 占位行为 status='completed' + 写入内容
--   - 未触发 batch 的占位行保持 pending，查询时过滤掉
```

**回溯语义**：
- 撤回到第 N 轮 → `DELETE FROM plot_summaries WHERE round_id > N` → 自动清除引用已删除轮次的 summary

### 3. `presets` 表 — WorldVariable 开关

```sql
-- migration: 0038_preset_world_variable.sql
ALTER TABLE presets ADD COLUMN world_variable_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ADD COLUMN world_variable_schema TEXT;
-- world_variable_schema: JSON 数组，形如
--   [{"key":"location","type":"string","description":"当前场景"},
--    {"key":"npc_mood","type":"enum","options":["平静","愤怒","喜悦"]}]
-- NULL 表示不约束 schema，由 LLM 自由生成
```

### 4. `settings` 表 — MEM0 快照配置

```sql
-- migration: 0039_mem0_snapshot_settings.sql
INSERT INTO settings (key, value) VALUES
  ('mem0_snapshot_window', '20'),
  ('mem0_snapshot_dir', 'D:\software_cache\mem0\snapshots');
-- mem0_snapshot_window: X 值，最新 X 轮每轮存一次快照
-- mem0_snapshot_dir: 快照存放目录（遵守 guardrails，严禁 C 盘）
```

**快照机制**：
```
下一轮对话开始时的瞬间：
1. 检查 memory_mode == 'mem0'
2. 检查当前轮次是否已存过快照（避免重复）
3. 复制主 SQLite 文件到 {snapshot_dir}/{conversation_id}/round_{N}.db
4. 同时复制 MEM0 向量库文件（D:\software_cache\mem0\ 下相关文件）

撤回/分支到第 N 轮（N 在快照窗口内）：
1. 关闭当前 SQLite connection
2. 关闭 MEM0 向量库 connection
3. 找到 round_{N}.db 副本
4. rename 副本覆盖主 db
5. rename 对应的 MEM0 向量库副本
6. 重开 connection

撤回超出 X 轮：直接拒绝，UI 提示"无法撤回到 X 轮以前"
```

### 5. `conversations` 表 — `memory_mode` 三态

```sql
-- 已存在（0034 migration），无需改 schema
-- 合法值扩展: 'stateless' | 'legacy' | 'mem0'
-- 语义:
--   stateless: 无 PlotSummary，WorldVariable 由 preset 控制，RecentHistory 全量
--   legacy:    PlotSummary(batch+占位) + WorldVariable(preset控制) + RecentHistory(可配置窗口)
--   mem0:      无 PlotSummary/WorldVariable/RecentHistory，MEM0 全权托管 + 快照机制
-- 约束: 创建会话后 memory_mode 不可切换
```

**会话创建时强制选择模式**，之后 `UPDATE conversations SET memory_mode = ?` 被拒绝（在 command 层校验，不在 DB 层约束）。

---

## 三模式最终架构图

```
stateless 模式:
┌─────────────────────────────────────────┐
│ PresetRule (100)                        │
│ MultiplayerProtocol (150) [online only] │
│ CharacterBase (200)                     │
│ PlayerBase (250)                        │
│ WorldBookMatch (300)                    │
│ WorldVariable (400) [preset 控制开关]    │  ← message_rounds.world_variables
│ PlotSummary (500) — 不存在               │
│ RetrievedDetail (550) — 不存在           │
│ RecentHistory (800) — 全量              │  ← 不剔除任何轮次
│ CurrentUser (900)                       │
└─────────────────────────────────────────┘
撤回: 每轮可撤回，直接 DELETE message_rounds WHERE round_id > N

legacy 模式:
┌─────────────────────────────────────────┐
│ PresetRule (100)                        │
│ MultiplayerProtocol (150) [online only] │
│ CharacterBase (200)                     │
│ PlayerBase (250)                        │
│ WorldBookMatch (300)                    │
│ WorldVariable (400) [preset 控制开关]   │  ← message_rounds.world_variables
│ PlotSummary (500) — batch 触发          │  ← plot_summaries 表
│ RetrievedDetail (550) — 不存在          │
│ RecentHistory (800) — 可配置窗口        │  ← 剔除 summarized_round_ids
│ CurrentUser (900)                       │
└─────────────────────────────────────────┘
撤回: 每轮可撤回，DELETE message_rounds + plot_summaries WHERE round_id > N

mem0 模式:
┌─────────────────────────────────────────┐
│ PresetRule (100)                        │
│ MultiplayerProtocol (150) [online only] │
│ CharacterBase (200)                     │
│ PlayerBase (250)                        │
│ WorldBookMatch (300)                    │
│ WorldVariable (400) — 不存在            │
│ PlotSummary (500) — 不存在              │
│ RetrievedDetail (550) — MEM0 多策略查询 │
│ RecentHistory (800) — 不存在            │
│ CurrentUser (900)                       │
└─────────────────────────────────────────┘
撤回: 仅最近 X 轮可撤回（默认 20），走快照切换
```

---

## 待办：下一轮总结 preset 能控制到的 SQLITE API

记下这个任务，下一轮对话时执行：

> **任务**：梳理 preset 系统能控制到的所有 SQLITE API 表面
> 
> **背景**：preset 层（第 1 层 PresetRule）除了已有的 system prompt / sampling params / output validator / provider override 之外，新增了 `world_variable_enabled` + `world_variable_schema`。需要全面梳理 preset 还能控制哪些 SQLITE API。
> 
> **范围**：
> - 当前 preset 已有的控制点（system_message 模板变量、sampling params、output validator、provider override）
> - 本次新增的 `world_variable_enabled` / `world_variable_schema`
> - 未来可能扩展的控制点（如 PlotSummary 触发窗口、RecentHistory 窗口大小、WorldBook 触发策略等）
> 
> **产出**：一份 preset 控制面清单，标注每个控制点的生效路径（preset 字段 → 哪个 service/command 读取 → 影响哪个 SQLITE 表/API）

---

## 需要你确认的最后一点

以上设计有几个隐含决策，请确认：

1. **character_state_overlays 表**：迁移到 `message_rounds.world_variables` 后，原表是**删除**还是**保留为只读归档**？
2. **MEM0 快照文件位置**：`D:\software_cache\mem0\snapshots\{conversation_id}\round_{N}.db` 这个路径符合预期吗？（遵守 guardrails：不在 C 盘）
3. **会话模式锁定**：创建会话时三选一，之后不可切换。这个约束在 command 层校验（`memory_mode_set` 命令拒绝已有会话的修改请求）对吗？
4. **X 值（快照窗口）的默认值**：默认 20 是否在 `settings` 表里硬编码，还是用户可在 UI 里调整？

确认后我就可以出最终的实施计划（不动代码，只出 plan）。
Human:1.settings 表 — MEM0 快照配置：不要存放在'D:\software_cache\mem0\snapshots'，这只在我的电脑上有效，在其他电脑中则是未定义行为——其他电脑不一定有D盘，也不一定有software_cache文件夹，所以存放在EXE同级目录下。
2.character_state_overlays 表：软件仍在开发阶段，不考虑任何数据保留。
3.会话模式锁定：不要预留切换会话模式的按钮，就可以保证避免未定义行为。
4.X 值（快照窗口）的默认值：在MEM0模式的会话下，默认值设置框放在会话抽屉界面中。
# Night Voyage Prompt Compiler 实施规划

## 任务分类

- 分类：后端架构规划
- 目标范围：先落地 `classic` 单模型编译链路，`director_agents` 只保留扩展位
- 约束：所有网络、数据库、LLM 编译、规则执行、检索与裁剪都在 `Rust` 后端完成

## 规划目标

把当前较轻量的 [`compile_chat_messages()`](src-tauri/src/services/prompt_compiler.rs:8) 演进为可扩展的 Prompt Compiler，满足以下要求：

1. 对输入源做结构化收集，而不是直接拼字符串
2. 对预设、多人协议、角色卡、玩家人设、世界书、世界变量、Character State Overlay、剧情总结层、向量细节层、最近上下文窗口、当前输入、正则、宏做明确分层
3. 在编译阶段支持排序、开关、覆盖、预算裁剪与 provider 能力判断
4. 先服务 `classic` 单模型链路，未来再接 `director_agents`

***

## 一、当前基线与缺口

### 当前已有能力

- 基础编译入口：[`compile_chat_messages()`](src-tauri/src/services/prompt_compiler.rs:8)
- 世界书命中服务：[`load_triggered_world_book_messages()`](src-tauri/src/services/world_book_matcher.rs:3)
- 聊天请求模型：[`ChatRequest`](src-tauri/src/llm/mod.rs:15)
- 当前后端消息生成路径：[`stream_llm_response()`](src-tauri/src/commands/chat.rs:414)

### 当前主要缺口

1. 输入源没有统一结构模型
2. 缺少中间表示 IR，导致难以排序和裁剪
3. 预设系统尚未真正接入编译器
4. Provider adapter 还没把"编译结果"和"请求体构造"清晰隔开

***

## 二、Prompt Compiler 的目标职责

Prompt Compiler 不负责网络发送。

它只负责：

1. 收集输入源
2. 宏展开
3. 规则匹配
4. 分层排序
5. token 预算裁剪
6. provider 能力判断
7. 生成结构化编译结果

真正把编译结果翻译成 OpenAI / Claude / Gemini 请求体的，应该是 Provider Adapter。

***

## 三、Prompt Compiler 推荐输入模型

建议新增一个编译输入对象，例如：

```rust
pub struct PromptCompileInput {
    pub conversation_id: i64,
    pub mode: PromptCompileMode,
    pub target_round_id: Option<i64>,
    pub provider_kind: String,
    pub model_name: String,
    pub budget: PromptBudget,
}
```

### `PromptCompileMode`

```rust
pub enum PromptCompileMode {
    ClassicChat,
    ClassicRegenerate,
    AgentDirectorPlaceholder,
}
```

说明：

- 本轮只真正实现 `ClassicChat` 与 `ClassicRegenerate`
- `AgentDirectorPlaceholder` 仅用于预留扩展位

### `PromptBudget`

```rust
pub struct PromptBudget {
    pub max_total_tokens: Option<usize>,
    pub reserve_output_tokens: Option<usize>,
    pub max_summary_tokens: Option<usize>,
    pub max_world_book_tokens: Option<usize>,
    pub max_retrieved_detail_tokens: Option<usize>,
}
```

说明：

- 第一版即使预算计算不精确，也要保留字段
- 真正的 token 精算可以下一步实现

***

## 四、Prompt Compiler 推荐中间表示 IR

建议不要让编译器直接输出字符串，而是输出结构化块。

### 1. Block 级表示

```rust
pub enum PromptBlockKind {
    PresetRule,           // ✅ 活跃
    MultiplayerProtocol,  // ✅ 仅多人模式启用
    CharacterBase,        // ✅ 活跃
    PlayerBase,           // ✅ 活跃
    WorldBookMatch,       // ✅ 活跃
    WorldVariable,        // ❓ 待讨论是否实现
    CharacterStateOverlay, // ❌ 总结模式关闭时不启用
    PlotSummary,          // ❌ 总结模式关闭时不启用
    RetrievedDetail,      // ❌ 总结模式关闭时不启用
    RecentHistory,        // ✅ 活跃（总结模式关闭时为完整上下文窗口）
    CurrentUser,          // ✅ 活跃
}
```

```rust
pub struct PromptBlock {
    pub kind: PromptBlockKind,
    pub priority: i32,
    pub role: PromptRole,
    pub title: Option<String>,
    pub content: String,
    pub source: PromptBlockSource,
    pub token_cost_estimate: Option<usize>,
    pub required: bool,
}
```

### 2. Source 元信息

```rust
pub enum PromptBlockSource {
    Preset { preset_id: i64, block_id: Option<i64> },
    Character { character_id: i64 },
    Player { character_id: i64 },
    WorldBook { world_book_id: i64, entry_id: i64 },
    Summary { summary_id: i64 },
    Retrieval { fragment_id: i64 },
    Message { message_id: i64 },
    StateOverlay,
    Compiler,
}
```

### 3. 最终编译结果

```rust
pub struct PromptCompileResult {
    pub system_blocks: Vec<PromptBlock>,
    pub history_blocks: Vec<PromptBlock>,
    pub current_user_block: PromptBlock,
    pub params: CompiledSamplingParams,
    pub debug: PromptCompileDebugReport,
}
```

***

## 五、各输入源与编译器的边界

### 1. 预设 ✅

职责：

- 生成风格
- 格式规则
- 采样参数
- macro 模板源
- provider override

进入编译器的形式：

- `PresetRule`
- `CompiledSamplingParams`

### 2. 多人协议 ✅

职责：

- 描述多人模式下的协作协议、发言规则、角色分工和上下文约束

进入编译器的形式：

- `MultiplayerProtocol`

状态：**仅多人模式启用**。单人模式不进入该层。

### 3. AI 角色卡 ✅

职责：

- AI 角色的人格底座
- 名称 / 身份 / 描述 / 标签 / 基础分区

进入编译器的形式：

- `CharacterBase`

### 4. 玩家角色卡 🆕

职责：

- 玩家扮演的角色人设
- 名称 / 身份 / 描述 / 标签 / 基础分区
- 数据来源：`conversation_members.player_character_id`

进入编译器的形式：

- `PlayerBase`

状态：**已实现**。用于玩家人设层。

### 5. 世界书 ✅

职责：

- 提供命中后才注入的外部设定

进入编译器的形式：

- `WorldBookMatch`

### 6. 世界变量层 ❓

职责：

- 记录世界中的地点、人物等变量因剧情推进和时间流逝而发生的相对于原角色卡和世界书的变化
- 例如：某个地点从"荒废"变为"繁华"、某个NPC从"陌生人"变为"挚友"、某个时间节点后的季节/天气变化

进入编译器的形式：

- `WorldVariable`

状态：**待讨论是否实现**。当前与 CharacterStateOverlay 有部分重叠。

### 7. Character State Overlay ❌

职责：

- 在剧情总结模式开启时，承接角色状态、关系变化、剧情推进后的状态覆盖

进入编译器的形式：

- `CharacterStateOverlay`

状态：**剧情总结模式关闭时不启用**。

### 8. 剧情总结层 ❌

职责：

- 提供剧情主线摘要

进入编译器的形式：

- `PlotSummary`

状态：**剧情总结模式关闭时不启用**。

### 9. 向量细节层 ❌

职责：

- 召回少量高相关细节

进入编译器的形式：

- `RetrievedDetail`

状态：**剧情总结模式关闭时不启用**。

### 10. 最近原文窗口 / 完整上下文窗口 ✅

职责：

- 在剧情总结模式关闭时，输出完整上下文窗口
- 在剧情总结模式开启时，输出最近原文窗口

进入编译器的形式：

- `RecentHistory`

### 11. 当前用户输入层 ✅

职责：

- 当前真正要响应的目标输入

进入编译器的形式：

- `CurrentUser`

***

## 六、各阶段推荐顺序

### Phase 1. 收集

- conversation metadata
- preset
- bound AI character
- bound player character ← 🆕
- world book
- summary mode status
- recent history
- current round input

### Phase 2. 模板展开 Macro

- 对预设 block 做 `minijinja` 渲染
- 对角色卡可编译片段做模板替换
- 对世界书条目中的动态变量做渲染

### Phase 3. 规则判断 Regex / Match

- 世界书关键词与正则触发
- 输出约束规则预判断
- 非法 block 过滤

### Phase 4. Block 生成

生成：

- `PresetRule` ✅
- `MultiplayerProtocol` ✅
- `CharacterBase` ✅
- `PlayerBase` ✅
- `WorldBookMatch` ✅
- `WorldVariable` ❓
- `CharacterStateOverlay` ❌
- `RecentHistory` ✅
- `CurrentUser` ✅

### Phase 5. 排序与覆盖

推荐优先级：

| 优先级 | Block | 说明 |
|--------|-------|------|
| 100 | PresetRule | 预设规则，最高优先 |
| 150 | MultiplayerProtocol | 多人协议 |
| 200 | CharacterBase | AI 角色人设 |
| 250 | PlayerBase | 玩家人设 |
| 300 | WorldBookMatch | 世界书命中 |
| 400 | WorldVariable ❓ | 世界变量 |
| 500 | CharacterStateOverlay ❌ | 角色状态覆盖 |
| 800 | RecentHistory | 最近聊天记录 |
| 900 | CurrentUser | 当前用户输入 |

### Phase 6. 预算裁剪

裁剪顺序建议：

- 先裁 `WorldVariable`（如果实现）
- 再裁部分 `WorldBookMatch`
- 尽量不裁 `RecentHistory` 的最近窗口
- 不裁 `CurrentUser`
- 不裁高优先级 `PresetRule`、`CharacterBase`、`PlayerBase`

### Phase 7. Provider 能力判断

要判断：

- system 支持方式
- stop / response\_format / top\_p / penalties 等参数支持情况

### Phase 8. 产出结果

输出：

- `PromptCompileResult`
- 由 Provider Adapter 再翻译为真实请求体

***

## 七、Prompt Compiler 与 Provider Adapter 的协作方式

推荐明确做两层：

### 1. Prompt Compiler

负责：

- 语义与上下文编译
- 产出 provider-agnostic IR

### 2. Provider Adapter

负责：

- 把 IR 转成 provider-specific request
- 例如 OpenAI compatible 的 `messages[]`
- 后续 Claude / Gemini 也在这里做兼容翻译

这样可避免：

- 编译器里混入大量 provider 分支
- provider 兼容逻辑污染上下文分层逻辑

***

## 八、当前活跃实现范围

### ✅ 已实现

1. `PromptCompileInput` / `PromptCompileResult`
2. `PromptBlock` 与优先级排序
3. 预设层编译（PresetRule / OutputValidator / 采样参数 / provider override）
4. AI 角色卡编译（CharacterBase）
5. 玩家人设编译（PlayerBase）
6. 世界书命中层编译（WorldBookMatch）
7. 最近原文窗口 / 完整上下文窗口编译（RecentHistory）
8. 当前用户输入层编译（CurrentUser）
9. 预算裁剪框架
10. debug report 框架
11. 多人协议（MultiplayerProtocol）
12. 剧情摘要（PlotSummary）— 代码存在但标记为关闭
13. Character State Overlay — 代码存在但在剧情总结模式关闭时不启用

### ❓ 待讨论

1. **WorldVariable**：是否值得单独实现
2. **CharacterStateOverlay**：仅在剧情总结模式开启时启用

### ❌ 已移除

1. **PlotSummary**：总结模式关闭时不启用
2. **RetrievedDetail**：总结模式关闭时不启用
3. **ExampleMessage**：移除
4. **PrefillSeed**：移除

***

## 九、推荐的分阶段实施顺序

### Stage A ✅

- 把当前 [`compile_chat_messages()`](src-tauri/src/services/prompt_compiler.rs:8) 改造成显式 IR 输出

### Stage B ✅

- 引入 `PromptCompileInput` / `PromptCompileResult`
- 聊天链路从"直接得到 messages"改成"先 compile，再由 adapter 转 request"

### Stage C ✅

- 引入 world book budget / history window budget
- 引入 debug report

### Stage D ✅

- 接预设 block / params
- 接 provider override

### Stage E 🆕（当前）

- PlayerBase 已实现，作为玩家人设层

### Stage F ❓

- 讨论并决定 WorldVariable 与 CharacterStateOverlay 的边界

***

## 十、推荐新增规划文档字段

为了后续交接稳定，建议在后端对接文档里明确：

- compiler input sources
- compiler phases
- block priority rules
- budget trimming rules
- provider adapter boundary
- debug report schema

***

## 十一、当前建议总结

本轮 Prompt Compiler 规划应当：

- 先聚焦 `classic` 单模型编译链路
- 把 provider 兼容翻译与上下文编译明确拆开
- **PlayerBase 已实现，作为玩家人设层**
- 关闭剧情总结模式时，Character State Overlay / PlotSummary / RetrievedDetail 不启用
- 关闭剧情总结模式时使用完整上下文窗口，而不是最近原文窗口
- 移除 ExampleMessage 与 PrefillSeed
- 待讨论 WorldVariable 是否值得单独实现
- 多人协议层仅在多人模式中启用

一句话总结：

**Prompt Compiler 当前最紧迫的事：把层级边界和启用条件理顺，特别是确认 WorldVariable 是否值得单独实现。**

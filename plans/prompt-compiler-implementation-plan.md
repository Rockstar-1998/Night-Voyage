# Night Voyage Prompt Compiler 实施规划

## 任务分类

- 分类：后端架构规划
- 目标范围：先落地 `classic` 单模型编译链路，`director_agents` 只保留扩展位
- 约束：所有网络、数据库、LLM 编译、规则执行、检索与裁剪都在 `Rust` 后端完成

## 规划目标

把当前较轻量的 [`compile_chat_messages()`](src-tauri/src/services/prompt_compiler.rs:8) 演进为可扩展的 Prompt Compiler，满足以下要求：

1. 对输入源做结构化收集，而不是直接拼字符串
2. 对预设、角色卡、世界书、历史摘要、向量检索、预填充、正则、宏做明确分层
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
4. 历史总结层与向量检索层尚未正式进入编译器
5. Prefill / Regex / Macro 还停留在架构讨论层，未转成可执行编译阶段
6. Provider adapter 还没把“编译结果”和“请求体构造”清晰隔开

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
    pub include_streaming_seed: bool,
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
    PresetRule,
    CharacterBase,
    WorldBookMatch,
    WorldVariable,
    PlotSummary,
    RetrievedDetail,
    RecentHistory,
    CurrentUser,
    ExampleMessage,
    PrefillSeed,
}
```}

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
    WorldBook { world_book_id: i64, entry_id: i64 },
    Summary { summary_id: i64 },
    Retrieval { fragment_id: i64 },
    Message { message_id: i64 },
    Compiler,
}
```

### 3. 最终编译结果

```rust
pub struct PromptCompileResult {
    pub system_blocks: Vec<PromptBlock>,
    pub example_blocks: Vec<PromptBlock>,
    pub history_blocks: Vec<PromptBlock>,
    pub current_user_block: PromptBlock,
    pub prefill_seed: Option<PromptBlock>,
    pub params: CompiledSamplingParams,
    pub debug: PromptCompileDebugReport,
}
```

***

## 五、各输入源与编译器的边界

### 1. 预设

职责：

- 生成风格
- 格式规则
- few-shot 示例
- 采样参数
- prefill 策略
- macro 模板源
- provider override

进入编译器的形式：

- `PresetRule`
- `ExampleMessage`
- `PrefillSeed`
- `CompiledSamplingParams`

### 2. 角色卡

职责：

- 基础人格底座
- 名称 / 身份 / 描述 / 标签
- 多开局

进入编译器的形式：

- `CharacterBase`

### 3. 世界书

职责：

- 提供命中后才注入的外部设定

进入编译器的形式：

- `WorldBookMatch`

### 4. 世界变量层

职责：

- 记录世界中的地点、人物等变量因剧情推进和时间流逝而发生的相对于原角色卡和世界书的变化
- 例如：某个地点从"荒废"变为"繁华"、某个NPC从"陌生人"变为"挚友"、某个时间节点后的季节/天气变化

进入编译器的形式：

- `WorldVariable`

### 5. 剧情总结

职责：

- 提供剧情主线摘要

进入编译器的形式：

- `PlotSummary`

### 6. 向量检索

职责：

- 召回少量高相关细节

进入编译器的形式：

- `RetrievedDetail`

### 7. 最近原文窗口

职责：

- 保持近场对话连续性

进入编译器的形式：

- `RecentHistory`

### 8. 当前轮输入

职责：

- 当前真正要响应的目标输入

进入编译器的形式：

- `CurrentUser`

***

## 六、各阶段推荐顺序

### Phase 1. 收集

- conversation metadata
- preset
- bound character
- world book
- summaries
- retrieval fragments
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

- `PresetRule`
- `CharacterBase`
- `WorldBookMatch`
- `WorldVariable`
- `PlotSummary`
- `RetrievedDetail`
- `ExampleMessage`
- `RecentHistory`
- `CurrentUser`
- `PrefillSeed`

### Phase 5. 排序与覆盖

推荐优先级：

1. PresetRule
2. CharacterBase
3. WorldBookMatch
4. WorldVariable
5. PlotSummary
6. RetrievedDetail
7. ExampleMessage
8. RecentHistory
9. CurrentUser

### Phase 6. 预算裁剪

裁剪顺序建议：

- 先裁 `RetrievedDetail`
- 再裁 `PlotSummary`
- 再裁部分 `WorldBookMatch`
- 不裁 `CurrentUser`
- 尽量不裁 `RecentHistory` 的最近窗口
- 不裁高优先级 `PresetRule` 与 `CharacterBase`

### Phase 7. Provider 能力判断

要判断：

- system 支持方式
- few-shot 注入方式
- prefill 支持方式
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

## 八、第一版只做 classic 的推荐实现范围

### 本轮真正实现范围

1. `PromptCompileInput`
2. `PromptBlock` 与 `PromptCompileResult`
3. 预设层先预留 block 输入位，不必完整落地 CRUD
4. 角色卡基础层编译
5. 世界书命中层编译
6. 最近原文窗口编译
7. 当前轮输入编译
8. 轻量预算裁剪框架
9. debug report 框架

### 只预留不实现

- `director_agents` 多 agent 编译路径
- 向量检索正式接入
- AI 总结层正式接入
- prefill / regex / macro 全量功能

***

## 九、推荐的分阶段实施顺序

### Stage A

- 把当前 [`compile_chat_messages()`](src-tauri/src/services/prompt_compiler.rs:8) 改造成显式 IR 输出

### Stage B

- 引入 `PromptCompileInput` / `PromptCompileResult`
- 聊天链路从“直接得到 messages”改成“先 compile，再由 adapter 转 request”

### Stage C

- 引入 world book budget / history window budget
- 引入 debug report

### Stage D

- 接预设 block / examples / params
- 接 provider capability matrix

### Stage E

- 接世界变量层 / 剧情总结 / retrieval fragments

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

- 先聚焦 `classic` 单模型链路
- 先把当前轻量实现升级成结构化 IR 编译器
- `director_agents` 只保留扩展位
- 把 provider 兼容翻译与上下文编译明确拆开
- 为预设、总结、检索、prefill、regex、macro 留好接口，但不一次吃完

一句话总结：

**Prompt Compiler 第一版最应该做的，不是功能堆满，而是把“输入源 -> 分层 block -> 预算裁剪 -> provider adapter”这条主骨架先立住。**

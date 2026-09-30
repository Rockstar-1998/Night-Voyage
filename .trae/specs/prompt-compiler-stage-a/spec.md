# Prompt Compiler 结构化升级 Spec

## Why

当前 `compile_chat_messages()` 是轻量字符串拼接，无法满足 Prompt Compiler 的分层排序、预算裁剪和 provider 适配需求。根据 `prompt-compiler-implementation-plan.md` 和 `prompt-compiler-and-injection-summary.md` 的规划，需要将编译链路升级为结构化 IR，并支持 Phase 1~5 的核心能力。

## What Changes

- 引入 `PromptCompileInput` / `PromptCompileMode` / `PromptBudget` 输入结构
- 引入 `PromptBlock` / `PromptBlockKind` / `PromptBlockSource` 中间表示 IR
- 引入 `PromptCompileResult` 输出结构，包含 `system_blocks`、`example_blocks`、`history_blocks`、`current_user_block`、`params`、`debug`
- 定义 10 层注入顺序，其中 `WorldVariable` 层标记为 TODO 暂不实现
- 明确 Provider Adapter 边界：Prompt Compiler 输出 IR，Provider Adapter 负责转换为 provider-specific 请求体
- 新增 `PromptCompileDebugReport` debug 报告框架

## Impact

- Affected specs: Prompt Compiler 实施规划、预设系统、Provider Adapter 层
- Affected code:
  - `src-tauri/src/services/prompt_compiler.rs` — 核心编译逻辑重构
  - `src-tauri/src/llm/mod.rs` — 新增 `PromptCompileInput`、`PromptBlock`、`PromptCompileResult` 等类型
  - `src-tauri/src/commands/chat.rs` — 调用链路改为先 compile 再 adapter 转 request
  - `src-tauri/src/services/provider_adapter.rs` — 接收 `PromptCompileResult` IR，转换为 Anthropic/OpenAI 请求体

## ADDED Requirements

### Requirement: PromptCompileInput 输入结构

系统 SHALL 提供 `PromptCompileInput` 结构作为 Prompt Compiler 的输入。

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

pub enum PromptCompileMode {
    ClassicChat,
    ClassicRegenerate,
    AgentDirectorPlaceholder, // 预留
}

pub struct PromptBudget {
    pub max_total_tokens: Option<usize>,
    pub reserve_output_tokens: Option<usize>,
    pub max_summary_tokens: Option<usize>,
    pub max_world_book_tokens: Option<usize>,
    pub max_retrieved_detail_tokens: Option<usize>,
}
```

### Requirement: PromptBlockKind 枚举

系统 SHALL 提供 `PromptBlockKind` 枚举，定义所有 Block 类型。

```rust
pub enum PromptBlockKind {
    PresetRule,        // 预设规则层
    CharacterBase,      // 角色卡基础层
    WorldBookMatch,     // 世界书命中层
    WorldVariable,      // 世界变量层 [TODO 暂不实现]
    PlotSummary,        // 剧情总结层
    RetrievedDetail,    // 向量细节层
    RecentHistory,      // 最近原文窗口
    CurrentUser,        // 当前轮输入
    ExampleMessage,     // 预设 few-shot 示例层
    PrefillSeed,        // 预填充种子
}
```

### Requirement: PromptBlock 中间表示

系统 SHALL 提供 `PromptBlock` 结构作为编译中间表示。

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

### Requirement: PromptCompileResult 输出结构

系统 SHALL 提供 `PromptCompileResult` 作为 Prompt Compiler 的输出。

```rust
pub struct PromptCompileResult {
    pub system_blocks: Vec<PromptBlock>,    // 注入 system 的分层块
    pub example_blocks: Vec<PromptBlock>,   // few-shot 示例
    pub history_blocks: Vec<PromptBlock>,   // 历史层
    pub current_user_block: PromptBlock,    // 当前轮输入
    pub prefill_seed: Option<PromptBlock>,   // 预填充种子
    pub params: CompiledSamplingParams,      // 采样参数
    pub debug: PromptCompileDebugReport,     // Debug 报告
}
```

### Requirement: 编译阶段排序

系统 SHALL 在 Phase 5 按以下优先级排序 system_blocks：

```
1. PresetRule
2. CharacterBase
3. WorldBookMatch
4. WorldVariable [TODO 暂不实现]
5. PlotSummary
6. RetrievedDetail
7. ExampleMessage
8. RecentHistory
9. CurrentUser
```

### Requirement: Provider Adapter 边界

系统 SHALL 明确 Provider Adapter 职责：

- **Prompt Compiler**：负责语义与上下文编译，产出 provider-agnostic IR
- **Provider Adapter**：负责将 `PromptCompileResult` IR 转换为 provider-specific 请求体（Anthropic `RequestTextBlock[]` / OpenAI `messages[]`）

### Requirement: 预算裁剪

系统 SHALL 提供预算裁剪框架，按以下顺序裁剪：

```
1. RetrievedDetail（最先裁）
2. PlotSummary
3. WorldBookMatch（部分裁）
4. 不裁 CurrentUser
5. 尽量不裁 RecentHistory 最近窗口
6. 不裁 PresetRule 与 CharacterBase
```

### Requirement: Debug 报告

系统 SHALL 在 `PromptCompileResult.debug` 中提供编译过程的 debug 信息，便于调试和审计。

## MODIFIED Requirements

### Requirement: compile_chat_messages 重构

`compile_chat_messages()` SHALL 改造为接收 `PromptCompileInput`，输出 `PromptCompileResult`，而非直接输出 `messages[]` 字符串。

### Requirement: 调用链路改造

聊天请求链路 SHALL 从"直接得到 messages"改造为"先 Prompt Compiler compile，再由 Provider Adapter 转 request"。

## REMOVED Requirements

无移除项。本阶段为纯增量扩展。

## 暂不实现标记

以下功能在本阶段 **标记为 TODO**，暂不实现：

| 功能 | 原因 |
|------|------|
| `WorldVariable` 层 | 剧情总结层（PlotSummary）已可部分覆盖其功能，待后续独立实现 |
| `RetrievedDetail` 向量检索层 | 待向量检索系统接入后再实现 |
| `PrefillSeed` 预填充层 | 预填充策略待预设系统完善后实现 |
| `ExampleMessage` few-shot 示例 | 待预设系统 block 接入后实现 |
| `AgentDirectorPlaceholder` 多 agent | 仅预留扩展位，本阶段聚焦 classic 单模型 |

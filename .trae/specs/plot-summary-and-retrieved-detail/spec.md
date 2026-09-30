# PlotSummary 层与 RetrievedDetail 层 Spec

## Why

当前 Prompt Compiler 已实现 PresetRule 和 CharacterBase 层，但剧情总结层（PlotSummary）和向量细节层（RetrievedDetail）尚未实现。根据 `prompt-compiler-implementation-plan.md` 第五节和第八节，这两个层是长对话历史场景下的关键能力：PlotSummary 压缩剧情主线，RetrievedDetail 召回高相关细节。

## What Changes

- 新增 PlotSummary 层编译能力：从历史消息中提取剧情主线摘要
- 新增 RetrievedDetail 层编译能力：向量检索召回相关细节片段
- 在 `prompt_compiler.rs` 中为这两个层添加加载逻辑
- 集成到 `PromptCompileResult.system_blocks` 中参与排序和预算裁剪

## Impact

- Affected specs: Prompt Compiler 实施规划、history-memory-injection-architecture
- Affected code:
  - `src-tauri/src/services/prompt_compiler.rs` — 新增 PlotSummary 和 RetrievedDetail 加载逻辑
  - `src-tauri/src/services/vector_store.rs` — 向量存储检索（若尚未实现）
  - `src-tauri/src/db/` — 可能需要新增 summary 相关表结构

## 层职责定义

### PlotSummary 层（剧情总结层）

**职责**：压缩区间剧情主线，提供长对话的上下文理解能力

**数据来源**：
- 定时 AI 总结（每 N 轮对话后触发）
- 或用户手动编写的剧情摘要

**注入形式**：
- `PromptBlockKind::PlotSummary`
- `PromptBlockSource::Summary { summary_id }`
- 注入位置：system，优先级 500（WorldBookMatch 之后，RetrievedDetail 之前）

**内容格式**：
```
[剧情摘要]
- 场景：Night Voyage 酒吧
- 进度：管理员初次到访，与 test character 互动
- 关系：管理员表现出急躁，test character 正在试图找到调酒师佩丽卡
```

### RetrievedDetail 层（向量细节层）

**职责**：从大量历史中召回与当前输入最相关的高相关细节片段

**数据来源**：
- 历史消息切分的 embedding 向量
- 相似度检索结果

**注入形式**：
- `PromptBlockKind::RetrievedDetail`
- `PromptBlockSource::Retrieval { fragment_id }`
- 注入位置：system 低权重参考区，优先级 600（PlotSummary 之后）
- 数量严格限制（建议最多 3-5 条）

**内容格式**：
```
[相关细节]
- (round_id=15) 管理员说："我要酒！！！"
- (round_id=12) test character 回应："佩丽卡？这个名字我不太熟悉呢"
```

## 裁剪规则

### PlotSummary 裁剪

- 按 `max_summary_tokens` 预算裁剪
- 优先保留最新剧情摘要
- 不裁剪 1/3 以内的内容

### RetrievedDetail 裁剪

- 按 `max_retrieved_detail_tokens` 预算裁剪
- 严格限制条数（建议最多 3-5 条）
- 按相似度得分排序，低分优先裁剪

## 数据模型

### Summary 表（建议）

```sql
CREATE TABLE summaries (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL,
    round_start INTEGER NOT NULL,
    round_end INTEGER NOT NULL,
    summary_text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    is_manual BOOLEAN DEFAULT FALSE
);
```

### RetrievalFragment 表（建议）

```sql
CREATE TABLE retrieval_fragments (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL,
    round_id INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding_id INTEGER,
    created_at INTEGER NOT NULL
);
```

## 暂不实现

| 功能 | 原因 |
|------|------|
| 自动 AI 总结触发 | 需要规划 AI 总结触发时机和频率 |
| embedding 生成 | 需要接入 embedding 模型服务 |
| 向量索引构建 | 需要规划向量数据库集成 |

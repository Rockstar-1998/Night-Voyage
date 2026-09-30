# Tasks

- [ ] Task 1: 数据库 Schema 设计与迁移

  - [ ] SubTask 1.1: 设计 `summaries` 表结构（id, conversation_id, round_start, round_end, summary_text, created_at, is_manual）
  - [ ] SubTask 1.2: 设计 `retrieval_fragments` 表结构（id, conversation_id, round_id, content_hash, content, embedding_id, created_at）
  - [ ] SubTask 1.3: 在 `src-tauri/src/db/` 中添加数据库迁移脚本
  - [ ] SubTask 1.4: 创建对应的 Rust struct 和 repository

- [ ] Task 2: PlotSummary 层编译逻辑

  - [ ] SubTask 2.1: 在 `prompt_compiler.rs` 中新增 `load_plot_summary_blocks()` 函数
  - [ ] SubTask 2.2: 从 `summaries` 表加载当前对话的最新 N 条剧情摘要
  - [ ] SubTask 2.3: 创建 `PromptBlock`（kind=PlotSummary, source=Summary）并填充元数据
  - [ ] SubTask 2.4: 在 `compile_prompt()` 的 Phase 1 收集阶段调用 `load_plot_summary_blocks()`
  - [ ] SubTask 2.5: 实现按 `max_summary_tokens` 预算裁剪逻辑

- [ ] Task 3: RetrievedDetail 层编译逻辑（框架）

  - [ ] SubTask 3.1: 在 `prompt_compiler.rs` 中新增 `load_retrieved_detail_blocks()` 函数框架
  - [ ] SubTask 3.2: 定义检索接口 `trait RetrievalService`，预留 embedding 集成位
  - [ ] SubTask 3.3: 创建 `PromptBlock`（kind=RetrievedDetail, source=Retrieval）并填充元数据
  - [ ] SubTask 3.4: 在 `compile_prompt()` 的 Phase 1 收集阶段调用 `load_retrieved_detail_blocks()`
  - [ ] SubTask 3.5: 实现按 `max_retrieved_detail_tokens` 预算裁剪逻辑，严格限制条数

- [ ] Task 4: 集成到编译链路

  - [ ] SubTask 4.1: 在 `compile_prompt()` 中按顺序调用 WorldBookMatch → PlotSummary → RetrievedDetail
  - [ ] SubTask 4.2: 验证各层按优先级正确排序（WorldBookMatch=300, PlotSummary=500, RetrievedDetail=600）
  - [ ] SubTask 4.3: 验证预算裁剪按正确顺序执行
  - [ ] SubTask 4.4: 验证日志输出包含新增的 PromptBlock 元数据

- [ ] Task 5: 验证与测试

  - [ ] SubTask 5.1: 运行 `cargo check` 确认编译通过
  - [ ] SubTask 5.2: 发送测试对话请求，验证日志中 PlotSummary 和 RetrievedDetail 层出现
  - [ ] SubTask 5.3: 验证 `system_blocks_metadata` 中包含正确的 kind、source、priority

# Task Dependencies

- Task 2 和 Task 3 可并行执行（独立的数据加载逻辑）
- Task 4 依赖 Task 1、Task 2、Task 3
- Task 5 依赖 Task 4

# 暂不实现

- 自动 AI 总结触发逻辑（Task 2 中的手动 Summary 加载优先实现）
- embedding 模型集成（RetrievedDetail 预留框架，数据来源先用手动标记的片段）

# Tasks

- [x] Task 1: 扩展 plot_summary_mode 值域，支持 "disabled"
  - [x] SubTask 1.1: 在 `plot_summaries.rs` 中新增常量 `PLOT_SUMMARY_MODE_DISABLED = "disabled"`
  - [x] SubTask 1.2: 修改 `normalize_plot_summary_mode` 接受 `"disabled"` 值
  - [x] SubTask 1.3: 修改 `load_plot_summary_mode` 默认值从 `"ai"` 改为 `"disabled"`
  - [x] SubTask 1.4: 将 `load_plot_summary_mode` 改为 `pub` 以便其他模块调用

- [x] Task 2: 数据库迁移——修改默认值
  - [x] SubTask 2.1: 在 INSERT 语句中显式设置 `plot_summary_mode = 'disabled'`（SQLite 不支持 ALTER COLUMN SET DEFAULT）

- [x] Task 3: prompt_compiler.rs 中按 plot_summary_mode 门控子功能
  - [x] SubTask 3.1: 在 `compile_prompt` 中查询 `plot_summary_mode`，缓存结果
  - [x] SubTask 3.2: 仅当 `plot_summary_mode != "disabled"` 时调用 `load_latest_character_state_overlay_block`
  - [x] SubTask 3.3: 仅当 `plot_summary_mode != "disabled"` 时调用 `load_plot_summary_blocks` 和 `load_completed_plot_summary_round_ids_before`
  - [x] SubTask 3.4: 当 `plot_summary_mode == "disabled"` 时，`latest_character_state_overlay_text` 保持 `None`，world_book 触发源不包含 overlay 文本

- [x] Task 4: stream_processor.rs 中按 plot_summary_mode 门控后台任务
  - [x] SubTask 4.1: 在 `spawn_stream_task` 的成功路径中，查询 `plot_summary_mode`
  - [x] SubTask 4.2: 仅当 `plot_summary_mode != "disabled"` 时调用 `spawn_character_state_overlay_generation_task`
  - [x] SubTask 4.3: 仅当 `plot_summary_mode != "disabled"` 时调用 `spawn_plot_summary_processing_task`

- [x] Task 5: 命令层适配
  - [x] SubTask 5.1: 修改 `plot_summaries_update_mode` 命令支持 `"disabled"` 值，切换到 `"disabled"` 时无需触发任何后台任务

- [x] Task 6: 验证
  - [x] SubTask 6.1: `cargo check` 编译通过
  - [ ] SubTask 6.2: 新会话默认 `plot_summary_mode = "disabled"`，请求体中无 Character State Overlay 和 Plot Summary 块
  - [ ] SubTask 6.3: 切换到 `"ai"` 模式后，后续回复正常生成 overlay 和 plot summary

# Task Dependencies

- Task 1 是所有后续 Task 的前置依赖
- Task 2 独立于 Task 3-5，可并行
- Task 3 和 Task 4 可并行
- Task 5 依赖 Task 1
- Task 6 依赖所有其他 Task

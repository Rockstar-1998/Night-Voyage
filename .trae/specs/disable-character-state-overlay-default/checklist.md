# Checklist

- [x] `PLOT_SUMMARY_MODE_DISABLED` 常量已添加到 `plot_summaries.rs`
- [x] `normalize_plot_summary_mode` 接受 `"disabled"` 值
- [x] `load_plot_summary_mode` 默认返回 `"disabled"`（数据库值为 NULL 时）
- [x] `load_plot_summary_mode` 已改为 `pub`
- [x] 新建会话 INSERT 语句中显式设置 `plot_summary_mode = 'disabled'`
- [x] `compile_prompt` 中 `load_latest_character_state_overlay_block` 仅在 `plot_summary_mode != "disabled"` 时调用
- [x] `compile_prompt` 中 `load_plot_summary_blocks` 和 `load_completed_plot_summary_round_ids_before` 仅在 `plot_summary_mode != "disabled"` 时调用
- [x] `compile_prompt` 中 `plot_summary_mode == "disabled"` 时 `latest_character_state_overlay_text` 为 `None`
- [x] `spawn_stream_task` 中 `spawn_character_state_overlay_generation_task` 仅在 `plot_summary_mode != "disabled"` 时调用
- [x] `spawn_stream_task` 中 `spawn_plot_summary_processing_task` 仅在 `plot_summary_mode != "disabled"` 时调用
- [x] `plot_summaries_update_mode` 命令支持 `"disabled"` 值
- [x] `cargo check` 编译通过
- [ ] 新会话请求体中无 Character State Overlay 和 Plot Summary 块

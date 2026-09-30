# Character State Overlay 默认关闭 Spec

## Why

Character State Overlay 是剧情总结模式（Plot Summary Mode）的子功能，与剧情总结层、向量细节层、最近原文窗口同属一个功能组。关闭剧情总结模式时，用户使用完整上下文窗口，这些子功能均不应生效。当前 `plot_summary_mode` 仅支持 `"ai"` 和 `"manual"` 两种值，默认为 `"ai"`，导致 Character State Overlay 和剧情总结层在所有新会话中无条件启用——这与功能层级关系不符，且浪费 token 预算和 API 调用。

## What Changes

- 新增 `plot_summary_mode = "disabled"` 状态，表示剧情总结模式关闭
- **BREAKING**：`plot_summary_mode` 默认值从 `"ai"` 改为 `"disabled"`
- `prompt_compiler.rs` 中 `load_latest_character_state_overlay_block` 和 `load_plot_summary_blocks` 仅在 `plot_summary_mode != "disabled"` 时执行
- `stream_processor.rs` 中 `spawn_character_state_overlay_generation_task` 和 `spawn_plot_summary_processing_task` 仅在 `plot_summary_mode != "disabled"` 时执行
- `normalize_plot_summary_mode` 接受 `"disabled"` 值
- `plot_summaries_update_mode` 命令支持 `"disabled"` 值

## Impact

- Affected specs: `plot-summary-and-retrieved-detail`
- Affected code:
  - `src-tauri/src/services/plot_summaries.rs` — `normalize_plot_summary_mode`、`load_plot_summary_mode`
  - `src-tauri/src/services/prompt_compiler.rs` — `compile_prompt` 中 overlay 和 plot summary 加载逻辑
  - `src-tauri/src/services/stream_processor.rs` — `spawn_stream_task` 中 overlay 和 plot summary 生成逻辑
  - `src-tauri/src/commands/plot_summaries.rs` — `plot_summaries_update_mode`
  - `src-tauri/migrations/` — 新增迁移修改默认值

## ADDED Requirements

### Requirement: Plot Summary Mode Disabled 状态

系统 SHALL 支持 `plot_summary_mode = "disabled"`，表示剧情总结模式完全关闭。

#### Scenario: 新会话默认关闭剧情总结模式
- **WHEN** 创建新会话
- **THEN** `plot_summary_mode` 默认为 `"disabled"`

#### Scenario: disabled 模式下不生成 Character State Overlay
- **WHEN** 会话的 `plot_summary_mode` 为 `"disabled"` 且 AI 回复完成
- **THEN** 不触发 `spawn_character_state_overlay_generation_task`

#### Scenario: disabled 模式下不生成剧情总结
- **WHEN** 会话的 `plot_summary_mode` 为 `"disabled"` 且 AI 回复完成
- **THEN** 不触发 `spawn_plot_summary_processing_task`

#### Scenario: disabled 模式下不注入 Character State Overlay 到请求体
- **WHEN** 会话的 `plot_summary_mode` 为 `"disabled"` 且执行 `compile_prompt`
- **THEN** `load_latest_character_state_overlay_block` 不被调用，请求体中不包含 Character State Overlay 块

#### Scenario: disabled 模式下不注入剧情总结到请求体
- **WHEN** 会话的 `plot_summary_mode` 为 `"disabled"` 且执行 `compile_prompt`
- **THEN** `load_plot_summary_blocks` 和 `load_completed_plot_summary_round_ids_before` 不被调用，请求体中不包含 Plot Summary 块，历史对话使用完整上下文窗口

#### Scenario: 切换到 ai 或 manual 模式后子功能恢复
- **WHEN** 用户将会话的 `plot_summary_mode` 从 `"disabled"` 切换为 `"ai"` 或 `"manual"`
- **THEN** 后续 AI 回复完成后正常触发 overlay 和 plot summary 生成任务，`compile_prompt` 正常加载对应块

## MODIFIED Requirements

### Requirement: Plot Summary Mode 值域

`normalize_plot_summary_mode` 接受的值域从 `{"ai", "manual"}` 扩展为 `{"disabled", "ai", "manual"}`。

### Requirement: Plot Summary Mode 默认值

`load_plot_summary_mode` 在数据库值为 NULL 时，默认返回 `"disabled"` 而非 `"ai"`。

## REMOVED Requirements

无移除项。

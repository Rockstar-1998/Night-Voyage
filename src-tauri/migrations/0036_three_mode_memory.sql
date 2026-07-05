-- 三模式记忆架构迁移
-- stateless: 纯多轮对话，无 PlotSummary，WorldVariable 由 preset 控制，RecentHistory 全量
-- legacy:    省钱方案，PlotSummary(batch+占位) + WorldVariable + RecentHistory(可配置窗口)
-- mem0:      MEM0 全权托管，SQLite 文件级快照回溯，无 PlotSummary/WorldVariable/RecentHistory

-- message_rounds: 合并 WorldVariable（替代 character_state_overlays）
ALTER TABLE message_rounds ADD COLUMN world_variables TEXT;

-- plot_summaries: 支持 per-round 占位行
ALTER TABLE plot_summaries ADD COLUMN round_id INTEGER;

-- presets: WorldVariable 开关
ALTER TABLE presets ADD COLUMN world_variable_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ADD COLUMN world_variable_schema TEXT;

-- conversations: MEM0 快照窗口（per-conversation）
ALTER TABLE conversations ADD COLUMN mem0_snapshot_window INTEGER NOT NULL DEFAULT 20;

-- 删除 character_state_overlays 表（开发阶段，不保留数据）
DROP TABLE IF EXISTS character_state_overlays;

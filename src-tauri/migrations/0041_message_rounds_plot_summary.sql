-- message_rounds: 添加 plot_summary 列
-- 用于蓝图 SchemaField(db_mapping="plot_summary") 的即时持久化
-- PlotSummary 的批量处理逻辑（plot_summaries 表 + pending/ready/completed 状态机）保持不变
ALTER TABLE message_rounds ADD COLUMN plot_summary TEXT;

-- 删除已废弃的旧字段（SQLite 3.35+ 支持 DROP COLUMN）
-- plot_summary_mode 和 mem0_enabled 已被 memory_mode 统一替代
ALTER TABLE conversations DROP COLUMN plot_summary_mode;
ALTER TABLE conversations DROP COLUMN mem0_enabled;

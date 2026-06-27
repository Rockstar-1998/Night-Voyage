-- 统一记忆模式：替代 plot_summary_mode + mem0_enabled
-- stateless (默认): 纯多轮对话，无任何记忆/总结
-- mem0: Mem0 作为唯一动态记忆权威
ALTER TABLE conversations ADD COLUMN memory_mode TEXT NOT NULL DEFAULT 'stateless';

-- 数据迁移：旧模式启用了任何动态层的会话 → 'mem0'
UPDATE conversations SET memory_mode = 'mem0'
WHERE plot_summary_mode != 'disabled' OR mem0_enabled != 0;

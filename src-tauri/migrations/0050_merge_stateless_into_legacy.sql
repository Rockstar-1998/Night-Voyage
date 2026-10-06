-- 0050_merge_stateless_into_legacy.sql
-- 2026-10-06 裁定：stateless 并入 legacy（两者同属"经典单次对话流"），
-- 记忆模式收敛为 legacy / mem0 两态。
-- 会话表中的 'stateless' 值全部迁移为 'legacy'（数据语义不变：同一条经典对话流）。

UPDATE conversations SET memory_mode = 'legacy' WHERE memory_mode = 'stateless';

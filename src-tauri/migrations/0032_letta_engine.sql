-- Letta 引擎集成：为会话添加引擎类型和 Letta Agent ID
ALTER TABLE conversations ADD COLUMN engine_kind TEXT NOT NULL DEFAULT 'native';
ALTER TABLE conversations ADD COLUMN letta_agent_id TEXT;

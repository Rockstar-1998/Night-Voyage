-- mem0-rs memory layer: per-conversation switch.
-- Default 0 (disabled) so existing conversations keep current behaviour and the
-- optional memory layer never runs unless the user explicitly opts in.
ALTER TABLE conversations ADD COLUMN mem0_enabled INTEGER NOT NULL DEFAULT 0;

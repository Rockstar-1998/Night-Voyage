-- 0051_round_snapshots.sql
-- 全 Agent 统一执行架构工单 04：每轮 Agent 执行前的游戏状态快照基线。
-- Regenerate / Delete / Rewind 的状态回滚以本表为事务基线：
-- 每行 = 某会话某轮在执行开始前 session_states 的完整 DataContainer 副本。
-- 首次捕获为准（INSERT OR IGNORE）：同轮重试/重生成不得覆盖原始基线。

CREATE TABLE IF NOT EXISTS round_snapshots (
    conversation_id INTEGER NOT NULL,
    round_id INTEGER NOT NULL,
    round_index INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, round_id)
);

CREATE INDEX IF NOT EXISTS idx_round_snapshots_conv_index
    ON round_snapshots (conversation_id, round_index);

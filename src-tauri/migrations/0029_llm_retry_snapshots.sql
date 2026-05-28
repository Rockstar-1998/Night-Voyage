CREATE TABLE IF NOT EXISTS llm_retry_snapshots (
    round_id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL,
    assistant_message_id INTEGER NOT NULL,
    provider_id INTEGER NOT NULL,
    provider_kind TEXT NOT NULL,
    model_name TEXT NOT NULL,
    response_mode TEXT,
    request_snapshot_json TEXT NOT NULL,
    validation_snapshot_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('prepared', 'running', 'failed', 'succeeded', 'aborted')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_started_at INTEGER,
    last_succeeded_at INTEGER,
    last_aborted_at INTEGER,
    FOREIGN KEY (round_id) REFERENCES message_rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (assistant_message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_llm_retry_snapshots_conversation_id ON llm_retry_snapshots(conversation_id);
CREATE INDEX IF NOT EXISTS idx_llm_retry_snapshots_status ON llm_retry_snapshots(status);
CREATE INDEX IF NOT EXISTS idx_llm_retry_snapshots_updated_at ON llm_retry_snapshots(updated_at DESC);

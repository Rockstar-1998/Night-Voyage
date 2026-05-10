ALTER TABLE conversations ADD COLUMN plot_summary_mode TEXT NOT NULL DEFAULT 'ai';

CREATE TABLE IF NOT EXISTS plot_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    batch_index INTEGER NOT NULL,
    start_round_id INTEGER NOT NULL,
    end_round_id INTEGER NOT NULL,
    start_round_index INTEGER NOT NULL,
    end_round_index INTEGER NOT NULL,
    covered_round_count INTEGER NOT NULL,
    covered_round_ids_json TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('ai', 'manual', 'manual_override')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'completed', 'failed')),
    summary_text TEXT,
    provider_kind TEXT,
    model_name TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (start_round_id) REFERENCES message_rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (end_round_id) REFERENCES message_rounds(id) ON DELETE CASCADE,
    UNIQUE (conversation_id, batch_index)
);

CREATE INDEX IF NOT EXISTS idx_plot_summaries_conversation_status_batch
    ON plot_summaries(conversation_id, status, batch_index ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_plot_summaries_conversation_range
    ON plot_summaries(conversation_id, start_round_id, end_round_id);

CREATE INDEX IF NOT EXISTS idx_plot_summaries_conversation_completed
    ON plot_summaries(conversation_id, completed_at DESC, batch_index DESC);

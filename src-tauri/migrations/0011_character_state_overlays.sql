CREATE TABLE IF NOT EXISTS character_state_overlays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    round_id INTEGER NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('ai', 'manual')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'completed', 'failed')),
    summary_text TEXT,
    input_user_content TEXT,
    input_assistant_content TEXT,
    provider_kind TEXT,
    model_name TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES character_cards(id) ON DELETE CASCADE,
    FOREIGN KEY (round_id) REFERENCES message_rounds(id) ON DELETE CASCADE,
    UNIQUE (conversation_id, character_id, round_id, source_kind)
);

CREATE INDEX IF NOT EXISTS idx_character_state_overlays_lookup
    ON character_state_overlays(conversation_id, character_id, status, round_id DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_character_state_overlays_round
    ON character_state_overlays(round_id, source_kind, status);

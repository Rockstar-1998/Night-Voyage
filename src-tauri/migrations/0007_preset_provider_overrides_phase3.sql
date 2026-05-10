CREATE TABLE IF NOT EXISTS preset_stop_sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preset_id INTEGER NOT NULL,
    stop_text TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS preset_provider_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preset_id INTEGER NOT NULL,
    provider_kind TEXT NOT NULL,
    temperature_override REAL,
    max_output_tokens_override INTEGER,
    top_p_override REAL,
    stop_sequences_override TEXT,
    disabled_block_types TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE,
    UNIQUE (preset_id, provider_kind)
);

CREATE INDEX IF NOT EXISTS idx_preset_stop_sequences_preset_sort
    ON preset_stop_sequences(preset_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_preset_provider_overrides_preset_provider
    ON preset_provider_overrides(preset_id, provider_kind ASC);

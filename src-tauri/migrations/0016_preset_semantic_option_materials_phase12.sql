CREATE TABLE IF NOT EXISTS preset_semantic_option_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    option_id INTEGER NOT NULL,
    block_type TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 100,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    scope TEXT NOT NULL DEFAULT 'global' CHECK (
        scope IN ('global', 'chat_only', 'group_only', 'single_only', 'completion_only', 'agent_only')
    ),
    is_locked INTEGER NOT NULL DEFAULT 0,
    lock_reason TEXT,
    exclusive_group_key TEXT,
    exclusive_group_label TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (option_id) REFERENCES preset_semantic_options(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_preset_semantic_option_blocks_option_sort
    ON preset_semantic_option_blocks(option_id, sort_order ASC, priority DESC, id ASC);

CREATE TABLE IF NOT EXISTS preset_semantic_option_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    option_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (option_id) REFERENCES preset_semantic_options(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_preset_semantic_option_examples_option_sort
    ON preset_semantic_option_examples(option_id, sort_order ASC, id ASC);

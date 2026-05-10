CREATE TABLE IF NOT EXISTS preset_semantic_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preset_id INTEGER NOT NULL,
    group_key TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    selection_mode TEXT NOT NULL DEFAULT 'single' CHECK (selection_mode IN ('single', 'multiple')),
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE,
    UNIQUE (preset_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_preset_semantic_groups_preset_sort
    ON preset_semantic_groups(preset_id, sort_order ASC, id ASC);

CREATE TABLE IF NOT EXISTS preset_semantic_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    option_key TEXT NOT NULL,
    parent_option_id INTEGER,
    label TEXT NOT NULL,
    description TEXT,
    depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_selected INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    expansion_kind TEXT NOT NULL DEFAULT 'mixed' CHECK (expansion_kind IN ('blocks', 'examples', 'params', 'mixed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (group_id) REFERENCES preset_semantic_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_option_id) REFERENCES preset_semantic_options(id) ON DELETE CASCADE,
    UNIQUE (group_id, option_key)
);

CREATE INDEX IF NOT EXISTS idx_preset_semantic_options_group_sort
    ON preset_semantic_options(group_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_preset_semantic_options_parent_sort
    ON preset_semantic_options(parent_option_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_preset_semantic_options_group_selected
    ON preset_semantic_options(group_id, is_selected, sort_order ASC, id ASC);

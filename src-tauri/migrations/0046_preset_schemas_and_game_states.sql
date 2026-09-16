-- 0046_preset_schemas_and_game_states.sql
-- 独立 Schema 资产表与会话状态容器表

CREATE TABLE IF NOT EXISTS preset_schemas (
    id TEXT PRIMARY KEY NOT NULL,
    preset_id INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    retention_depth INTEGER DEFAULT NULL,
    fields_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preset_schemas_preset_id ON preset_schemas(preset_id);

CREATE TABLE IF NOT EXISTS session_states (
    session_id INTEGER PRIMARY KEY NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS preset_ui_layouts (
    id TEXT PRIMARY KEY NOT NULL,
    preset_id INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mount_type TEXT NOT NULL DEFAULT 'RightDock',
    theme TEXT NOT NULL DEFAULT 'xuanqing',
    custom_css TEXT NOT NULL DEFAULT '',
    layout_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preset_ui_layouts_preset_id ON preset_ui_layouts(preset_id);


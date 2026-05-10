ALTER TABLE presets ADD COLUMN description TEXT;
ALTER TABLE presets ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE presets ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE presets ADD COLUMN temperature REAL;
ALTER TABLE presets ADD COLUMN max_output_tokens INTEGER;
ALTER TABLE presets ADD COLUMN top_p REAL;
ALTER TABLE presets ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

UPDATE presets
SET updated_at = CASE
    WHEN created_at IS NOT NULL AND created_at > 0 THEN created_at
    ELSE CAST(strftime('%s', 'now') AS INTEGER)
END
WHERE updated_at = 0;

CREATE TABLE IF NOT EXISTS preset_prompt_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preset_id INTEGER NOT NULL,
    block_type TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 100,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    scope TEXT NOT NULL DEFAULT 'global' CHECK (
        scope IN ('global', 'chat_only', 'group_only', 'single_only', 'completion_only', 'agent_only')
    ),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
);

INSERT INTO preset_prompt_blocks (
    preset_id,
    block_type,
    title,
    content,
    sort_order,
    priority,
    is_enabled,
    scope,
    created_at,
    updated_at
)
SELECT
    id,
    'custom:legacy-system',
    'Legacy System Prompt',
    system_prompt_template,
    0,
    100,
    1,
    'global',
    created_at,
    updated_at
FROM presets
WHERE system_prompt_template IS NOT NULL AND TRIM(system_prompt_template) <> '';

INSERT INTO preset_prompt_blocks (
    preset_id,
    block_type,
    title,
    content,
    sort_order,
    priority,
    is_enabled,
    scope,
    created_at,
    updated_at
)
SELECT
    id,
    'custom:legacy-jailbreak',
    'Legacy Jailbreak Prompt',
    jailbreak_prompt,
    1,
    100,
    1,
    'global',
    created_at,
    updated_at
FROM presets
WHERE jailbreak_prompt IS NOT NULL AND TRIM(jailbreak_prompt) <> '';

CREATE INDEX IF NOT EXISTS idx_presets_updated_at ON presets(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_preset_prompt_blocks_preset_sort
    ON preset_prompt_blocks(preset_id, sort_order ASC, id ASC);

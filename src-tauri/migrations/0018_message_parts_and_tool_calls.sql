CREATE TABLE IF NOT EXISTS message_content_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    part_index INTEGER NOT NULL,
    part_type TEXT NOT NULL CHECK (
        part_type IN (
            'text',
            'image',
            'tool_use',
            'tool_result',
            'thinking',
            'redacted_thinking'
        )
    ),
    text_value TEXT,
    json_value TEXT,
    asset_id INTEGER,
    mime_type TEXT,
    tool_use_id TEXT,
    tool_name TEXT,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    UNIQUE (message_id, part_index)
);

CREATE TABLE IF NOT EXISTS message_tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    tool_use_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'ignored')),
    result_message_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (result_message_id) REFERENCES messages(id) ON DELETE SET NULL,
    UNIQUE (tool_use_id)
);

CREATE INDEX IF NOT EXISTS idx_message_content_parts_message_id
ON message_content_parts(message_id, part_index);

CREATE INDEX IF NOT EXISTS idx_message_content_parts_hidden
ON message_content_parts(message_id, is_hidden, part_index);

CREATE INDEX IF NOT EXISTS idx_message_tool_calls_message_id
ON message_tool_calls(message_id, created_at);

CREATE INDEX IF NOT EXISTS idx_message_tool_calls_result_message_id
ON message_tool_calls(result_message_id);

CREATE TABLE IF NOT EXISTS message_content_parts_new (
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
            'redacted_thinking',
            'structured_output'
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

INSERT INTO message_content_parts_new
    SELECT id, message_id, part_index, part_type, text_value, json_value,
           asset_id, mime_type, tool_use_id, tool_name, is_hidden, created_at
    FROM message_content_parts;

DROP TABLE message_content_parts;

ALTER TABLE message_content_parts_new RENAME TO message_content_parts;

CREATE INDEX IF NOT EXISTS idx_message_content_parts_message_id
ON message_content_parts(message_id, part_index);

CREATE INDEX IF NOT EXISTS idx_message_content_parts_hidden
ON message_content_parts(message_id, is_hidden, part_index);

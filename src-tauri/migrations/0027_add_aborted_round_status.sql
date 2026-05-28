-- Add 'aborted' to the message_rounds status CHECK constraint
-- SQLite does not support ALTER TABLE to modify CHECK constraints,
-- so we must recreate the table.

CREATE TABLE message_rounds_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    round_index INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('collecting', 'queued', 'streaming', 'completed', 'failed', 'aborted')),
    aggregated_user_content TEXT,
    aggregate_message_id INTEGER,
    active_assistant_message_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

INSERT INTO message_rounds_new
    SELECT id, conversation_id, round_index, status, aggregated_user_content,
           aggregate_message_id, active_assistant_message_id, created_at,
           updated_at, completed_at
    FROM message_rounds;

DROP TABLE message_rounds;

ALTER TABLE message_rounds_new RENAME TO message_rounds;

CREATE INDEX idx_message_rounds_conversation_id ON message_rounds(conversation_id);
CREATE INDEX idx_message_rounds_status ON message_rounds(status);

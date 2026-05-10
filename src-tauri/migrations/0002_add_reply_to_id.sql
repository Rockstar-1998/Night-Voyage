ALTER TABLE messages ADD COLUMN reply_to_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON messages(reply_to_id);

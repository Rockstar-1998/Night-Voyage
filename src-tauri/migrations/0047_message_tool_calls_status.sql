-- 0047_message_tool_calls_status.sql
-- 为 message_tool_calls.status 增加 'result_available' 取值。
--
-- 原委：回注链路在把 ToolResult 写入后会把该行标记为 'result_available'
-- （见 repositories/message_repository.rs::update_tool_call_status），
-- 而 0018 建表时的 CHECK 只允许 ('pending','completed','failed','ignored')，
-- 导致 UPDATE 必然失败、tool_result 无法落盘，Agent 模式的 ToolCall 回路在此断开。
--
-- SQLite 不支持修改 CHECK 约束，因此按 0027 的既有做法重建表并搬移数据。

CREATE TABLE message_tool_calls_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    tool_use_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'result_available', 'completed', 'failed', 'ignored')
    ),
    result_message_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (result_message_id) REFERENCES messages(id) ON DELETE SET NULL,
    UNIQUE (tool_use_id)
);

INSERT INTO message_tool_calls_new
    SELECT id, message_id, tool_use_id, tool_name, input_json, status,
           result_message_id, created_at, updated_at
    FROM message_tool_calls;

DROP TABLE message_tool_calls;

ALTER TABLE message_tool_calls_new RENAME TO message_tool_calls;

CREATE INDEX idx_message_tool_calls_message_id
ON message_tool_calls(message_id, created_at);

CREATE INDEX idx_message_tool_calls_result_message_id
ON message_tool_calls(result_message_id);

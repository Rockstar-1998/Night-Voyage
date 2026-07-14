-- 蓝图编辑器 Gate 选择状态存储：记录会话级 MutexGate / GroupGate 的运行时选中项
-- selected_keys 存 JSON 数组字符串，例如 ["option_a"]；MutexGate 单元素，GroupGate 多元素
-- 空数组在应用层转为 DELETE，避免遗留 [] 垃圾行
CREATE TABLE conversation_gate_selections (
    conversation_id INTEGER NOT NULL,
    gate_id TEXT NOT NULL,
    selected_keys TEXT NOT NULL,
    PRIMARY KEY (conversation_id, gate_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversation_gate_selections_conversation_id
    ON conversation_gate_selections(conversation_id);

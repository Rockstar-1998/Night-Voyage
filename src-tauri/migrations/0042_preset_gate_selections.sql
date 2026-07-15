-- 预设级 Gate 选择状态存储：记录某预设蓝图中 MutexGate / GroupGate 节点的运行时选中项
-- key 改为 node_id（蓝图节点本身即分组单位，gate_id 已移除）
-- selected_keys 存 JSON 数组字符串，例如 ["option_a"]；MutexGate 单元素，GroupGate 多元素
-- 空数组在应用层转为 DELETE，避免遗留 [] 垃圾行
CREATE TABLE preset_gate_selections (
    preset_id INTEGER NOT NULL,
    node_id TEXT NOT NULL,
    selected_keys TEXT NOT NULL,
    PRIMARY KEY (preset_id, node_id),
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
);

CREATE INDEX idx_preset_gate_selections_preset_id
    ON preset_gate_selections(preset_id);

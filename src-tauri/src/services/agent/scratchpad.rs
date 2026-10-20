//! 纯内存文本工作区（Scratchpad）及原生工具链。
//!
//! 在多智能体（剧本流水线、导演-演员）执行过程中，提供纯内存暂存区。
//! 包含 `draft`、`critique`、`final` 及任意自定义键名的文本缓冲。
//! 全生命周期仅存留于内存中，不落盘（0 disk I/O，不写 SQLite `agent_drafts` 表），
//! 回合结束或管道执行完毕后自动清空释放。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use serde_json::Value;

use crate::llm::LlmToolDefinition;

/// 临时纯内存文本工作区。
#[derive(Debug, Clone, Default)]
pub struct Scratchpad {
    buffers: Arc<RwLock<HashMap<String, String>>>,
}

impl Scratchpad {
    /// 创建一个新的空工作区。
    pub fn new() -> Self {
        Self {
            buffers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 从现有数据初始化工作区。
    pub fn from_map(map: HashMap<String, String>) -> Self {
        Self {
            buffers: Arc::new(RwLock::new(map)),
        }
    }

    /// 读取工作区变量。不存在时返回 Err。
    pub fn read_text(&self, key: &str) -> Result<String, String> {
        let guard = self
            .buffers
            .read()
            .map_err(|e| format!("读取工作区失败: {}", e))?;
        guard
            .get(key)
            .cloned()
            .ok_or_else(|| format!("工作区变量 `{key}` 不存在"))
    }

    /// 写入或更新工作区变量。
    pub fn write_text(&self, key: impl Into<String>, content: impl Into<String>) {
        if let Ok(mut guard) = self.buffers.write() {
            guard.insert(key.into(), content.into());
        }
    }

    /// 检查指定变量是否存在。
    pub fn contains_key(&self, key: &str) -> bool {
        self.buffers
            .read()
            .map(|g| g.contains_key(key))
            .unwrap_or(false)
    }

    /// 获取工作区所有键值对的快照。
    pub fn snapshot(&self) -> HashMap<String, String> {
        self.buffers
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    /// 清空工作区缓冲，释放所有暂存文本。
    pub fn clear(&self) {
        if let Ok(mut guard) = self.buffers.write() {
            guard.clear();
        }
    }
}

/// 返回 `read_text` 工具的 LLM 契约定义。
pub fn read_text_tool_definition() -> LlmToolDefinition {
    LlmToolDefinition {
        name: "read_text".to_string(),
        description: Some("从纯内存临时工作区中按 key 读取文本内容（如 draft、critique、final 等）".to_string()),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "工作区缓冲区的键名（如 draft、critique、final）"
                }
            },
            "required": ["key"]
        }),
    }
}

/// 返回 `write_text` 工具的 LLM 契约定义。
pub fn write_text_tool_definition() -> LlmToolDefinition {
    LlmToolDefinition {
        name: "write_text".to_string(),
        description: Some("向纯内存临时工作区中写入或更新指定 key 的文本内容（生命周期仅限本轮，不持久化落盘）".to_string()),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "工作区缓冲区的键名（如 draft、critique、final）"
                },
                "content": {
                    "type": "string",
                    "description": "要暂存的文本内容"
                }
            },
            "required": ["key", "content"]
        }),
    }
}

/// 返回原生工作区工具清单（[read_text, write_text]）。
pub fn native_scratchpad_tools() -> Vec<LlmToolDefinition> {
    vec![read_text_tool_definition(), write_text_tool_definition()]
}

/// 执行原生 scratchpad 工具调用。若 tool_name 不是 read_text 或 write_text，返回 None。
pub fn execute_scratchpad_tool(
    scratchpad: &Scratchpad,
    tool_name: &str,
    arguments_json: &str,
) -> Option<Result<String, String>> {
    match tool_name {
        "read_text" => Some(execute_read_text(scratchpad, arguments_json)),
        "write_text" => Some(execute_write_text(scratchpad, arguments_json)),
        _ => None,
    }
}

fn execute_read_text(scratchpad: &Scratchpad, arguments_json: &str) -> Result<String, String> {
    let args: Value = serde_json::from_str(arguments_json)
        .map_err(|e| format!("read_text 参数不是合法 JSON: {}", e))?;
    let key = args
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "read_text 缺少必需参数 `key`".to_string())?;
    scratchpad.read_text(key)
}

fn execute_write_text(scratchpad: &Scratchpad, arguments_json: &str) -> Result<String, String> {
    let args: Value = serde_json::from_str(arguments_json)
        .map_err(|e| format!("write_text 参数不是合法 JSON: {}", e))?;
    let key = args
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "write_text 缺少必需参数 `key`".to_string())?;
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "write_text 缺少必需参数 `content`".to_string())?;
    scratchpad.write_text(key, content);
    Ok(format!("成功写入工作区变量 `{key}`（长度: {} 字符）", content.chars().count()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scratchpad_read_write() {
        let pad = Scratchpad::new();
        assert!(!pad.contains_key("draft"));
        assert!(pad.read_text("draft").is_err());

        pad.write_text("draft", "初稿内容");
        assert!(pad.contains_key("draft"));
        assert_eq!(pad.read_text("draft").unwrap(), "初稿内容");

        // Overwrite
        pad.write_text("draft", "更新后的初稿");
        assert_eq!(pad.read_text("draft").unwrap(), "更新后的初稿");

        // Multiple keys
        pad.write_text("critique", "批注：语气需更严肃");
        pad.write_text("final", "定稿正文");
        let snap = pad.snapshot();
        assert_eq!(snap.len(), 3);
        assert_eq!(snap.get("critique").unwrap(), "批注：语气需更严肃");

        // Clear
        pad.clear();
        assert_eq!(pad.snapshot().len(), 0);
        assert!(!pad.contains_key("draft"));
    }

    #[test]
    fn test_execute_native_tools() {
        let pad = Scratchpad::new();

        // 1. write_text tool
        let write_res = execute_scratchpad_tool(
            &pad,
            "write_text",
            r#"{"key": "draft", "content": "测试文本A"}"#,
        );
        assert!(write_res.is_some());
        assert!(write_res.unwrap().is_ok());
        assert_eq!(pad.read_text("draft").unwrap(), "测试文本A");

        // 2. read_text tool
        let read_res = execute_scratchpad_tool(
            &pad,
            "read_text",
            r#"{"key": "draft"}"#,
        );
        assert!(read_res.is_some());
        assert_eq!(read_res.unwrap().unwrap(), "测试文本A");

        // 3. read_text non-existent key
        let read_missing = execute_scratchpad_tool(
            &pad,
            "read_text",
            r#"{"key": "non_existent"}"#,
        );
        assert!(read_missing.is_some());
        assert!(read_missing.unwrap().is_err());

        // 4. invalid arguments
        let invalid_args = execute_scratchpad_tool(
            &pad,
            "write_text",
            r#"{"key": "test"}"#, // missing content
        );
        assert!(invalid_args.is_some());
        assert!(invalid_args.unwrap().is_err());

        // 5. unknown tool
        let unknown = execute_scratchpad_tool(
            &pad,
            "unknown_tool",
            r#"{}"#,
        );
        assert!(unknown.is_none());
    }

    #[test]
    fn test_tool_definitions() {
        let tools = native_scratchpad_tools();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "read_text");
        assert_eq!(tools[1].name, "write_text");
        assert!(tools[0].input_schema.get("properties").is_some());
        assert!(tools[1].input_schema.get("properties").is_some());
    }
}

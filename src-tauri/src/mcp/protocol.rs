//! 开发期 MCP 端点的 JSON-RPC 2.0 载荷结构与响应构造。
//!
//! 只处理端点自身需要的最小面：单对象请求、成功/错误响应、错误消息规范化。
//! 批量（数组）载荷与流式响应均不在支持范围内，遇到时显式报错而非静默丢弃。

use serde::Deserialize;
use serde_json::{json, Value};

/// JSON-RPC 标准错误码与端点扩展错误码。
pub mod codes {
    /// 载荷不是合法 JSON-RPC 请求对象。
    pub const INVALID_REQUEST: i64 = -32600;
    /// 方法不存在。
    pub const METHOD_NOT_FOUND: i64 = -32601;
    /// 方法参数不合法。
    pub const INVALID_PARAMS: i64 = -32602;
    /// 内部执行失败。
    pub const INTERNAL_ERROR: i64 = -32603;
    /// 端点扩展：鉴权失败。
    pub const UNAUTHORIZED: i64 = -32001;
}

/// 入站 JSON-RPC 请求。`jsonrpc` 版本字段按规范固定为 `2.0`，此处不解析以免产生无用状态。
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    /// 请求标识。缺省表示这是通知，端点不返回响应体。
    #[serde(default)]
    pub id: Option<Value>,
    /// 方法名。
    pub method: String,
    /// 方法参数，缺省视为无参数。
    #[serde(default)]
    pub params: Option<Value>,
}

/// 构造成功响应，`id` 原样回显。
pub fn success(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// 构造错误响应。
pub fn error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message.into() }
    })
}

/// 把错误消息规范化为跨进程可安全传输的形态（反斜杠替换为正斜杠），与既有 IPC 约定一致。
pub fn normalize_message(message: impl std::fmt::Display) -> String {
    message.to_string().replace('\\', "/")
}

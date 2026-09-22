//! MCP 工具层。
//!
//! 每个工具只做参数解包与结果序列化，业务语义一律调用既有 `services` / `repositories`
//! 函数：不重写门禁、不重算负重、不自己拼 DataContainer。因此这些工具与前端走的是
//! 同一条后端路径，不存在第二套实现。
//!
//! 错误语义遵循 C2：处理器返回 `Result<String, String>`，禁止 `unwrap_or` 默认成功、
//! 禁止 `.ok()` 吞错。坏数据（如 `missing field unitWeight`）必须原样上抛给调用方。

use async_trait::async_trait;
use serde_json::{json, Value};
use sqlx::{FromRow, SqlitePool};
use tauri::AppHandle;

use crate::models::game_state::DataContainer;
use crate::services::agent_runtime::{
    broadcast_hud_patch, execute_tool_call, load_session_state, reset_session_state,
};

/// 工具执行上下文：真实运行中的应用句柄与真实连接池。
#[derive(Clone)]
pub struct ToolContext {
    /// 运行中应用的句柄。工具由此访问真实事件总线（HUD 增量广播）。
    pub app: AppHandle,
    /// 与应用同一来源、同一路径的 SQLite 连接池。
    pub db: SqlitePool,
}

/// MCP 工具契约。实现者为无状态单元结构体，多态由 trait 分发承担。
#[async_trait]
pub trait McpTool: Send + Sync {
    /// 工具名（MCP 侧唯一标识）。
    fn name(&self) -> &'static str;
    /// 工具说明，供代理侧判断调用时机。
    fn description(&self) -> &'static str;
    /// 入参 JSON Schema。
    fn input_schema(&self) -> Value;
    /// 执行工具。`args` 已保证是 JSON 对象。
    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String>;
}

/// 取出必需的整数参数。
fn require_i64(args: &Value, key: &str) -> Result<i64, String> {
    args.get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("缺少必需的整数参数: {}", key))
}

/// 取出必需的字符串参数。
fn require_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("缺少必需的字符串参数: {}", key))
}

/// 取出可选整数参数；缺省时返回调用方给出的默认值（可选参数语义，非错误兜底）。
fn optional_i64(args: &Value, key: &str, default: i64) -> i64 {
    args.get(key).and_then(Value::as_i64).unwrap_or(default)
}

/// 关键表行数快照。
#[derive(FromRow)]
struct TableCounts {
    conversation_count: i64,
    message_count: i64,
    session_state_count: i64,
}

/// 会话一行。
#[derive(FromRow)]
struct ConversationRow {
    id: i64,
    character_id: Option<i64>,
    title: Option<String>,
    created_at: i64,
    updated_at: i64,
}

/// 会话状态原始行。
#[derive(FromRow)]
struct SessionStateRawRow {
    state_json: String,
    updated_at: i64,
}

/// 消息一行。
#[derive(FromRow)]
struct MessageRow {
    id: i64,
    role: String,
    created_at: i64,
    content_length: i64,
    is_swipe: i64,
    swipe_index: i64,
}

/// 报告端点实际生效的库路径与关键表行数。
///
/// 用于确认代理侧与应用侧操作的是同一个库——库路径存在三种解析来源
/// （环境变量、exe 同目录、应用数据目录），不做这一步容易改错库。
pub struct NvDbInfo;

#[async_trait]
impl McpTool for NvDbInfo {
    fn name(&self) -> &'static str {
        "nv_db_info"
    }

    fn description(&self) -> &'static str {
        "报告本端点连接的 SQLite 库路径与 conversations / messages / session_states 行数，用于确认代理侧与应用侧操作同一个库。"
    }

    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {}, "additionalProperties": false })
    }

    async fn call(&self, ctx: &ToolContext, _args: &Value) -> Result<String, String> {
        let db_path = crate::db::resolve_db_path(&ctx.app)
            .map_err(|err| format!("解析数据库路径失败: {}", err))?
            .to_string_lossy()
            .replace('\\', "/");

        let counts: TableCounts = sqlx::query_as(
            "SELECT (SELECT count(*) FROM conversations) AS conversation_count, \
                    (SELECT count(*) FROM messages) AS message_count, \
                    (SELECT count(*) FROM session_states) AS session_state_count",
        )
        .fetch_one(&ctx.db)
        .await
        .map_err(|err| format!("统计表行数失败: {}", err))?;

        Ok(format!(
            "数据库路径: {}\nconversations={}\nmessages={}\nsession_states={}",
            db_path, counts.conversation_count, counts.message_count, counts.session_state_count
        ))
    }
}

/// 列出全部会话。
pub struct NvConversationsList;

#[async_trait]
impl McpTool for NvConversationsList {
    fn name(&self) -> &'static str {
        "nv_conversations_list"
    }

    fn description(&self) -> &'static str {
        "列出库中全部会话（id、绑定的角色卡、标题、创建与更新时间戳）。"
    }

    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {}, "additionalProperties": false })
    }

    async fn call(&self, ctx: &ToolContext, _args: &Value) -> Result<String, String> {
        let rows: Vec<ConversationRow> = sqlx::query_as(
            "SELECT id, character_id, title, created_at, updated_at FROM conversations ORDER BY id",
        )
        .fetch_all(&ctx.db)
        .await
        .map_err(|err| format!("查询 conversations 失败: {}", err))?;

        if rows.is_empty() {
            return Ok("(库中没有任何会话)".to_string());
        }

        Ok(rows
            .iter()
            .map(|row| {
                format!(
                    "#{} | character={} | title={} | created_at={} | updated_at={}",
                    row.id,
                    row.character_id.map_or_else(|| "(未绑定)".to_string(), |v| v.to_string()),
                    row.title.clone().unwrap_or_else(|| "(无标题)".to_string()),
                    row.created_at,
                    row.updated_at
                )
            })
            .collect::<Vec<String>>()
            .join("\n"))
    }
}

/// 读取会话状态的原始 JSON 字符串，不做任何解析或修补。
pub struct NvSessionStateRaw;

#[async_trait]
impl McpTool for NvSessionStateRaw {
    fn name(&self) -> &'static str {
        "nv_session_state_raw"
    }

    fn description(&self) -> &'static str {
        "读取 session_states.state_json 的原始字符串与长度，不做解析、不做修补。用于区分「库里的数据坏了」与「界面渲染坏了」。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" } },
            "required": ["sessionId"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;

        let row: Option<SessionStateRawRow> =
            sqlx::query_as("SELECT state_json, updated_at FROM session_states WHERE session_id = ?")
                .bind(session_id)
                .fetch_optional(&ctx.db)
                .await
                .map_err(|err| format!("查询 session_states 失败: {}", err))?;

        let Some(row) = row else {
            return Ok(format!(
                "session_id={} 在 session_states 中没有行（该会话从未建立过游戏状态）",
                session_id
            ));
        };

        Ok(format!(
            "session_id={}\nupdated_at={}\nlength={}\nraw:\n{}",
            session_id,
            row.updated_at,
            row.state_json.len(),
            row.state_json
        ))
    }
}

/// 经真实 service 解析会话状态（与前端 `session_game_state_get` 同一条路径）。
pub struct NvSessionStateGet;

#[async_trait]
impl McpTool for NvSessionStateGet {
    fn name(&self) -> &'static str {
        "nv_session_state_get"
    }

    fn description(&self) -> &'static str {
        "调用后端 load_session_state 解析会话状态，与前端 session_game_state_get 完全同一条路径（含 serde 契约校验）。解析失败会原样报错，不做任何降级。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" } },
            "required": ["sessionId"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;
        let state: DataContainer = load_session_state(&ctx.db, session_id).await?;
        let pretty = serde_json::to_string_pretty(&state)
            .map_err(|err| format!("序列化 DataContainer 失败: {}", err))?;

        Ok(format!(
            "session_id={}\n条目数: stats={} inventory={} flags={} scratchpad={}\n当前负重={:.2} 负重上限={:.2} 金币={:.2}\n解析结果:\n{}",
            session_id,
            state.stats.len(),
            state.inventory.len(),
            state.flags.len(),
            state.scratchpad.len(),
            state.total_weight(),
            state.get_stat("max_weight"),
            state.get_stat("gold"),
            pretty
        ))
    }
}

/// 执行 ToolCall 契约：真实门禁判定 + 真实持久化 + 真实 HUD 广播。
pub struct NvToolCallExecute;

#[async_trait]
impl McpTool for NvToolCallExecute {
    fn name(&self) -> &'static str {
        "nv_tool_call_execute"
    }

    fn description(&self) -> &'static str {
        "调用后端 execute_tool_call 执行 ToolCall 契约（check_inventory / get_player_stats / inspect_item / buy_item / use_item / read_text / write_text）。含确定性门禁、状态持久化与 HUD 增量广播，结果会实时反映到运行中的界面。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" },
                "toolName": { "type": "string", "description": "ToolCall 契约名" },
                "argumentsJson": { "type": "string", "description": "参数对象序列化后的 JSON 字符串，例如 {\"item_id\":\"health_potion\",\"count\":1}" }
            },
            "required": ["sessionId", "toolName", "argumentsJson"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;
        let tool_name = require_str(args, "toolName")?;
        let arguments_json = require_str(args, "argumentsJson")?;

        execute_tool_call(&ctx.db, &ctx.app, session_id, tool_name, arguments_json).await
    }
}

/// 把会话状态重置为默认初始状态。
///
/// 存量数据可能由历史脚本写入、字段名不符合当前 serde 契约（例如 snake_case 的
/// `unit_weight`），此时任何以 `load_session_state` 为入口的工具都会在解析阶段失败。
/// 本工具调用后端 `reset_session_state`，由 serde 序列化生成字段名必然合法的状态，
/// 是修复此类数据的唯一合规路径——不手写 JSON 塞库。
pub struct NvSessionStateReset;

#[async_trait]
impl McpTool for NvSessionStateReset {
    fn name(&self) -> &'static str {
        "nv_session_state_reset"
    }

    fn description(&self) -> &'static str {
        "调用后端 reset_session_state 把会话状态重置为默认初始状态（由 serde 序列化生成，字段名必然符合 camelCase 契约），并广播 HUD 增量。用于把不符合当前契约的存量数据恢复到合法状态。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" } },
            "required": ["sessionId"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;
        let state = reset_session_state(&ctx.db, session_id).await?;
        broadcast_hud_patch(&ctx.app, session_id, &state, None);

        let pretty = serde_json::to_string_pretty(&state)
            .map_err(|err| format!("序列化 DataContainer 失败: {}", err))?;

        Ok(format!(
            "session_id={} 已重置为默认状态并广播 HUD 增量:\n{}",
            session_id, pretty
        ))
    }
}

/// 列出会话的消息。
pub struct NvMessagesList;

#[async_trait]
impl McpTool for NvMessagesList {
    fn name(&self) -> &'static str {
        "nv_messages_list"
    }

    fn description(&self) -> &'static str {
        "列出指定会话的消息（id、角色、时间戳、正文长度、swipe 状态）。默认最多 50 条。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" },
                "limit": { "type": "integer", "description": "最多返回条数，默认 50" }
            },
            "required": ["sessionId"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;
        let limit = optional_i64(args, "limit", 50);
        if limit <= 0 {
            return Err("limit 必须为正整数".to_string());
        }

        let rows: Vec<MessageRow> = sqlx::query_as(
            "SELECT id, role, created_at, length(content) AS content_length, is_swipe, swipe_index \
             FROM messages WHERE conversation_id = ? ORDER BY id LIMIT ?",
        )
        .bind(session_id)
        .bind(limit)
        .fetch_all(&ctx.db)
        .await
        .map_err(|err| format!("查询 messages 失败: {}", err))?;

        if rows.is_empty() {
            return Ok(format!("conversation_id={} 没有任何消息", session_id));
        }

        let lines = rows
            .iter()
            .map(|row| {
                format!(
                    "#{} | {} | {} 字 | created_at={} | is_swipe={} swipe_index={}",
                    row.id, row.role, row.content_length, row.created_at, row.is_swipe, row.swipe_index
                )
            })
            .collect::<Vec<String>>()
            .join("\n");

        Ok(format!(
            "conversation_id={} 共返回 {}\n{}",
            session_id,
            rows.len(),
            lines
        ))
    }
}

/// 全部已注册工具。
pub fn all_tools() -> Vec<Box<dyn McpTool>> {
    vec![
        Box::new(NvDbInfo),
        Box::new(NvConversationsList),
        Box::new(NvSessionStateRaw),
        Box::new(NvSessionStateGet),
        Box::new(NvToolCallExecute),
        Box::new(NvSessionStateReset),
        Box::new(NvMessagesList),
    ]
}

/// 按名字查找工具。
pub fn find_tool(name: &str) -> Option<Box<dyn McpTool>> {
    all_tools().into_iter().find(|tool| tool.name() == name)
}

/// 构造 `tools/list` 所需的工具描述列表。
pub fn tool_listing() -> Vec<Value> {
    all_tools()
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name(),
                "description": tool.description(),
                "inputSchema": tool.input_schema(),
            })
        })
        .collect()
}

/// 供错误提示使用的工具名清单。
pub fn tool_names() -> String {
    all_tools()
        .iter()
        .map(|tool| tool.name())
        .collect::<Vec<&str>>()
        .join(", ")
}

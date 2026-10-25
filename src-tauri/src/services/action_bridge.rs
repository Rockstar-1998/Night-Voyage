//! 动作与跨域读的统一治理层（spec：L3 动作通道 / L2 Querier）。
//!
//! 白名单是**设置数据**（`settings` 表），不是代码枚举：ActionButton 的用户动作
//! 与 Querier 的跨域读共用同一份 `action_bridge.command_whitelist`，未在白名单中
//! 的命令一律显式报错（I2 / C2 零静默回退，默认空白名单 = 注册前不可用）。
//! 后端分发采用可扩展命令路由注册表 (`ActionBridgeRouter`) 将白名单命令动态映射到具体处理器。

use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};

use futures_util::future::BoxFuture;
use serde_json::Value;
use sqlx::{Row, SqlitePool};

pub const WHITELIST_SETTING_KEY: &str = "action_bridge.command_whitelist";

/// 动态命令处理器签名：接收数据库连接池、会话 ID 和参数 JSON，返回异步执行结果。
pub type ActionCommandHandler =
    Arc<dyn for<'a> Fn(&'a SqlitePool, i64, &'a Value) -> BoxFuture<'a, Result<Value, String>> + Send + Sync>;

/// 可扩展 ActionBridge 命令路由器
#[derive(Clone)]
pub struct ActionBridgeRouter {
    handlers: HashMap<String, ActionCommandHandler>,
}

impl ActionBridgeRouter {
    /// 创建一个空的命令路由器。
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /// 创建预置内置命令处理器的路由器。
    pub fn with_builtins() -> Self {
        let mut router = Self::new();
        router.register("query_world_book_entries", |db, conv_id, args| {
            Box::pin(query_world_book_entries(db, conv_id, args))
        });
        router.register("get_character_detail", |db, _conv_id, args| {
            Box::pin(get_character_detail(db, args))
        });
        router.register("create_world_book_entry", |db, conv_id, args| {
            Box::pin(create_world_book_entry(db, conv_id, args))
        });
        router.register("get_conversation_detail", |db, conv_id, args| {
            Box::pin(get_conversation_detail(db, conv_id, args))
        });
        router.register("get_session_state", |db, conv_id, args| {
            Box::pin(get_session_state(db, conv_id, args))
        });
        router
    }

    /// 注册一个命令处理器。
    pub fn register<F>(&mut self, command: impl Into<String>, handler: F) -> &mut Self
    where
        F: for<'a> Fn(&'a SqlitePool, i64, &'a Value) -> BoxFuture<'a, Result<Value, String>>
            + Send
            + Sync
            + 'static,
    {
        self.handlers.insert(command.into(), Arc::new(handler));
        self
    }

    /// 移除已注册命令。
    pub fn unregister(&mut self, command: &str) -> Option<ActionCommandHandler> {
        self.handlers.remove(command)
    }

    /// 检查命令是否已注册处理器。
    pub fn has_command(&self, command: &str) -> bool {
        self.handlers.contains_key(command)
    }

    /// 获取命令处理器。
    pub fn get_handler(&self, command: &str) -> Option<ActionCommandHandler> {
        self.handlers.get(command).cloned()
    }

    /// 执行命令分发。
    pub async fn dispatch(
        &self,
        db: &SqlitePool,
        conversation_id: i64,
        command: &str,
        args: &Value,
    ) -> Result<Value, String> {
        if let Some(handler) = self.get_handler(command) {
            handler(db, conversation_id, args).await
        } else {
            Err(format!("命令 `{command}` 已在白名单但尚未注册后端处理器"))
        }
    }
}

impl Default for ActionBridgeRouter {
    fn default() -> Self {
        Self::with_builtins()
    }
}

static GLOBAL_ROUTER: OnceLock<RwLock<ActionBridgeRouter>> = OnceLock::new();

/// 获取全局默认命令路由器的读写锁。
pub fn global_router() -> &'static RwLock<ActionBridgeRouter> {
    GLOBAL_ROUTER.get_or_init(|| RwLock::new(ActionBridgeRouter::with_builtins()))
}

/// 向全局默认路由器动态注册新命令处理器。
pub fn register_command<F>(command: impl Into<String>, handler: F)
where
    F: for<'a> Fn(&'a SqlitePool, i64, &'a Value) -> BoxFuture<'a, Result<Value, String>>
        + Send
        + Sync
        + 'static,
{
    if let Ok(mut router) = global_router().write() {
        router.register(command, handler);
    }
}

/// 读取白名单。未写入过 = 空白名单（I2：动作件注册前显式报错）。
pub async fn load_whitelist(db: &SqlitePool) -> Result<Vec<String>, String> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = ? LIMIT 1")
            .bind(WHITELIST_SETTING_KEY)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?;
    match value {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|err| format!("白名单设置不是合法 JSON 数组: {err}")),
        None => Ok(Vec::new()),
    }
}

/// 覆盖保存白名单（设置页增删后整体写回）。
pub async fn save_whitelist(db: &SqlitePool, commands: &[String]) -> Result<(), String> {
    let raw = serde_json::to_string(commands).map_err(|err| err.to_string())?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(WHITELIST_SETTING_KEY)
    .bind(&raw)
    .execute(db)
    .await
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// 白名单校验：未在白名单中显式报错（C2 零静默回退）。
pub async fn ensure_allowed(db: &SqlitePool, command: &str) -> Result<(), String> {
    let whitelist = load_whitelist(db).await?;
    if whitelist.iter().any(|c| c == command) {
        Ok(())
    } else {
        Err(format!("命令 `{command}` 未在当前会话的预设白名单中"))
    }
}

/// 白名单校验 + 后端分发。`conversation_id` 供会话级命令（如按会话世界书检索）
/// 定位数据域。
pub async fn invoke(
    db: &SqlitePool,
    conversation_id: i64,
    command: &str,
    args: &Value,
) -> Result<Value, String> {
    ensure_allowed(db, command).await?;
    dispatch(db, conversation_id, command, args).await
}

/// 支持指定自定义路由器的执行入口（供单测与隔离环境）。
pub async fn invoke_with_router(
    router: &ActionBridgeRouter,
    db: &SqlitePool,
    conversation_id: i64,
    command: &str,
    args: &Value,
) -> Result<Value, String> {
    ensure_allowed(db, command).await?;
    router.dispatch(db, conversation_id, command, args).await
}

/// 后端分发路由：白名单命令名 → 已注册命令实现。
pub async fn dispatch(
    db: &SqlitePool,
    conversation_id: i64,
    command: &str,
    args: &Value,
) -> Result<Value, String> {
    let handler = {
        let router = global_router()
            .read()
            .map_err(|err| format!("读取全局命令路由失败: {err}"))?;
        router.get_handler(command)
    };

    if let Some(handler) = handler {
        handler(db, conversation_id, args).await
    } else {
        Err(format!("命令 `{command}` 已在白名单但尚未注册后端处理器"))
    }
}

/// `get_character_detail`：按 `character_id` 读取角色卡档案
/// （spec §2.3 示例命令；`args_template` 用 `{stats.char_id}` 等占位注入）。
/// `character_id` 接受数值或数值字符串（模板注入以字符串为主）。
async fn get_character_detail(db: &SqlitePool, args: &Value) -> Result<Value, String> {
    let character_id = args
        .get("character_id")
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
        })
        .ok_or_else(|| "get_character_detail 缺少数值参数 character_id".to_string())?;
    let card = crate::commands::characters::character_card_get(db, character_id).await?;
    serde_json::to_value(card).map_err(|err| err.to_string())
}

/// `create_world_book_entry`：向会话绑定的世界书写入一条启用的普通条目
/// （spec §2.4 示例命令：产物卡"加入到世界书"动作的持久化终点）。
async fn create_world_book_entry(
    db: &SqlitePool,
    conversation_id: i64,
    args: &Value,
) -> Result<Value, String> {
    let world_book_id: Option<i64> =
        sqlx::query_scalar("SELECT world_book_id FROM conversations WHERE id = ? LIMIT 1")
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?
            .flatten();
    let Some(world_book_id) = world_book_id else {
        return Err("会话未绑定世界书，无法创建条目".to_string());
    };

    let title = args
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "create_world_book_entry 缺少 title 参数".to_string())?;
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "create_world_book_entry 缺少 content 参数".to_string())?;

    let now = crate::utils::now_ts();
    let result = sqlx::query(
        "INSERT INTO world_book_entries (
            world_book_id, title, content, trigger_mode,
            is_enabled, sort_order, created_at, updated_at
         ) VALUES (?, ?, ?, 'any', 1, 0, ?, ?)",
    )
    .bind(world_book_id)
    .bind(title)
    .bind(content)
    .bind(now)
    .bind(now)
    .execute(db)
    .await
    .map_err(|err| err.to_string())?;
    let entry_id = result.last_insert_rowid();

    Ok(serde_json::json!({
        "entryId": entry_id,
        "worldBookId": world_book_id,
        "title": title,
        "content": content,
    }))
}

/// `query_world_book_entries`：按会话绑定的世界书检索条目
/// （标题 / 正文 / 关键词 包含匹配，大小写不敏感；仅启用条目）。
async fn query_world_book_entries(
    db: &SqlitePool,
    conversation_id: i64,
    args: &Value,
) -> Result<Value, String> {
    let world_book_id: Option<i64> =
        sqlx::query_scalar("SELECT world_book_id FROM conversations WHERE id = ? LIMIT 1")
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?
            .flatten();
    let Some(world_book_id) = world_book_id else {
        return Err("会话未绑定世界书，无法检索条目".to_string());
    };

    let keyword = args
        .get("keyword")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "query_world_book_entries 缺少 keyword 参数".to_string())?
        .to_lowercase();
    let limit = args
        .get("limit")
        .and_then(Value::as_i64)
        .unwrap_or(10)
        .clamp(1, 50) as usize;

    let rows = sqlx::query(
        "SELECT id FROM world_book_entries WHERE world_book_id = ? AND is_enabled = 1 \
         ORDER BY sort_order ASC, id ASC",
    )
    .bind(world_book_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let mut hits = Vec::new();
    for row in rows {
        let id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        let entry = crate::commands::world_books::world_book_entry_get(db, id).await?;
        let matched = entry.title.to_lowercase().contains(&keyword)
            || entry.content.to_lowercase().contains(&keyword)
            || entry
                .keywords
                .iter()
                .any(|k| k.to_lowercase().contains(&keyword));
        if matched {
            hits.push(serde_json::json!({
                "id": entry.id, "title": entry.title, "content": entry.content,
            }));
            if hits.len() >= limit {
                break;
            }
        }
    }
    Ok(Value::Array(hits))
}

/// `get_conversation_detail`：按会话 ID 获取会话详情元数据
async fn get_conversation_detail(
    db: &SqlitePool,
    conversation_id: i64,
    args: &Value,
) -> Result<Value, String> {
    let conv_id = args
        .get("conversation_id")
        .or_else(|| args.get("id"))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
        })
        .unwrap_or(conversation_id);

    let row = sqlx::query(
        "SELECT id, conversation_type, title, host_character_id, world_book_id, preset_id, \
         provider_id, embedding_provider_id, chat_mode, agent_provider_policy, memory_mode, \
         mem0_snapshot_window, created_at, updated_at \
         FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conv_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    let Some(row) = row else {
        return Err(format!("未找到 ID 为 {conv_id} 的会话记录"));
    };

    Ok(serde_json::json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(conv_id),
        "conversationType": row.try_get::<String, _>("conversation_type").unwrap_or_default(),
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "hostCharacterId": row.try_get::<Option<i64>, _>("host_character_id").ok().flatten(),
        "worldBookId": row.try_get::<Option<i64>, _>("world_book_id").ok().flatten(),
        "presetId": row.try_get::<Option<i64>, _>("preset_id").ok().flatten(),
        "providerId": row.try_get::<Option<i64>, _>("provider_id").ok().flatten(),
        "embeddingProviderId": row.try_get::<Option<i64>, _>("embedding_provider_id").ok().flatten(),
        "chatMode": row.try_get::<String, _>("chat_mode").unwrap_or_default(),
        "agentProviderPolicy": row.try_get::<String, _>("agent_provider_policy").unwrap_or_default(),
        "memoryMode": row.try_get::<String, _>("memory_mode").unwrap_or_default(),
        "mem0SnapshotWindow": row.try_get::<Option<i64>, _>("mem0_snapshot_window").ok().flatten(),
        "createdAt": row.try_get::<String, _>("created_at").unwrap_or_default(),
        "updatedAt": row.try_get::<String, _>("updated_at").unwrap_or_default(),
    }))
}

/// `get_session_state`：按会话 ID 获取当前数据容器状态 (DataContainer)
async fn get_session_state(
    db: &SqlitePool,
    conversation_id: i64,
    args: &Value,
) -> Result<Value, String> {
    let session_id = args
        .get("session_id")
        .or_else(|| args.get("conversation_id"))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
        })
        .unwrap_or(conversation_id);

    let state = crate::services::agent_runtime::load_session_state(db, session_id).await?;
    serde_json::to_value(state).map_err(|err| err.to_string())
}

/// 解析 ActionBridge 内置系统命令的正式工具定义与真实 JSON Schema（A12 闭环，Spec Line 172）。
pub fn resolve_action_bridge_tool_definition(command: &str) -> Option<crate::llm::LlmToolDefinition> {
    match command {
        "query_world_book_entries" => Some(crate::llm::LlmToolDefinition {
            name: "query_world_book_entries".to_string(),
            description: Some("按关键词查询世界设定书条目".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "查询关键词" },
                    "limit": { "type": "integer", "description": "最大返回条数" }
                },
                "required": ["query"]
            }),
        }),
        "get_character_detail" => Some(crate::llm::LlmToolDefinition {
            name: "get_character_detail".to_string(),
            description: Some("获取指定角色的详细卡片与设定".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "character_id": { "type": "integer", "description": "角色 ID" }
                },
                "required": ["character_id"]
            }),
        }),
        "create_world_book_entry" => Some(crate::llm::LlmToolDefinition {
            name: "create_world_book_entry".to_string(),
            description: Some("在世界设定书中创建新条目".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "条目标题" },
                    "content": { "type": "string", "description": "条目详细内容" }
                },
                "required": ["title", "content"]
            }),
        }),
        "get_conversation_detail" => Some(crate::llm::LlmToolDefinition {
            name: "get_conversation_detail".to_string(),
            description: Some("获取当前会话的元数据与配置详情".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }),
        "get_session_state" => Some(crate::llm::LlmToolDefinition {
            name: "get_session_state".to_string(),
            description: Some("获取当前会话的数据容器状态（状态属性、背包物品等）".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }),
        _ => None,
    }
}

/// 解析全局能力池（Native Scratchpad / ActionBridge / MCP）中已知的真实工具定义。
pub fn resolve_known_capability_tool_definition(tool_name: &str) -> Option<crate::llm::LlmToolDefinition> {
    if let Some(t) = crate::services::agent::scratchpad::native_scratchpad_tools()
        .into_iter()
        .find(|t| t.name == tool_name)
    {
        return Some(t);
    }

    if let Some(def) = resolve_action_bridge_tool_definition(tool_name) {
        return Some(def);
    }

    for mcp in crate::mcp::tools::all_tools() {
        if mcp.name() == tool_name {
            return Some(crate::llm::LlmToolDefinition {
                name: mcp.name().to_string(),
                description: Some(mcp.description().to_string()),
                input_schema: mcp.input_schema(),
            });
        }
    }

    None
}

/// 解析全局能力池（Native Scratchpad / ActionBridge / MCP）中已知的真实工具定义。
/// 若工具未在任何已知能力源中声明，显式返回硬错（C2 零静默回退，杜绝空 schema 占位）。
pub fn resolve_required_capability_tool_definition(tool_name: &str) -> Result<crate::llm::LlmToolDefinition, String> {
    resolve_known_capability_tool_definition(tool_name).ok_or_else(|| {
        format!(
            "未识别的智能体工具能力 `{tool_name}`：未在蓝图工具节点、ActionBridge、MCP 工具或原生工作区工具集中声明"
        )
        .replace('\\', "/")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite::memory:");
        sqlx::migrate!()
            .run(&pool)
            .await
            .expect("run migrations");
        pool
    }

    #[tokio::test]
    async fn test_unauthorized_command_rejection() {
        let pool = setup_test_db().await;

        let err = ensure_allowed(&pool, "unwhitelisted_cmd")
            .await
            .expect_err("should reject unwhitelisted command");
        assert_eq!(err, "命令 `unwhitelisted_cmd` 未在当前会话的预设白名单中");

        let invoke_err = invoke(&pool, 1, "unwhitelisted_cmd", &json!({}))
            .await
            .expect_err("should reject invoke of unwhitelisted command");
        assert_eq!(invoke_err, "命令 `unwhitelisted_cmd` 未在当前会话的预设白名单中");
    }

    #[tokio::test]
    async fn test_whitelisted_but_unregistered_command() {
        let pool = setup_test_db().await;
        save_whitelist(&pool, &["cmd_without_handler".to_string()])
            .await
            .expect("save whitelist");

        let err = invoke(&pool, 1, "cmd_without_handler", &json!({}))
            .await
            .expect_err("should fail when command has no backend handler");
        assert_eq!(err, "命令 `cmd_without_handler` 已在白名单但尚未注册后端处理器");
    }

    #[tokio::test]
    async fn test_custom_router_registration_and_dispatch() {
        let pool = setup_test_db().await;
        let mut router = ActionBridgeRouter::new();

        router.register("calculate_sum", |_db, _conv_id, args| {
            Box::pin(async move {
                let a = args.get("a").and_then(Value::as_i64).unwrap_or(0);
                let b = args.get("b").and_then(Value::as_i64).unwrap_or(0);
                Ok(json!({ "sum": a + b }))
            })
        });

        save_whitelist(&pool, &["calculate_sum".to_string()])
            .await
            .expect("save whitelist");

        let res = invoke_with_router(&router, &pool, 42, "calculate_sum", &json!({ "a": 15, "b": 27 }))
            .await
            .expect("dispatch calculate_sum");
        assert_eq!(res["sum"], 42);

        let unauth = invoke_with_router(&router, &pool, 42, "unknown_cmd", &json!({}))
            .await
            .expect_err("unauthorized should fail");
        assert_eq!(unauth, "命令 `unknown_cmd` 未在当前会话的预设白名单中");
    }

    #[tokio::test]
    async fn test_builtin_get_conversation_detail() {
        let pool = setup_test_db().await;

        sqlx::query(
            "INSERT INTO conversations (id, conversation_type, title, chat_mode, memory_mode, created_at, updated_at) \
             VALUES (99, 'single', 'Test Adventure', 'normal', 'legacy', '2026-01-01', '2026-01-01')",
        )
        .execute(&pool)
        .await
        .expect("insert conversation");

        save_whitelist(&pool, &["get_conversation_detail".to_string()])
            .await
            .expect("save whitelist");

        let res = invoke(&pool, 99, "get_conversation_detail", &json!({}))
            .await
            .expect("invoke get_conversation_detail");

        assert_eq!(res["id"], 99);
        assert_eq!(res["title"], "Test Adventure");
        assert_eq!(res["conversationType"], "single");
    }

    #[tokio::test]
    async fn test_builtin_get_session_state() {
        let pool = setup_test_db().await;

        save_whitelist(&pool, &["get_session_state".to_string()])
            .await
            .expect("save whitelist");

        let res = invoke(&pool, 1, "get_session_state", &json!({}))
            .await
            .expect("invoke get_session_state");

        assert!(res.is_object());
    }
}

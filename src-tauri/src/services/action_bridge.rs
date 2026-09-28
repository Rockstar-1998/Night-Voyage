//! 动作与跨域读的统一治理层（spec：L3 动作通道 / L2 Querier）。
//!
//! 白名单是**设置数据**（`settings` 表），不是代码枚举：ActionButton 的用户动作
//! 与 Querier 的跨域读共用同一份 `action_bridge.command_whitelist`，未注册命令
//! 一律显式报错（I2，默认空白名单 = 注册前不可用）。后端分发用注册表把白名单
//! 命令名接到**既有命令实现**上——注册表是基础设施接线，域语义仍在蓝图资产的
//! 命令名与参数模板里。

use serde_json::Value;
use sqlx::{Row, SqlitePool};

pub const WHITELIST_SETTING_KEY: &str = "action_bridge.command_whitelist";

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

/// 白名单校验：未注册命令显式报错（附当前白名单摘要，便于设置页排障）。
pub async fn ensure_allowed(db: &SqlitePool, command: &str) -> Result<(), String> {
    let whitelist = load_whitelist(db).await?;
    if whitelist.iter().any(|c| c == command) {
        Ok(())
    } else {
        Err(format!(
            "命令 `{command}` 未在动作白名单注册（当前白名单: [{}]）；请在设置页登记后重试",
            whitelist.join(", ")
        ))
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

/// 后端分发注册表：白名单命令名 → 既有命令实现。
///
/// 注册表是基础设施接线（把名字接到既有命令域）；新增可代理命令时在此登记
/// 一行，域语义仍由蓝图资产的命令名与参数模板表达。
async fn dispatch(
    db: &SqlitePool,
    conversation_id: i64,
    command: &str,
    args: &Value,
) -> Result<Value, String> {
    match command {
        "query_world_book_entries" => query_world_book_entries(db, conversation_id, args).await,
        other => Err(format!(
            "命令 `{other}` 已在白名单但没有后端分发实现；请检查白名单与注册表一致性"
        )),
    }
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

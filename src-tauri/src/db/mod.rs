use std::{env, path::PathBuf, time::Duration};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use crate::dbg_eprintln;

pub type DbResult<T> = Result<T, Box<dyn std::error::Error>>;

pub async fn init_pool(app: &AppHandle) -> DbResult<SqlitePool> {
    let db_path = resolve_db_path(app)?;
    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await?;

    sqlx::migrate!().run(&pool).await?;

    cleanup_stale_rounds(&pool).await;
    repair_unrendered_opening_messages(&pool).await;
    crate::repositories::llm_retry_snapshot_repository::RetrySnapshotRepository::recover_running_snapshots(&pool).await?;

    Ok(pool)
}

async fn cleanup_stale_rounds(db: &SqlitePool) {
    let stale_rounds: Vec<i64> = match sqlx::query_scalar(
        "SELECT mr.id FROM message_rounds mr \
         WHERE mr.status = 'collecting' \
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.round_id = mr.id AND m.is_hidden = 0)",
    )
    .fetch_all(db)
    .await
    {
        Ok(ids) => ids,
        Err(err) => {
            dbg_eprintln!("[startup] cleanup_stale_rounds: query failed: {}", err);
            return;
        }
    };

    if stale_rounds.is_empty() {
        return;
    }

    dbg_eprintln!(
        "[startup] cleanup_stale_rounds: found {} stale collecting rounds with no visible messages",
        stale_rounds.len()
    );

    for round_id in &stale_rounds {
        dbg_eprintln!("[startup] cleanup_stale_rounds: cleaning round_id={}", round_id);

        if let Err(err) = sqlx::query("DELETE FROM message_content_parts WHERE message_id IN (SELECT id FROM messages WHERE round_id = ?)")
            .bind(round_id)
            .execute(db)
            .await
        {
            dbg_eprintln!("[startup] cleanup_stale_rounds: failed to delete content_parts for round {}: {}", round_id, err);
        }

        if let Err(err) = sqlx::query("DELETE FROM message_tool_calls WHERE message_id IN (SELECT id FROM messages WHERE round_id = ?)")
            .bind(round_id)
            .execute(db)
            .await
        {
            dbg_eprintln!("[startup] cleanup_stale_rounds: failed to delete tool_calls for round {}: {}", round_id, err);
        }

        if let Err(err) = sqlx::query("DELETE FROM messages WHERE round_id = ?")
            .bind(round_id)
            .execute(db)
            .await
        {
            dbg_eprintln!("[startup] cleanup_stale_rounds: failed to delete messages for round {}: {}", round_id, err);
        }

        if let Err(err) = sqlx::query("DELETE FROM round_member_actions WHERE round_id = ?")
            .bind(round_id)
            .execute(db)
            .await
        {
            dbg_eprintln!("[startup] cleanup_stale_rounds: failed to delete member_actions for round {}: {}", round_id, err);
        }

        if let Err(err) = sqlx::query("DELETE FROM message_rounds WHERE id = ?")
            .bind(round_id)
            .execute(db)
            .await
        {
            dbg_eprintln!("[startup] cleanup_stale_rounds: failed to delete round {}: {}", round_id, err);
        }
    }

    dbg_eprintln!("[startup] cleanup_stale_rounds: cleaned {} stale rounds", stale_rounds.len());
}

pub(crate) async fn cleanup_stale_rooms(db: &SqlitePool) {
    let stale_rooms: Vec<(i64, i64)> = match sqlx::query_as::<_, (i64, i64)>(
        "SELECT id, conversation_id FROM rooms WHERE status = 'waiting'",
    )
    .fetch_all(db)
    .await
    {
        Ok(rooms) => rooms,
        Err(err) => {
            dbg_eprintln!("[startup] cleanup_stale_rooms: query failed: {}", err);
            return;
        }
    };

    if stale_rooms.is_empty() {
        return;
    }

    dbg_eprintln!(
        "[startup] cleanup_stale_rooms: found {} waiting rooms to close",
        stale_rooms.len()
    );

    for (room_id, conversation_id) in &stale_rooms {
        dbg_eprintln!(
            "[startup] cleanup_stale_rooms: cleaning room_id={}, conversation_id={}",
            room_id, conversation_id
        );

        if let Err(err) = sqlx::query(
            "DELETE FROM conversation_members WHERE conversation_id = ? AND join_order > 0",
        )
        .bind(conversation_id)
        .execute(db)
        .await
        {
            dbg_eprintln!(
                "[startup] cleanup_stale_rooms: failed to clean members for room {}: {}",
                room_id, err
            );
        }

        if let Err(err) = sqlx::query(
            "UPDATE rooms SET status = 'closed', current_player_count = 1 WHERE id = ?",
        )
        .bind(room_id)
        .execute(db)
        .await
        {
            dbg_eprintln!(
                "[startup] cleanup_stale_rooms: failed to close room {}: {}",
                room_id, err
            );
        }
    }

    dbg_eprintln!(
        "[startup] cleanup_stale_rooms: cleaned {} stale rooms",
        stale_rooms.len()
    );
}

async fn repair_unrendered_opening_messages(db: &SqlitePool) {
    let unrendered_messages: Vec<(i64, i64, String)> = match sqlx::query_as(
        "SELECT id, conversation_id, content FROM messages \
         WHERE role = 'assistant' \
         AND (content LIKE '%{{%' OR content LIKE '%<user>%' OR content LIKE '%<char>%')",
    )
    .fetch_all(db)
    .await
    {
        Ok(rows) => rows,
        Err(err) => {
            dbg_eprintln!("[startup] repair_unrendered_opening_messages query failed: {err}");
            return;
        }
    };

    if unrendered_messages.is_empty() {
        return;
    }

    for (msg_id, conversation_id, content) in unrendered_messages {
        let normalized = crate::services::prompt_compiler::normalize_st_placeholder_macros(&content);
        if !normalized.contains("{{") {
            continue;
        }

        let conv_info: Option<(i64, i64)> = match sqlx::query_as(
            "SELECT c.host_character_id, cm.player_character_id \
             FROM conversations c \
             JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.member_role = 'host' \
             WHERE c.id = ? LIMIT 1",
        )
        .bind(conversation_id)
        .fetch_optional(db)
        .await
        {
            Ok(info) => info,
            Err(_) => None,
        };

        let Some((host_char_id, player_char_id)) = conv_info else {
            continue;
        };

        let char_data: Option<(String, Option<String>)> = match sqlx::query_as(
            "SELECT name, description FROM character_cards WHERE id = ?",
        )
        .bind(host_char_id)
        .fetch_optional(db)
        .await
        {
            Ok(d) => d,
            Err(_) => None,
        };

        let player_data: Option<(String, Option<String>)> = match sqlx::query_as(
            "SELECT name, description FROM character_cards WHERE id = ?",
        )
        .bind(player_char_id)
        .fetch_optional(db)
        .await
        {
            Ok(d) => d,
            Err(_) => None,
        };

        let (char_name, char_desc) = char_data.unwrap_or_default();
        let (player_name, player_desc) = player_data.unwrap_or_default();

        if let Ok(rendered) = crate::services::prompt_compiler::render_opening_template(
            &content,
            &char_name,
            char_desc.as_deref().unwrap_or(""),
            &player_name,
            player_desc.as_deref().unwrap_or(""),
        ) {
            if rendered != content {
                dbg_eprintln!(
                    "[startup] repairing unrendered opening message {msg_id} in conv {conversation_id}"
                );
                let _ = sqlx::query("UPDATE messages SET content = ? WHERE id = ?")
                    .bind(rendered)
                    .bind(msg_id)
                    .execute(db)
                    .await;
            }
        }
    }
}

pub fn resolve_db_path(app: &AppHandle) -> DbResult<PathBuf> {
    if let Some(dev_db_path) = env::var_os("NIGHT_VOYAGE_DB_PATH") {
        let dev_db_path = PathBuf::from(&dev_db_path);
        if let Some(parent) = dev_db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        return Ok(dev_db_path);
    }

    if let Ok(exe_path) = std::fs::canonicalize(std::env::current_exe()?) {
        if let Some(exe_dir) = exe_path.parent() {
            let local_db = exe_dir.join("night-voyage.sqlite3");
            if local_db.exists() {
                return Ok(local_db);
            }
        }
    }

    let app_data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data_dir)?;
    Ok(app_data_dir.join("night-voyage.sqlite3"))
}

use std::{env, path::PathBuf, time::Duration};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

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
            eprintln!("[startup] cleanup_stale_rounds: query failed: {}", err);
            return;
        }
    };

    if stale_rounds.is_empty() {
        return;
    }

    eprintln!(
        "[startup] cleanup_stale_rounds: found {} stale collecting rounds with no visible messages",
        stale_rounds.len()
    );

    for round_id in &stale_rounds {
        eprintln!("[startup] cleanup_stale_rounds: cleaning round_id={}", round_id);

        if let Err(err) = sqlx::query("DELETE FROM message_content_parts WHERE message_id IN (SELECT id FROM messages WHERE round_id = ?)")
            .bind(round_id)
            .execute(db)
            .await
        {
            eprintln!("[startup] cleanup_stale_rounds: failed to delete content_parts for round {}: {}", round_id, err);
        }

        if let Err(err) = sqlx::query("DELETE FROM message_tool_calls WHERE message_id IN (SELECT id FROM messages WHERE round_id = ?)")
            .bind(round_id)
            .execute(db)
            .await
        {
            eprintln!("[startup] cleanup_stale_rounds: failed to delete tool_calls for round {}: {}", round_id, err);
        }

        if let Err(err) = sqlx::query("DELETE FROM messages WHERE round_id = ?")
            .bind(round_id)
            .execute(db)
            .await
        {
            eprintln!("[startup] cleanup_stale_rounds: failed to delete messages for round {}: {}", round_id, err);
        }

        if let Err(err) = sqlx::query("DELETE FROM round_member_actions WHERE round_id = ?")
            .bind(round_id)
            .execute(db)
            .await
        {
            eprintln!("[startup] cleanup_stale_rounds: failed to delete member_actions for round {}: {}", round_id, err);
        }

        if let Err(err) = sqlx::query("DELETE FROM message_rounds WHERE id = ?")
            .bind(round_id)
            .execute(db)
            .await
        {
            eprintln!("[startup] cleanup_stale_rounds: failed to delete round {}: {}", round_id, err);
        }
    }

    eprintln!("[startup] cleanup_stale_rounds: cleaned {} stale rounds", stale_rounds.len());
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

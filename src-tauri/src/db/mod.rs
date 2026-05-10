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

    Ok(pool)
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

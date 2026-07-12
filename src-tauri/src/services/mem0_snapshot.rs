//! MEM0 SQLite file-level snapshot service.
//!
//! In mem0 mode, the database is snapshotted at the START of each new round
//! (before the round is created). Snapshots enable rollback to any round within
//! the configurable window (default 20). Rollback closes the connection pool,
//! replaces the main DB file with a snapshot, and reopens the pool.
//!
//! All snapshot files live under `<exe_dir>/mem0-snapshots/<conversation_id>/`.

use std::path::PathBuf;

use sqlx::SqlitePool;
use crate::dbg_eprintln;

/// Resolve snapshot directory for a given conversation.
pub fn snapshot_dir(conversation_id: i64) -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "无法解析 EXE 所在目录".to_string())?;
    let dir = exe_dir.join("mem0-snapshots").join(conversation_id.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Information about a single snapshot.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub round_index: i64,
    pub timestamp: i64,
    pub file_size: u64,
    pub file_name: String,
}

/// Resolve the main SQLite database file path.
/// Uses the same resolution logic as `db/mod.rs`: env var → exe dir.
fn resolve_main_db_path() -> Result<PathBuf, String> {
    // Try NIGHT_VOYAGE_DB_PATH env var first
    if let Ok(env_path) = std::env::var("NIGHT_VOYAGE_DB_PATH") {
        let p = PathBuf::from(&env_path);
        if p.exists() {
            return Ok(p);
        }
    }

    // Try exe-relative path
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let db_path = exe_dir.join("night-voyage.sqlite3");
            if db_path.exists() {
                return Ok(db_path);
            }
        }
    }

    Err("无法定位主数据库文件".to_string())
}

/// Create a snapshot of the main SQLite database at the START of a new round.
///
/// Steps:
/// 1. Execute `PRAGMA wal_checkpoint(TRUNCATE)` to flush WAL into the main file.
/// 2. Copy the main SQLite file to the snapshot directory.
/// 3. Copy associated MEM0 vector store files alongside.
///
/// Returns the snapshot file path on success. Failures are logged but non-fatal
/// (the caller should not block the conversation flow).
pub async fn create_snapshot(
    db: &SqlitePool,
    conversation_id: i64,
    round_index: i64,
) -> Result<PathBuf, String> {
    // 1. Flush WAL
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(db)
        .await
        .map_err(|e| format!("WAL checkpoint failed: {e}"))?;

    // 2. Resolve paths
    let main_db_path = resolve_main_db_path()?;
    let snap_dir = snapshot_dir(conversation_id)?;
    let timestamp = crate::utils::now_ts();
    let snap_name = format!("snapshot_{round_index}_{timestamp}.db");
    let snap_path = snap_dir.join(&snap_name);

    // 3. Copy main DB file
    std::fs::copy(&main_db_path, &snap_path)
        .map_err(|e| format!("Failed to copy DB to snapshot: {e}"))?;

    // 4. Copy WAL and SHM files if they exist (after checkpoint they should be
    //    empty, but copy for safety)
    let wal_path = main_db_path.with_extension("sqlite3-wal");
    let shm_path = main_db_path.with_extension("sqlite3-shm");
    for ext_path in [&wal_path, &shm_path] {
        if ext_path.exists() {
            let dest = snap_dir.join(format!(
                "snapshot_{round_index}_{timestamp}.{}",
                ext_path
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
            ));
            let _ = std::fs::copy(ext_path, dest);
        }
    }

    // 5. Copy MEM0 vector store files (best-effort)
    if let Ok(mem0_dir) = crate::services::memory_providers::resolve_mem0_storage_dir() {
        let mem0_path = PathBuf::from(&mem0_dir);
        if mem0_path.exists() {
            let mem0_snap_dir = snap_dir.join("mem0-data");
            let _ = std::fs::create_dir_all(&mem0_snap_dir);
            // Copy all files in mem0 storage directory
            if let Ok(entries) = std::fs::read_dir(&mem0_path) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                        let dest = mem0_snap_dir.join(entry.file_name());
                        let _ = std::fs::copy(entry.path(), dest);
                    }
                }
            }
        }
    }

    dbg_eprintln!(
        "[mem0-snapshot] created snapshot for conversation {conversation_id} round {round_index}: {}",
        snap_path.display()
    );

    Ok(snap_path)
}

/// List all available snapshots for a conversation, sorted by round_index descending.
pub fn list_snapshots(conversation_id: i64) -> Result<Vec<SnapshotInfo>, String> {
    let snap_dir = snapshot_dir(conversation_id)?;
    if !snap_dir.exists() {
        return Ok(Vec::new());
    }

    let mut snapshots = Vec::new();
    let entries = std::fs::read_dir(&snap_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name.starts_with("snapshot_") || !file_name.ends_with(".db") {
            continue;
        }
        // Parse: snapshot_<round_index>_<timestamp>.db
        let parts: Vec<&str> = file_name
            .trim_start_matches("snapshot_")
            .trim_end_matches(".db")
            .splitn(2, '_')
            .collect();
        if parts.len() != 2 {
            continue;
        }
        let round_index = parts[0].parse::<i64>().unwrap_or(-1);
        let timestamp = parts[1].parse::<i64>().unwrap_or(0);
        let file_size = entry.metadata().map(|m| m.len()).unwrap_or(0);

        snapshots.push(SnapshotInfo {
            round_index,
            timestamp,
            file_size,
            file_name,
        });
    }

    // Sort by round_index descending
    snapshots.sort_by(|a, b| b.round_index.cmp(&a.round_index));
    Ok(snapshots)
}

/// Remove snapshots that exceed the configured window size.
/// Keeps the `window` most recent snapshots (by round_index).
pub fn prune_old_snapshots(conversation_id: i64, window: usize) -> Result<usize, String> {
    let mut snapshots = list_snapshots(conversation_id)?;
    if snapshots.len() <= window {
        return Ok(0);
    }

    // Sort ascending so oldest are first
    snapshots.sort_by(|a, b| a.round_index.cmp(&b.round_index));
    let to_remove = snapshots.len() - window;
    let snap_dir = snapshot_dir(conversation_id)?;
    let mut removed = 0;

    for snap in snapshots.iter().take(to_remove) {
        let snap_path = snap_dir.join(&snap.file_name);
        if snap_path.exists() {
            let _ = std::fs::remove_file(&snap_path);
            removed += 1;
        }
    }

    Ok(removed)
}

/// Load the configured snapshot window for a conversation.
pub async fn load_snapshot_window(db: &SqlitePool, conversation_id: i64) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT mem0_snapshot_window FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .unwrap_or(20)
}

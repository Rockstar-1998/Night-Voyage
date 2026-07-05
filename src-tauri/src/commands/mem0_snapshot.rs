//! Tauri commands for MEM0 snapshot management.

use tauri::State;

use crate::services::mem0_snapshot::{self, SnapshotInfo};
use crate::AppState;

/// List all available snapshots for a conversation.
#[tauri::command]
pub async fn mem0_snapshot_list(
    state: State<'_, AppState>,
    conversation_id: i64,
) -> Result<Vec<SnapshotInfo>, String> {
    // Verify conversation is in mem0 mode
    let mode = crate::services::prompt_compiler::load_memory_mode(&state.db, conversation_id).await;
    if mode != crate::services::prompt_compiler::MEMORY_MODE_MEM0 {
        return Err("快照功能仅在 Mem0 模式下可用".to_string());
    }
    mem0_snapshot::list_snapshots(conversation_id)
}

/// Set the snapshot window for a conversation (number of rounds to keep).
#[tauri::command]
pub async fn mem0_snapshot_window_set(
    state: State<'_, AppState>,
    conversation_id: i64,
    window: i64,
) -> Result<(), String> {
    if window < 1 || window > 1000 {
        return Err("快照窗口必须在 1-1000 之间".to_string());
    }
    sqlx::query(
        "UPDATE conversations SET mem0_snapshot_window = ?, updated_at = ? WHERE id = ?",
    )
    .bind(window)
    .bind(crate::utils::now_ts())
    .bind(conversation_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
    Ok(())
}

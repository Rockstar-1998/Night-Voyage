use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::{
    models::Mem0InitStatusResponse,
    services::{
        memory_providers::resolve_mem0_storage_dir,
        memory_service::{MemoryRecord, MemoryService},
    },
    utils::now_ts,
    AppState,
};

/// Global mem0 capability status surfaced to the UI.
#[derive(Debug, Serialize)]
pub struct Mem0Status {
    /// At least one embedding-purpose provider exists, so mem0 can be
    /// configured per-conversation.
    pub enabled: bool,
    /// Mirrors `enabled`: actual per-conversation health is checked when a
    /// memory service is lazily constructed.
    pub provider_ready: bool,
    /// Fixed on-disk persistence path (guardrails: never C:\).
    pub vector_store_path: String,
}

/// Acquire the memory backend for a specific conversation, constructing it
/// lazily from the conversation's `embedding_provider_id` and caching the
/// result in `AppState.memory_service`. Build errors propagate to the caller.
async fn get_memory_service_for_conversation(
    state: &State<'_, AppState>,
    conversation_id: i64,
) -> Result<Arc<dyn MemoryService>, String> {
    crate::services::memory_providers::get_or_build_memory_service(
        &state.db,
        &state.memory_service,
        conversation_id,
    )
    .await
}

#[tauri::command]
pub async fn mem0_status(state: State<'_, AppState>) -> Result<Mem0Status, String> {
    let has_emb = crate::services::memory_providers::has_embedding_provider(&state.db).await?;
    Ok(Mem0Status {
        enabled: has_emb,
        provider_ready: has_emb,
        vector_store_path: resolve_mem0_storage_dir().unwrap_or_else(|_| "unknown".to_string()),
    })
}

/// Expose the startup init result so the UI can display why mem0 is unavailable.
#[tauri::command]
pub async fn mem0_init_status(
    state: State<'_, AppState>,
) -> Result<Mem0InitStatusResponse, String> {
    // Under lazy construction, mem0 is "available" whenever an embedding-purpose
    // provider exists. Per-conversation build errors surface at use time.
    let available = crate::services::memory_providers::has_embedding_provider(&state.db).await?;
    let error = state.mem0_init_error.clone();
    Ok(Mem0InitStatusResponse { available, error })
}

/// Set the per-conversation memory mode ('stateless', 'legacy', or 'mem0').
/// Note: UI does not expose mode switching after creation; this command is
/// retained for debugging and initial creation flows.
#[tauri::command]
pub async fn memory_mode_set(
    state: State<'_, AppState>,
    conversation_id: i64,
    mode: String,
) -> Result<String, String> {
    let normalized = match mode.as_str() {
        "stateless" | "legacy" | "mem0" => mode,
        _ => return Err("memory_mode 必须是 'stateless', 'legacy' 或 'mem0'".to_string()),
    };
    sqlx::query("UPDATE conversations SET memory_mode = ?, updated_at = ? WHERE id = ?")
        .bind(&normalized)
        .bind(now_ts())
        .bind(conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
    Ok(normalized)
}

/// Deprecated: forwards to `memory_mode_set`. Use `memory_mode_set` directly.
#[tauri::command]
pub async fn mem0_set_enabled(
    state: State<'_, AppState>,
    conversation_id: i64,
    enabled: bool,
) -> Result<bool, String> {
    let mode = if enabled { "mem0" } else { "stateless" };
    memory_mode_set(state, conversation_id, mode.to_string()).await?;
    Ok(enabled)
}

#[tauri::command]
pub async fn mem0_search_test(
    state: State<'_, AppState>,
    conversation_id: i64,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<MemoryRecord>, String> {
    let service = get_memory_service_for_conversation(&state, conversation_id).await?;
    let limit = limit.unwrap_or(5).max(1);
    let user_id = conversation_id.to_string();
    service
        .search(&query, &user_id, limit)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn mem0_list_memories(
    state: State<'_, AppState>,
    conversation_id: i64,
    limit: Option<usize>,
) -> Result<Vec<MemoryRecord>, String> {
    let service = get_memory_service_for_conversation(&state, conversation_id).await?;
    let limit = limit.unwrap_or(50).max(1);
    let user_id = conversation_id.to_string();
    service
        .get_all(&user_id, limit)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn mem0_delete_memory(
    state: State<'_, AppState>,
    conversation_id: i64,
    memory_id: String,
) -> Result<(), String> {
    let service = get_memory_service_for_conversation(&state, conversation_id).await?;
    service
        .delete(&memory_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn mem0_delete_all(
    state: State<'_, AppState>,
    conversation_id: i64,
) -> Result<usize, String> {
    let service = get_memory_service_for_conversation(&state, conversation_id).await?;
    let user_id = conversation_id.to_string();
    service
        .delete_all(&user_id)
        .await
        .map_err(|err| err.to_string())
}

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::{
    services::{
        memory_providers::MEM0_STORAGE_DIR,
        memory_service::{MemoryRecord, MemoryService},
    },
    utils::now_ts,
    AppState,
};

/// Global mem0 capability status surfaced to the UI.
#[derive(Debug, Serialize)]
pub struct Mem0Status {
    /// A memory backend is registered in AppState (initialized at startup).
    pub enabled: bool,
    /// The registered backend reports itself healthy via `health()`.
    pub provider_ready: bool,
    /// Fixed on-disk persistence path (guardrails: never C:\).
    pub vector_store_path: String,
}

/// Acquire a clone of the optional memory backend registered in AppState.
async fn clone_memory_service(
    state: &State<'_, AppState>,
) -> Option<Arc<dyn MemoryService>> {
    let guard = state.memory_service.lock().await;
    guard.clone()
}

#[tauri::command]
pub async fn mem0_status(state: State<'_, AppState>) -> Result<Mem0Status, String> {
    let service = clone_memory_service(&state).await;
    let enabled = service.is_some();
    let provider_ready = match service {
        Some(service) => service.health().await.unwrap_or(false),
        None => false,
    };
    Ok(Mem0Status {
        enabled,
        provider_ready,
        vector_store_path: MEM0_STORAGE_DIR.to_string(),
    })
}

/// Set the per-conversation memory mode ('stateless' or 'mem0').
#[tauri::command]
pub async fn memory_mode_set(
    state: State<'_, AppState>,
    conversation_id: i64,
    mode: String,
) -> Result<String, String> {
    let normalized = match mode.as_str() {
        "stateless" | "mem0" => mode,
        _ => return Err("memory_mode 必须是 'stateless' 或 'mem0'".to_string()),
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
    let Some(service) = clone_memory_service(&state).await else {
        return Err("mem0 未启用：未配置 memory service".to_string());
    };
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
    let Some(service) = clone_memory_service(&state).await else {
        return Err("mem0 未启用：未配置 memory service".to_string());
    };
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
    memory_id: String,
) -> Result<(), String> {
    let Some(service) = clone_memory_service(&state).await else {
        return Err("mem0 未启用：未配置 memory service".to_string());
    };
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
    let Some(service) = clone_memory_service(&state).await else {
        return Err("mem0 未启用：未配置 memory service".to_string());
    };
    let user_id = conversation_id.to_string();
    service
        .delete_all(&user_id)
        .await
        .map_err(|err| err.to_string())
}

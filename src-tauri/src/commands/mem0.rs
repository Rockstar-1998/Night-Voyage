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

#[tauri::command]
pub async fn mem0_set_enabled(
    state: State<'_, AppState>,
    conversation_id: i64,
    enabled: bool,
) -> Result<bool, String> {
    let now = now_ts();
    sqlx::query("UPDATE conversations SET mem0_enabled = ?, updated_at = ? WHERE id = ?")
        .bind(if enabled { 1 } else { 0 })
        .bind(now)
        .bind(conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    // Read back to confirm the persisted value (explicit, no silent fallback).
    let persisted: bool = sqlx::query_scalar::<_, i64>(
        "SELECT mem0_enabled FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?
    .map(|value| value != 0)
    .unwrap_or(false);
    Ok(persisted)
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

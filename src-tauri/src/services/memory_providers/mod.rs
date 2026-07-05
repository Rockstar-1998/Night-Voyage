//! Concrete `MemoryService` implementations.
//!
//! Each backend lives in its own submodule and is the ONLY place allowed to
//! import that backend's crate types. Business code never reaches in here
//! directly beyond constructing the provider once during app setup.

pub mod mem0_rs;

pub use mem0_rs::{Mem0RsProvider, Mem0RsProviderConfig};

use std::sync::Arc;

use sqlx::{Row, SqlitePool};

use crate::services::memory_service::MemoryService;

/// Resolve mem0 storage directory relative to the EXE location.
/// Returns `<exe_dir>/mem0-data/` and ensures the directory exists.
/// Falls back to app data dir if exe path cannot be resolved.
pub fn resolve_mem0_storage_dir() -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path.parent().ok_or_else(|| "无法解析 EXE 所在目录".to_string())?;
    let mem0_dir = exe_dir.join("mem0-data");
    std::fs::create_dir_all(&mem0_dir).map_err(|e| e.to_string())?;
    Ok(mem0_dir.to_string_lossy().to_string())
}

/// Settings keys for mem0 configuration. LLM and embedding credentials now
/// come from per-conversation bindings (`conversations.provider_id` and
/// `conversations.embedding_provider_id`); only the embedding dimension
/// remains a global setting because it is a property of the embedding model,
/// not the provider row.
const SETTING_EMBEDDING_DIMS: &str = "mem0_embedding_dims";

const DEFAULT_EMBEDDING_MODEL: &str = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMS: usize = 1536;

async fn load_setting(db: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(key)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
}

/// A row from `api_providers` needed by mem0.
struct ProviderRow {
    base_url: String,
    api_key: String,
    model_name: String,
}

async fn fetch_provider_row(
    db: &SqlitePool,
    provider_id: Option<i64>,
) -> Result<Option<ProviderRow>, String> {
    let row = if let Some(id) = provider_id {
        sqlx::query("SELECT base_url, api_key, model_name FROM api_providers WHERE id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?
    } else {
        sqlx::query(
            "SELECT base_url, api_key, model_name FROM api_providers \
             ORDER BY updated_at DESC, id DESC LIMIT 1",
        )
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?
    };
    row.map(|r| {
        Ok(ProviderRow {
            base_url: r.try_get::<String, _>("base_url").map_err(|e| e.to_string())?,
            api_key: r.try_get::<String, _>("api_key").map_err(|e| e.to_string())?,
            model_name: r.try_get::<String, _>("model_name").map_err(|e| e.to_string())?,
        })
    })
    .transpose()
}

/// Build a `MemoryService` for a specific conversation. Reads the
/// conversation's `embedding_provider_id` (embedding credentials) and
/// `provider_id` (LLM credentials for mem0 fact extraction) from the
/// database. Each embedding provider gets its own vector store collection
/// because different embedding models produce vectors of different
/// dimensions.
pub async fn build_memory_service_for_conversation(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<Arc<dyn MemoryService>, String> {
    // Read conversation's provider bindings.
    let row = sqlx::query(
        "SELECT provider_id, embedding_provider_id FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?
    .ok_or_else(|| format!("conversation {} not found", conversation_id))?;

    let llm_provider_id: Option<i64> = row.try_get("provider_id").ok();
    let embedding_provider_id: Option<i64> = row.try_get("embedding_provider_id").ok();

    let embedding_provider_id = embedding_provider_id.ok_or_else(|| {
        "会话未绑定 embedding provider；请在右侧抽屉的会话绑定中设置 embedding API 档案".to_string()
    })?;

    // LLM credentials from conversation's provider_id (fallback to most recent).
    let llm_row = fetch_provider_row(db, llm_provider_id)
        .await?
        .ok_or_else(|| "mem0 LLM provider not found; 会话未绑定 LLM provider".to_string())?;
    if llm_row.base_url.trim().is_empty() {
        return Err("mem0 LLM provider has an empty base_url".to_string());
    }
    let llm_model = if llm_row.model_name.trim().is_empty() {
        return Err("mem0 LLM model unresolved: provider has empty model_name".to_string());
    } else {
        llm_row.model_name.clone()
    };

    // Embedding credentials from conversation's embedding_provider_id.
    let embed_row = fetch_provider_row(db, Some(embedding_provider_id))
        .await?
        .ok_or_else(|| {
            format!(
                "embedding_provider_id={} does not match any row in api_providers",
                embedding_provider_id
            )
        })?;
    if embed_row.base_url.trim().is_empty() {
        return Err("mem0 embedding provider has an empty base_url".to_string());
    }
    let embedding_model = if embed_row.model_name.trim().is_empty() {
        DEFAULT_EMBEDDING_MODEL.to_string()
    } else {
        embed_row.model_name.clone()
    };
    let embedding_dims = load_setting(db, SETTING_EMBEDDING_DIMS)
        .await
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_EMBEDDING_DIMS);

    let config = Mem0RsProviderConfig {
        llm_base_url: llm_row.base_url,
        llm_api_key: llm_row.api_key,
        llm_model,
        embedding_base_url: embed_row.base_url,
        embedding_api_key: embed_row.api_key,
        embedding_model,
        embedding_dims,
        storage_dir: resolve_mem0_storage_dir()?,
        collection_name: format!("night_voyage_emb_{}", embedding_provider_id),
    };

    let provider = Mem0RsProvider::new(config).map_err(|err| err.to_string())?;
    Ok(Arc::new(provider))
}

/// Get or build a memory service for a conversation. Uses a per-provider
/// cache (keyed by embedding_provider_id) to avoid reconstructing the mem0
/// orchestrator on every call. The cache is held in `AppState.memory_service`.
pub async fn get_or_build_memory_service(
    db: &SqlitePool,
    cache: &tokio::sync::Mutex<std::collections::HashMap<i64, Arc<dyn MemoryService>>>,
    conversation_id: i64,
) -> Result<Arc<dyn MemoryService>, String> {
    // Read embedding_provider_id for cache key.
    let embedding_provider_id: Option<i64> = sqlx::query_scalar(
        "SELECT embedding_provider_id FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?
    .flatten();

    let embedding_provider_id = embedding_provider_id.ok_or_else(|| {
        "会话未绑定 embedding provider；请在右侧抽屉的会话绑定中设置 embedding API 档案".to_string()
    })?;

    // Check cache.
    {
        let cache_guard = cache.lock().await;
        if let Some(svc) = cache_guard.get(&embedding_provider_id) {
            return Ok(svc.clone());
        }
    }

    // Cache miss: build and insert.
    let svc = build_memory_service_for_conversation(db, conversation_id).await?;
    {
        let mut cache_guard = cache.lock().await;
        cache_guard.insert(embedding_provider_id, svc.clone());
    }
    Ok(svc)
}

/// Check whether any embedding-purpose provider exists. Used by
/// `mem0_init_status` to tell the UI whether mem0 can be configured.
pub async fn has_embedding_provider(db: &SqlitePool) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM api_providers WHERE purpose = 'embedding'",
    )
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;
    Ok(count > 0)
}

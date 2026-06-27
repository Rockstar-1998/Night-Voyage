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

/// Fixed project cache location for mem0 persistence (guardrails: never C:\).
pub const MEM0_STORAGE_DIR: &str = "D:\\software_cache\\mem0";

/// Settings keys for mem0 embedding configuration. The chat/LLM credentials are
/// reused from `api_providers`; only embedding-specific knobs live in settings
/// because the providers table has no embedding columns.
const SETTING_EMBEDDING_MODEL: &str = "mem0_embedding_model";
const SETTING_EMBEDDING_DIMS: &str = "mem0_embedding_dims";
const SETTING_PROVIDER_ID: &str = "mem0_provider_id";

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

/// Resolve the provider mem0 should reuse for LLM + embedding credentials.
///
/// Preference order: the explicitly designated `mem0_provider_id` setting, then
/// the most recently updated provider in `api_providers`.
async fn resolve_provider(db: &SqlitePool) -> Result<(String, String), String> {
    let designated_id = load_setting(db, SETTING_PROVIDER_ID)
        .await
        .and_then(|value| value.trim().parse::<i64>().ok());

    let row = if let Some(provider_id) = designated_id {
        sqlx::query("SELECT base_url, api_key FROM api_providers WHERE id = ? LIMIT 1")
            .bind(provider_id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?
    } else {
        sqlx::query(
            "SELECT base_url, api_key FROM api_providers ORDER BY updated_at DESC, id DESC LIMIT 1",
        )
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?
    };

    let row = row.ok_or_else(|| {
        "no api_providers configured; mem0 needs a provider for LLM/embedding".to_string()
    })?;

    let base_url: String = row.try_get("base_url").map_err(|err| err.to_string())?;
    let api_key: String = row.try_get("api_key").map_err(|err| err.to_string())?;

    if base_url.trim().is_empty() {
        return Err("selected provider has an empty base_url".to_string());
    }
    Ok((base_url, api_key))
}

/// Build a `MemoryService` from the current DB state. Returns an error (never
/// panics) so callers can degrade gracefully when mem0 is not configurable yet.
pub async fn build_memory_service(
    db: &SqlitePool,
) -> Result<Arc<dyn MemoryService>, String> {
    let (base_url, api_key) = resolve_provider(db).await?;

    // The chat model is provider-bound; reuse the designated provider's model
    // for extraction. Fall back to the provider's own model_name column.
    let llm_model: String = sqlx::query_scalar::<_, String>(
        "SELECT model_name FROM api_providers ORDER BY updated_at DESC, id DESC LIMIT 1",
    )
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?
    .unwrap_or_default();

    let embedding_model = load_setting(db, SETTING_EMBEDDING_MODEL)
        .await
        .unwrap_or_else(|| DEFAULT_EMBEDDING_MODEL.to_string());
    let embedding_dims = load_setting(db, SETTING_EMBEDDING_DIMS)
        .await
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_EMBEDDING_DIMS);

    let config = Mem0RsProviderConfig {
        base_url,
        api_key,
        llm_model,
        embedding_model,
        embedding_dims,
        storage_dir: MEM0_STORAGE_DIR.to_string(),
    };

    let provider = Mem0RsProvider::new(config).map_err(|err| err.to_string())?;
    Ok(Arc::new(provider))
}


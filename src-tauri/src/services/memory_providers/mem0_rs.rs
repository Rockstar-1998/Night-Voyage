//! mem0-rs adapter: the ONLY module permitted to import mem0-rs types.
//!
//! Implements the project-owned [`MemoryService`] trait by delegating to the
//! mem0-rs [`mem0::Memory`] orchestrator (library mode, embedded vector store).
//! All mem0-rs errors are converted into [`MemoryServiceError`] here so they
//! never leak to callers. To track upstream changes, only this file should need
//! edits when the mem0-rs API shifts.

use async_trait::async_trait;
use mem0::{AddOptions, JsonMap, Memory, MemoryConfig, Message, SearchOptions};
use serde_json::{json, Value};

use crate::services::memory_service::{
    MemoryMessage, MemoryRecord, MemoryService, MemoryServiceError,
};

/// Project-owned configuration used to construct the adapter. Built from the
/// `api_providers` table plus the fixed cache path; deliberately free of any
/// mem0-rs type so the caller (AppState setup) stays decoupled.
///
/// LLM and embedding credentials are DECOUPLED: mem0 fact extraction routes
/// through one OpenAI-compatible provider, while vector search may use a
/// different provider that actually serves `/v1/embeddings`. Mixing them was
/// the root cause of [EMBED_001] 404 when the chat provider was Anthropic
/// native or otherwise lacked an embeddings endpoint.
#[derive(Debug, Clone)]
pub struct Mem0RsProviderConfig {
    /// OpenAI-compatible base URL for mem0's LLM (fact extraction) calls.
    pub llm_base_url: String,
    /// API key for mem0's LLM calls.
    pub llm_api_key: String,
    /// Chat model used by mem0 for fact extraction.
    pub llm_model: String,
    /// OpenAI-compatible base URL for embedding calls. MUST serve
    /// `/v1/embeddings`.
    pub embedding_base_url: String,
    /// API key for embedding calls.
    pub embedding_api_key: String,
    /// Embedding model used to vectorize memories.
    pub embedding_model: String,
    /// Embedding dimensionality (must match `embedding_model`).
    pub embedding_dims: usize,
    /// Directory for the embedded vector store + history db (project cache).
    pub storage_dir: String,
    /// Vector store collection name. Different embedding providers must use
    /// different collections because vector dimensions may differ.
    pub collection_name: String,
}

/// mem0-rs backed memory provider.
pub struct Mem0RsProvider {
    memory: Memory,
    /// Retained for health probes: we test the embedding endpoint directly.
    config: Mem0RsProviderConfig,
}

impl Mem0RsProvider {
    /// Build the provider from project-owned config. The mem0-rs `MemoryConfig`
    /// is assembled entirely here from our own fields — callers never see it.
    pub fn new(config: Mem0RsProviderConfig) -> Result<Self, MemoryServiceError> {
        // Persist vector store JSON and the history db under the project cache
        // directory (guardrails: never write to C:\). mem0-rs writes its
        // history db to history_db_path and the embedded store under `path`.
        std::fs::create_dir_all(&config.storage_dir).map_err(|err| {
            MemoryServiceError::NotConfigured(format!(
                "failed to create mem0 storage dir {}: {err}",
                config.storage_dir
            ))
        })?;

        let history_db_path = format!(
            "{}/history.db",
            config.storage_dir.trim_end_matches(['/', '\\'])
        );

        let memory_config_json = json!({
            "embedder": {
                "provider": "openai_compatible",
                "config": {
                    "model": config.embedding_model,
                    "api_key": config.embedding_api_key,
                    "openai_base_url": config.embedding_base_url,
                    "embedding_dims": config.embedding_dims,
                }
            },
            "llm": {
                "provider": "openai_compatible",
                "config": {
                    "model": config.llm_model,
                    "api_key": config.llm_api_key,
                    "openai_base_url": config.llm_base_url,
                }
            },
            "vector_store": {
                "provider": "embedded",
                "config": {
                    "path": config.storage_dir,
                    "collection_name": config.collection_name,
                    "embedding_model_dims": config.embedding_dims,
                }
            },
            "history_db_path": history_db_path,
        });

        let config_struct: MemoryConfig = serde_json::from_value(memory_config_json)
            .map_err(|err| MemoryServiceError::NotConfigured(err.to_string()))?;

        let memory = mem0::from_config(config_struct)
            .map_err(|err| MemoryServiceError::NotConfigured(err.to_string()))?;

        Ok(Self { memory, config })
    }

    /// Build the scope filter map mem0-rs expects for search/list/delete_all.
    fn user_filter(user_id: &str) -> JsonMap {
        let mut filters = JsonMap::new();
        filters.insert("user_id".into(), Value::String(user_id.to_string()));
        filters
    }
}

/// Parse mem0-rs's `{ "results": [...] }` shape into project records.
/// Returns `(records, skipped_reasons)` — each reason explains why one entry
/// was dropped so that silent data loss becomes visible in the logs.
fn parse_records(value: &Value) -> (Vec<MemoryRecord>, Vec<String>) {
    let Some(results) = value.get("results").and_then(|v| v.as_array()) else {
        return (Vec::new(), Vec::new());
    };
    let mut records = Vec::with_capacity(results.len());
    let mut skipped = Vec::new();

    for (idx, item) in results.iter().enumerate() {
        let id = match item.get("id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => {
                skipped.push(format!("results[{idx}]: missing or non-string 'id'"));
                continue;
            }
        };
        let memory = item
            .get("memory")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if memory.trim().is_empty() {
            skipped.push(format!("results[{idx}] id={id}: empty memory text"));
            continue;
        }
        let score = item
            .get("score")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32);
        let created_at = item
            .get("created_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        records.push(MemoryRecord {
            id,
            memory,
            score,
            created_at,
        });
    }
    (records, skipped)
}

#[async_trait]
impl MemoryService for Mem0RsProvider {
    async fn add(
        &self,
        messages: Vec<MemoryMessage>,
        user_id: &str,
        agent_id: &str,
    ) -> Result<(), MemoryServiceError> {
        let mem0_messages: Vec<Message> = messages
            .into_iter()
            .map(|m| Message::new(m.role, m.content))
            .collect();

        let opts = AddOptions {
            user_id: Some(user_id.to_string()),
            agent_id: Some(agent_id.to_string()),
            ..Default::default()
        };

        self.memory
            .add(mem0_messages, opts)
            .await
            .map(|_| ())
            .map_err(|err| MemoryServiceError::Backend(err.to_string()))
    }

    async fn search(
        &self,
        query: &str,
        user_id: &str,
        limit: usize,
    ) -> Result<Vec<MemoryRecord>, MemoryServiceError> {
        let filters = Self::user_filter(user_id);
        let options = SearchOptions {
            top_k: limit,
            ..Default::default()
        };
        let value = self
            .memory
            .search(query, &filters, options)
            .await
            .map_err(|err| MemoryServiceError::Backend(err.to_string()))?;
        let (records, skipped) = parse_records(&value);
        for reason in &skipped {
            eprintln!("[mem0-rs] search skipped record: {reason}");
        }
        Ok(records)
    }

    async fn get_all(
        &self,
        user_id: &str,
        limit: usize,
    ) -> Result<Vec<MemoryRecord>, MemoryServiceError> {
        let filters = Self::user_filter(user_id);
        let value = self
            .memory
            .get_all(&filters, limit)
            .await
            .map_err(|err| MemoryServiceError::Backend(err.to_string()))?;
        let (records, skipped) = parse_records(&value);
        for reason in &skipped {
            eprintln!("[mem0-rs] get_all skipped record: {reason}");
        }
        Ok(records)
    }

    async fn delete(&self, memory_id: &str) -> Result<(), MemoryServiceError> {
        self.memory
            .delete(memory_id)
            .await
            .map(|_| ())
            .map_err(|err| MemoryServiceError::Backend(err.to_string()))
    }

    async fn delete_all(&self, user_id: &str) -> Result<usize, MemoryServiceError> {
        // Count first (delete_all returns only a message), then delete.
        let existing = self.get_all(user_id, usize::MAX).await?;
        let count = existing.len();
        self.memory
            .delete_all(Some(user_id), None, None)
            .await
            .map_err(|err| MemoryServiceError::Backend(err.to_string()))?;
        Ok(count)
    }

    async fn health(&self) -> Result<bool, MemoryServiceError> {
        // Probe the embedding endpoint directly with a minimal request.
        // A real HTTP check is more reliable than the construction-time
        // invariant: the upstream provider may have gone down since startup.
        // Uses the EMBEDDING provider's credentials (not the LLM provider's),
        // since `/v1/embeddings` is only meaningful on the embedding endpoint.
        let url = format!(
            "{}/embeddings",
            self.config.embedding_base_url.trim_end_matches('/')
        );
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|err| MemoryServiceError::Backend(err.to_string()))?;

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.embedding_api_key))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "model": self.config.embedding_model,
                "input": "health"
            }))
            .send()
            .await
            .map_err(|err| MemoryServiceError::Backend(format!("embedding probe failed: {err}")))?;

        Ok(response.status().is_success())
    }
}

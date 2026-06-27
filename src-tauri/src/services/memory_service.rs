//! Project-owned memory abstraction boundary.
//!
//! Business code (prompt_compiler, chat_service, commands) depends ONLY on this
//! module. No mem0-rs types appear here or in any caller — they are confined to
//! `services/memory_providers/mem0_rs.rs`. To swap the memory backend, add a new
//! implementation under `memory_providers/` and rewire AppState; callers stay
//! untouched.

use async_trait::async_trait;
use serde::Serialize;

/// A single message handed to the memory backend for fact extraction.
///
/// Deliberately minimal and provider-agnostic: only the role + content the
/// extraction LLM needs. We never pass character cards, world books, or other
/// constant layers here.
#[derive(Debug, Clone)]
pub struct MemoryMessage {
    /// `user` | `assistant` | `system`.
    pub role: String,
    /// Raw message content.
    pub content: String,
}

impl MemoryMessage {
    /// Construct a `user` message.
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
        }
    }

    /// Construct an `assistant` message.
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.into(),
        }
    }
}

/// A stored memory returned from search/list operations.
#[derive(Debug, Clone, Serialize)]
pub struct MemoryRecord {
    /// Stable backend id for the memory (used by delete).
    pub id: String,
    /// The extracted memory text.
    pub memory: String,
    /// Optional relevance score from search (None for plain listings).
    pub score: Option<f32>,
    /// Optional creation timestamp (RFC3339), surfaced for debug UIs.
    pub created_at: Option<String>,
}

/// Project-owned error type. mem0-rs errors are converted into this inside the
/// adapter so they never leak to callers.
#[derive(Debug, Clone)]
pub enum MemoryServiceError {
    /// The backend was requested but not configured/initialized.
    NotConfigured(String),
    /// A backend call failed (network, LLM, vector store, parsing, ...).
    Backend(String),
}

impl std::fmt::Display for MemoryServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotConfigured(msg) => write!(f, "memory service not configured: {msg}"),
            Self::Backend(msg) => write!(f, "memory backend error: {msg}"),
        }
    }
}

impl std::error::Error for MemoryServiceError {}

/// The memory capability contract. Implementations live under
/// `memory_providers/`. The trait is object-safe and `Send + Sync` so it can be
/// stored as `Arc<dyn MemoryService>` in AppState.
#[async_trait]
pub trait MemoryService: Send + Sync {
    /// Extract and store memories from the given messages, scoped to
    /// `user_id` (conversation) and `agent_id` (character).
    async fn add(
        &self,
        messages: Vec<MemoryMessage>,
        user_id: &str,
        agent_id: &str,
    ) -> Result<(), MemoryServiceError>;

    /// Semantic search for memories relevant to `query`, scoped to `user_id`.
    async fn search(
        &self,
        query: &str,
        user_id: &str,
        limit: usize,
    ) -> Result<Vec<MemoryRecord>, MemoryServiceError>;

    /// List stored memories for `user_id` (no query ranking).
    async fn get_all(
        &self,
        user_id: &str,
        limit: usize,
    ) -> Result<Vec<MemoryRecord>, MemoryServiceError>;

    /// Delete a single memory by backend id.
    async fn delete(&self, memory_id: &str) -> Result<(), MemoryServiceError>;

    /// Delete all memories scoped to `user_id`. Returns count deleted.
    async fn delete_all(&self, user_id: &str) -> Result<usize, MemoryServiceError>;

    /// Lightweight readiness probe.
    async fn health(&self) -> Result<bool, MemoryServiceError>;
}

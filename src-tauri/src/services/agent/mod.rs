pub mod banned_words;
pub mod dice;
pub mod director;
pub mod redaction;
pub mod sandbox;
pub mod scriptwriter;

#[allow(unused_imports)]
pub use banned_words::{BannedWordsFilter, BannedWordsViolation, DEFAULT_BANNED_WORDS};
#[allow(unused_imports)]
pub use dice::{DiceRollResult, DiceRollSpec};
#[allow(unused_imports)]
pub use director::{ActorReturnPayload, AgentDelegateTaskSpec, DirectorTurnOutput, ScopedCharacterCard};
#[allow(unused_imports)]
pub use redaction::RedactedText;
#[allow(unused_imports)]
pub use sandbox::AgentSandbox;
#[allow(unused_imports)]
pub use scriptwriter::{CritiqueResult, ScriptwriterPipelineRecord, MAX_HANDOFF_DEPTH};

#[allow(dead_code)]

use serde::{Deserialize, Serialize};

/// Agent 运行过程事件载荷，用于通过 Tauri Event 向前端无延迟广播
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct AgentProgressEvent {
    pub conversation_id: i64,
    pub step: String,
    pub message: String,
    pub payload: Option<serde_json::Value>,
    pub timestamp: i64,
}

impl AgentProgressEvent {
    pub fn new(conversation_id: i64, step: &str, message: &str) -> Self {
        Self {
            conversation_id,
            step: step.to_string(),
            message: message.to_string(),
            payload: None,
            timestamp: crate::utils::now_ts(),
        }
    }

    pub fn with_payload(mut self, payload: serde_json::Value) -> Self {
        self.payload = Some(payload);
        self
    }
}

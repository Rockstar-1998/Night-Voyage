use serde::{Deserialize, Serialize};

pub const ANTHROPIC_API_VERSION: &str = "2025-04-14";

pub type LlmResult<T> = Result<T, LlmError>;
pub type VectorStoreResult<T> = Result<T, VectorStoreError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LlmRole {
    System,
    User,
    Assistant,
}

impl LlmRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmBinarySource {
    Base64 {
        media_type: String,
        data_base64: String,
    },
    Asset {
        asset_id: i64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmContentPart {
    Text {
        text: String,
    },
    Image {
        media_type: String,
        source: LlmBinarySource,
    },
    ToolUse {
        id: String,
        name: String,
        input_json: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content_parts: Vec<LlmContentPart>,
        is_error: bool,
    },
    Thinking {
        text: String,
        signature: Option<String>,
    },
    RedactedThinking {
        data: String,
    },
}

impl LlmContentPart {
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text { text: text.into() }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::Text { text } => Some(text.as_str()),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessage {
    pub role: LlmRole,
    pub parts: Vec<LlmContentPart>,
}

impl LlmMessage {
    pub fn text(role: LlmRole, text: impl Into<String>) -> Self {
        Self {
            role,
            parts: vec![LlmContentPart::text(text)],
        }
    }

    pub fn first_text(&self) -> Option<&str> {
        self.parts.first().and_then(LlmContentPart::as_text)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmToolDefinition {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmToolChoice {
    Auto,
    Any,
    Tool { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmThinkingConfig {
    pub enabled: bool,
    pub budget_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatRequest {
    pub provider_kind: String,
    pub model: String,
    pub system: Vec<String>,
    pub messages: Vec<LlmMessage>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub top_k: Option<i64>,
    pub presence_penalty: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub response_mode: Option<String>,
    pub stop_sequences: Vec<String>,
    pub stream: bool,
    pub tools: Vec<LlmToolDefinition>,
    pub tool_choice: Option<LlmToolChoice>,
    pub thinking: Option<LlmThinkingConfig>,
    pub beta_features: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHttpRequest {
    pub url: String,
    pub headers: Vec<ProviderHttpHeader>,
    pub body: serde_json::Value,
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LlmStreamEventKind {
    TextDelta,
    ThinkingDelta,
    ContentBlockStart,
    ContentBlockStop,
    ToolUse,
    MessageStop,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmToolUsePayload {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmStreamEvent {
    pub event_kind: LlmStreamEventKind,
    pub part_index: Option<usize>,
    pub part_type: Option<String>,
    pub text_delta: Option<String>,
    pub json_delta: Option<String>,
    pub tool_use: Option<LlmToolUsePayload>,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
        }
    }
}

impl From<ChatMessage> for LlmMessage {
    fn from(value: ChatMessage) -> Self {
        let role = match value.role.as_str() {
            "system" => LlmRole::System,
            "assistant" => LlmRole::Assistant,
            _ => LlmRole::User,
        };
        LlmMessage::text(role, value.content)
    }
}

impl TryFrom<LlmMessage> for ChatMessage {
    type Error = String;

    fn try_from(value: LlmMessage) -> Result<Self, Self::Error> {
        let content = value
            .first_text()
            .ok_or_else(|| "仅支持把纯文本 LlmMessage 转换为 ChatMessage".to_string())?;
        Ok(Self::new(value.role.as_str(), content))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub provider_kind: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatChunk {
    pub delta: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamHandle {
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingRequest {
    pub provider_kind: String,
    pub model: String,
    pub texts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingVector {
    pub index: usize,
    pub values: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VectorPoint {
    pub id: String,
    pub vector: Vec<f32>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VectorQuery {
    pub vector: Vec<f32>,
    pub top_k: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VectorMatch {
    pub id: String,
    pub score: f32,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmError {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VectorStoreError {
    pub message: String,
}

pub trait ModelProviderGateway: Send + Sync {
    fn provider_kind(&self) -> &'static str;
}

pub trait EmbeddingGateway: Send + Sync {
    fn provider_kind(&self) -> &'static str;
}

pub trait VectorStore: Send + Sync {
    fn backend(&self) -> &'static str;
}

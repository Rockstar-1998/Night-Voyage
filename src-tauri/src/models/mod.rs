pub mod blueprint;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApiProvider {
    pub id: i64,
    pub name: String,
    pub provider_kind: String,
    pub purpose: String,
    pub base_url: String,
    pub api_key: String,
    pub model_name: String,
    pub max_tokens: Option<i64>,
    pub max_context_tokens: Option<i64>,
    pub temperature: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApiProviderSummary {
    pub id: i64,
    pub name: String,
    pub provider_kind: String,
    pub purpose: String,
    pub base_url: String,
    pub model_name: String,
    pub has_api_key: bool,
    pub api_key_preview: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModel {
    pub id: String,
    pub owned_by: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConversationListItem {
    pub id: i64,
    pub conversation_type: String,
    pub title: Option<String>,
    pub host_character_id: Option<i64>,
    pub world_book_id: Option<i64>,
    pub preset_id: Option<i64>,
    pub provider_id: Option<i64>,
    pub embedding_provider_id: Option<i64>,
    pub chat_mode: String,
    pub agent_provider_policy: String,
    pub memory_mode: String,
    pub mem0_snapshot_window: i64,
    pub member_count: i64,
    pub pending_member_count: i64,
    pub room_status: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMember {
    pub id: i64,
    pub conversation_id: i64,
    pub member_role: String,
    pub display_name: String,
    pub player_character_id: Option<i64>,
    pub join_order: i64,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoundState {
    pub round_id: i64,
    pub conversation_id: i64,
    pub round_index: i64,
    pub status: String,
    pub required_member_count: i64,
    pub decided_member_count: i64,
    pub waiting_member_ids: Vec<i64>,
    pub aggregated_user_content: Option<String>,
    pub active_assistant_message_id: Option<i64>,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UiMessage {
    pub id: i64,
    pub conversation_id: i64,
    pub round_id: Option<i64>,
    pub member_id: Option<i64>,
    pub role: String,
    pub message_kind: String,
    pub content: String,
    pub display_name: Option<String>,
    pub is_swipe: bool,
    pub swipe_index: i64,
    pub reply_to_id: Option<i64>,
    pub summary_batch_index: Option<i64>,
    pub summary_entry_id: Option<i64>,
    pub is_active_in_round: bool,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConversationCreateResult {
    pub conversation: ConversationListItem,
    pub host_member: ConversationMember,
    pub round: RoundState,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetSummary {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub is_builtin: bool,
    pub version: i64,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub top_k: Option<i64>,
    pub presence_penalty: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub response_mode: Option<String>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget_tokens: Option<i64>,
    pub beta_features: Option<Vec<String>>,
    pub structured_output_schema: Option<String>,
    pub structured_output_display: Option<String>,
    pub context_included_keys: Option<String>,
    /// 蓝图图 JSON 字符串（BlueprintGraph 序列化，version=2）。
    ///
    /// 迁移期与旧字段共存：当此字段为 `Some` 时由图执行器运行时执行；
    /// 为 `None` 时回退到旧字段（blocks / structured_output_schema / semantic_groups）。
    /// 旧字段在 Task 12 删除。
    pub blueprint_graph: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetPromptBlockRecord {
    pub id: i64,
    pub preset_id: i64,
    pub semantic_option_id: Option<i64>,
    pub block_type: String,
    pub title: Option<String>,
    pub content: String,
    pub sort_order: i64,
    pub priority: i64,
    pub is_enabled: bool,
    pub scope: String,
    pub is_locked: bool,
    pub lock_reason: Option<String>,
    pub exclusive_group_key: Option<String>,
    pub exclusive_group_label: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetStopSequenceRecord {
    pub id: i64,
    pub preset_id: i64,
    pub stop_text: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetProviderOverrideRecord {
    pub id: i64,
    pub preset_id: i64,
    pub provider_kind: String,
    pub temperature_override: Option<f64>,
    pub max_output_tokens_override: Option<i64>,
    pub top_p_override: Option<f64>,
    pub top_k_override: Option<i64>,
    pub presence_penalty_override: Option<f64>,
    pub frequency_penalty_override: Option<f64>,
    pub response_mode_override: Option<String>,
    pub stop_sequences_override: Vec<String>,
    pub disabled_block_types: Vec<String>,
    pub thinking_enabled_override: Option<bool>,
    pub thinking_budget_tokens_override: Option<i64>,
    pub beta_features_override: Option<Vec<String>>,
    pub structured_output_schema_override: Option<String>,
    pub structured_output_display_override: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetSemanticOptionBlockRecord {
    pub id: i64,
    pub option_id: i64,
    pub block_type: String,
    pub title: Option<String>,
    pub content: String,
    pub sort_order: i64,
    pub priority: i64,
    pub is_enabled: bool,
    pub scope: String,
    pub is_locked: bool,
    pub lock_reason: Option<String>,
    pub exclusive_group_key: Option<String>,
    pub exclusive_group_label: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetSemanticOptionExampleRecord {
    pub id: i64,
    pub option_id: i64,
    pub role: String,
    pub content: String,
    pub sort_order: i64,
    pub is_enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetSemanticOptionRecord {
    pub id: i64,
    pub group_id: i64,
    pub parent_option_id: Option<i64>,
    pub option_key: String,
    pub label: String,
    pub description: Option<String>,
    pub depth: i64,
    pub sort_order: i64,
    pub is_selected: bool,
    pub is_enabled: bool,
    pub expansion_kind: String,
    pub linked_schema_keys: Option<String>,
    pub blocks: Vec<PresetSemanticOptionBlockRecord>,
    pub examples: Vec<PresetSemanticOptionExampleRecord>,
    pub children: Vec<PresetSemanticOptionRecord>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetSemanticGroupRecord {
    pub id: i64,
    pub preset_id: i64,
    pub group_key: String,
    pub label: String,
    pub description: Option<String>,
    pub sort_order: i64,
    pub selection_mode: String,
    pub is_enabled: bool,
    pub options: Vec<PresetSemanticOptionRecord>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetDetail {
    pub preset: PresetSummary,
    pub blocks: Vec<PresetPromptBlockRecord>,
    pub stop_sequences: Vec<PresetStopSequenceRecord>,
    pub provider_overrides: Vec<PresetProviderOverrideRecord>,
    pub semantic_groups: Vec<PresetSemanticGroupRecord>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRoundAction {
    pub member_id: i64,
    pub action_type: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachment {
    pub base64_data: String,
    pub mime_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatSubmitInputResult {
    pub round: RoundState,
    pub action: SubmitRoundAction,
    pub visible_user_message: Option<UiMessage>,
    pub assistant_message: Option<UiMessage>,
    pub auto_dispatched: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RegenerateRoundResult {
    pub round: RoundState,
    pub assistant_message: UiMessage,
    pub preserved_version_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RetryFailedRoundResult {
    pub round: RoundState,
    pub assistant_message: UiMessage,
    pub attempt_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatRoundStateEvent {
    pub round: RoundState,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunkEvent {
    pub conversation_id: i64,
    pub round_id: i64,
    pub message_id: i64,
    pub delta: String,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LlmStreamToolUseEvent {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LlmStreamEventPayload {
    pub conversation_id: i64,
    pub round_id: i64,
    pub message_id: i64,
    pub provider_kind: String,
    pub event_kind: String,
    pub part_index: Option<i64>,
    pub part_type: Option<String>,
    pub text_delta: Option<String>,
    pub json_delta: Option<String>,
    pub tool_use: Option<LlmStreamToolUseEvent>,
    pub stop_reason: Option<String>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamErrorEvent {
    pub conversation_id: i64,
    pub round_id: i64,
    pub message_id: i64,
    pub error: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamRetryEvent {
    pub conversation_id: i64,
    pub round_id: i64,
    pub message_id: i64,
    pub error: String,
    pub attempt_count: i64,
    pub auto_retry_enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CharacterBaseSection {
    pub id: i64,
    pub character_id: i64,
    pub section_key: String,
    pub title: Option<String>,
    pub content: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CharacterCard {
    pub id: i64,
    pub card_type: String,
    pub name: String,
    pub image_path: Option<String>,
    pub description: String,
    pub tags: Vec<String>,
    pub base_sections: Vec<CharacterBaseSection>,
    pub first_messages: Vec<String>,
    pub default_world_book_id: Option<i64>,
    pub default_preset_id: Option<i64>,
    pub default_provider_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

// CharacterStateOverlayRecord, CharacterStateOverlayUpdatedEvent, and
// CharacterStateOverlayErrorEvent removed: character_state_overlays table
// dropped in migration 0036. WorldVariable is now stored per-round in
// message_rounds.world_variables.

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlotSummaryRecord {
    pub id: i64,
    pub conversation_id: i64,
    pub batch_index: i64,
    pub start_round_id: i64,
    pub end_round_id: i64,
    pub start_round_index: i64,
    pub end_round_index: i64,
    pub covered_round_count: i64,
    pub source_kind: String,
    pub status: String,
    pub summary_text: Option<String>,
    pub provider_kind: Option<String>,
    pub model_name: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlotSummaryUpdatedEvent {
    pub conversation_id: i64,
    pub plot_summary_id: i64,
    pub batch_index: i64,
    pub status: String,
    pub source_kind: Option<String>,
    pub summary_text: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlotSummaryErrorEvent {
    pub conversation_id: i64,
    pub plot_summary_id: i64,
    pub batch_index: i64,
    pub status: String,
    pub error: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlotSummaryPendingEvent {
    pub conversation_id: i64,
    pub plot_summary_id: i64,
    pub batch_index: i64,
    pub status: String,
    pub start_round_index: i64,
    pub end_round_index: i64,
    pub covered_round_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorldBookSummary {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub image_path: Option<String>,
    pub entry_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorldBookEntryRecord {
    pub id: i64,
    pub world_book_id: i64,
    pub title: String,
    pub content: String,
    pub keywords: Vec<String>,
    pub trigger_mode: String,
    pub is_enabled: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenLayerUsage {
    pub kind: String,
    pub title: Option<String>,
    pub estimated_tokens: usize,
    pub color: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageReport {
    pub context_window_size: Option<usize>,
    pub layers: Vec<TokenLayerUsage>,
    pub total_estimated_tokens: usize,
    pub total_actual_tokens: Option<usize>,
}

/// Emitted via `llm-memory-error` when a memory backend operation fails.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemoryBackendErrorEvent {
    pub conversation_id: i64,
    pub round_id: i64,
    /// "search" | "add" | "health" etc.
    pub operation: String,
    /// Which retrieval strategy failed (detail, character_state, plot) — None for non-search ops.
    pub strategy: Option<String>,
    pub error: String,
}

/// Response payload for the `mem0_init_status` command.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mem0InitStatusResponse {
    pub available: bool,
    pub error: Option<String>,
}

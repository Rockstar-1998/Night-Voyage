use crate::models::{PresetDetail, PresetSummary};
use crate::services::preset_service::PresetService;
use crate::validators::preset_validator::{
    PresetExampleInput, PresetPromptBlockInput, PresetProviderOverrideInput,
    PresetSemanticGroupInput, PresetStopSequenceInput,
};
use crate::AppState;

#[tauri::command]
pub async fn presets_list(state: tauri::State<'_, AppState>) -> Result<Vec<PresetSummary>, String> {
    let service = PresetService::new(&state.db);
    service.list_all().await
}

#[tauri::command]
pub async fn presets_get(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<PresetDetail, String> {
    let service = PresetService::new(&state.db);
    service.get_by_id(id).await
}

#[tauri::command]
pub async fn presets_export(state: tauri::State<'_, AppState>, id: i64) -> Result<String, String> {
    let service = PresetService::new(&state.db);
    service.export(id).await
}

#[tauri::command]
pub async fn presets_import(
    state: tauri::State<'_, AppState>,
    payload_json: String,
) -> Result<PresetDetail, String> {
    let service = PresetService::new(&state.db);
    service.import(payload_json).await
}

#[tauri::command]
pub async fn presets_create(
    state: tauri::State<'_, AppState>,
    name: String,
    description: Option<String>,
    category: Option<String>,
    temperature: Option<f64>,
    max_output_tokens: Option<i64>,
    top_p: Option<f64>,
    top_k: Option<i64>,
    presence_penalty: Option<f64>,
    frequency_penalty: Option<f64>,
    response_mode: Option<String>,
    thinking_enabled: Option<bool>,
    thinking_budget_tokens: Option<i64>,
    beta_features: Option<Vec<String>>,
    blocks: Option<Vec<PresetPromptBlockInput>>,
    examples: Option<Vec<PresetExampleInput>>,
    stop_sequences: Option<Vec<PresetStopSequenceInput>>,
    provider_overrides: Option<Vec<PresetProviderOverrideInput>>,
    semantic_groups: Option<Vec<PresetSemanticGroupInput>>,
) -> Result<PresetDetail, String> {
    let service = PresetService::new(&state.db);
    service
        .create(
            name,
            description,
            category,
            temperature,
            max_output_tokens,
            top_p,
            top_k,
            presence_penalty,
            frequency_penalty,
            response_mode,
            thinking_enabled,
            thinking_budget_tokens,
            beta_features,
            blocks,
            examples,
            stop_sequences,
            provider_overrides,
            semantic_groups,
        )
        .await
}

#[tauri::command]
pub async fn presets_update(
    state: tauri::State<'_, AppState>,
    id: i64,
    name: String,
    description: Option<String>,
    category: Option<String>,
    temperature: Option<f64>,
    max_output_tokens: Option<i64>,
    top_p: Option<f64>,
    top_k: Option<i64>,
    presence_penalty: Option<f64>,
    frequency_penalty: Option<f64>,
    response_mode: Option<String>,
    thinking_enabled: Option<bool>,
    thinking_budget_tokens: Option<i64>,
    beta_features: Option<Vec<String>>,
    blocks: Option<Vec<PresetPromptBlockInput>>,
    examples: Option<Vec<PresetExampleInput>>,
    stop_sequences: Option<Vec<PresetStopSequenceInput>>,
    provider_overrides: Option<Vec<PresetProviderOverrideInput>>,
    semantic_groups: Option<Vec<PresetSemanticGroupInput>>,
) -> Result<PresetDetail, String> {
    let service = PresetService::new(&state.db);
    service
        .update(
            id,
            name,
            description,
            category,
            temperature,
            max_output_tokens,
            top_p,
            top_k,
            presence_penalty,
            frequency_penalty,
            response_mode,
            thinking_enabled,
            thinking_budget_tokens,
            beta_features,
            blocks,
            examples,
            stop_sequences,
            provider_overrides,
            semantic_groups,
        )
        .await
}

#[tauri::command]
pub async fn presets_delete(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    let service = PresetService::new(&state.db);
    service.delete(id).await
}

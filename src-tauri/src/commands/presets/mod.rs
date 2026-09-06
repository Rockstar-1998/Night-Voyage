use std::path::PathBuf;

use crate::models::{PresetDetail, PresetSummary};
use crate::services::preset_service::PresetService;
use crate::validators::preset_validator::{
    PresetPromptBlockInput, PresetProviderOverrideInput,
    PresetSemanticGroupInput, PresetStopSequenceInput,
};
use crate::AppState;

// AppHandle.path() 由 Manager trait 提供。
use tauri::Manager;

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
pub async fn presets_export_to_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
    file_name: String,
) -> Result<String, String> {
    let service = PresetService::new(&state.db);
    let json = service.export(id).await?;

    let dir = resolve_export_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;

    let file_name = sanitize_export_file_name(&file_name);
    let path = unique_export_path(&dir, &file_name);

    std::fs::write(&path, json).map_err(|err| err.to_string())?;

    // 跨 IPC 路径统一使用正斜杠，避免 JSON 解析与前端显示问题。
    Ok(path.to_string_lossy().replace('\\', "/"))
}

fn resolve_export_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        let base = app.path().app_data_dir().map_err(|err| err.to_string())?;
        Ok(base.join("exports"))
    }

    #[cfg(not(target_os = "android"))]
    {
        let base = app
            .path()
            .download_dir()
            .or_else(|_| app.path().app_data_dir())
            .map_err(|err| err.to_string())?;
        Ok(base.join("Night Voyage Exports"))
    }
}

fn sanitize_export_file_name(input: &str) -> String {
    let filtered: String = input
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'))
        .collect();
    let mut name = filtered.trim().to_string();
    if name.is_empty() {
        name = "preset.nvpreset.json".to_string();
    }
    if !name.ends_with(".nvpreset.json") {
        name.push_str(".nvpreset.json");
    }
    name
}

fn unique_export_path(dir: &std::path::Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let stem = file_name.strip_suffix(".nvpreset.json").unwrap_or(file_name);
    let mut counter = 1;
    loop {
        let next_name = format!("{} ({}).nvpreset.json", stem, counter);
        let candidate = dir.join(&next_name);
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
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
    structured_output_schema: Option<String>,
    structured_output_display: Option<String>,
    context_included_keys: Option<String>,
    blueprint_graph: Option<String>,
    blocks: Option<Vec<PresetPromptBlockInput>>,
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
            structured_output_schema,
            structured_output_display,
            context_included_keys,
            blueprint_graph,
            blocks,
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
    structured_output_schema: Option<String>,
    structured_output_display: Option<String>,
    context_included_keys: Option<String>,
    blueprint_graph: Option<String>,
    blocks: Option<Vec<PresetPromptBlockInput>>,
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
            structured_output_schema,
            structured_output_display,
            context_included_keys,
            blueprint_graph,
            blocks,
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

#[tauri::command]
pub async fn presets_rename(
    state: tauri::State<'_, AppState>,
    id: i64,
    new_name: String,
) -> Result<PresetDetail, String> {
    let service = PresetService::new(&state.db);
    service.rename(id, new_name).await
}

#[tauri::command]
pub async fn presets_duplicate(
    state: tauri::State<'_, AppState>,
    id: i64,
    new_name: String,
) -> Result<PresetDetail, String> {
    let service = PresetService::new(&state.db);
    service.duplicate(id, new_name).await
}

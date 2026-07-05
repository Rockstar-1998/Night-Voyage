use tauri::{AppHandle, State};

use crate::{
    models::PlotSummaryRecord,
    services::plot_summaries::{
        list_pending_plot_summaries, list_plot_summaries, normalize_plot_summary_mode,
        upsert_manual_plot_summary,
    },
    AppState,
};

#[tauri::command]
pub async fn plot_summaries_list(
    state: State<'_, AppState>,
    conversation_id: i64,
) -> Result<Vec<PlotSummaryRecord>, String> {
    list_plot_summaries(&state.db, conversation_id).await
}

#[tauri::command]
pub async fn plot_summaries_get_pending(
    state: State<'_, AppState>,
    conversation_id: i64,
) -> Result<Vec<PlotSummaryRecord>, String> {
    list_pending_plot_summaries(&state.db, conversation_id).await
}

#[tauri::command]
pub async fn plot_summaries_upsert_manual(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: i64,
    batch_index: i64,
    summary_text: String,
) -> Result<PlotSummaryRecord, String> {
    upsert_manual_plot_summary(&app, &state.db, conversation_id, batch_index, &summary_text).await
}

/// Deprecated: forwards to `memory_mode_set`. Use `memory_mode_set` directly.
/// DEPRECATED: legacy forwarding from old plot_summary_mode API.
/// Maps: "disabled" → "stateless", "ai"/"manual" → "legacy".
/// No longer called from UI; kept for backward compatibility.
#[tauri::command]
pub async fn plot_summaries_update_mode(
    _app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: i64,
    plot_summary_mode: String,
) -> Result<String, String> {
    let normalized_mode = normalize_plot_summary_mode(&plot_summary_mode)?;
    let memory_mode = if normalized_mode == "disabled" {
        "stateless"
    } else {
        "legacy"
    };
    crate::commands::mem0::memory_mode_set(state, conversation_id, memory_mode.to_string()).await?;
    Ok(normalized_mode)
}

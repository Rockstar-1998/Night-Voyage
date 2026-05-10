use tauri::{AppHandle, State};

use crate::{
    models::PlotSummaryRecord,
    services::plot_summaries::{
        list_pending_plot_summaries, list_plot_summaries, normalize_plot_summary_mode,
        spawn_plot_summary_processing_task, upsert_manual_plot_summary,
    },
    utils::now_ts,
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

#[tauri::command]
pub async fn plot_summaries_update_mode(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: i64,
    plot_summary_mode: String,
) -> Result<String, String> {
    let normalized_mode = normalize_plot_summary_mode(&plot_summary_mode)?;
    let now = now_ts();

    sqlx::query("UPDATE conversations SET plot_summary_mode = ?, updated_at = ? WHERE id = ?")
        .bind(&normalized_mode)
        .bind(now)
        .bind(conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    if normalized_mode == "ai" {
        let provider_id: Option<i64> =
            sqlx::query_scalar("SELECT provider_id FROM conversations WHERE id = ? LIMIT 1")
                .bind(conversation_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|err| err.to_string())?
                .flatten();

        if let Some(provider_id) = provider_id {
            spawn_plot_summary_processing_task(app, state.db.clone(), conversation_id, provider_id);
        }
    } else {
        let _ = list_plot_summaries(&state.db, conversation_id).await?;
    }

    Ok(normalized_mode)
}

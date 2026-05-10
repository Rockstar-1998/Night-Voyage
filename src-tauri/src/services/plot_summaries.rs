use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter};

use crate::{
    models::{
        ApiProvider, PlotSummaryErrorEvent, PlotSummaryPendingEvent, PlotSummaryRecord,
        PlotSummaryUpdatedEvent,
    },
    services::prompt_compiler::{
        PromptBlock, PromptBlockKind, PromptBlockSource, PromptCompileDebugReport, PromptRole,
    },
    utils::now_ts,
};

pub const PLOT_SUMMARY_MODE_AI: &str = "ai";
pub const PLOT_SUMMARY_MODE_MANUAL: &str = "manual";
pub const PLOT_SUMMARY_SOURCE_AI: &str = "ai";
pub const PLOT_SUMMARY_SOURCE_MANUAL: &str = "manual";
pub const PLOT_SUMMARY_SOURCE_MANUAL_OVERRIDE: &str = "manual_override";
pub const PLOT_SUMMARY_STATUS_PENDING: &str = "pending";
pub const PLOT_SUMMARY_STATUS_QUEUED: &str = "queued";
pub const PLOT_SUMMARY_STATUS_COMPLETED: &str = "completed";
pub const PLOT_SUMMARY_STATUS_FAILED: &str = "failed";
pub const PLOT_SUMMARY_WINDOW_SIZE: usize = 5;

#[derive(Debug, Clone)]
pub struct PlotSummaryRoundMarker {
    pub batch_index: i64,
    pub summary_id: i64,
}

#[derive(Debug, Clone)]
struct CompletedRoundRef {
    id: i64,
    round_index: i64,
}

#[derive(Debug, Clone)]
struct PlotSummaryBatchWindow {
    batch_index: i64,
    start_round_id: i64,
    end_round_id: i64,
    start_round_index: i64,
    end_round_index: i64,
    covered_round_count: i64,
    covered_round_ids: Vec<i64>,
}

#[derive(Debug, Clone)]
struct PlotSummaryRoundContext {
    round_id: i64,
    round_index: i64,
    user_content: String,
    assistant_content: String,
}

#[derive(Debug, Clone)]
struct PlotSummaryGenerationContext {
    batch: PlotSummaryBatchWindow,
    rounds: Vec<PlotSummaryRoundContext>,
}

pub fn normalize_plot_summary_mode(value: &str) -> Result<String, String> {
    match value.trim() {
        PLOT_SUMMARY_MODE_AI => Ok(PLOT_SUMMARY_MODE_AI.to_string()),
        PLOT_SUMMARY_MODE_MANUAL => Ok(PLOT_SUMMARY_MODE_MANUAL.to_string()),
        _ => Err("plotSummaryMode 只支持 ai 或 manual".to_string()),
    }
}

pub async fn load_plot_summary_blocks(
    db: &SqlitePool,
    conversation_id: i64,
    target_round_id: Option<i64>,
    debug: &mut PromptCompileDebugReport,
) -> Result<Vec<PromptBlock>, String> {
    let rows = sqlx::query(
        "SELECT id, batch_index, start_round_index, end_round_index, summary_text \
         FROM plot_summaries \
         WHERE conversation_id = ? \
           AND status = 'completed' \
           AND summary_text IS NOT NULL \
           AND TRIM(summary_text) <> '' \
           AND (? IS NULL OR end_round_id < ?) \
         ORDER BY batch_index ASC, id ASC",
    )
    .bind(conversation_id)
    .bind(target_round_id)
    .bind(target_round_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let mut blocks = Vec::with_capacity(rows.len());
    for row in rows {
        let summary_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        let batch_index: i64 = row.try_get("batch_index").unwrap_or_default();
        let start_round_index: i64 = row.try_get("start_round_index").unwrap_or_default();
        let end_round_index: i64 = row.try_get("end_round_index").unwrap_or_default();
        let summary_text = row
            .try_get::<String, _>("summary_text")
            .unwrap_or_default()
            .trim()
            .to_string();
        if summary_text.is_empty() {
            continue;
        }
        debug.input_sources.push(format!(
            "plot_summary:{conversation_id}:{batch_index}:{summary_id}"
        ));
        blocks.push(build_plot_summary_block(
            summary_id,
            batch_index,
            start_round_index,
            end_round_index,
            summary_text,
        ));
    }

    Ok(blocks)
}

pub async fn load_completed_plot_summary_round_ids_before(
    db: &SqlitePool,
    conversation_id: i64,
    target_round_id: Option<i64>,
) -> Result<HashSet<i64>, String> {
    let rows = sqlx::query(
        "SELECT covered_round_ids_json \
         FROM plot_summaries \
         WHERE conversation_id = ? \
           AND status = 'completed' \
           AND (? IS NULL OR end_round_id < ?)",
    )
    .bind(conversation_id)
    .bind(target_round_id)
    .bind(target_round_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let mut round_ids = HashSet::new();
    for row in rows {
        let covered_round_ids_json: String =
            row.try_get("covered_round_ids_json").unwrap_or_default();
        for round_id in parse_round_ids_json(
            &covered_round_ids_json,
            "plot_summaries.covered_round_ids_json",
        )? {
            round_ids.insert(round_id);
        }
    }

    Ok(round_ids)
}

pub async fn load_completed_plot_summary_round_map(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<HashMap<i64, PlotSummaryRoundMarker>, String> {
    let rows = sqlx::query(
        "SELECT id, batch_index, covered_round_ids_json \
         FROM plot_summaries \
         WHERE conversation_id = ? AND status = 'completed' \
         ORDER BY batch_index ASC, id ASC",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let mut mapping = HashMap::new();
    for row in rows {
        let summary_id: i64 = row.try_get("id").unwrap_or_default();
        let batch_index: i64 = row.try_get("batch_index").unwrap_or_default();
        let covered_round_ids_json: String =
            row.try_get("covered_round_ids_json").unwrap_or_default();
        for round_id in parse_round_ids_json(
            &covered_round_ids_json,
            "plot_summaries.covered_round_ids_json",
        )? {
            mapping.insert(
                round_id,
                PlotSummaryRoundMarker {
                    batch_index,
                    summary_id,
                },
            );
        }
    }

    Ok(mapping)
}

pub async fn list_plot_summaries(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<Vec<PlotSummaryRecord>, String> {
    if load_plot_summary_mode(db, conversation_id).await? == PLOT_SUMMARY_MODE_MANUAL {
        ensure_manual_pending_plot_summaries(None, db, conversation_id).await?;
    }
    load_plot_summary_records(db, conversation_id, None).await
}

pub async fn list_pending_plot_summaries(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<Vec<PlotSummaryRecord>, String> {
    if load_plot_summary_mode(db, conversation_id).await? == PLOT_SUMMARY_MODE_MANUAL {
        ensure_manual_pending_plot_summaries(None, db, conversation_id).await?;
    }
    load_plot_summary_records(db, conversation_id, Some(PLOT_SUMMARY_STATUS_PENDING)).await
}

pub async fn upsert_manual_plot_summary(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    batch_index: i64,
    summary_text: &str,
) -> Result<PlotSummaryRecord, String> {
    let summary_text = normalize_summary_text(summary_text)?;
    let batch = load_batch_window_by_index(db, conversation_id, batch_index)
        .await?
        .ok_or_else(|| format!("未找到可写入的剧情总结窗口 batchIndex={batch_index}"))?;
    let now = now_ts();

    let existing = sqlx::query(
        "SELECT id, source_kind FROM plot_summaries WHERE conversation_id = ? AND batch_index = ? LIMIT 1",
    )
    .bind(conversation_id)
    .bind(batch_index)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    let (summary_id, event_source_kind) = if let Some(row) = existing {
        let summary_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        let existing_source_kind: String = row.try_get("source_kind").unwrap_or_default();
        let next_source_kind = if existing_source_kind == PLOT_SUMMARY_SOURCE_AI {
            PLOT_SUMMARY_SOURCE_MANUAL_OVERRIDE
        } else {
            PLOT_SUMMARY_SOURCE_MANUAL
        };
        sqlx::query(
            "UPDATE plot_summaries SET
                start_round_id = ?,
                end_round_id = ?,
                start_round_index = ?,
                end_round_index = ?,
                covered_round_count = ?,
                covered_round_ids_json = ?,
                source_kind = ?,
                status = ?,
                summary_text = ?,
                provider_kind = NULL,
                model_name = NULL,
                error_message = NULL,
                updated_at = ?,
                completed_at = ?
             WHERE id = ?",
        )
        .bind(batch.start_round_id)
        .bind(batch.end_round_id)
        .bind(batch.start_round_index)
        .bind(batch.end_round_index)
        .bind(batch.covered_round_count)
        .bind(covered_round_ids_json(&batch.covered_round_ids)?)
        .bind(next_source_kind)
        .bind(PLOT_SUMMARY_STATUS_COMPLETED)
        .bind(&summary_text)
        .bind(now)
        .bind(now)
        .bind(summary_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        (summary_id, next_source_kind.to_string())
    } else {
        let result = sqlx::query(
            "INSERT INTO plot_summaries (
                conversation_id, batch_index, start_round_id, end_round_id,
                start_round_index, end_round_index, covered_round_count, covered_round_ids_json,
                source_kind, status, summary_text,
                provider_kind, model_name, error_message,
                created_at, updated_at, completed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)",
        )
        .bind(conversation_id)
        .bind(batch.batch_index)
        .bind(batch.start_round_id)
        .bind(batch.end_round_id)
        .bind(batch.start_round_index)
        .bind(batch.end_round_index)
        .bind(batch.covered_round_count)
        .bind(covered_round_ids_json(&batch.covered_round_ids)?)
        .bind(PLOT_SUMMARY_SOURCE_MANUAL)
        .bind(PLOT_SUMMARY_STATUS_COMPLETED)
        .bind(&summary_text)
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        (
            result.last_insert_rowid(),
            PLOT_SUMMARY_SOURCE_MANUAL.to_string(),
        )
    };

    emit_plot_summary_updated(
        app,
        conversation_id,
        summary_id,
        batch.batch_index,
        PLOT_SUMMARY_STATUS_COMPLETED,
        Some(event_source_kind),
        Some(summary_text.clone()),
    )?;

    load_plot_summary_record_by_id(db, summary_id).await
}

pub fn spawn_plot_summary_processing_task(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    provider_id: i64,
) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) =
            run_plot_summary_processing_task(&app, &db, conversation_id, provider_id).await
        {
            let _ = app.emit(
                "plot-summary-error",
                PlotSummaryErrorEvent {
                    conversation_id,
                    plot_summary_id: 0,
                    batch_index: 0,
                    status: PLOT_SUMMARY_STATUS_FAILED.to_string(),
                    error,
                },
            );
        }
    });
}

async fn run_plot_summary_processing_task(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    provider_id: i64,
) -> Result<(), String> {
    let mode = load_plot_summary_mode(db, conversation_id).await?;
    if mode == PLOT_SUMMARY_MODE_MANUAL {
        ensure_manual_pending_plot_summaries(Some(app), db, conversation_id).await?;
        return Ok(());
    }

    let provider = load_plot_summary_provider(db, provider_id).await?;

    loop {
        let Some(batch) = load_next_ai_batch(db, conversation_id).await? else {
            break;
        };

        let summary_id = upsert_ai_plot_summary_job(
            db,
            conversation_id,
            &batch,
            &provider.provider_kind,
            &provider.model_name,
        )
        .await?;

        emit_plot_summary_updated(
            app,
            conversation_id,
            summary_id,
            batch.batch_index,
            PLOT_SUMMARY_STATUS_QUEUED,
            Some(PLOT_SUMMARY_SOURCE_AI.to_string()),
            None,
        )?;

        let generation_context =
            match load_plot_summary_generation_context(db, conversation_id, &batch).await {
                Ok(generation_context) => generation_context,
                Err(error) => {
                    finalize_plot_summary_failed(db, summary_id, &error).await?;
                    emit_plot_summary_error(
                        app,
                        conversation_id,
                        summary_id,
                        batch.batch_index,
                        &error,
                    )?;
                    return Ok(());
                }
            };

        let summary_text = match request_ai_plot_summary(&provider, &generation_context).await {
            Ok(summary_text) => summary_text,
            Err(error) => {
                finalize_plot_summary_failed(db, summary_id, &error).await?;
                emit_plot_summary_error(
                    app,
                    conversation_id,
                    summary_id,
                    batch.batch_index,
                    &error,
                )?;
                return Ok(());
            }
        };

        finalize_plot_summary_completed(db, summary_id, &summary_text).await?;
        emit_plot_summary_updated(
            app,
            conversation_id,
            summary_id,
            batch.batch_index,
            PLOT_SUMMARY_STATUS_COMPLETED,
            Some(PLOT_SUMMARY_SOURCE_AI.to_string()),
            Some(summary_text),
        )?;
    }

    Ok(())
}

async fn load_plot_summary_mode(db: &SqlitePool, conversation_id: i64) -> Result<String, String> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT plot_summary_mode FROM conversations WHERE id = ? LIMIT 1")
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?;

    normalize_plot_summary_mode(
        value
            .unwrap_or_else(|| PLOT_SUMMARY_MODE_AI.to_string())
            .as_str(),
    )
}

async fn ensure_manual_pending_plot_summaries(
    app: Option<&AppHandle>,
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<(), String> {
    let available_batches = load_available_plot_summary_batches(db, conversation_id).await?;
    if available_batches.is_empty() {
        return Ok(());
    }

    let existing_batch_indices =
        sqlx::query("SELECT batch_index FROM plot_summaries WHERE conversation_id = ?")
            .bind(conversation_id)
            .fetch_all(db)
            .await
            .map_err(|err| err.to_string())?
            .into_iter()
            .filter_map(|row| row.try_get::<i64, _>("batch_index").ok())
            .collect::<HashSet<_>>();

    let now = now_ts();
    for batch in available_batches {
        if existing_batch_indices.contains(&batch.batch_index) {
            continue;
        }

        let result = sqlx::query(
            "INSERT INTO plot_summaries (
                conversation_id, batch_index, start_round_id, end_round_id,
                start_round_index, end_round_index, covered_round_count, covered_round_ids_json,
                source_kind, status, summary_text,
                provider_kind, model_name, error_message,
                created_at, updated_at, completed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL)",
        )
        .bind(conversation_id)
        .bind(batch.batch_index)
        .bind(batch.start_round_id)
        .bind(batch.end_round_id)
        .bind(batch.start_round_index)
        .bind(batch.end_round_index)
        .bind(batch.covered_round_count)
        .bind(covered_round_ids_json(&batch.covered_round_ids)?)
        .bind(PLOT_SUMMARY_SOURCE_MANUAL)
        .bind(PLOT_SUMMARY_STATUS_PENDING)
        .bind(now)
        .bind(now)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;

        if let Some(app) = app {
            emit_plot_summary_pending(app, conversation_id, result.last_insert_rowid(), &batch)?;
        }
    }

    Ok(())
}

async fn load_available_plot_summary_batches(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<Vec<PlotSummaryBatchWindow>, String> {
    let rows = sqlx::query(
        "SELECT id, round_index FROM message_rounds \
         WHERE conversation_id = ? AND status = 'completed' \
         ORDER BY round_index ASC, id ASC",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let rounds = rows
        .into_iter()
        .map(|row| CompletedRoundRef {
            id: row.try_get("id").unwrap_or_default(),
            round_index: row.try_get("round_index").unwrap_or_default(),
        })
        .collect::<Vec<_>>();

    let mut batches = Vec::new();
    for (index, chunk) in rounds.chunks(PLOT_SUMMARY_WINDOW_SIZE).enumerate() {
        if chunk.len() < PLOT_SUMMARY_WINDOW_SIZE {
            break;
        }
        let first = &chunk[0];
        let last = &chunk[chunk.len() - 1];
        batches.push(PlotSummaryBatchWindow {
            batch_index: (index + 1) as i64,
            start_round_id: first.id,
            end_round_id: last.id,
            start_round_index: first.round_index,
            end_round_index: last.round_index,
            covered_round_count: chunk.len() as i64,
            covered_round_ids: chunk.iter().map(|round| round.id).collect(),
        });
    }

    Ok(batches)
}

async fn load_batch_window_by_index(
    db: &SqlitePool,
    conversation_id: i64,
    batch_index: i64,
) -> Result<Option<PlotSummaryBatchWindow>, String> {
    Ok(load_available_plot_summary_batches(db, conversation_id)
        .await?
        .into_iter()
        .find(|batch| batch.batch_index == batch_index))
}

async fn load_next_ai_batch(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<Option<PlotSummaryBatchWindow>, String> {
    let available_batches = load_available_plot_summary_batches(db, conversation_id).await?;
    if available_batches.is_empty() {
        return Ok(None);
    }

    let existing_rows = sqlx::query(
        "SELECT batch_index, status FROM plot_summaries WHERE conversation_id = ? ORDER BY batch_index ASC, id ASC",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let mut existing_by_batch = HashMap::new();
    for row in existing_rows {
        let batch_index: i64 = row.try_get("batch_index").unwrap_or_default();
        let status: String = row.try_get("status").unwrap_or_default();
        existing_by_batch.insert(batch_index, status);
    }

    for batch in available_batches {
        match existing_by_batch
            .get(&batch.batch_index)
            .map(String::as_str)
        {
            Some(PLOT_SUMMARY_STATUS_COMPLETED) => continue,
            Some(PLOT_SUMMARY_STATUS_QUEUED) => return Ok(None),
            _ => return Ok(Some(batch)),
        }
    }

    Ok(None)
}

async fn upsert_ai_plot_summary_job(
    db: &SqlitePool,
    conversation_id: i64,
    batch: &PlotSummaryBatchWindow,
    provider_kind: &str,
    model_name: &str,
) -> Result<i64, String> {
    let now = now_ts();
    let existing_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM plot_summaries WHERE conversation_id = ? AND batch_index = ? LIMIT 1",
    )
    .bind(conversation_id)
    .bind(batch.batch_index)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    if let Some(existing_id) = existing_id {
        sqlx::query(
            "UPDATE plot_summaries SET
                start_round_id = ?,
                end_round_id = ?,
                start_round_index = ?,
                end_round_index = ?,
                covered_round_count = ?,
                covered_round_ids_json = ?,
                source_kind = ?,
                status = ?,
                summary_text = NULL,
                provider_kind = ?,
                model_name = ?,
                error_message = NULL,
                updated_at = ?,
                completed_at = NULL
             WHERE id = ?",
        )
        .bind(batch.start_round_id)
        .bind(batch.end_round_id)
        .bind(batch.start_round_index)
        .bind(batch.end_round_index)
        .bind(batch.covered_round_count)
        .bind(covered_round_ids_json(&batch.covered_round_ids)?)
        .bind(PLOT_SUMMARY_SOURCE_AI)
        .bind(PLOT_SUMMARY_STATUS_QUEUED)
        .bind(provider_kind)
        .bind(model_name)
        .bind(now)
        .bind(existing_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        return Ok(existing_id);
    }

    let result = sqlx::query(
        "INSERT INTO plot_summaries (
            conversation_id, batch_index, start_round_id, end_round_id,
            start_round_index, end_round_index, covered_round_count, covered_round_ids_json,
            source_kind, status, summary_text,
            provider_kind, model_name, error_message,
            created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, NULL)",
    )
    .bind(conversation_id)
    .bind(batch.batch_index)
    .bind(batch.start_round_id)
    .bind(batch.end_round_id)
    .bind(batch.start_round_index)
    .bind(batch.end_round_index)
    .bind(batch.covered_round_count)
    .bind(covered_round_ids_json(&batch.covered_round_ids)?)
    .bind(PLOT_SUMMARY_SOURCE_AI)
    .bind(PLOT_SUMMARY_STATUS_QUEUED)
    .bind(provider_kind)
    .bind(model_name)
    .bind(now)
    .bind(now)
    .execute(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(result.last_insert_rowid())
}

async fn load_plot_summary_generation_context(
    db: &SqlitePool,
    conversation_id: i64,
    batch: &PlotSummaryBatchWindow,
) -> Result<PlotSummaryGenerationContext, String> {
    let rows = sqlx::query(
        "SELECT mr.id, mr.round_index, mr.aggregated_user_content, m.content AS assistant_content \
         FROM message_rounds mr \
         LEFT JOIN messages m ON m.id = mr.active_assistant_message_id \
         WHERE mr.conversation_id = ? AND mr.status = 'completed' \
         ORDER BY mr.round_index ASC, mr.id ASC",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let covered_round_id_set = batch
        .covered_round_ids
        .iter()
        .copied()
        .collect::<HashSet<_>>();
    let mut rounds = Vec::with_capacity(batch.covered_round_ids.len());
    for row in rows {
        let round_id: i64 = row.try_get("id").unwrap_or_default();
        if !covered_round_id_set.contains(&round_id) {
            continue;
        }

        let user_content = row
            .try_get::<String, _>("aggregated_user_content")
            .unwrap_or_default()
            .trim()
            .to_string();
        if user_content.is_empty() {
            return Err("剧情总结缺少聚合用户输入".to_string());
        }
        let assistant_content = row
            .try_get::<String, _>("assistant_content")
            .unwrap_or_default()
            .trim()
            .to_string();
        if assistant_content.is_empty() {
            return Err("剧情总结缺少 assistant 输出正文".to_string());
        }
        rounds.push(PlotSummaryRoundContext {
            round_id,
            round_index: row.try_get("round_index").unwrap_or_default(),
            user_content,
            assistant_content,
        });
    }

    rounds.sort_by_key(|round| round.round_index);

    if rounds.len() != batch.covered_round_count as usize {
        return Err(format!(
            "剧情总结窗口轮次数量不完整，期望 {} 实际 {}",
            batch.covered_round_count,
            rounds.len()
        ));
    }

    Ok(PlotSummaryGenerationContext {
        batch: batch.clone(),
        rounds,
    })
}

async fn request_ai_plot_summary(
    provider: &ApiProvider,
    context: &PlotSummaryGenerationContext,
) -> Result<String, String> {
    if provider.provider_kind != "openai_compatible" {
        return Err(format!(
            "剧情总结暂不支持 provider_kind='{}'",
            provider.provider_kind
        ));
    }

    let messages = build_plot_summary_messages(context);
    let request_messages = messages
        .into_iter()
        .map(|(role, content)| json!({ "role": role, "content": content }))
        .collect::<Vec<_>>();

    let body = json!({
        "model": provider.model_name,
        "messages": request_messages,
        "stream": false,
        "temperature": 0.2,
        "max_tokens": 260,
    });

    let client = crate::services::http_client::shared_http_client();
    let response = client
        .post(build_openai_url(&provider.base_url))
        .bearer_auth(&provider.api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("剧情总结请求失败: {} {}", status, text));
    }

    let value: Value = response.json().await.map_err(|err| err.to_string())?;
    let summary_text = value
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();

    normalize_summary_text(&summary_text)
}

fn build_plot_summary_messages(context: &PlotSummaryGenerationContext) -> Vec<(String, String)> {
    let round_sections = context
        .rounds
        .iter()
        .map(|round| {
            format!(
                "[第 {} 轮 / round_id={}]\n聚合用户输入:\n{}\n\nassistant 输出:\n{}",
                round.round_index, round.round_id, round.user_content, round.assistant_content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    vec![
        (
            "system".to_string(),
            format!(
                "你是 Night Voyage 的剧情总结层编译器。\n\
                 你只总结当前提供的 {} 轮对话窗口，不要总结窗口外内容。\n\
                 输出必须是可直接注入 Prompt Compiler 第 5 层的条目式纯文本。\n\
                 不要输出 JSON，不要输出代码块，不要解释过程。\n\
                 第一行写这一窗口内最重要的剧情推进。\n\
                 后续可按“键：值”继续写委托、场景、人物状态、关系变化、重要事实。\n\
                 变量直接写进文本本体，例如“委托：已接受”“伊诺状态：犯困”。\n\
                 不要编造输入中不存在的事实。",
                context.batch.covered_round_count
            ),
        ),
        (
            "user".to_string(),
            format!(
                "请为以下轮次窗口生成剧情总结。\n\n窗口：第 {} 到第 {} 轮\n\n{}",
                context.batch.start_round_index, context.batch.end_round_index, round_sections
            ),
        ),
    ]
}

async fn load_plot_summary_provider(
    db: &SqlitePool,
    provider_id: i64,
) -> Result<ApiProvider, String> {
    let row = sqlx::query(
        "SELECT id, name, provider_kind, base_url, api_key, model_name, max_tokens, max_context_tokens, temperature \
         FROM api_providers WHERE id = ? LIMIT 1",
    )
    .bind(provider_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(ApiProvider {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        provider_kind: row
            .try_get("provider_kind")
            .unwrap_or_else(|_| "openai_compatible".to_string()),
        base_url: row.try_get("base_url").unwrap_or_default(),
        api_key: row.try_get("api_key").unwrap_or_default(),
        model_name: row.try_get("model_name").unwrap_or_default(),
        max_tokens: row.try_get("max_tokens").ok(),
        max_context_tokens: row.try_get("max_context_tokens").ok(),
        temperature: row.try_get("temperature").ok(),
    })
}

async fn finalize_plot_summary_completed(
    db: &SqlitePool,
    summary_id: i64,
    summary_text: &str,
) -> Result<(), String> {
    let now = now_ts();
    sqlx::query(
        "UPDATE plot_summaries SET
            status = ?,
            summary_text = ?,
            error_message = NULL,
            updated_at = ?,
            completed_at = ?
         WHERE id = ?",
    )
    .bind(PLOT_SUMMARY_STATUS_COMPLETED)
    .bind(summary_text)
    .bind(now)
    .bind(now)
    .bind(summary_id)
    .execute(db)
    .await
    .map_err(|err| err.to_string())?;
    Ok(())
}

async fn finalize_plot_summary_failed(
    db: &SqlitePool,
    summary_id: i64,
    error_message: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE plot_summaries SET
            status = ?,
            error_message = ?,
            updated_at = ?,
            completed_at = NULL
         WHERE id = ?",
    )
    .bind(PLOT_SUMMARY_STATUS_FAILED)
    .bind(error_message)
    .bind(now_ts())
    .bind(summary_id)
    .execute(db)
    .await
    .map_err(|err| err.to_string())?;
    Ok(())
}

async fn load_plot_summary_records(
    db: &SqlitePool,
    conversation_id: i64,
    status_filter: Option<&str>,
) -> Result<Vec<PlotSummaryRecord>, String> {
    let rows = sqlx::query(
        "SELECT id, conversation_id, batch_index, start_round_id, end_round_id,
                start_round_index, end_round_index, covered_round_count,
                source_kind, status, summary_text, provider_kind, model_name,
                error_message, created_at, updated_at, completed_at
         FROM plot_summaries
         WHERE conversation_id = ?
           AND (? IS NULL OR status = ?)
         ORDER BY batch_index ASC, id ASC",
    )
    .bind(conversation_id)
    .bind(status_filter)
    .bind(status_filter)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(rows.into_iter().map(row_to_plot_summary_record).collect())
}

async fn load_plot_summary_record_by_id(
    db: &SqlitePool,
    summary_id: i64,
) -> Result<PlotSummaryRecord, String> {
    let row = sqlx::query(
        "SELECT id, conversation_id, batch_index, start_round_id, end_round_id,
                start_round_index, end_round_index, covered_round_count,
                source_kind, status, summary_text, provider_kind, model_name,
                error_message, created_at, updated_at, completed_at
         FROM plot_summaries WHERE id = ? LIMIT 1",
    )
    .bind(summary_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(row_to_plot_summary_record(row))
}

fn row_to_plot_summary_record(row: sqlx::sqlite::SqliteRow) -> PlotSummaryRecord {
    PlotSummaryRecord {
        id: row.try_get("id").unwrap_or_default(),
        conversation_id: row.try_get("conversation_id").unwrap_or_default(),
        batch_index: row.try_get("batch_index").unwrap_or_default(),
        start_round_id: row.try_get("start_round_id").unwrap_or_default(),
        end_round_id: row.try_get("end_round_id").unwrap_or_default(),
        start_round_index: row.try_get("start_round_index").unwrap_or_default(),
        end_round_index: row.try_get("end_round_index").unwrap_or_default(),
        covered_round_count: row.try_get("covered_round_count").unwrap_or_default(),
        source_kind: row.try_get("source_kind").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        summary_text: row.try_get("summary_text").ok(),
        provider_kind: row.try_get("provider_kind").ok(),
        model_name: row.try_get("model_name").ok(),
        error_message: row.try_get("error_message").ok(),
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
        completed_at: row.try_get("completed_at").ok(),
    }
}

fn build_plot_summary_block(
    summary_id: i64,
    batch_index: i64,
    start_round_index: i64,
    end_round_index: i64,
    summary_text: String,
) -> PromptBlock {
    let title = format!(
        "Plot Summary {} 轮次 {}-{}",
        batch_index, start_round_index, end_round_index
    );
    let content = format!(
        "Plot Summary {} (Rounds {}-{}):\n{}",
        batch_index,
        start_round_index,
        end_round_index,
        summary_text.trim()
    );
    PromptBlock {
        kind: PromptBlockKind::PlotSummary,
        priority: PromptBlockKind::PlotSummary.priority(),
        role: PromptRole::System,
        title: Some(title),
        content: content.clone(),
        source: PromptBlockSource::Summary { summary_id },
        token_cost_estimate: Some(estimate_token_cost(&content)),
        required: false,
    }
}

fn estimate_token_cost(content: &str) -> usize {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        0
    } else {
        trimmed.chars().count().div_ceil(4)
    }
}

fn normalize_summary_text(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("剧情总结内容不能为空".to_string());
    }
    Ok(trimmed.to_string())
}

fn parse_round_ids_json(raw: &str, field_name: &str) -> Result<Vec<i64>, String> {
    let parsed = serde_json::from_str::<Vec<i64>>(raw)
        .map_err(|err| format!("{field_name} JSON parse failed: {err}"))?;
    Ok(parsed)
}

fn covered_round_ids_json(round_ids: &[i64]) -> Result<String, String> {
    serde_json::to_string(round_ids).map_err(|err| err.to_string())
}

fn emit_plot_summary_updated(
    app: &AppHandle,
    conversation_id: i64,
    plot_summary_id: i64,
    batch_index: i64,
    status: &str,
    source_kind: Option<String>,
    summary_text: Option<String>,
) -> Result<(), String> {
    app.emit(
        "plot-summary-updated",
        PlotSummaryUpdatedEvent {
            conversation_id,
            plot_summary_id,
            batch_index,
            status: status.to_string(),
            source_kind,
            summary_text,
        },
    )
    .map_err(|err| err.to_string())
}

fn emit_plot_summary_error(
    app: &AppHandle,
    conversation_id: i64,
    plot_summary_id: i64,
    batch_index: i64,
    error: &str,
) -> Result<(), String> {
    app.emit(
        "plot-summary-error",
        PlotSummaryErrorEvent {
            conversation_id,
            plot_summary_id,
            batch_index,
            status: PLOT_SUMMARY_STATUS_FAILED.to_string(),
            error: error.to_string(),
        },
    )
    .map_err(|err| err.to_string())
}

fn emit_plot_summary_pending(
    app: &AppHandle,
    conversation_id: i64,
    plot_summary_id: i64,
    batch: &PlotSummaryBatchWindow,
) -> Result<(), String> {
    app.emit(
        "plot-summary-pending",
        PlotSummaryPendingEvent {
            conversation_id,
            plot_summary_id,
            batch_index: batch.batch_index,
            status: PLOT_SUMMARY_STATUS_PENDING.to_string(),
            start_round_index: batch.start_round_index,
            end_round_index: batch.end_round_index,
            covered_round_count: batch.covered_round_count,
        },
    )
    .map_err(|err| err.to_string())
}

fn build_openai_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{}/chat/completions", trimmed)
    } else {
        format!("{}/v1/chat/completions", trimmed)
    }
}

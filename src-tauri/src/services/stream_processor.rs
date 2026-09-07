use std::collections::HashMap;

use futures_util::StreamExt;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{Duration, Instant};

use crate::llm::{LlmBinarySource, LlmChatRequest, LlmContentPart, LlmRole, ProviderHttpRequest};
use crate::models::{ChatAttachment, StreamErrorEvent, StreamRetryEvent};
use crate::repositories::conversation_repository::ConversationRepository;
use crate::repositories::message_repository::{
    normalize_tool_use_input_json,
};
use crate::repositories::message_repository::{
    MessageRepository, PendingMessageContentPart, PendingToolUseSkeleton,
};
use crate::repositories::llm_retry_snapshot_repository::{
    RetrySnapshotRepository, RetrySnapshotSeed,
};
use crate::repositories::round_repository::RoundRepository;
use crate::services::chat_service::{
    broadcast_stream_end, emit_llm_stream_event, emit_object_field_complete_event,
    emit_round_state, emit_stream_message_stop, emit_structured_field_delta_event,
    build_compatibility_fallback_json, emit_compatibility_mode_event,
    finalize_streamed_response, flush_text_delta_event, save_agent_debug_log,
    save_llm_debug_log,
};
use crate::services::prompt_compiler::{
    PromptBudget, PromptCompileInput, PromptCompileMode, PromptCompileResult,
};
use crate::services::provider_adapter::{
    build_llm_chat_request, build_provider_http_request, ProviderCapabilityMatrix,
};
use crate::dbg_eprintln;

const STREAM_ABORTED_ERROR: &str = "__stream_aborted__";

struct StreamResponseData {
    full_content: String,
    thinking_content: Option<String>,
    stop_reason: Option<String>,
}

fn map_structured_field_part_type(key: &str) -> &'static str {
    match key {
        "thinking" => "thinking",
        _ => "structured_output",
    }
}

fn ensure_content_part_by_key(
    content_parts: &mut Vec<PendingMessageContentPart>,
    content_part_lookup: &mut HashMap<String, usize>,
    key: &str,
    next_index: i64,
    part_type: &str,
) -> usize {
    if let Some(index) = content_part_lookup.get(key) {
        return *index;
    }
    let index = content_parts.len();
    content_parts.push(PendingMessageContentPart {
        part_index: next_index,
        part_type: part_type.to_string(),
        text_value: None,
        json_value: None,
        asset_id: None,
        mime_type: None,
        tool_use_id: None,
        tool_name: None,
        is_hidden: false,
    });
    content_part_lookup.insert(key.to_string(), index);
    index
}

fn append_content_part_text(part: &mut PendingMessageContentPart, delta: &str) {
    let text = part.text_value.get_or_insert_with(String::new);
    text.push_str(delta);
}

async fn is_round_aborted(db: &SqlitePool, round_id: i64, assistant_message_id: i64) -> Result<bool, String> {
    let row: Option<(Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT status, active_assistant_message_id FROM message_rounds WHERE id = ? LIMIT 1",
    )
    .bind(round_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    match row {
        None => Ok(true),
        Some((status, active_msg_id)) => {
            if status.as_deref() == Some("aborted") {
                return Ok(true);
            }
            if active_msg_id != Some(assistant_message_id) {
                dbg_eprintln!(
                    "[chat] is_round_aborted: active_assistant_message_id mismatch, expected={}, got={:?}, treating as aborted",
                    assistant_message_id, active_msg_id
                );
                return Ok(true);
            }
            let msg_exists: bool = sqlx::query_scalar(
                "SELECT COUNT(*) FROM messages WHERE id = ?",
            )
            .bind(assistant_message_id)
            .fetch_one(db)
            .await
            .map(|count: i64| count > 0)
            .unwrap_or(false);
            if !msg_exists {
                dbg_eprintln!(
                    "[chat] is_round_aborted: assistant_message_id={} no longer exists, treating as aborted",
                    assistant_message_id
                );
                return Ok(true);
            }
            Ok(false)
        }
    }
}

/// Maximum number of LLM request attempts for a single chat round when
/// automatic retry is enabled (i.e. after the user clicks "自动重试").
/// The initial send is not auto-retry and is not counted here.
const MAX_CHAT_AUTO_RETRY_ATTEMPTS: i64 = 4;

pub fn spawn_stream_task(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    attachments: Vec<ChatAttachment>,
    auto_retry_enabled: bool,
) {
    tauri::async_runtime::spawn(async move {
        dbg_eprintln!(
            "[chat] spawn_stream_task: starting stream_llm_response, conversation_id={}, round_id={}, provider_id={}, assistant_message_id={}",
            conversation_id, round_id, provider_id, assistant_message_id
        );

        // Auto-retry loop: keep retrying until the model responds successfully
        // or the user aborts. Each retry reuses the same assistant_message_id
        // and round, clearing previous partial content.
        loop {
            // Mark the retry attempt in the snapshot (tracks attempt_count).
            // Capture the snapshot to read attempt_count for retry notifications.
            let attempt_count = RetrySnapshotRepository::mark_attempt_started(&db, round_id)
                .await
                .map(|s| s.attempt_count)
                .unwrap_or(0);

            // Cap automatic retries to avoid hammering a permanently failing provider.
            if auto_retry_enabled && attempt_count > MAX_CHAT_AUTO_RETRY_ATTEMPTS {
                let error = format!(
                    "已达到最大自动重试次数（{} 次），请检查 provider 网络或稍后手动重试",
                    MAX_CHAT_AUTO_RETRY_ATTEMPTS
                );
                dbg_eprintln!(
                    "[chat] spawn_stream_task: max auto retries reached, conversation_id={}, round_id={}, attempt_count={}",
                    conversation_id, round_id, attempt_count
                );
                let _ = RoundRepository::mark_failed(&db, round_id).await;
                let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;
                let _ = app.emit(
                    "llm-stream-error",
                    StreamErrorEvent {
                        conversation_id,
                        round_id,
                        message_id: assistant_message_id,
                        error,
                    },
                );
                broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                break;
            }

            let stream_result = stream_llm_response(
                app.clone(),
                db.clone(),
                conversation_id,
                round_id,
                provider_id,
                assistant_message_id,
                attachments.clone(),
            )
            .await;

            match stream_result {
                Err(error) => {
                    dbg_eprintln!(
                        "[chat] spawn_stream_task: stream_llm_response FAILED (attempt), conversation_id={}, round_id={}, error={}",
                        conversation_id, round_id, error
                    );
                    crate::services::chat_service::chat_debug_log(
                        &app,
                        &format!(
                            "stream FAILED (will retry): conv={}, round={}, error={}",
                            conversation_id, round_id, error
                        ),
                    );

                    // If the user aborted, stop the loop immediately.
                    if error == STREAM_ABORTED_ERROR {
                        let _ = RoundRepository::mark_failed(&db, round_id).await;
                        let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;
                        let _ = app.emit(
                            "llm-stream-error",
                            StreamErrorEvent {
                                conversation_id,
                                round_id,
                                message_id: assistant_message_id,
                                error,
                            },
                        );
                        broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                        break;
                    }

                    // Prompt compilation errors (e.g. mem0 retrieval failure)
                    // are deterministic — retrying will not fix them. Emit
                    // the error to the UI and stop.
                    if error.contains("mem0 retrieval failed")
                        || error.contains("Prompt Compiler")
                    {
                        let _ = RoundRepository::mark_failed(&db, round_id).await;
                        let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;
                        let _ = app.emit(
                            "llm-stream-error",
                            StreamErrorEvent {
                                conversation_id,
                                round_id,
                                message_id: assistant_message_id,
                                error,
                            },
                        );
                        broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                        break;
                    }

                    // Check if the user aborted during the stream (status = 'aborted').
                    if let Ok(true) = is_round_aborted(&db, round_id, assistant_message_id).await {
                        dbg_eprintln!(
                            "[chat] spawn_stream_task: round aborted by user, stopping retry loop, round_id={}",
                            round_id
                        );
                        let _ = RetrySnapshotRepository::mark_aborted(&db, round_id).await;
                        broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                        break;
                    }

                    // Mark the snapshot as failed (but keep the round in streaming
                    // state so the next retry attempt can proceed).
                    let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;

                    // Notify the frontend that a retry is being attempted.
                    let _ = app.emit(
                        "llm-stream-retry",
                        StreamRetryEvent {
                            conversation_id,
                            round_id,
                            message_id: assistant_message_id,
                            error: error.clone(),
                            attempt_count,
                            auto_retry_enabled,
                        },
                    );

                    {
                        let state = app.state::<crate::AppState>();
                        let host_server = state.host_server.lock().await;
                        if let Some(server) = host_server.as_ref() {
                            let server = server.lock().await;
                            let msg = crate::network::RoomMessage::StreamRetry {
                                conversation_id,
                                round_id,
                                message_id: assistant_message_id,
                                error: error.clone(),
                                attempt_count,
                                auto_retry_enabled,
                            };
                            server.broadcast_message(&msg).await;
                        }
                    }

                    // Reset the assistant message content for the next attempt.
                    let now = crate::utils::now_ts();
                    let _ = sqlx::query("UPDATE messages SET content = '' WHERE id = ?")
                        .bind(assistant_message_id)
                        .execute(&db)
                        .await;
                    let _ = sqlx::query(
                        "DELETE FROM message_content_parts WHERE message_id = ?",
                    )
                    .bind(assistant_message_id)
                    .execute(&db)
                    .await;
                    let _ = sqlx::query(
                        "UPDATE message_rounds SET status = 'streaming', updated_at = ? WHERE id = ?",
                    )
                    .bind(now)
                    .bind(round_id)
                    .execute(&db)
                    .await;

                    if !auto_retry_enabled {
                        // 首次失败不自动重试，等待用户点击"自动重试"按钮
                        dbg_eprintln!(
                            "[chat] spawn_stream_task: first failure, auto_retry disabled, breaking loop, conversation_id={}, round_id={}",
                            conversation_id, round_id
                        );
                        break;
                    }

                    // Brief delay before retrying to avoid hammering the API.
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

                    dbg_eprintln!(
                        "[chat] spawn_stream_task: retrying stream_llm_response, conversation_id={}, round_id={}",
                        conversation_id, round_id
                    );
                    // Continue the loop to retry.
                    continue;
                }
                Ok((data, db_mappings)) => {
                    let _ = RetrySnapshotRepository::mark_succeeded(&db, round_id).await;
                    if !data.full_content.is_empty() {
                        spawn_post_round_tasks(
                            &app,
                            &db,
                            conversation_id,
                            round_id,
                            provider_id,
                            assistant_message_id,
                            &db_mappings,
                            &data.full_content,
                        )
                        .await;
                    }
                    if let Ok(round) =
                        RoundRepository::load_state(&db, conversation_id, Some(round_id)).await
                    {
                        let _ = emit_round_state(&app, round);
                    }
                    break;
                }
            }
        }
    });
}

/// Unified post-round task spawner with three-mode gating:
/// - mem0: only memory extraction
/// - legacy: plot_summary placeholder + batch processing + world variable generation
/// - stateless: world variable generation only (preset-gated)
///
/// Blueprint `db_mappings` persistence (mode-independent): when the active
/// preset has a blueprint with SchemaField nodes declaring `db_mapping`,
/// the AI's structured_output fields are extracted and written to the
/// corresponding `message_rounds` columns (e.g. `world_variables`).
/// This runs before the mode-specific tasks and applies to all modes.
async fn spawn_post_round_tasks(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    db_mappings: &HashMap<String, String>,
    structured_content: &str,
) {
    // Blueprint db_mappings persistence: extract declared fields from the
    // AI's structured_output and write them to message_rounds columns.
    // Empty db_mappings (no blueprint or blueprint without db_mapping nodes)
    // is a no-op — preserves compatibility with legacy presets.
    if !db_mappings.is_empty() {
        if let Err(err) = persist_db_mapping_fields(db, round_id, db_mappings, structured_content)
            .await
        {
            dbg_eprintln!(
                "[stream] spawn_post_round_tasks: persist_db_mapping_fields failed: {err}"
            );
        }
    }

    let memory_mode =
        crate::services::prompt_compiler::load_memory_mode(db, conversation_id).await;

    match memory_mode.as_str() {
        m if m == crate::services::prompt_compiler::MEMORY_MODE_MEM0 => {
            // Mem0: only spawn memory extraction task.
            crate::services::chat_service::spawn_memory_extraction_task(
                app.clone(),
                db.clone(),
                conversation_id,
                round_id,
                assistant_message_id,
            );
        }
        m if m == crate::services::prompt_compiler::MEMORY_MODE_LEGACY => {
            // Legacy: PlotSummary placeholder + batch processing + world variable.
            // Fetch round_index for the placeholder.
            let round_index: Option<i64> = sqlx::query_scalar(
                "SELECT round_index FROM message_rounds WHERE id = ? LIMIT 1",
            )
            .bind(round_id)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();

            if let Some(ri) = round_index {
                if let Err(err) = crate::services::plot_summaries::create_round_placeholder(
                    db, conversation_id, round_id, ri,
                ).await {
                    dbg_eprintln!(
                        "[stream] spawn_post_round_tasks: create_round_placeholder failed: {err}"
                    );
                }
            }

            crate::services::plot_summaries::spawn_plot_summary_processing_task(
                app.clone(),
                db.clone(),
                conversation_id,
                provider_id,
            );
        }
        _ => {
            // Stateless: only world variable generation (preset-gated).
        }
    }
}

/// Extract fields declared in `db_mappings` from the AI's structured_output
/// JSON and persist them to the corresponding columns on `message_rounds`.
///
/// `db_mappings` maps schema field names (e.g. `"world_variables"`) to
/// `message_rounds` column names (e.g. `"world_variables"`). Only columns
/// in the validated allowlist are accepted — this prevents SQL injection
/// via dynamic column names (column identifiers cannot be parameterized).
///
/// Empty `db_mappings` is a no-op (legacy preset compatibility). Fields
/// present in `db_mappings` but absent from the structured_output are
/// skipped with a debug log (the field may be optional in the schema).
async fn persist_db_mapping_fields(
    db: &SqlitePool,
    round_id: i64,
    db_mappings: &HashMap<String, String>,
    structured_content: &str,
) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(structured_content)
        .map_err(|err| {
            format!(
                "db_mappings persist: structured_output is not valid JSON (len={}): {}",
                structured_content.len(),
                err
            )
        })?;
    let obj = parsed
        .as_object()
        .ok_or_else(|| "db_mappings persist: structured_output is not a JSON object".to_string())?;

    for (field_name, db_column) in db_mappings {
        if !is_valid_message_rounds_column(db_column) {
            return Err(format!(
                "db_mappings persist: db_column `{db_column}` (field `{field_name}`) is not a \
                 supported message_rounds column. Supported: `world_variables`, `plot_summary`."
            ));
        }
        let Some(value) = obj.get(field_name) else {
            dbg_eprintln!(
                "[stream] db_mappings persist: field `{field_name}` (db_column `{db_column}`) \
                 not present in structured_output, skipping"
            );
            continue;
        };
        let serialized = serde_json::to_string(value).map_err(|err| {
            format!("db_mappings persist: failed to serialize field `{field_name}`: {err}")
        })?;
        // Safe: db_column is validated against the allowlist above.
        let sql = format!("UPDATE message_rounds SET {db_column} = ? WHERE id = ?");
        sqlx::query(&sql)
            .bind(&serialized)
            .bind(round_id)
            .execute(db)
            .await
            .map_err(|err| {
                format!("db_mappings persist: UPDATE message_rounds.{db_column} failed: {err}")
            })?;
    }
    Ok(())
}

/// Validate that a `db_mapping` column name is a known, existing column on
/// the `message_rounds` table. This is a security allowlist — column names
/// cannot be SQL-parameterized, so only allowlisted identifiers are inserted
/// into the dynamic UPDATE statement.
fn is_valid_message_rounds_column(column: &str) -> bool {
    matches!(column, "world_variables" | "plot_summary")
}

async fn stream_llm_response(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    attachments: Vec<ChatAttachment>,
) -> Result<(StreamResponseData, HashMap<String, String>), String> {
    let provider = ConversationRepository::load_provider(&db, provider_id).await?;

    dbg_eprintln!(
        "[chat] stream_llm_response: loaded provider, provider_kind={}, model_name={}, base_url_len={}",
        provider.provider_kind, provider.model_name, provider.base_url.len()
    );
    crate::services::chat_service::chat_debug_log(
        &app,
        &format!(
            "stream_llm_response: provider={}/{}, base_url_len={}",
            provider.provider_kind, provider.model_name, provider.base_url.len()
        ),
    );

    let debug_log_dir: Option<std::path::PathBuf> = app
        .path()
        .app_data_dir()
        .ok();

    if !attachments.is_empty() {
        let capabilities = ProviderCapabilityMatrix::for_provider_kind(&provider.provider_kind)?;
        if !capabilities.supports_image_input {
            return Err(format!(
                "当前 provider ({}) 不支持图片输入",
                provider.provider_kind
            ));
        }
    }

    let compile_mode = resolve_prompt_compile_mode(&db, round_id, assistant_message_id).await?;
    dbg_eprintln!("[chat] stream_llm_response: compile_mode={:?}", compile_mode);

    let conv_preset_id: Option<i64> = sqlx::query_scalar(
        "SELECT preset_id FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(&db)
    .await
    .ok()
    .flatten();
    let all_presets: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, name FROM presets ORDER BY id ASC",
    )
    .fetch_all(&db)
    .await
    .unwrap_or_default();
    let preset_listing = all_presets.iter().map(|(id, name)| format!("[{}] {}", id, name)).collect::<Vec<_>>().join(", ");
    crate::services::chat_service::chat_debug_log(
        &app,
        &format!(
            "before compile: conv_preset_id={:?}, available_presets=[{}]", conv_preset_id, preset_listing
        ),
    );
    let effective_max_tokens = provider.max_tokens.filter(|&v| v > 0);
    let compile_input = PromptCompileInput {
        conversation_id,
        mode: compile_mode,
        target_round_id: Some(round_id),
        provider_kind: provider.provider_kind.clone(),
        model_name: provider.model_name.clone(),
        include_streaming_seed: false,
        budget: PromptBudget {
            max_total_tokens: None,
            reserve_output_tokens: effective_max_tokens
                .and_then(|value| usize::try_from(value).ok()),
            max_summary_tokens: None,
            max_world_book_tokens: None,
            max_retrieved_detail_tokens: None,
        },
        log_dir: debug_log_dir.clone(),
    };
    dbg_eprintln!("[chat] stream_llm_response: calling compile_prompt...");
    // Build the memory backend lazily for mem0-mode conversations only.
    // Non-mem0 conversations pass None so compile_prompt skips retrieval.
    // Build errors propagate rather than silently degrading.
    let memory_mode =
        crate::services::prompt_compiler::load_memory_mode(&db, conversation_id).await;
    let memory_service = if memory_mode == crate::services::prompt_compiler::MEMORY_MODE_MEM0 {
        let state = app.state::<crate::AppState>();
        Some(
            crate::services::memory_providers::get_or_build_memory_service(
                &state.db,
                &state.memory_service,
                conversation_id,
            )
            .await?,
        )
    } else {
        None
    };
    let mut compiled_prompt =
        crate::services::prompt_compiler::compile_prompt(
            &db,
            &compile_input,
            assistant_message_id,
            memory_service.as_ref(),
        )
        .await?;
    dbg_eprintln!(
        "[chat] stream_llm_response: compile_prompt done, response_mode={:?}, structured_output_schema={:?}, system_blocks={}, history_blocks={}",
        compiled_prompt.params.response_mode,
        compiled_prompt.params.structured_output_schema.as_ref().map(|s| {
            if let Some((idx, _)) = s.char_indices().nth(80) {
                format!("{}...", &s[..idx])
            } else {
                s.clone()
            }
        }),
        compiled_prompt.system_blocks.len(),
        compiled_prompt.history_blocks.len(),
    );
    crate::services::chat_service::chat_debug_log(
        &app,
        &format!(
            "compile_prompt done: response_mode={:?}, schema={}, sys_blocks={}, hist_blocks={}",
            compiled_prompt.params.response_mode,
            compiled_prompt.params.structured_output_schema.is_some(),
            compiled_prompt.system_blocks.len(),
            compiled_prompt.history_blocks.len(),
        ),
    );
    let mut request = build_llm_chat_request(
        &mut compiled_prompt,
        &provider.provider_kind,
        &provider.model_name,
        true,
        provider.temperature,
        effective_max_tokens,
    )?;
    inject_image_parts_into_request(&mut request, &attachments)?;
    dbg_eprintln!(
        "[chat] stream_llm_response: provider={}/{}, max_output_tokens={:?}, model={}, messages_count={}, system_blocks={}, estimated_input_tokens={}",
        provider.provider_kind,
        provider.model_name,
        request.max_output_tokens,
        request.model,
        request.messages.len(),
        request.system.len(),
        compiled_prompt.debug.total_token_estimate_after_trim,
    );
    let http_request =
        build_provider_http_request(&request, &provider.base_url, &provider.api_key)?;
    let request_body = serde_json::to_value(&http_request.body).unwrap_or(serde_json::Value::Null);

    let validation_snapshot = compiled_prompt.retry_output_validator_snapshot();
    let _ = RetrySnapshotRepository::ensure_prepared(
        &db,
        RetrySnapshotSeed {
            round_id,
            conversation_id,
            assistant_message_id,
            provider_id,
            provider_kind: provider.provider_kind.clone(),
            model_name: provider.model_name.clone(),
            response_mode: compiled_prompt.params.response_mode.clone(),
            request: http_request.clone(),
            validation_rules: validation_snapshot,
        },
    )
    .await;

    dbg_eprintln!(
        "[chat] request body preview: messages_count={}, system_count={}, model={}, stream={}",
        request_body.get("messages").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        request_body.get("system").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        request_body.get("model").and_then(|v| v.as_str()).unwrap_or("?"),
        request_body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false),
    );
    let response = execute_provider_http_request(&http_request).await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        save_llm_debug_log(
            conversation_id,
            round_id,
            &provider.provider_kind,
            &request.model,
            &request_body,
            &text,
            true,
            Some(&compiled_prompt.system_blocks),
            debug_log_dir.as_deref(),
        );
        save_agent_debug_log(
            conversation_id,
            round_id,
            &provider.provider_kind,
            &request.model,
            &request_body,
            &text,
            true,
            Some(&compiled_prompt.system_blocks),
            debug_log_dir.as_deref(),
        );
        return Err(format!("LLM 请求失败: {} {}", status, text));
    }

    let stream_result = match provider.provider_kind.as_str() {
        "openai_compatible" => {
            stream_openai_text_response(
                response,
                &app,
                &db,
                conversation_id,
                round_id,
                assistant_message_id,
                &compiled_prompt,
                compiled_prompt.params.response_mode.as_deref(),
                compiled_prompt.params.structured_output_schema.as_deref(),
            )
            .await
        }
        "anthropic" => {
            stream_anthropic_text_response(
                response,
                &app,
                &db,
                conversation_id,
                round_id,
                assistant_message_id,
                &compiled_prompt,
                compiled_prompt.params.response_mode.as_deref(),
                compiled_prompt.params.structured_output_schema.as_deref(),
            )
            .await
        }
        other => Err(format!("当前聊天链路暂不支持 provider_kind='{}'", other)),
    };

    let debug_response_body = match &stream_result {
        Ok(data) => {
            match provider.provider_kind.as_str() {
                "anthropic" => {
                    let mut content_array = Vec::new();
                    if let Some(ref thinking) = data.thinking_content {
                        content_array.push(serde_json::json!({
                            "type": "thinking",
                            "thinking": thinking,
                        }));
                    }
                    content_array.push(serde_json::json!({
                        "type": "text",
                        "text": data.full_content,
                    }));
                    let mut response = serde_json::Map::new();
                    response.insert("content".to_string(), serde_json::Value::Array(content_array));
                    if let Some(ref stop_reason) = data.stop_reason {
                        response.insert("stop_reason".to_string(), serde_json::Value::String(stop_reason.clone()));
                    }
                    serde_json::Value::Object(response).to_string()
                }
                _ => {
                    let mut message = serde_json::Map::new();
                    message.insert("role".to_string(), serde_json::Value::String("assistant".to_string()));
                    if let Some(ref thinking) = data.thinking_content {
                        message.insert("reasoning_content".to_string(), serde_json::Value::String(thinking.clone()));
                    }
                    message.insert("content".to_string(), serde_json::Value::String(data.full_content.clone()));
                    let mut choice = serde_json::Map::new();
                    choice.insert("message".to_string(), serde_json::Value::Object(message));
                    choice.insert("finish_reason".to_string(), serde_json::Value::String(
                        data.stop_reason.clone().unwrap_or_else(|| "stop".to_string())
                    ));
                    serde_json::json!({
                        "choices": [serde_json::Value::Object(choice)],
                    }).to_string()
                }
            }
        }
        Err(e) => serde_json::json!({
            "error": e,
        }).to_string(),
    };
    save_llm_debug_log(
        conversation_id,
        round_id,
        &provider.provider_kind,
        &request.model,
        &request_body,
        &debug_response_body,
        true,
        Some(&compiled_prompt.system_blocks),
        debug_log_dir.as_deref(),
    );
    save_agent_debug_log(
        conversation_id,
        round_id,
        &provider.provider_kind,
        &request.model,
        &request_body,
        &debug_response_body,
        true,
        Some(&compiled_prompt.system_blocks),
        debug_log_dir.as_deref(),
    );

    stream_result.map(|data| (data, compiled_prompt.db_mappings.clone()))
}

async fn execute_provider_http_request(
    http_request: &ProviderHttpRequest,
) -> Result<reqwest::Response, String> {
    dbg_eprintln!(
        "[chat] HTTP POST url={}, body_size={}",
        http_request.url,
        http_request.body.to_string().len(),
    );
    let client = crate::services::http_client::shared_permissive_http_client();
    // 传输层重试：仅针对连接级失败（is_connect/is_request），与用户的内容级 auto_retry 开关解耦。
    // 死连接已被 hyper 移出池，重试会新建/复用活连接；失败发生在取得任何响应字节前，重发幂等。
    const TRANSPORT_RETRY_LIMIT: usize = 1;
    let mut attempt = 0usize;
    let response = loop {
        let mut attempt_builder = client.post(&http_request.url);
        for header in &http_request.headers {
            attempt_builder = attempt_builder.header(&header.name, &header.value);
        }
        match attempt_builder.json(&http_request.body).send().await {
            Ok(resp) => break resp,
            Err(err) => {
                let is_connect = err.is_connect();
                let is_timeout = err.is_timeout();
                let is_request = err.is_request();
                let is_body = err.is_body();
                let is_decode = err.is_decode();
                let is_redirect = err.is_redirect();
                let cause = {
                    let first = std::error::Error::source(&err);
                    let second = first.and_then(std::error::Error::source);
                    match (first, second) {
                        (Some(f), Some(s)) => format!("{} <- {}", f, s),
                        (Some(f), None) => f.to_string(),
                        _ => "<none>".to_string(),
                    }
                };
                let formatted = format!(
                    "HTTP 请求发送失败: {} | connect={} timeout={} request={} body={} decode={} redirect={} | cause={}",
                    err, is_connect, is_timeout, is_request, is_body, is_decode, is_redirect, cause
                );
                let is_transport_connection_error = is_connect || is_request;
                if is_transport_connection_error && attempt < TRANSPORT_RETRY_LIMIT {
                    dbg_eprintln!(
                        "[chat] HTTP 连接级失败，传输层自动重试 (第 {} 次): {}",
                        attempt + 1,
                        formatted
                    );
                    attempt += 1;
                    continue;
                }
                return Err(formatted);
            }
        }
    };
    let status = response.status();
    let content_encoding = response.headers()
        .get("content-encoding")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none")
        .to_string();
    let content_type = response.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none")
        .to_string();
    dbg_eprintln!(
        "[chat] HTTP response: status={}, content-encoding={}, content-type={}",
        status, content_encoding, content_type
    );
    Ok(response)
}

async fn stream_openai_text_response(
    response: reqwest::Response,
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    assistant_message_id: i64,
    _compiled_prompt: &PromptCompileResult,
    response_mode: Option<&str>,
    schema_json: Option<&str>,
) -> Result<StreamResponseData, String> {
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut thinking_content = String::new();
    let mut pending = String::new();
    let mut last_emit = Instant::now();
    let mut content_parts: Vec<PendingMessageContentPart> = Vec::new();
    let mut content_part_lookup: HashMap<String, usize> = HashMap::new();
    let mut finish_reason: Option<String> = None;
    let provider_kind: &str = "openai_compatible";
    let mut raw_prose = String::new();
    let mut prompt_tokens: Option<i64> = None;
    let mut completion_tokens: Option<i64> = None;
    let mut last_abort_check = Instant::now();

    let mut structured_parser = if response_mode == Some("structured_json") {
        Some(crate::services::structured_output_parser::StructuredOutputParser::new())
    } else {
        None
    };

    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|err| {
            let is_timeout = err.is_timeout();
            let is_body = err.is_body();
            let is_decode = err.is_decode();
            dbg_eprintln!(
                "[chat] bytes_stream error: {} | timeout={} body={} decode={}",
                err, is_timeout, is_body, is_decode
            );
            let category = if is_timeout {
                "流式响应读取超时"
            } else {
                "流式响应解码失败"
            };
            format!(
                "{}: {} | timeout={} body={} decode={}",
                category, err, is_timeout, is_body, is_decode
            )
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let raw_line = buffer[..pos].to_string();
            buffer = buffer[pos + 1..].to_string();
            let line = raw_line.trim();

            if !line.starts_with("data:") {
                continue;
            }

            let data = line.trim_start_matches("data:").trim();
            if data == "[DONE]" {
                flush_text_delta_event(
                    app,
                    conversation_id,
                    round_id,
                    assistant_message_id,
                    "openai_compatible",
                    &mut pending,
                )?;
                let mut structured_json_content: Option<String> = None;
                if let Some(parser) = structured_parser.take() {
                    match parser.finish() {
                        Ok(result) => {
                            let mut full_json = serde_json::Map::new();
                            for (key, value) in &result.fields {
                                full_json.insert(key.clone(), value.clone());
                            }
                            structured_json_content = Some(serde_json::Value::Object(full_json).to_string());
                            for (key, value) in result.fields {
                                let part_type = map_structured_field_part_type(&key);
                                let next_index = content_parts.len() as i64;
                                let content_index = ensure_content_part_by_key(
                                    &mut content_parts, &mut content_part_lookup,
                                    &key, next_index, part_type,
                                );
                                if value.is_string() {
                                    append_content_part_text(&mut content_parts[content_index], value.as_str().unwrap_or(""));
                                } else if value.is_object() {
                                    content_parts[content_index].json_value = Some(value.to_string());
                                } else if value.is_array() {
                                    content_parts[content_index].json_value = Some(value.to_string());
                                }
                                if part_type == "structured_output" {
                                    content_parts[content_index].tool_name = Some(key);
                                }
                            }
                        }
                        Err(err) => {
                            dbg_eprintln!("[structured_output] finish error, entering compatibility mode: {}", err);
                            if !raw_prose.trim().is_empty() {
                                structured_json_content = Some(build_compatibility_fallback_json(
                                    &raw_prose,
                                    schema_json,
                                ));
                                if let Err(e) = emit_compatibility_mode_event(
                                    app,
                                    conversation_id,
                                    round_id,
                                    assistant_message_id,
                                    provider_kind,
                                    "结构化 JSON 解析失败，已启用兼容模式：流式解析未完成或结构非法，原文已整体转入 narrative 字段。",
                                ) {
                                    dbg_eprintln!("[compatibility_mode] failed to emit notice: {}", e);
                                }
                            }
                        }
                    }
                }
                emit_stream_message_stop(
                    app,
                    conversation_id,
                    round_id,
                    assistant_message_id,
                    "openai_compatible",
                    None,
                    prompt_tokens,
                    completion_tokens,
                )?;
                let content_to_save = structured_json_content.as_deref().unwrap_or(&full_content);
                finalize_streamed_response(
                    db,
                    round_id,
                    assistant_message_id,
                    content_to_save,
                    content_parts.as_slice(),
                    &[],
                    prompt_tokens,
                )
                .await?;
                return Ok(StreamResponseData {
                    full_content: structured_json_content.unwrap_or(full_content),
                    thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                    stop_reason: finish_reason,
                });
            }

            let value: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => {
                    dbg_eprintln!("[chat] stream_openai_text: failed to parse SSE data as JSON, len={}", data.len());
                    continue;
                }
            };

            let has_content = value.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")).and_then(|d| d.get("content")).is_some();
            let has_reasoning = value.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")).and_then(|d| d.get("reasoning_content")).is_some();
            let has_finish = value.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("finish_reason")).is_some();
            if !has_content && !has_reasoning && !has_finish {
                dbg_eprintln!("[chat] stream_openai_text: unrecognized SSE event, keys={:?}", value.as_object().map(|o| o.keys().collect::<Vec<_>>()));
            }

            if let Some(delta) = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("content"))
                .and_then(|content| content.as_str())
            {
                if !delta.is_empty() {
                    if let Some(ref mut parser) = structured_parser {
                        raw_prose.push_str(delta);
                        let has_backslash = delta.contains('\\');
                        let has_raw_newline = delta.contains('\n');
                        if has_backslash || has_raw_newline {
                            dbg_eprintln!(
                                "[structured_output] feed delta contains escape chars: len={}, has_backslash={}, has_raw_newline={}, preview={:?}",
                                delta.len(), has_backslash, has_raw_newline,
                                if delta.len() > 80 { &delta[..delta.ceil_char_boundary(80)] } else { delta }
                            );
                        }
                        let events = parser.feed(delta);
                        for event in events {
                            match event {
                                crate::services::structured_output_parser::StructuredOutputEvent::StringFieldDelta { key, delta } => {
                    if key == "content" {
                        full_content.push_str(&delta);
                    }
                    let next_index = content_parts.len() as i64;
                    let part_type = map_structured_field_part_type(&key);
                    let content_index = ensure_content_part_by_key(
                        &mut content_parts, &mut content_part_lookup,
                        &key, next_index, part_type,
                    );
                    if part_type == "structured_output" {
                        content_parts[content_index].tool_name = Some(key.clone());
                    }
                    append_content_part_text(&mut content_parts[content_index], &delta);
                    emit_structured_field_delta_event(
                        app, conversation_id, round_id, assistant_message_id,
                        "openai_compatible", &key, content_index as i64, &delta,
                    )?;
                }
                                crate::services::structured_output_parser::StructuredOutputEvent::ObjectFieldComplete { key, value } => {
                                    let json_str = serde_json::Value::Object(value).to_string();
                                    let next_index = content_parts.len() as i64;
                                    let part_type = map_structured_field_part_type(&key);
                                    let content_index = ensure_content_part_by_key(
                                        &mut content_parts, &mut content_part_lookup,
                                        &key, next_index, part_type,
                                    );
                                    content_parts[content_index].json_value = Some(json_str.clone());
                                    if part_type == "structured_output" {
                                        content_parts[content_index].tool_name = Some(key.clone());
                                    }
                                    emit_object_field_complete_event(
                                        app, conversation_id, round_id, assistant_message_id,
                                        "openai_compatible", &key, content_index as i64, &json_str,
                                    )?;
                                }
                                crate::services::structured_output_parser::StructuredOutputEvent::ArrayFieldComplete { key, value } => {
                                    let json_str = value.to_string();
                                    let next_index = content_parts.len() as i64;
                                    let part_type = map_structured_field_part_type(&key);
                                    let content_index = ensure_content_part_by_key(
                                        &mut content_parts, &mut content_part_lookup,
                                        &key, next_index, part_type,
                                    );
                                    content_parts[content_index].json_value = Some(json_str.clone());
                                    if part_type == "structured_output" {
                                        content_parts[content_index].tool_name = Some(key.clone());
                                    }
                                    emit_object_field_complete_event(
                                        app, conversation_id, round_id, assistant_message_id,
                                        "openai_compatible", &key, content_index as i64, &json_str,
                                    )?;
                                }
                                crate::services::structured_output_parser::StructuredOutputEvent::ParseError(err) => {
                                    dbg_eprintln!("[structured_output] parse error: {}", err);
                                }
                            }
                        }
                    } else {
                        full_content.push_str(delta);
                        pending.push_str(delta);
                    }
                }
            }

            let reasoning_opt = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| {
                    delta.get("reasoning_content")
                        .or_else(|| delta.get("reasoning"))
                        .or_else(|| delta.get("thinking"))
                })
                .and_then(|rc| rc.as_str());

            if let Some(reasoning) = reasoning_opt {
                if !reasoning.is_empty() {
                    thinking_content.push_str(reasoning);
                    let content_index = ensure_content_part_by_key(
                        &mut content_parts,
                        &mut content_part_lookup,
                        "thinking_0",
                        0,
                        "thinking",
                    );
                    append_content_part_text(&mut content_parts[content_index], reasoning);
                    emit_llm_stream_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        "openai_compatible",
                        "thinking_delta",
                        Some(0),
                        Some("thinking"),
                        Some(reasoning.to_string()),
                        None,
                        None,
                        None,
                        None,
                        None,
                    )?;
                }
            }

            if let Some(reason) = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("finish_reason"))
                .and_then(|fr| fr.as_str())
            {
                if !reason.is_empty() {
                    finish_reason = Some(reason.to_string());
                }
            }

            if let Some(usage) = value.get("usage") {
                if prompt_tokens.is_none() {
                    prompt_tokens = usage.get("prompt_tokens").and_then(|v| v.as_i64());
                }
                if completion_tokens.is_none() {
                    completion_tokens = usage.get("completion_tokens").and_then(|v| v.as_i64());
                }
            }

            if last_emit.elapsed() >= Duration::from_millis(50) && !pending.is_empty() {
                flush_text_delta_event(
                    app,
                    conversation_id,
                    round_id,
                    assistant_message_id,
                    "openai_compatible",
                    &mut pending,
                )?;
                last_emit = Instant::now();
            }
        }

        if last_abort_check.elapsed() >= Duration::from_millis(500) {
            last_abort_check = Instant::now();
            if is_round_aborted(db, round_id, assistant_message_id).await? {
                break;
            }
        }
    }

    if !pending.is_empty() {
        flush_text_delta_event(
            app,
            conversation_id,
            round_id,
            assistant_message_id,
            "openai_compatible",
            &mut pending,
        )?;
    }
    let mut structured_json_content: Option<String> = None;
    if let Some(parser) = structured_parser.take() {
        match parser.finish() {
            Ok(result) => {
                let mut full_json = serde_json::Map::new();
                for (key, value) in &result.fields {
                    full_json.insert(key.clone(), value.clone());
                }
                structured_json_content = Some(serde_json::Value::Object(full_json).to_string());
                for (key, value) in result.fields {
                    let part_type = map_structured_field_part_type(&key);
                    let next_index = content_parts.len() as i64;
                    let content_index = ensure_content_part_by_key(
                        &mut content_parts, &mut content_part_lookup,
                        &key, next_index, part_type,
                    );
                    if value.is_string() {
                        append_content_part_text(&mut content_parts[content_index], value.as_str().unwrap_or(""));
                    } else if value.is_object() {
                        content_parts[content_index].json_value = Some(value.to_string());
                    }
                    if part_type == "structured_output" {
                        content_parts[content_index].tool_name = Some(key);
                    }
                }
            }
            Err(err) => {
                dbg_eprintln!("[structured_output] finish error, entering compatibility mode: {}", err);
                if !raw_prose.trim().is_empty() {
                    structured_json_content = Some(build_compatibility_fallback_json(
                        &raw_prose,
                        schema_json,
                    ));
                    if let Err(e) = emit_compatibility_mode_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        provider_kind,
                        "结构化 JSON 解析失败，已启用兼容模式：模型回复未返回合法 JSON，原文已整体转入 narrative 字段。",
                    ) {
                        dbg_eprintln!("[compatibility_mode] failed to emit notice: {}", e);
                    }
                }
            }
        }
    }
    if structured_json_content.is_none() && !full_content.is_empty() {
        let next_index = content_parts.len() as i64;
        let content_index = ensure_content_part_by_key(
            &mut content_parts,
            &mut content_part_lookup,
            "text",
            next_index,
            "text",
        );
        append_content_part_text(&mut content_parts[content_index], &full_content);
    }
    emit_stream_message_stop(
        app,
        conversation_id,
        round_id,
        assistant_message_id,
        "openai_compatible",
        None,
        prompt_tokens,
        completion_tokens,
    )?;

    let content_to_save = structured_json_content.as_deref().unwrap_or(&full_content);
    if content_to_save.is_empty() {
        let msg_exists: bool = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE id = ?")
            .bind(assistant_message_id)
            .fetch_one(db)
            .await
            .map(|count: i64| count > 0)
            .unwrap_or(false);
        if !msg_exists {
            dbg_eprintln!("[chat] stream_openai: content empty and message {} deleted, silently returning", assistant_message_id);
            return Ok(StreamResponseData {
                full_content: String::new(),
                thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                stop_reason: finish_reason,
            });
        }
        return Err("LLM 响应为空".to_string());
    }

    finalize_streamed_response(
        db,
        round_id,
        assistant_message_id,
        content_to_save,
        content_parts.as_slice(),
        &[],
        prompt_tokens,
    )
    .await?;

    Ok(StreamResponseData {
        full_content: structured_json_content.unwrap_or(full_content),
        thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
        stop_reason: finish_reason,
    })
}

async fn stream_anthropic_text_response(
    response: reqwest::Response,
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    assistant_message_id: i64,
    _compiled_prompt: &PromptCompileResult,
    response_mode: Option<&str>,
    schema_json: Option<&str>,
) -> Result<StreamResponseData, String> {
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut thinking_content = String::new();
    let mut pending = String::new();
    let mut last_emit = Instant::now();
    let mut content_parts: Vec<PendingMessageContentPart> = Vec::new();
    let mut content_part_lookup: HashMap<String, usize> = HashMap::new();
    let mut latest_stop_reason: Option<String> = None;
    let provider_kind: &str = "anthropic";
    let mut raw_prose = String::new();
    let mut pending_tool_use: Option<PendingToolUseSkeleton> = None;
    let mut prompt_tokens: Option<i64> = None;
    let mut completion_tokens: Option<i64> = None;
    let mut last_abort_check = Instant::now();
    let mut structured_parser = if response_mode == Some("structured_json") {
        Some(crate::services::structured_output_parser::StructuredOutputParser::new())
    } else {
        None
    };

    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|err| {
            let is_timeout = err.is_timeout();
            let is_body = err.is_body();
            let is_decode = err.is_decode();
            dbg_eprintln!(
                "[chat] bytes_stream error (anthropic): {} | timeout={} body={} decode={}",
                err, is_timeout, is_body, is_decode
            );
            format!(
                "流式响应解码失败: {} | timeout={} body={} decode={}",
                err, is_timeout, is_body, is_decode
            )
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let raw_line = buffer[..pos].to_string();
            buffer = buffer[pos + 1..].to_string();
            let line = raw_line.trim();

            if !line.starts_with("data:") {
                continue;
            }

            let data = line.trim_start_matches("data:").trim();
            let value: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let event_type = value
                .get("type")
                .and_then(|event_type| event_type.as_str())
                .unwrap_or_default();

            match event_type {
                "content_block_start" => {
                    let block_type = value
                        .get("content_block")
                        .and_then(|content_block| content_block.get("type"))
                        .and_then(|block_type| block_type.as_str())
                        .unwrap_or_default();
                    let provider_part_index = value
                        .get("index")
                        .and_then(|index| index.as_i64())
                        .unwrap_or(content_parts.len() as i64);
                    match block_type {
                        "" | "text" => {
                            emit_llm_stream_event(
                                app,
                                conversation_id,
                                round_id,
                                assistant_message_id,
                                "anthropic",
                                "content_block_start",
                                Some(provider_part_index),
                                Some("text"),
                                None,
                                None,
                                None,
                                None,
                                None,
                                None,
                            )?;
                        }
                        "tool_use" => {
                            let content_block = value.get("content_block").ok_or_else(|| {
                                "Anthropic tool_use 缺少 content_block".to_string()
                            })?;
                            let tool_use_id = content_block
                                .get("id")
                                .and_then(|id| id.as_str())
                                .ok_or_else(|| "Anthropic tool_use 缺少 id".to_string())?
                                .to_string();
                            let tool_name = content_block
                                .get("name")
                                .and_then(|name| name.as_str())
                                .ok_or_else(|| "Anthropic tool_use 缺少 name".to_string())?
                                .to_string();
                            let content_index = ensure_content_part_by_key(
                                &mut content_parts,
                                &mut content_part_lookup,
                                &tool_use_id,
                                provider_part_index,
                                "tool_use",
                            );
                            content_parts[content_index].tool_use_id = Some(tool_use_id.clone());
                            content_parts[content_index].tool_name = Some(tool_name.clone());
                            content_parts[content_index].json_value = content_block
                                .get("input")
                                .map(|input| input.to_string())
                                .or_else(|| Some("{}".to_string()));
                            pending_tool_use = Some(PendingToolUseSkeleton {
                                provider_part_index,
                                tool_use_id: tool_use_id.clone(),
                                tool_name: tool_name.clone(),
                                input_json: String::new(),
                            });
                            emit_llm_stream_event(
                                app,
                                conversation_id,
                                round_id,
                                assistant_message_id,
                                "anthropic",
                                "content_block_start",
                                Some(provider_part_index),
                                Some("tool_use"),
                                None,
                                None,
                                Some(crate::models::LlmStreamToolUseEvent {
                                    id: tool_use_id,
                                    name: tool_name,
                                }),
                                None,
                                None,
                                None,
                            )?;
                        }
                        "thinking" | "redacted_thinking" => {
                            let content_index = ensure_content_part_by_key(
                                &mut content_parts,
                                &mut content_part_lookup,
                                &format!("{}_{}", block_type, provider_part_index),
                                provider_part_index,
                                block_type,
                            );
                            if block_type == "redacted_thinking" {
                                if let Some(data_value) = value
                                    .get("content_block")
                                    .and_then(|content_block| content_block.get("data"))
                                {
                                    content_parts[content_index].json_value =
                                        Some(data_value.to_string());
                                }
                            }
                            emit_llm_stream_event(
                                app,
                                conversation_id,
                                round_id,
                                assistant_message_id,
                                "anthropic",
                                "content_block_start",
                                Some(provider_part_index),
                                Some(block_type),
                                None,
                                None,
                                None,
                                None,
                                None,
                                None,
                            )?;
                        }
                        other => {
                            return Err(format!(
                                "当前聊天主链路尚未支持 Anthropic content_block.type='{}'",
                                other
                            ))
                        }
                    }
                }
                "content_block_delta" => {
                    let delta_type = value
                        .get("delta")
                        .and_then(|delta| delta.get("type"))
                        .and_then(|delta_type| delta_type.as_str())
                        .unwrap_or_default();
                    let provider_part_index = value
                        .get("index")
                        .and_then(|index| index.as_i64())
                        .unwrap_or(content_parts.len() as i64);
                    match delta_type {
                        "text_delta" => {
                            let delta = value
                                .get("delta")
                                .and_then(|delta| delta.get("text"))
                                .and_then(|text| text.as_str())
                                .unwrap_or_default();
                            if !delta.is_empty() {
                                if let Some(ref mut parser) = structured_parser {
                                    raw_prose.push_str(delta);
                                    let events = parser.feed(delta);
                                    for event in events {
                                        match event {
                                            crate::services::structured_output_parser::StructuredOutputEvent::StringFieldDelta { key, delta: field_delta } => {
                                                if key == "content" || key == "text" {
                                                    full_content.push_str(&field_delta);
                                                }
                                                let next_index = content_parts.len() as i64;
                                                let part_type = map_structured_field_part_type(&key);
                                                let content_index = ensure_content_part_by_key(
                                                    &mut content_parts, &mut content_part_lookup,
                                                    &key, next_index, part_type,
                                                );
                                                if part_type == "structured_output" {
                                                    content_parts[content_index].tool_name = Some(key.clone());
                                                }
                                                append_content_part_text(&mut content_parts[content_index], &field_delta);
                                                emit_structured_field_delta_event(
                                                    app, conversation_id, round_id, assistant_message_id,
                                                    "anthropic", &key, content_index as i64, &field_delta,
                                                )?;
                                            }
                                            crate::services::structured_output_parser::StructuredOutputEvent::ObjectFieldComplete { key, value } => {
                                                let json_str = serde_json::Value::Object(value).to_string();
                                                let next_index = content_parts.len() as i64;
                                                let part_type = map_structured_field_part_type(&key);
                                                let content_index = ensure_content_part_by_key(
                                                    &mut content_parts, &mut content_part_lookup,
                                                    &key, next_index, part_type,
                                                );
                                                content_parts[content_index].json_value = Some(json_str.clone());
                                                if part_type == "structured_output" {
                                                    content_parts[content_index].tool_name = Some(key.clone());
                                                }
                                                emit_object_field_complete_event(
                                                    app, conversation_id, round_id, assistant_message_id,
                                                    "anthropic", &key, content_index as i64, &json_str,
                                                )?;
                                            }
                                            crate::services::structured_output_parser::StructuredOutputEvent::ArrayFieldComplete { key, value } => {
                                                let json_str = value.to_string();
                                                let next_index = content_parts.len() as i64;
                                                let part_type = map_structured_field_part_type(&key);
                                                let content_index = ensure_content_part_by_key(
                                                    &mut content_parts, &mut content_part_lookup,
                                                    &key, next_index, part_type,
                                                );
                                                content_parts[content_index].json_value = Some(json_str.clone());
                                                if part_type == "structured_output" {
                                                    content_parts[content_index].tool_name = Some(key.clone());
                                                }
                                                emit_object_field_complete_event(
                                                    app, conversation_id, round_id, assistant_message_id,
                                                    "anthropic", &key, content_index as i64, &json_str,
                                                )?;
                                            }
                                            crate::services::structured_output_parser::StructuredOutputEvent::ParseError(err) => {
                                                dbg_eprintln!("[structured_output] parse error: {}", err);
                                            }
                                        }
                                    }
                                } else {
                                    full_content.push_str(delta);
                                    pending.push_str(delta);
                                }
                            }
                        }
                        "input_json_delta" => {
                            let partial_json = value
                                .get("delta")
                                .and_then(|delta| delta.get("partial_json"))
                                .and_then(|partial_json| partial_json.as_str())
                                .unwrap_or_default();
                            if let Some(ref mut parser) = structured_parser {
                                let events = parser.feed(partial_json);
                                for event in events {
                                    match event {
                                        crate::services::structured_output_parser::StructuredOutputEvent::StringFieldDelta { key, delta } => {
                                            if key == "content" {
                                                full_content.push_str(&delta);
                                            }
                                            let next_index = content_parts.len() as i64;
                                            let part_type = map_structured_field_part_type(&key);
                                            let content_index = ensure_content_part_by_key(
                                                &mut content_parts, &mut content_part_lookup,
                                                &key, next_index, part_type,
                                            );
                                            if part_type == "structured_output" {
                                                content_parts[content_index].tool_name = Some(key.clone());
                                            }
                                            append_content_part_text(&mut content_parts[content_index], &delta);
                                            emit_structured_field_delta_event(
                                                app, conversation_id, round_id, assistant_message_id,
                                                "anthropic", &key, content_index as i64, &delta,
                                            )?;
                                        }
                                        crate::services::structured_output_parser::StructuredOutputEvent::ObjectFieldComplete { key, value } => {
                                            let json_str = serde_json::Value::Object(value).to_string();
                                            let next_index = content_parts.len() as i64;
                                            let part_type = map_structured_field_part_type(&key);
                                            let content_index = ensure_content_part_by_key(
                                                &mut content_parts, &mut content_part_lookup,
                                                &key, next_index, part_type,
                                            );
                                            content_parts[content_index].json_value = Some(json_str.clone());
                                            if part_type == "structured_output" {
                                                content_parts[content_index].tool_name = Some(key.clone());
                                            }
                                            emit_object_field_complete_event(
                                                app, conversation_id, round_id, assistant_message_id,
                                                "anthropic", &key, content_index as i64, &json_str,
                                            )?;
                                        }
                                        crate::services::structured_output_parser::StructuredOutputEvent::ArrayFieldComplete { key, value } => {
                                            let json_str = value.to_string();
                                            let next_index = content_parts.len() as i64;
                                            let part_type = map_structured_field_part_type(&key);
                                            let content_index = ensure_content_part_by_key(
                                                &mut content_parts, &mut content_part_lookup,
                                                &key, next_index, part_type,
                                            );
                                            content_parts[content_index].json_value = Some(json_str.clone());
                                            if part_type == "structured_output" {
                                                content_parts[content_index].tool_name = Some(key.clone());
                                            }
                                            emit_object_field_complete_event(
                                                app, conversation_id, round_id, assistant_message_id,
                                                "anthropic", &key, content_index as i64, &json_str,
                                            )?;
                                        }
                                        crate::services::structured_output_parser::StructuredOutputEvent::ParseError(err) => {
                                            dbg_eprintln!("[structured_output] parse error: {}", err);
                                        }
                                    }
                                }
                            } else {
                                let pending_tool_use_ref = pending_tool_use
                                    .as_mut()
                                    .ok_or_else(|| {
                                        "Anthropic tool_use input_json_delta 缺少 pending tool_use 上下文"
                                            .to_string()
                                    })?;
                                pending_tool_use_ref.input_json.push_str(partial_json);
                                let content_index = ensure_content_part_by_key(
                                    &mut content_parts,
                                    &mut content_part_lookup,
                                    &pending_tool_use_ref.tool_use_id,
                                    provider_part_index,
                                    "tool_use",
                                );
                                content_parts[content_index].tool_use_id =
                                    Some(pending_tool_use_ref.tool_use_id.clone());
                                content_parts[content_index].tool_name =
                                    Some(pending_tool_use_ref.tool_name.clone());
                                content_parts[content_index].json_value = Some(
                                    normalize_tool_use_input_json(&pending_tool_use_ref.input_json),
                                );
                                emit_llm_stream_event(
                                    app,
                                    conversation_id,
                                    round_id,
                                    assistant_message_id,
                                    "anthropic",
                                    "tool_use",
                                    Some(provider_part_index),
                                    Some("tool_use"),
                                    None,
                                    Some(partial_json.to_string()),
                                    Some(crate::models::LlmStreamToolUseEvent {
                                        id: pending_tool_use_ref.tool_use_id.clone(),
                                        name: pending_tool_use_ref.tool_name.clone(),
                                    }),
                                    None,
                                    None,
                                    None,
                                )?;
                            }
                        }
                        "thinking_delta" => {
                            let content_index = ensure_content_part_by_key(
                                &mut content_parts,
                                &mut content_part_lookup,
                                &format!("thinking_{}", provider_part_index),
                                provider_part_index,
                                "thinking",
                            );
                            let delta = value
                                .get("delta")
                                .and_then(|delta| delta.get("thinking"))
                                .and_then(|thinking| thinking.as_str())
                                .unwrap_or_default();
                            if !delta.is_empty() {
                                thinking_content.push_str(delta);
                                append_content_part_text(&mut content_parts[content_index], delta);
                                emit_llm_stream_event(
                                    app,
                                    conversation_id,
                                    round_id,
                                    assistant_message_id,
                                    "anthropic",
                                    "thinking_delta",
                                    Some(provider_part_index),
                                    Some("thinking"),
                                    Some(delta.to_string()),
                                    None,
                                    None,
                                    None,
                                    None,
                                    None,
                                )?;
                            }
                        }
                        "signature_delta" => {
                            let content_index = ensure_content_part_by_key(
                                &mut content_parts,
                                &mut content_part_lookup,
                                &format!("thinking_{}", provider_part_index),
                                provider_part_index,
                                "thinking",
                            );
                            let signature_delta = value
                                .get("delta")
                                .and_then(|delta| delta.get("signature"))
                                .and_then(|signature| signature.as_str())
                                .unwrap_or_default();
                            if !signature_delta.is_empty() {
                                content_parts[content_index].json_value =
                                    Some(signature_delta.to_string());
                                emit_llm_stream_event(
                                    app,
                                    conversation_id,
                                    round_id,
                                    assistant_message_id,
                                    "anthropic",
                                    "thinking_delta",
                                    Some(provider_part_index),
                                    Some("thinking"),
                                    None,
                                    Some(signature_delta.to_string()),
                                    None,
                                    None,
                                    None,
                                    None,
                                )?;
                            }
                        }
                        "" => {}
                        other => {
                            return Err(format!(
                                "当前聊天主链路尚未支持 Anthropic delta.type='{}'",
                                other
                            ))
                        }
                    }
                }
                "message_delta" => {
                    let stop_reason = value
                        .get("delta")
                        .and_then(|delta| delta.get("stop_reason"))
                        .and_then(|stop_reason| stop_reason.as_str())
                        .unwrap_or_default();
                    if completion_tokens.is_none() {
                        completion_tokens = value
                            .get("usage")
                            .and_then(|usage| usage.get("output_tokens"))
                            .and_then(|v| v.as_i64());
                    }
                    if !stop_reason.is_empty() {
                        latest_stop_reason = Some(stop_reason.to_string());
                        if stop_reason != "tool_use" {
                            emit_llm_stream_event(
                                app,
                                conversation_id,
                                round_id,
                                assistant_message_id,
                                "anthropic",
                                "message_stop",
                                None,
                                None,
                                None,
                                None,
                                None,
                                Some(stop_reason),
                                None,
                                None,
                            )?;
                        }
                    }
                    if stop_reason == "tool_use" {
                        let pending_tool_use = pending_tool_use.take().ok_or_else(|| {
                            "Anthropic 返回 stop_reason=tool_use 但未找到已解析 tool_use block"
                                .to_string()
                        })?;
                        flush_text_delta_event(
                            app,
                            conversation_id,
                            round_id,
                            assistant_message_id,
                            "anthropic",
                            &mut pending,
                        )?;
                        RoundRepository::persist_tool_use_agent_skeleton(
                            db,
                            conversation_id,
                            round_id,
                            assistant_message_id,
                            &full_content,
                            content_parts.as_slice(),
                            &pending_tool_use,
                        )
                        .await?;
                        emit_llm_stream_event(
                            app,
                            conversation_id,
                            round_id,
                            assistant_message_id,
                            "anthropic",
                            "tool_use",
                            Some(pending_tool_use.provider_part_index),
                            Some("tool_use"),
                            None,
                            Some(normalize_tool_use_input_json(&pending_tool_use.input_json)),
                            Some(crate::models::LlmStreamToolUseEvent {
                                id: pending_tool_use.tool_use_id.clone(),
                                name: pending_tool_use.tool_name.clone(),
                            }),
                            Some("tool_use"),
                            None,
                            None,
                        )?;
                        return Err(format!(
                            "Anthropic tool_use '{}' 已记录为最小 agent mode 骨架，等待未来 tool_result 回注",
                            pending_tool_use.tool_name
                        ));
                    }
                }
                "message_stop" => {
                    flush_text_delta_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        "anthropic",
                        &mut pending,
                    )?;
                    let mut structured_json_content: Option<String> = None;
                    if let Some(parser) = structured_parser.take() {
                        match parser.finish() {
                            Ok(result) => {
                                let mut full_json = serde_json::Map::new();
                                for (key, value) in &result.fields {
                                    full_json.insert(key.clone(), value.clone());
                                }
                                structured_json_content = Some(serde_json::Value::Object(full_json).to_string());
                                for (key, value) in result.fields {
                                    let part_type = map_structured_field_part_type(&key);
                                    let next_index = content_parts.len() as i64;
                                    let content_index = ensure_content_part_by_key(
                                        &mut content_parts, &mut content_part_lookup,
                                        &key, next_index, part_type,
                                    );
                                    if value.is_string() {
                                        append_content_part_text(&mut content_parts[content_index], value.as_str().unwrap_or(""));
                                    } else if value.is_object() {
                                        content_parts[content_index].json_value = Some(value.to_string());
                                    }
                                    if part_type == "structured_output" {
                                        content_parts[content_index].tool_name = Some(key);
                                    }
                                }
                            }
                            Err(err) => {
                                dbg_eprintln!("[structured_output] finish error, entering compatibility mode: {}", err);
                                if !raw_prose.trim().is_empty() {
                                    structured_json_content = Some(build_compatibility_fallback_json(
                                        &raw_prose,
                                        schema_json,
                                    ));
                                    if let Err(e) = emit_compatibility_mode_event(
                                        app,
                                        conversation_id,
                                        round_id,
                                        assistant_message_id,
                                        provider_kind,
                                        "结构化 JSON 解析失败，已启用兼容模式：流式解析未完成或结构非法，原文已整体转入 narrative 字段。",
                                    ) {
                                        dbg_eprintln!("[compatibility_mode] failed to emit notice: {}", e);
                                    }
                                }
                            }
                        }
                    }
                    emit_stream_message_stop(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        "anthropic",
                        latest_stop_reason.as_deref(),
                        prompt_tokens,
                        completion_tokens,
                    )?;
                    let content_to_save = structured_json_content.as_deref().unwrap_or(&full_content);
                    finalize_streamed_response(
                        db,
                        round_id,
                        assistant_message_id,
                        content_to_save,
                        content_parts.as_slice(),
                        &[],
                        prompt_tokens,
                    )
                    .await?;
                    return Ok(StreamResponseData {
                        full_content: structured_json_content.unwrap_or(full_content),
                        thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                        stop_reason: latest_stop_reason.clone(),
                    });
                }
                "content_block_stop" => {
                    let provider_part_index = value.get("index").and_then(|index| index.as_i64());
                    emit_llm_stream_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        "anthropic",
                        "content_block_stop",
                        provider_part_index,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                    )?;
                }
                "ping" | "message_start"
                    if event_type == "message_start"
                        && prompt_tokens.is_none() => {
                            prompt_tokens = value
                                .get("message")
                                .and_then(|msg| msg.get("usage"))
                                .and_then(|usage| usage.get("input_tokens"))
                                .and_then(|v| v.as_i64());
                        }
                _ => {}
            }

            if last_emit.elapsed() >= Duration::from_millis(50) && !pending.is_empty() {
                flush_text_delta_event(
                    app,
                    conversation_id,
                    round_id,
                    assistant_message_id,
                    "anthropic",
                    &mut pending,
                )?;
                last_emit = Instant::now();
            }
        }

        if last_abort_check.elapsed() >= Duration::from_millis(500) {
            last_abort_check = Instant::now();
            if is_round_aborted(db, round_id, assistant_message_id).await? {
                break;
            }
        }
    }

    if !pending.is_empty() {
        flush_text_delta_event(
            app,
            conversation_id,
            round_id,
            assistant_message_id,
            "anthropic",
            &mut pending,
        )?;
    }
    let mut structured_json_content: Option<String> = None;
    if let Some(parser) = structured_parser.take() {
        match parser.finish() {
            Ok(result) => {
                let mut full_json = serde_json::Map::new();
                for (key, value) in &result.fields {
                    full_json.insert(key.clone(), value.clone());
                }
                structured_json_content = Some(serde_json::Value::Object(full_json).to_string());
                for (key, value) in result.fields {
                    let part_type = map_structured_field_part_type(&key);
                    let next_index = content_parts.len() as i64;
                    let content_index = ensure_content_part_by_key(
                        &mut content_parts, &mut content_part_lookup,
                        &key, next_index, part_type,
                    );
                    if value.is_string() {
                        append_content_part_text(&mut content_parts[content_index], value.as_str().unwrap_or(""));
                    } else if value.is_object() {
                        content_parts[content_index].json_value = Some(value.to_string());
                    }
                    if part_type == "structured_output" {
                        content_parts[content_index].tool_name = Some(key);
                    }
                }
            }
            Err(err) => {
                dbg_eprintln!("[structured_output] finish error, entering compatibility mode: {}", err);
                if !raw_prose.trim().is_empty() {
                    structured_json_content = Some(build_compatibility_fallback_json(
                        &raw_prose,
                        schema_json,
                    ));
                    if let Err(e) = emit_compatibility_mode_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        provider_kind,
                        "结构化 JSON 解析失败，已启用兼容模式：模型回复未返回合法 JSON，原文已整体转入 narrative 字段。",
                    ) {
                        dbg_eprintln!("[compatibility_mode] failed to emit notice: {}", e);
                    }
                }
            }
        }
    }
    if structured_json_content.is_none() && !full_content.is_empty() && !content_parts.iter().any(|p| p.part_type == "text") {
        let next_index = content_parts.len() as i64;
        let content_index = ensure_content_part_by_key(
            &mut content_parts,
            &mut content_part_lookup,
            "text",
            next_index,
            "text",
        );
        append_content_part_text(&mut content_parts[content_index], &full_content);
    }
    emit_stream_message_stop(
        app,
        conversation_id,
        round_id,
        assistant_message_id,
        "anthropic",
        latest_stop_reason.as_deref(),
        prompt_tokens,
        completion_tokens,
    )?;

    let content_to_save = structured_json_content.as_deref().unwrap_or(&full_content);
    if content_to_save.is_empty() {
        let msg_exists: bool = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE id = ?")
            .bind(assistant_message_id)
            .fetch_one(db)
            .await
            .map(|count: i64| count > 0)
            .unwrap_or(false);
        if !msg_exists {
            dbg_eprintln!("[chat] stream_anthropic: content empty and message {} deleted, silently returning", assistant_message_id);
            return Ok(StreamResponseData {
                full_content: String::new(),
                thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                stop_reason: latest_stop_reason.clone(),
            });
        }
        return Err("LLM 响应为空".to_string());
    }

    finalize_streamed_response(
        db,
        round_id,
        assistant_message_id,
        content_to_save,
        content_parts.as_slice(),
        &[],
        prompt_tokens,
    )
    .await?;

    Ok(StreamResponseData {
        full_content: structured_json_content.unwrap_or(full_content),
        thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
        stop_reason: latest_stop_reason.clone(),
    })
}

async fn resolve_prompt_compile_mode(
    db: &SqlitePool,
    round_id: i64,
    assistant_message_id: i64,
) -> Result<PromptCompileMode, String> {
    let has_prior =
        MessageRepository::has_prior_assistant_in_round(db, round_id, assistant_message_id).await?;
    Ok(if has_prior {
        PromptCompileMode::ClassicRegenerate
    } else {
        PromptCompileMode::ClassicChat
    })
}

fn inject_image_parts_into_request(
    request: &mut LlmChatRequest,
    attachments: &[ChatAttachment],
) -> Result<(), String> {
    if attachments.is_empty() {
        return Ok(());
    }

    let user_msg_index = request
        .messages
        .iter()
        .rposition(|msg| msg.role == LlmRole::User)
        .ok_or_else(|| "cannot find user message to inject image parts".to_string())?;

    let image_parts: Vec<LlmContentPart> = attachments
        .iter()
        .map(|attachment| LlmContentPart::Image {
            media_type: attachment.mime_type.clone(),
            source: LlmBinarySource::Base64 {
                media_type: attachment.mime_type.clone(),
                data_base64: attachment.base64_data.clone(),
            },
        })
        .collect();

    let message = &mut request.messages[user_msg_index];
    let mut new_parts = image_parts;
    new_parts.append(&mut message.parts);
    message.parts = new_parts;

    Ok(())
}

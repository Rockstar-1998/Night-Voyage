use std::collections::HashMap;

use futures_util::StreamExt;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{Duration, Instant};

use crate::llm::{LlmBinarySource, LlmChatRequest, LlmContentPart, LlmRole, ProviderHttpRequest};
use crate::models::{ChatAttachment, StreamErrorEvent};
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
    emit_llm_stream_event, emit_round_state, emit_stream_message_stop, finalize_streamed_response,
    flush_text_delta_event, save_llm_debug_log,
};
use crate::services::prompt_compiler::{
    PromptBudget, PromptCompileInput, PromptCompileMode, PromptCompileResult,
};
use crate::services::provider_adapter::{
    build_llm_chat_request, build_provider_http_request, ProviderCapabilityMatrix,
};

const STREAM_ABORTED_ERROR: &str = "__stream_aborted__";

struct StreamResponseData {
    full_content: String,
    thinking_content: Option<String>,
    stop_reason: Option<String>,
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
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
                eprintln!(
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
                eprintln!(
                    "[chat] is_round_aborted: assistant_message_id={} no longer exists, treating as aborted",
                    assistant_message_id
                );
                return Ok(true);
            }
            Ok(false)
        }
    }
}

pub fn spawn_stream_task(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    attachments: Vec<ChatAttachment>,
) {
    tauri::async_runtime::spawn(async move {
        eprintln!(
            "[chat] spawn_stream_task: starting stream_llm_response, conversation_id={}, round_id={}, provider_id={}, assistant_message_id={}",
            conversation_id, round_id, provider_id, assistant_message_id
        );
        let stream_result = stream_llm_response(
            app.clone(),
            db.clone(),
            conversation_id,
            round_id,
            provider_id,
            assistant_message_id,
            attachments,
        )
        .await;

        match stream_result {
            Err(error) => {
                eprintln!(
                    "[chat] spawn_stream_task: stream_llm_response FAILED, conversation_id={}, round_id={}, error={}",
                    conversation_id, round_id, error
                );
                crate::services::chat_service::chat_debug_log(
                    &app,
                    &format!(
                        "stream FAILED: conv={}, round={}, error={}",
                        conversation_id, round_id, error
                    ),
                );
                let _ = RoundRepository::mark_failed(&db, round_id).await;
                let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;
                if let Ok(round) =
                    RoundRepository::load_state(&db, conversation_id, Some(round_id)).await
                {
                    let _ = emit_round_state(&app, round);
                }
                let _ = app.emit(
                    "llm-stream-error",
                    StreamErrorEvent {
                        conversation_id,
                        round_id,
                        message_id: assistant_message_id,
                        error,
                    },
                );
            }
            Ok(data) => {
                let _ = RetrySnapshotRepository::mark_succeeded(&db, round_id).await;
                if !data.full_content.is_empty() {
                    let plot_summary_enabled =
                        crate::services::plot_summaries::load_plot_summary_mode(&db, conversation_id)
                            .await
                            .unwrap_or_else(|err| {
                                eprintln!("[stream] spawn_stream_task: failed to load plot_summary_mode: {}, skipping overlay/summary", err);
                                crate::services::plot_summaries::PLOT_SUMMARY_MODE_DISABLED.to_string()
                            })
                            != crate::services::plot_summaries::PLOT_SUMMARY_MODE_DISABLED;

                    if plot_summary_enabled {
                        crate::services::character_state_overlays::spawn_character_state_overlay_generation_task(
                            app.clone(),
                            db.clone(),
                            conversation_id,
                            round_id,
                            provider_id,
                        );
                        crate::services::plot_summaries::spawn_plot_summary_processing_task(
                            app.clone(),
                            db.clone(),
                            conversation_id,
                            provider_id,
                        );
                    }
                }
                if let Ok(round) =
                    RoundRepository::load_state(&db, conversation_id, Some(round_id)).await
                {
                    let _ = emit_round_state(&app, round);
                }
            }
        }
    });
}

async fn handle_stream_completion(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    data: StreamResponseData,
) -> Result<(), String> {
    if !data.full_content.is_empty() {
        let plot_summary_enabled =
            crate::services::plot_summaries::load_plot_summary_mode(&db, conversation_id)
                .await
                .unwrap_or_else(|err| {
                    eprintln!("[stream] handle_stream_completion: failed to load plot_summary_mode: {}, skipping overlay/summary", err);
                    crate::services::plot_summaries::PLOT_SUMMARY_MODE_DISABLED.to_string()
                })
                != crate::services::plot_summaries::PLOT_SUMMARY_MODE_DISABLED;

        if plot_summary_enabled {
            crate::services::character_state_overlays::spawn_character_state_overlay_generation_task(
                app.clone(),
                db.clone(),
                conversation_id,
                round_id,
                provider_id,
            );
            crate::services::plot_summaries::spawn_plot_summary_processing_task(
                app.clone(),
                db.clone(),
                conversation_id,
                provider_id,
            );
        }
    }

    if let Ok(round) = RoundRepository::load_state(&db, conversation_id, Some(round_id)).await {
        let _ = emit_round_state(&app, round);
    }

    Ok(())
}

async fn stream_llm_response(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    attachments: Vec<ChatAttachment>,
) -> Result<StreamResponseData, String> {
    let provider = ConversationRepository::load_provider(&db, provider_id).await?;

    eprintln!(
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
    eprintln!("[chat] stream_llm_response: compile_mode={:?}", compile_mode);

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
    };
    eprintln!("[chat] stream_llm_response: calling compile_prompt...");
    let mut compiled_prompt =
        crate::services::prompt_compiler::compile_prompt(&db, &compile_input, assistant_message_id)
            .await?;
    eprintln!(
        "[chat] stream_llm_response: compile_prompt done, response_mode={:?}, structured_output_schema={:?}, system_blocks={}, history_blocks={}",
        compiled_prompt.params.response_mode,
        compiled_prompt.params.structured_output_schema.as_ref().map(|s| if s.len() > 80 { format!("{}...", &s[..80]) } else { s.clone() }),
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
    eprintln!(
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

    eprintln!(
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

    stream_result
}

async fn execute_provider_http_request(
    http_request: &ProviderHttpRequest,
) -> Result<reqwest::Response, String> {
    eprintln!(
        "[chat] HTTP POST url={}, body_size={}",
        http_request.url,
        http_request.body.to_string().len(),
    );
    let client = crate::services::http_client::shared_permissive_http_client();
    let mut request_builder = client.post(&http_request.url);
    for header in &http_request.headers {
        request_builder = request_builder.header(&header.name, &header.value);
    }
    let response = request_builder
        .json(&http_request.body)
        .send()
        .await
        .map_err(|err| {
            let is_connect = err.is_connect();
            let is_timeout = err.is_timeout();
            let is_request = err.is_request();
            let is_body = err.is_body();
            let is_decode = err.is_decode();
            let is_redirect = err.is_redirect();
            format!(
                "HTTP 请求发送失败: {} | connect={} timeout={} request={} body={} decode={} redirect={}",
                err, is_connect, is_timeout, is_request, is_body, is_decode, is_redirect
            )
        })?;
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
    eprintln!(
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
    compiled_prompt: &PromptCompileResult,
    response_mode: Option<&str>,
) -> Result<StreamResponseData, String> {
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut thinking_content = String::new();
    let mut pending = String::new();
    let mut last_emit = Instant::now();
    let mut content_parts: Vec<PendingMessageContentPart> = Vec::new();
    let mut content_part_lookup: HashMap<String, usize> = HashMap::new();
    let mut finish_reason: Option<String> = None;
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
            eprintln!(
                "[chat] bytes_stream error: {} | timeout={} body={} decode={}",
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
                                }
                                if part_type == "structured_output" {
                                    content_parts[content_index].tool_name = Some(key);
                                }
                            }
                        }
                        Err(err) => {
                            eprintln!("[structured_output] finish error: {}", err);
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
                    prompt_tokens,
                    completion_tokens,
                });
            }

            let value: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => {
                    eprintln!("[chat] stream_openai_text: failed to parse SSE data as JSON, len={}", data.len());
                    continue;
                }
            };

            let has_content = value.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")).and_then(|d| d.get("content")).is_some();
            let has_reasoning = value.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")).and_then(|d| d.get("reasoning_content")).is_some();
            let has_finish = value.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("finish_reason")).is_some();
            if !has_content && !has_reasoning && !has_finish {
                eprintln!("[chat] stream_openai_text: unrecognized SSE event, keys={:?}", value.as_object().map(|o| o.keys().collect::<Vec<_>>()));
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
                        let has_backslash = delta.contains('\\');
                        let has_raw_newline = delta.contains('\n');
                        if has_backslash || has_raw_newline {
                            eprintln!(
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
                                        pending.push_str(&delta);
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
                                    if key != "content" {
                                        if delta.contains('\n') || delta.contains('\\') {
                                            eprintln!(
                                                "[structured_output] StringFieldDelta key={}, len={}, has_newline={}, has_backslash={}, preview={:?}",
                                                key, delta.len(), delta.contains('\n'), delta.contains('\\'),
                                                if delta.len() > 60 { &delta[..delta.ceil_char_boundary(60)] } else { &delta }
                                            );
                                        }
                                        emit_llm_stream_event(
                                            app, conversation_id, round_id, assistant_message_id,
                                            "openai_compatible", "string_field_delta",
                                            Some(content_index as i64), Some(&key),
                                            Some(delta), None, None, None, None, None,
                                        )?;
                                    }
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
                                    emit_llm_stream_event(
                                        app, conversation_id, round_id, assistant_message_id,
                                        "openai_compatible", "object_field_complete",
                                        Some(content_index as i64), Some(&key),
                                        None, Some(json_str), None, None, None, None,
                                    )?;
                                }
                                crate::services::structured_output_parser::StructuredOutputEvent::ParseError(err) => {
                                    eprintln!("[structured_output] parse error: {}", err);
                                }
                            }
                        }
                    } else {
                        full_content.push_str(delta);
                        pending.push_str(delta);
                    }
                }
            }

            if let Some(reasoning) = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("reasoning_content"))
                .and_then(|rc| rc.as_str())
            {
                if !reasoning.is_empty() {
                    thinking_content.push_str(reasoning);
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
                eprintln!("[structured_output] finish error: {}", err);
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
    if content_to_save.is_empty() {
        let msg_exists: bool = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE id = ?")
            .bind(assistant_message_id)
            .fetch_one(db)
            .await
            .map(|count: i64| count > 0)
            .unwrap_or(false);
        if !msg_exists {
            eprintln!("[chat] stream_openai: content empty and message {} deleted, silently returning", assistant_message_id);
            return Ok(StreamResponseData {
                full_content: String::new(),
                thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                stop_reason: finish_reason,
                prompt_tokens,
                completion_tokens,
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
        prompt_tokens,
        completion_tokens,
    })
}

async fn stream_anthropic_text_response(
    response: reqwest::Response,
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    assistant_message_id: i64,
    compiled_prompt: &PromptCompileResult,
    response_mode: Option<&str>,
) -> Result<StreamResponseData, String> {
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut thinking_content = String::new();
    let mut pending = String::new();
    let mut last_emit = Instant::now();
    let mut content_parts: Vec<PendingMessageContentPart> = Vec::new();
    let mut content_part_lookup: HashMap<String, usize> = HashMap::new();
    let mut latest_stop_reason: Option<String> = None;
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
            eprintln!(
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
                                    let events = parser.feed(delta);
                                    for event in events {
                                        match event {
                                            crate::services::structured_output_parser::StructuredOutputEvent::StringFieldDelta { key, delta: field_delta } => {
                                                if key == "content" || key == "text" {
                                                    full_content.push_str(&field_delta);
                                                    pending.push_str(&field_delta);
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
                                                if key != "content" && key != "text" {
                                                    emit_llm_stream_event(
                                                        app, conversation_id, round_id, assistant_message_id,
                                                        "anthropic", "string_field_delta",
                                                        Some(content_index as i64), Some(&key),
                                                        Some(field_delta), None, None, None, None, None,
                                                    )?;
                                                }
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
                                                emit_llm_stream_event(
                                                    app, conversation_id, round_id, assistant_message_id,
                                                    "anthropic", "object_field_complete",
                                                    Some(content_index as i64), Some(&key),
                                                    None, Some(json_str), None, None, None, None,
                                                )?;
                                            }
                                            crate::services::structured_output_parser::StructuredOutputEvent::ParseError(err) => {
                                                eprintln!("[structured_output] parse error: {}", err);
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
                                                pending.push_str(&delta);
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
                                            if key != "content" {
                                                emit_llm_stream_event(
                                                    app, conversation_id, round_id, assistant_message_id,
                                                    "anthropic", "string_field_delta",
                                                    Some(content_index as i64), Some(&key),
                                                    Some(delta), None, None, None, None, None,
                                                )?;
                                            }
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
                                            emit_llm_stream_event(
                                                app, conversation_id, round_id, assistant_message_id,
                                                "anthropic", "object_field_complete",
                                                Some(content_index as i64), Some(&key),
                                                None, Some(json_str), None, None, None, None,
                                            )?;
                                        }
                                        crate::services::structured_output_parser::StructuredOutputEvent::ParseError(err) => {
                                            eprintln!("[structured_output] parse error: {}", err);
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
                                eprintln!("[structured_output] finish error: {}", err);
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
                        prompt_tokens,
                        completion_tokens,
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
                "ping" | "message_start" => {
                    if event_type == "message_start" {
                        if prompt_tokens.is_none() {
                            prompt_tokens = value
                                .get("message")
                                .and_then(|msg| msg.get("usage"))
                                .and_then(|usage| usage.get("input_tokens"))
                                .and_then(|v| v.as_i64());
                        }
                    }
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
                eprintln!("[structured_output] finish error: {}", err);
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
    if content_to_save.is_empty() {
        let msg_exists: bool = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE id = ?")
            .bind(assistant_message_id)
            .fetch_one(db)
            .await
            .map(|count: i64| count > 0)
            .unwrap_or(false);
        if !msg_exists {
            eprintln!("[chat] stream_anthropic: content empty and message {} deleted, silently returning", assistant_message_id);
            return Ok(StreamResponseData {
                full_content: String::new(),
                thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                stop_reason: latest_stop_reason.clone(),
                prompt_tokens,
                completion_tokens,
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
        prompt_tokens,
        completion_tokens,
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

use std::collections::HashMap;

use futures_util::StreamExt;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use tokio::time::{Duration, Instant};

use crate::llm::{LlmBinarySource, LlmChatRequest, LlmContentPart, LlmRole, ProviderHttpRequest};
use crate::models::{ChatAttachment, StreamErrorEvent};
use crate::repositories::conversation_repository::ConversationRepository;
use crate::repositories::message_repository::{
    append_hidden_part_text, ensure_hidden_message_part, normalize_tool_use_input_json,
};
use crate::repositories::message_repository::{
    MessageRepository, PendingMessageContentPart, PendingToolUseSkeleton,
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
        if let Err(error) = stream_llm_response(
            app.clone(),
            db.clone(),
            conversation_id,
            round_id,
            provider_id,
            assistant_message_id,
            attachments,
        )
        .await
        {
            let _ = RoundRepository::mark_failed(&db, round_id).await;
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
        } else {
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
            if let Ok(round) =
                RoundRepository::load_state(&db, conversation_id, Some(round_id)).await
            {
                let _ = emit_round_state(&app, round);
            }
        }
    });
}

async fn stream_llm_response(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    attachments: Vec<ChatAttachment>,
) -> Result<(), String> {
    let provider = ConversationRepository::load_provider(&db, provider_id).await?;

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
    let mut compiled_prompt =
        crate::services::prompt_compiler::compile_prompt(&db, &compile_input, assistant_message_id)
            .await?;
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
            )
            .await
        }
        other => Err(format!("当前聊天链路暂不支持 provider_kind='{}'", other)),
    };

    let stream_result_ref = &stream_result;
    let response_label = match stream_result_ref {
        Ok(_) => "[streaming_success]".to_string(),
        Err(e) => format!("[stream_error: {}]", e),
    };
    save_llm_debug_log(
        conversation_id,
        round_id,
        &provider.provider_kind,
        &request.model,
        &request_body,
        &response_label,
        true,
        Some(&compiled_prompt.system_blocks),
    );

    stream_result?;

    Ok(())
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
    request_builder
        .json(&http_request.body)
        .send()
        .await
        .map_err(|err| err.to_string())
}

async fn stream_openai_text_response(
    response: reqwest::Response,
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    assistant_message_id: i64,
    compiled_prompt: &PromptCompileResult,
) -> Result<(), String> {
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut pending = String::new();
    let mut last_emit = Instant::now();
    let hidden_parts: Vec<PendingMessageContentPart> = Vec::new();

    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|err| err.to_string())?;
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
                emit_stream_message_stop(
                    app,
                    conversation_id,
                    round_id,
                    assistant_message_id,
                    "openai_compatible",
                    None,
                )?;
                return finalize_streamed_response(
                    db,
                    round_id,
                    assistant_message_id,
                    compiled_prompt,
                    &full_content,
                    hidden_parts.as_slice(),
                )
                .await;
            }

            let value: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };

            if let Some(delta) = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("content"))
                .and_then(|content| content.as_str())
            {
                if !delta.is_empty() {
                    full_content.push_str(delta);
                    pending.push_str(delta);
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
    emit_stream_message_stop(
        app,
        conversation_id,
        round_id,
        assistant_message_id,
        "openai_compatible",
        None,
    )?;

    finalize_streamed_response(
        db,
        round_id,
        assistant_message_id,
        compiled_prompt,
        &full_content,
        hidden_parts.as_slice(),
    )
    .await
}

async fn stream_anthropic_text_response(
    response: reqwest::Response,
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    assistant_message_id: i64,
    compiled_prompt: &PromptCompileResult,
) -> Result<(), String> {
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut pending = String::new();
    let mut last_emit = Instant::now();
    let mut hidden_parts = Vec::new();
    let mut hidden_part_lookup: HashMap<i64, usize> = HashMap::new();
    let mut latest_stop_reason: Option<String> = None;
    let mut pending_tool_use: Option<PendingToolUseSkeleton> = None;

    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|err| err.to_string())?;
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
                        .unwrap_or(hidden_parts.len() as i64);
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
                            let hidden_index = ensure_hidden_message_part(
                                &mut hidden_parts,
                                &mut hidden_part_lookup,
                                provider_part_index,
                                "tool_use",
                            );
                            hidden_parts[hidden_index].tool_use_id = Some(tool_use_id.clone());
                            hidden_parts[hidden_index].tool_name = Some(tool_name.clone());
                            hidden_parts[hidden_index].json_value = content_block
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
                            )?;
                        }
                        "thinking" | "redacted_thinking" => {
                            let hidden_index = ensure_hidden_message_part(
                                &mut hidden_parts,
                                &mut hidden_part_lookup,
                                provider_part_index,
                                block_type,
                            );
                            if block_type == "redacted_thinking" {
                                if let Some(data_value) = value
                                    .get("content_block")
                                    .and_then(|content_block| content_block.get("data"))
                                {
                                    hidden_parts[hidden_index].json_value =
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
                        .unwrap_or(hidden_parts.len() as i64);
                    match delta_type {
                        "text_delta" => {
                            let delta = value
                                .get("delta")
                                .and_then(|delta| delta.get("text"))
                                .and_then(|text| text.as_str())
                                .unwrap_or_default();
                            if !delta.is_empty() {
                                full_content.push_str(delta);
                                pending.push_str(delta);
                            }
                        }
                        "input_json_delta" => {
                            let partial_json = value
                                .get("delta")
                                .and_then(|delta| delta.get("partial_json"))
                                .and_then(|partial_json| partial_json.as_str())
                                .unwrap_or_default();
                            let pending_tool_use_ref = pending_tool_use
                                .as_mut()
                                .ok_or_else(|| {
                                    "Anthropic tool_use input_json_delta 缺少 pending tool_use 上下文"
                                        .to_string()
                                })?;
                            pending_tool_use_ref.input_json.push_str(partial_json);
                            let hidden_index = ensure_hidden_message_part(
                                &mut hidden_parts,
                                &mut hidden_part_lookup,
                                provider_part_index,
                                "tool_use",
                            );
                            hidden_parts[hidden_index].tool_use_id =
                                Some(pending_tool_use_ref.tool_use_id.clone());
                            hidden_parts[hidden_index].tool_name =
                                Some(pending_tool_use_ref.tool_name.clone());
                            hidden_parts[hidden_index].json_value = Some(
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
                            )?;
                        }
                        "thinking_delta" => {
                            let hidden_index = ensure_hidden_message_part(
                                &mut hidden_parts,
                                &mut hidden_part_lookup,
                                provider_part_index,
                                "thinking",
                            );
                            let delta = value
                                .get("delta")
                                .and_then(|delta| delta.get("thinking"))
                                .and_then(|thinking| thinking.as_str())
                                .unwrap_or_default();
                            if !delta.is_empty() {
                                append_hidden_part_text(&mut hidden_parts[hidden_index], delta);
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
                                )?;
                            }
                        }
                        "signature_delta" => {
                            let hidden_index = ensure_hidden_message_part(
                                &mut hidden_parts,
                                &mut hidden_part_lookup,
                                provider_part_index,
                                "thinking",
                            );
                            let signature_delta = value
                                .get("delta")
                                .and_then(|delta| delta.get("signature"))
                                .and_then(|signature| signature.as_str())
                                .unwrap_or_default();
                            if !signature_delta.is_empty() {
                                hidden_parts[hidden_index].json_value =
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
                            hidden_parts.as_slice(),
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
                    emit_stream_message_stop(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        "anthropic",
                        latest_stop_reason.as_deref(),
                    )?;
                    return finalize_streamed_response(
                        db,
                        round_id,
                        assistant_message_id,
                        compiled_prompt,
                        &full_content,
                        hidden_parts.as_slice(),
                    )
                    .await;
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
                    )?;
                }
                "ping" | "message_start" => {}
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
    emit_stream_message_stop(
        app,
        conversation_id,
        round_id,
        assistant_message_id,
        "anthropic",
        latest_stop_reason.as_deref(),
    )?;

    finalize_streamed_response(
        db,
        round_id,
        assistant_message_id,
        compiled_prompt,
        &full_content,
        hidden_parts.as_slice(),
    )
    .await
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

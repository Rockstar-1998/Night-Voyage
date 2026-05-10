use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{
    ChatAttachment, ChatRoundStateEvent, ChatSubmitInputResult, LlmStreamEventPayload,
    LlmStreamToolUseEvent, RegenerateRoundResult, RoundState, StreamChunkEvent, SubmitRoundAction,
    UiMessage,
};
use crate::repositories::conversation_repository::ConversationRepository;
use crate::repositories::message_repository::{
    InsertMessageRecord, MessageRepository, PendingMessageContentPart,
};
use crate::repositories::round_repository::RoundRepository;
use crate::services::prompt_compiler::PromptCompileResult;
use crate::utils::now_ts;

const ALLOWED_IMAGE_MIME_TYPES: &[&str] = &["image/jpeg", "image/png", "image/gif", "image/webp"];

pub fn validate_attachment_mime_types(attachments: &[ChatAttachment]) -> Result<(), String> {
    for attachment in attachments {
        if !ALLOWED_IMAGE_MIME_TYPES.contains(&attachment.mime_type.as_str()) {
            return Err(format!(
                "unsupported image format: {}. Allowed: image/jpeg, image/png, image/gif, image/webp",
                attachment.mime_type
            ));
        }
    }
    Ok(())
}

pub struct ChatService;

impl ChatService {
    pub async fn list_messages(
        db: &SqlitePool,
        conversation_id: i64,
        limit: Option<i64>,
    ) -> Result<Vec<UiMessage>, String> {
        let limit = limit.unwrap_or(200).max(1);
        let mut messages =
            MessageRepository::list_by_conversation(db, conversation_id, limit).await?;

        let summary_round_map =
            crate::services::plot_summaries::load_completed_plot_summary_round_map(
                db,
                conversation_id,
            )
            .await?;
        for message in &mut messages {
            if let Some(round_id) = message.round_id {
                if let Some(marker) = summary_round_map.get(&round_id) {
                    message.summary_batch_index = Some(marker.batch_index);
                    message.summary_entry_id = Some(marker.summary_id);
                }
            }
        }
        messages.reverse();
        Ok(messages)
    }

    pub async fn submit_input(
        app: AppHandle,
        db: SqlitePool,
        conversation_id: i64,
        member_id: i64,
        content: String,
        provider_id_override: Option<i64>,
        attachments: Vec<ChatAttachment>,
    ) -> Result<ChatSubmitInputResult, String> {
        validate_attachment_mime_types(&attachments)?;

        let now = now_ts();
        let trimmed = content.trim().to_string();
        let mut tx = db.begin().await.map_err(|err| err.to_string())?;

        ConversationRepository::ensure_member_active(&mut tx, conversation_id, member_id).await?;

        let (round_id, _round_index) =
            RoundRepository::ensure_collecting(&mut tx, conversation_id, now).await?;

        if RoundRepository::member_already_decided(&mut tx, round_id, member_id).await? {
            return Err("当前成员本轮已提交发言或放弃发言".to_string());
        }

        let action_type = if trimmed.is_empty() && attachments.is_empty() {
            "skipped"
        } else {
            "spoken"
        };

        RoundRepository::insert_member_action(
            &mut tx,
            round_id,
            member_id,
            action_type,
            &trimmed,
            now,
        )
        .await?;

        let visible_user_message_id = if action_type == "spoken" {
            Some(
                MessageRepository::insert_record(
                    &mut tx,
                    InsertMessageRecord {
                        conversation_id,
                        round_id: Some(round_id),
                        member_id: Some(member_id),
                        role: "user",
                        message_kind: "user_visible",
                        content: content.as_str(),
                        is_hidden: false,
                        is_swipe: false,
                        swipe_index: 0,
                        reply_to_id: None,
                        created_at: now,
                    },
                )
                .await?,
            )
        } else {
            None
        };

        if let Some(message_id) = visible_user_message_id {
            if !attachments.is_empty() {
                MessageRepository::persist_image_content_parts(&mut tx, message_id, &attachments)
                    .await?;
            }
        }

        let required_member_count =
            RoundRepository::count_active_members(&mut tx, conversation_id).await?;
        let decided_member_count =
            RoundRepository::count_decided_members(&mut tx, round_id).await?;

        ConversationRepository::update_timestamp(&mut tx, conversation_id, now).await?;

        let mut assistant_message_id = None;
        let auto_dispatched =
            required_member_count > 0 && decided_member_count >= required_member_count;

        let provider_id_to_use = if auto_dispatched {
            let provider_id = ConversationRepository::resolve_provider_id(
                &mut tx,
                conversation_id,
                provider_id_override,
            )
            .await?;
            let conversation_type =
                ConversationRepository::load_conversation_type(&mut tx, conversation_id).await?;
            let aggregated_user_content = RoundRepository::build_aggregated_user_content(
                &mut tx,
                round_id,
                &conversation_type,
            )
            .await?;
            let aggregate_message_id = MessageRepository::insert_record(
                &mut tx,
                InsertMessageRecord {
                    conversation_id,
                    round_id: Some(round_id),
                    member_id: None,
                    role: "user",
                    message_kind: "user_aggregate",
                    content: aggregated_user_content.as_str(),
                    is_hidden: true,
                    is_swipe: false,
                    swipe_index: 0,
                    reply_to_id: None,
                    created_at: now,
                },
            )
            .await?;

            let new_assistant_message_id = MessageRepository::insert_record(
                &mut tx,
                InsertMessageRecord {
                    conversation_id,
                    round_id: Some(round_id),
                    member_id: None,
                    role: "assistant",
                    message_kind: "assistant_visible",
                    content: "",
                    is_hidden: false,
                    is_swipe: false,
                    swipe_index: 0,
                    reply_to_id: Some(aggregate_message_id),
                    created_at: now,
                },
            )
            .await?;

            assistant_message_id = Some(new_assistant_message_id);

            RoundRepository::set_streaming(
                &mut tx,
                round_id,
                &aggregated_user_content,
                aggregate_message_id,
                new_assistant_message_id,
                now,
            )
            .await?;

            Some(provider_id)
        } else {
            RoundRepository::update_timestamp(&mut tx, round_id, now).await?;
            None
        };

        tx.commit().await.map_err(|err| err.to_string())?;

        let round = RoundRepository::load_state(&db, conversation_id, Some(round_id)).await?;
        let visible_user_message = match visible_user_message_id {
            Some(message_id) => Some(MessageRepository::find_by_id(&db, message_id).await?),
            None => None,
        };
        let assistant_message = match assistant_message_id {
            Some(message_id) => Some(MessageRepository::find_by_id(&db, message_id).await?),
            None => None,
        };

        emit_round_state(&app, round.clone())?;

        if let Some(message) = visible_user_message.clone() {
            broadcast_room_player_message(&app, message, action_type.to_string());
        }

        if let (Some(provider_id), Some(message_id)) = (provider_id_to_use, assistant_message_id) {
            crate::services::stream_processor::spawn_stream_task(
                app.clone(),
                db.clone(),
                conversation_id,
                round_id,
                provider_id,
                message_id,
                attachments,
            );
        }

        Ok(ChatSubmitInputResult {
            round,
            action: SubmitRoundAction {
                member_id,
                action_type: action_type.to_string(),
                content: trimmed,
            },
            visible_user_message,
            assistant_message,
            auto_dispatched,
        })
    }

    pub async fn submit_tool_result(
        app: AppHandle,
        db: SqlitePool,
        conversation_id: i64,
        round_id: i64,
        tool_use_id: String,
        content: String,
        _is_error: bool,
    ) -> Result<serde_json::Value, String> {
        let chat_mode = ConversationRepository::load_chat_mode(&db, conversation_id).await?;
        if chat_mode != "director_agents" {
            return Err(
                "tool_result submission is only available in agent mode (director_agents)"
                    .to_string(),
            );
        }

        let tool_call_row = MessageRepository::find_tool_call_by_use_id(&db, &tool_use_id).await?;

        let tool_call_row = tool_call_row.ok_or_else(|| {
            format!(
                "tool_use_id not found in message_tool_calls: {}",
                tool_use_id
            )
        })?;

        let tool_call_status: String = tool_call_row.try_get("status").unwrap_or_default();
        if tool_call_status != "pending" {
            return Err(format!(
                "tool_use_id {} is not in pending state (current: {})",
                tool_use_id, tool_call_status
            ));
        }

        let tool_result_display = format!("[Tool Result for {}]", tool_use_id);
        let now = now_ts();
        let mut tx = db.begin().await.map_err(|err| err.to_string())?;

        let user_message_id = MessageRepository::insert_record(
            &mut tx,
            InsertMessageRecord {
                conversation_id,
                round_id: Some(round_id),
                member_id: None,
                role: "user",
                message_kind: "user_visible",
                content: &tool_result_display,
                is_hidden: false,
                is_swipe: false,
                swipe_index: 0,
                reply_to_id: None,
                created_at: now,
            },
        )
        .await?;

        MessageRepository::insert_tool_result_content_part(
            &mut tx,
            user_message_id,
            &content,
            &tool_use_id,
            now,
        )
        .await?;

        MessageRepository::update_tool_call_status(&mut tx, user_message_id, now, &tool_use_id)
            .await?;

        let new_round_id = RoundRepository::create_next(&mut tx, conversation_id, now).await?;

        let provider_id = ConversationRepository::load_provider_id(&mut tx, conversation_id)
            .await?
            .ok_or_else(|| "会话尚未绑定 API 档案".to_string())?;

        let aggregated_user_content = format!("[Tool Result for {}]", tool_use_id);
        let aggregate_message_id = MessageRepository::insert_record(
            &mut tx,
            InsertMessageRecord {
                conversation_id,
                round_id: Some(new_round_id),
                member_id: None,
                role: "user",
                message_kind: "user_aggregate",
                content: aggregated_user_content.as_str(),
                is_hidden: true,
                is_swipe: false,
                swipe_index: 0,
                reply_to_id: None,
                created_at: now,
            },
        )
        .await?;

        let assistant_message_id = MessageRepository::insert_record(
            &mut tx,
            InsertMessageRecord {
                conversation_id,
                round_id: Some(new_round_id),
                member_id: None,
                role: "assistant",
                message_kind: "assistant_visible",
                content: "",
                is_hidden: false,
                is_swipe: false,
                swipe_index: 0,
                reply_to_id: Some(aggregate_message_id),
                created_at: now,
            },
        )
        .await?;

        RoundRepository::set_streaming_tool_result(
            &mut tx,
            new_round_id,
            &aggregated_user_content,
            aggregate_message_id,
            assistant_message_id,
            now,
        )
        .await?;

        tx.commit().await.map_err(|err| err.to_string())?;

        crate::services::stream_processor::spawn_stream_task(
            app,
            db.clone(),
            conversation_id,
            new_round_id,
            provider_id,
            assistant_message_id,
            vec![],
        );

        let round_state =
            RoundRepository::load_state(&db, conversation_id, Some(new_round_id)).await?;
        Ok(serde_json::to_value(round_state).unwrap_or_default())
    }

    pub async fn regenerate_round(
        app: AppHandle,
        db: SqlitePool,
        conversation_id: i64,
        round_id: i64,
        provider_id_override: Option<i64>,
    ) -> Result<RegenerateRoundResult, String> {
        let now = now_ts();
        let mut tx = db.begin().await.map_err(|err| err.to_string())?;

        let aggregate_message_id =
            RoundRepository::find_aggregate_message_id(&mut tx, round_id, conversation_id).await?;

        let provider_id = ConversationRepository::resolve_provider_id(
            &mut tx,
            conversation_id,
            provider_id_override,
        )
        .await?;
        let max_swipe = MessageRepository::max_swipe_index_for_round(&mut tx, round_id).await?;
        let next_swipe = max_swipe.unwrap_or(0) + 1;

        let assistant_message_id = MessageRepository::insert_record(
            &mut tx,
            InsertMessageRecord {
                conversation_id,
                round_id: Some(round_id),
                member_id: None,
                role: "assistant",
                message_kind: "assistant_visible",
                content: "",
                is_hidden: false,
                is_swipe: true,
                swipe_index: next_swipe,
                reply_to_id: Some(aggregate_message_id),
                created_at: now,
            },
        )
        .await?;

        RoundRepository::set_streaming_regenerate(&mut tx, round_id, assistant_message_id, now)
            .await?;

        ConversationRepository::update_timestamp(&mut tx, conversation_id, now).await?;

        tx.commit().await.map_err(|err| err.to_string())?;

        let round = RoundRepository::load_state(&db, conversation_id, Some(round_id)).await?;
        let assistant_message = MessageRepository::find_by_id(&db, assistant_message_id).await?;

        emit_round_state(&app, round.clone())?;
        crate::services::stream_processor::spawn_stream_task(
            app.clone(),
            db.clone(),
            conversation_id,
            round_id,
            provider_id,
            assistant_message_id,
            Vec::new(),
        );

        Ok(RegenerateRoundResult {
            round,
            assistant_message,
            preserved_version_count: next_swipe,
        })
    }

    pub async fn update_message_content(
        db: &SqlitePool,
        conversation_id: i64,
        member_id: i64,
        message_id: i64,
        content: String,
    ) -> Result<(), String> {
        ConversationRepository::ensure_member_is_host(db, conversation_id, member_id).await?;
        MessageRepository::update_content(db, message_id, &content).await?;
        MessageRepository::update_content_parts_text(db, message_id, &content).await?;
        Ok(())
    }

    pub async fn switch_swipe(
        db: &SqlitePool,
        round_id: i64,
        target_message_id: i64,
    ) -> Result<UiMessage, String> {
        RoundRepository::set_active_assistant_message(db, round_id, target_message_id).await?;
        MessageRepository::find_by_id(db, target_message_id).await
    }

    pub async fn resolve_round_id_from_reply_to(
        db: &SqlitePool,
        conversation_id: i64,
        reply_to_id: i64,
    ) -> Result<i64, String> {
        MessageRepository::find_round_id_by_message(db, conversation_id, reply_to_id)
            .await?
            .ok_or_else(|| "无法定位需要重新生成的轮次".to_string())
    }
}

pub fn emit_round_state(app: &AppHandle, round: RoundState) -> Result<(), String> {
    let event = ChatRoundStateEvent {
        round: round.clone(),
    };
    app.emit("chat-round-state", event)
        .map_err(|err| err.to_string())?;

    tauri::async_runtime::spawn({
        let app = app.clone();
        let round = round.clone();
        async move {
            let state = app.state::<crate::AppState>();
            let host_server = state.host_server.lock().await;
            if let Some(server) = host_server.as_ref() {
                let server = server.lock().await;
                let msg = crate::network::RoomMessage::RoundStateUpdate { round_state: round };
                server.broadcast_message(&msg).await;
            }
        }
    });

    Ok(())
}

fn broadcast_room_player_message(app: &AppHandle, message: UiMessage, action_type: String) {
    if message.role != "user" || message.message_kind != "user_visible" {
        return;
    }

    let Some(member_id) = message.member_id else {
        return;
    };

    let msg = crate::network::RoomMessage::PlayerMessage {
        member_id,
        display_name: message.display_name.unwrap_or_else(|| "Player".to_string()),
        content: message.content,
        action_type,
        conversation_id: Some(message.conversation_id),
        round_id: message.round_id,
        message_id: Some(message.id),
    };

    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let state = app.state::<crate::AppState>();
            let host_server = state.host_server.lock().await;
            if let Some(server) = host_server.as_ref() {
                if let Some(payload) = msg.event_payload() {
                    let _ = app.emit(msg.event_name(), payload);
                }
                let server = server.lock().await;
                server.broadcast_message(&msg).await;
            }
        }
    });
}

pub fn emit_llm_stream_event(
    app: &AppHandle,
    conversation_id: i64,
    round_id: i64,
    message_id: i64,
    provider_kind: &str,
    event_kind: &str,
    part_index: Option<i64>,
    part_type: Option<&str>,
    text_delta: Option<String>,
    json_delta: Option<String>,
    tool_use: Option<LlmStreamToolUseEvent>,
    stop_reason: Option<&str>,
) -> Result<(), String> {
    let payload = LlmStreamEventPayload {
        conversation_id,
        round_id,
        message_id,
        provider_kind: provider_kind.to_string(),
        event_kind: event_kind.to_string(),
        part_index,
        part_type: part_type.map(|value| value.to_string()),
        text_delta,
        json_delta,
        tool_use,
        stop_reason: stop_reason.map(|value| value.to_string()),
    };
    app.emit("llm-stream-event", payload)
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn flush_text_delta_event(
    app: &AppHandle,
    conversation_id: i64,
    round_id: i64,
    message_id: i64,
    provider_kind: &str,
    pending: &mut String,
) -> Result<(), String> {
    if pending.is_empty() {
        return Ok(());
    }

    let delta = pending.clone();
    pending.clear();
    let chunk_event = StreamChunkEvent {
        conversation_id,
        round_id,
        message_id,
        delta: delta.clone(),
        done: false,
    };
    app.emit("llm-stream-chunk", chunk_event.clone())
        .map_err(|err| err.to_string())?;

    tauri::async_runtime::spawn({
        let app = app.clone();
        let chunk_event = chunk_event.clone();
        async move {
            let state = app.state::<crate::AppState>();
            let host_server = state.host_server.lock().await;
            if let Some(server) = host_server.as_ref() {
                let server = server.lock().await;
                let msg = crate::network::RoomMessage::StreamChunk {
                    conversation_id: chunk_event.conversation_id,
                    round_id: chunk_event.round_id,
                    message_id: chunk_event.message_id,
                    delta: chunk_event.delta,
                    done: chunk_event.done,
                };
                server.broadcast_message(&msg).await;
            }
        }
    });

    emit_llm_stream_event(
        app,
        conversation_id,
        round_id,
        message_id,
        provider_kind,
        "text_delta",
        Some(0),
        Some("text"),
        Some(delta),
        None,
        None,
        None,
    )
}

pub fn emit_stream_message_stop(
    app: &AppHandle,
    conversation_id: i64,
    round_id: i64,
    message_id: i64,
    provider_kind: &str,
    stop_reason: Option<&str>,
) -> Result<(), String> {
    let chunk_event = StreamChunkEvent {
        conversation_id,
        round_id,
        message_id,
        delta: String::new(),
        done: true,
    };
    app.emit("llm-stream-chunk", chunk_event.clone())
        .map_err(|err| err.to_string())?;

    tauri::async_runtime::spawn({
        let app = app.clone();
        let chunk_event = chunk_event.clone();
        async move {
            let state = app.state::<crate::AppState>();
            let host_server = state.host_server.lock().await;
            if let Some(server) = host_server.as_ref() {
                let server = server.lock().await;
                let msg = crate::network::RoomMessage::StreamEnd {
                    conversation_id: chunk_event.conversation_id,
                    round_id: chunk_event.round_id,
                    message_id: chunk_event.message_id,
                };
                server.broadcast_message(&msg).await;
            }
        }
    });

    emit_llm_stream_event(
        app,
        conversation_id,
        round_id,
        message_id,
        provider_kind,
        "message_stop",
        None,
        None,
        None,
        None,
        None,
        stop_reason,
    )
}

pub async fn finalize_streamed_response(
    db: &SqlitePool,
    round_id: i64,
    assistant_message_id: i64,
    compiled_prompt: &PromptCompileResult,
    full_content: &str,
    hidden_parts: &[PendingMessageContentPart],
) -> Result<(), String> {
    if full_content.is_empty() {
        return Err("LLM 响应为空".to_string());
    }

    MessageRepository::update_content(db, assistant_message_id, full_content).await?;
    MessageRepository::replace_content_parts(db, assistant_message_id, full_content, hidden_parts)
        .await?;
    compiled_prompt.validate_output_text(full_content)?;
    RoundRepository::mark_completed(db, round_id, assistant_message_id).await?;
    Ok(())
}

pub fn save_llm_debug_log(
    conversation_id: i64,
    round_id: i64,
    provider_kind: &str,
    model: &str,
    request_body: &serde_json::Value,
    response_body: &str,
    is_streaming: bool,
    system_blocks_metadata: Option<&[crate::services::prompt_compiler::PromptBlock]>,
) {
    let timestamp = now_ts();
    let safe_model = model.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let filename = format!(
        "llm_req_{}_cid{}_rid{}_{}.json",
        timestamp, conversation_id, round_id, safe_model
    );

    let mut log_dir = std::path::PathBuf::from(".");
    if let Ok(cargo_manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        log_dir = std::path::PathBuf::from(&cargo_manifest)
            .parent()
            .unwrap()
            .to_path_buf();
    }
    log_dir.push("llm_debug_logs");
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!("[llm-debug] failed to create log dir: {}", e);
        return;
    }

    let full_path = log_dir.join(&filename);
    let system_blocks_debug: Vec<serde_json::Value> = system_blocks_metadata
        .map(|blocks| {
            blocks
                .iter()
                .map(|block| {
                    serde_json::json!({
                        "kind": block.kind.as_str(),
                        "priority": block.priority,
                        "required": block.required,
                        "title": block.title,
                        "source": match &block.source {
                            crate::services::prompt_compiler::PromptBlockSource::Preset { preset_id, block_id } => {
                                serde_json::json!({"type": "preset", "preset_id": preset_id, "block_id": block_id})
                            }
                            crate::services::prompt_compiler::PromptBlockSource::Character { character_id } => {
                                serde_json::json!({"type": "character", "character_id": character_id})
                            }
                            crate::services::prompt_compiler::PromptBlockSource::WorldBook { world_book_id, entry_id } => {
                                serde_json::json!({"type": "world_book", "world_book_id": world_book_id, "entry_id": entry_id})
                            }
                            crate::services::prompt_compiler::PromptBlockSource::Summary { summary_id } => {
                                serde_json::json!({"type": "summary", "summary_id": summary_id})
                            }
                            crate::services::prompt_compiler::PromptBlockSource::Retrieval { fragment_id } => {
                                serde_json::json!({"type": "retrieval", "fragment_id": fragment_id})
                            }
                            crate::services::prompt_compiler::PromptBlockSource::Message { message_id } => {
                                serde_json::json!({"type": "message", "message_id": message_id})
                            }
                            crate::services::prompt_compiler::PromptBlockSource::Compiler => {
                                serde_json::json!({"type": "compiler"})
                            }
                        },
                        "token_cost_estimate": block.token_cost_estimate,
                        "content_preview": if block.content.len() > 200 {
                            let end = block.content.char_indices().take_while(|(i, _)| *i < 200).last().map(|(i, c)| i + c.len_utf8()).unwrap_or(block.content.len().min(200));
                            format!("{}...", &block.content[..end])
                        } else {
                            block.content.clone()
                        },
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let combined = serde_json::json!({
        "conversation_id": conversation_id,
        "round_id": round_id,
        "provider_kind": provider_kind,
        "model": model,
        "timestamp": timestamp,
        "is_streaming": is_streaming,
        "request": request_body,
        "system_blocks_metadata": system_blocks_debug,
        "response": if response_body.len() > 100_000 {
            format!("[TRUNCATED, {} chars]", response_body.len())
        } else {
            response_body.to_string()
        }
    });

    if let Err(e) = std::fs::write(&full_path, combined.to_string()) {
        eprintln!("[llm-debug] failed to write log {}: {}", filename, e);
    } else {
        eprintln!("[llm-debug] saved to {}", full_path.display());
    }
}

pub fn build_openai_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{}/chat/completions", trimmed)
    } else {
        format!("{}/v1/chat/completions", trimmed)
    }
}

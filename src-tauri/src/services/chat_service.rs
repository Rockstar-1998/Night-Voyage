use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{
    ChatAttachment, ChatRoundStateEvent, ChatSubmitInputResult, LlmStreamEventPayload,
    LlmStreamToolUseEvent, RegenerateRoundResult, RetryFailedRoundResult, RoundState,
    StreamChunkEvent, SubmitRoundAction, UiMessage,
};
use crate::repositories::conversation_repository::ConversationRepository;
use crate::repositories::message_repository::{
    InsertMessageRecord, MessageRepository, PendingMessageContentPart,
};
use crate::repositories::llm_retry_snapshot_repository::RetrySnapshotRepository;
use crate::repositories::round_repository::RoundRepository;
use crate::services::prompt_compiler::{
    validate_output_text_with_retry_snapshot, PromptCompileResult, RetryOutputValidatorSnapshot,
};
use crate::utils::now_ts;

const ALLOWED_IMAGE_MIME_TYPES: &[&str] = &["image/jpeg", "image/png", "image/gif", "image/webp"];

pub fn chat_debug_log(app: &AppHandle, message: &str) {
    eprintln!("[chat] {}", message);
    if let Ok(data_dir) = app.path().app_data_dir() {
        let log_dir = data_dir.join("chat_debug_logs");
        let _ = std::fs::create_dir_all(&log_dir);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let log_line = format!("[{}] {}\n", timestamp, message);
        let date_suffix = timestamp / 86_400_000;
        let log_path = log_dir.join(format!("chat_{}.log", date_suffix));
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let _ = file.write_all(log_line.as_bytes());
        }
    }
}

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
            let member_visible_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM messages WHERE round_id = ? AND member_id = ? AND is_hidden = 0",
            )
            .bind(round_id)
            .bind(member_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;

            if member_visible_count == 0 {
                eprintln!(
                    "[chat] submit_input: member_already_decided=true but member has 0 visible messages, clearing stale action. round_id={}, member_id={}",
                    round_id, member_id
                );
                sqlx::query("DELETE FROM round_member_actions WHERE round_id = ? AND member_id = ?")
                    .bind(round_id)
                    .bind(member_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|err| err.to_string())?;
            } else {
                return Err("当前成员本轮已提交发言或放弃发言".to_string());
            }
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

        eprintln!(
            "[chat] submit_input: conversation_id={}, round_id={}, member_id={}, required_members={}, decided_members={}, auto_dispatched={}",
            conversation_id, round_id, member_id, required_member_count, decided_member_count, auto_dispatched
        );

        chat_debug_log(
            &app,
            &format!(
                "submit_input: conv={}, round={}, member={}, required={}, decided={}, auto_dispatched={}",
                conversation_id, round_id, member_id, required_member_count, decided_member_count, auto_dispatched
            ),
        );

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

        let round = match RoundRepository::load_state(&db, conversation_id, Some(round_id)).await {
            Ok(r) => Some(r),
            Err(err) => {
                eprintln!("[chat] submit_input: load_state failed after commit: {}", err);
                None
            }
        };
        let visible_user_message = match visible_user_message_id {
            Some(message_id) => MessageRepository::find_by_id(&db, message_id).await.ok(),
            None => None,
        };
        let assistant_message = match assistant_message_id {
            Some(message_id) => MessageRepository::find_by_id(&db, message_id).await.ok(),
            None => None,
        };

        if let Some(ref r) = round {
            if let Err(err) = emit_round_state(&app, r.clone()) {
                eprintln!("[chat] submit_input: emit_round_state failed: {}", err);
            }
        }

        if let Some(message) = visible_user_message.clone() {
            broadcast_room_player_message(&app, message, action_type.to_string());
        }

        if let (Some(provider_id), Some(message_id)) = (provider_id_to_use, assistant_message_id) {
            eprintln!(
                "[chat] submit_input: spawning stream task, provider_id={}, assistant_message_id={}",
                provider_id, message_id
            );
            chat_debug_log(
                &app,
                &format!(
                    "submit_input: spawning stream task, provider_id={}, assistant_message_id={}",
                    provider_id, message_id
                ),
            );
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
            round: round.unwrap_or_else(|| {
                crate::models::RoundState {
                    round_id,
                    conversation_id,
                    round_index: 0,
                    status: "streaming".to_string(),
                    required_member_count: 0,
                    decided_member_count: 0,
                    waiting_member_ids: Vec::new(),
                    aggregated_user_content: None,
                    active_assistant_message_id: assistant_message_id,
                    updated_at: 0,
                }
            }),
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

    pub async fn delete_message(db: &SqlitePool, message_id: i64) -> Result<(), String> {
        let message = MessageRepository::find_by_id(db, message_id).await?;
        let round_id = message.round_id;
        let role = message.role;
        let conversation_id = message.conversation_id;
        let message_kind = message.message_kind.clone();

        eprintln!(
            "[delete_message] id={}, role={}, kind={}, round_id={:?}, conv={}",
            message_id, role, message_kind, round_id, conversation_id
        );

        if let Some(round_id) = round_id {
            if role == "assistant" {
                eprintln!(
                    "[delete_message] assistant: deleting entire round_id={}",
                    round_id
                );
                Self::delete_round_completely(db, round_id).await?;
            } else {
                MessageRepository::delete_message(db, message_id).await?;

                let round = RoundRepository::load_state(db, conversation_id, Some(round_id)).await?;
                let is_streaming_or_queued = round.status == "streaming" || round.status == "queued";
                let is_aggregate = message_kind == "user_aggregate";

                eprintln!(
                    "[delete_message] user: round_id={}, round_status={}, is_aggregate={}, is_streaming_or_queued={}",
                    round_id, round.status, is_aggregate, is_streaming_or_queued
                );

                let visible_count: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM messages WHERE round_id = ? AND is_hidden = 0",
                )
                .bind(round_id)
                .fetch_one(db)
                .await
                .map_err(|err| err.to_string())?;

                if visible_count == 0 {
                    eprintln!("[delete_message] user: no visible messages left, deleting round {}", round_id);
                    Self::delete_round_completely(db, round_id).await?;
                } else if is_aggregate || is_streaming_or_queued {
                    let has_assistant: Option<i64> = sqlx::query_scalar(
                        "SELECT id FROM messages \
                         WHERE round_id = ? AND role = 'assistant' AND is_hidden = 0 \
                         LIMIT 1",
                    )
                    .bind(round_id)
                    .fetch_optional(db)
                    .await
                    .map_err(|err| err.to_string())?;

                    if has_assistant.is_some() {
                        eprintln!("[delete_message] user: has_assistant, setting completed");
                        sqlx::query(
                            "UPDATE message_rounds SET status = 'completed', aggregate_message_id = NULL, aggregated_user_content = NULL WHERE id = ?",
                        )
                        .bind(round_id)
                        .execute(db)
                        .await
                        .map_err(|err| err.to_string())?;
                    } else {
                        eprintln!("[delete_message] user: no assistant, deleting round {}", round_id);
                        Self::delete_round_completely(db, round_id).await?;
                    }
                }
            }
        } else {
            MessageRepository::delete_message(db, message_id).await?;
        }

        Ok(())
    }

    async fn delete_round_completely(db: &SqlitePool, round_id: i64) -> Result<(), String> {
        let message_ids: Vec<i64> = sqlx::query_scalar(
            "SELECT id FROM messages WHERE round_id = ?",
        )
        .bind(round_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        eprintln!(
            "[delete_message] delete_round_completely: round_id={}, deleting {} messages",
            round_id,
            message_ids.len()
        );

        for mid in &message_ids {
            sqlx::query("DELETE FROM message_content_parts WHERE message_id = ?")
                .bind(mid)
                .execute(db)
                .await
                .map_err(|err| err.to_string())?;
            sqlx::query("DELETE FROM message_tool_calls WHERE message_id = ?")
                .bind(mid)
                .execute(db)
                .await
                .map_err(|err| err.to_string())?;
        }

        sqlx::query("DELETE FROM messages WHERE round_id = ?")
            .bind(round_id)
            .execute(db)
            .await
            .map_err(|err| err.to_string())?;

        sqlx::query("DELETE FROM round_member_actions WHERE round_id = ?")
            .bind(round_id)
            .execute(db)
            .await
            .map_err(|err| err.to_string())?;

        sqlx::query("DELETE FROM message_rounds WHERE id = ?")
            .bind(round_id)
            .execute(db)
            .await
            .map_err(|err| err.to_string())?;

        eprintln!("[delete_message] delete_round_completely: round_id={} deleted", round_id);
        Ok(())
    }

    pub async fn retry_failed_round(
        app: AppHandle,
        db: SqlitePool,
        conversation_id: i64,
        member_id: i64,
        round_id: i64,
    ) -> Result<RetryFailedRoundResult, String> {
        ConversationRepository::ensure_member_is_host(&db, conversation_id, member_id).await?;

        let snapshot = RetrySnapshotRepository::load_by_round(&db, round_id)
            .await?
            .ok_or_else(|| "未找到该轮次的重试快照".to_string())?;

        if snapshot.status == "running" {
            return Err("该轮次正在重试中，请勿重复操作".to_string());
        }

        let assistant_message_id = snapshot.assistant_message_id;

        let now = now_ts();
        sqlx::query("UPDATE messages SET content = '' WHERE id = ?")
            .bind(assistant_message_id)
            .execute(&db)
            .await
            .map_err(|err| err.to_string())?;

        sqlx::query("DELETE FROM message_content_parts WHERE message_id = ?")
            .bind(assistant_message_id)
            .execute(&db)
            .await
            .map_err(|err| err.to_string())?;

        sqlx::query(
            "UPDATE message_rounds SET status = 'streaming', updated_at = ? WHERE id = ?",
        )
        .bind(now)
        .bind(round_id)
        .execute(&db)
        .await
        .map_err(|err| err.to_string())?;

        let round = RoundRepository::load_state(&db, conversation_id, Some(round_id)).await?;
        let assistant_message = MessageRepository::find_by_id(&db, assistant_message_id).await?;

        emit_round_state(&app, round.clone())?;
        emit_message_reset_event(&app, conversation_id, round_id, assistant_message_id)?;

        crate::services::stream_processor::spawn_stream_task(
            app,
            db,
            conversation_id,
            round_id,
            snapshot.provider_id,
            assistant_message_id,
            Vec::new(),
        );

        Ok(RetryFailedRoundResult {
            round,
            assistant_message,
            attempt_count: 0,
        })
    }

    pub async fn abort_round_stream(db: &SqlitePool, round_id: i64) -> Result<(), String> {
        RoundRepository::mark_aborted(db, round_id).await?;
        let _ = RetrySnapshotRepository::mark_aborted(db, round_id).await;
        Ok(())
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

pub fn emit_message_reset_event(
    app: &AppHandle,
    conversation_id: i64,
    round_id: i64,
    message_id: i64,
) -> Result<(), String> {
    emit_llm_stream_event(
        app,
        conversation_id,
        round_id,
        message_id,
        "",
        "message_reset",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
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
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
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
        prompt_tokens,
        completion_tokens,
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
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
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
        prompt_tokens,
        completion_tokens,
    )
}

pub async fn finalize_streamed_response(
    db: &SqlitePool,
    round_id: i64,
    assistant_message_id: i64,
    full_content: &str,
    content_parts: &[PendingMessageContentPart],
    validation_rules: &[RetryOutputValidatorSnapshot],
    prompt_tokens: Option<i64>,
) -> Result<(), String> {
    if full_content.is_empty() {
        return Err("LLM 响应为空".to_string());
    }

    let mut tx = db.begin().await.map_err(|err| err.to_string())?;

    sqlx::query("UPDATE messages SET content = ? WHERE id = ?")
        .bind(full_content)
        .bind(assistant_message_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

    if let Some(tokens) = prompt_tokens {
        sqlx::query("UPDATE messages SET actual_prompt_tokens = ? WHERE id = ? AND message_kind = 'assistant_visible'")
            .bind(tokens)
            .bind(assistant_message_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;
    }

    if let Err(err) = MessageRepository::replace_content_parts_tx(&mut tx, assistant_message_id, content_parts).await {
        eprintln!("[finalize_streamed_response] replace_content_parts failed: {}, round_id={}", err, round_id);
    }

    let now = crate::utils::now_ts();
    sqlx::query(
        "UPDATE message_rounds \
         SET status = 'completed', active_assistant_message_id = ?, updated_at = ?, completed_at = ? \
         WHERE id = ?",
    )
    .bind(assistant_message_id)
    .bind(now)
    .bind(now)
    .bind(round_id)
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    tx.commit().await.map_err(|err| err.to_string())?;

    validate_output_text_with_retry_snapshot(full_content, validation_rules)?;
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
    log_dir_override: Option<&std::path::Path>,
) {
    let timestamp = now_ts();
    let safe_model = model.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let filename = format!(
        "llm_req_{}_cid{}_rid{}_{}.json",
        timestamp, conversation_id, round_id, safe_model
    );

    let log_dir = if let Some(dir) = log_dir_override {
        dir.join("llm_debug_logs")
    } else {
        let mut dir = std::path::PathBuf::from(".");
        if let Ok(cargo_manifest) = std::env::var("CARGO_MANIFEST_DIR") {
            dir = std::path::PathBuf::from(&cargo_manifest)
                .parent()
                .unwrap()
                .to_path_buf();
        }
        dir.push("llm_debug_logs");
        dir
    };
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!("[llm-debug] failed to create log dir {}: {}", log_dir.display(), e);
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
                            crate::services::prompt_compiler::PromptBlockSource::Player { character_id } => {
                                serde_json::json!({"type": "player", "character_id": character_id})
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

use tauri::{AppHandle, Manager};

use crate::models::{
    ChatAttachment, ChatSubmitInputResult, RegenerateRoundResult, RetryFailedRoundResult,
    RoundState, TokenUsageReport, UiMessage,
};
use crate::repositories::conversation_repository::ConversationRepository;
use crate::repositories::round_repository::RoundRepository;
use crate::services::chat::capability_guard;
use crate::services::chat::mode::{OpCapability, Operation};
use crate::services::chat_service::ChatService;
use crate::services::prompt_compiler::compile_token_usage_report;
use crate::AppState;

#[tauri::command]
pub async fn messages_list(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    limit: Option<i64>,
) -> Result<Vec<UiMessage>, String> {
    ChatService::list_messages(&state.db, conversation_id, limit).await
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    provider_id: i64,
    content: String,
    attachments: Option<Vec<ChatAttachment>>,
) -> Result<ChatSubmitInputResult, String> {
    let host_member_id =
        ConversationRepository::find_host_member_id(&state.db, conversation_id).await?;
    capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(host_member_id),
        Operation::Send,
    )
    .await?;
    ChatService::submit_input(
        app,
        state.db.clone(),
        conversation_id,
        host_member_id,
        content,
        Some(provider_id),
        attachments.unwrap_or_default(),
    )
    .await
}

#[tauri::command]
pub async fn chat_submit_input(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    content: String,
    attachments: Option<Vec<ChatAttachment>>,
) -> Result<ChatSubmitInputResult, String> {
    capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(member_id),
        Operation::Send,
    )
    .await?;
    ChatService::submit_input(
        app,
        state.db.clone(),
        conversation_id,
        member_id,
        content,
        None,
        attachments.unwrap_or_default(),
    )
    .await
}

#[tauri::command]
pub async fn regenerate_message(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    provider_id: i64,
    reply_to_id: i64,
) -> Result<RegenerateRoundResult, String> {
    capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(member_id),
        Operation::Regenerate,
    )
    .await?;
    ConversationRepository::ensure_member_is_host(&state.db, conversation_id, member_id).await?;
    let round_id =
        ChatService::resolve_round_id_from_reply_to(&state.db, conversation_id, reply_to_id)
            .await?;
    ChatService::regenerate_round(
        app,
        state.db.clone(),
        conversation_id,
        round_id,
        Some(provider_id),
    )
    .await
}

#[tauri::command]
pub async fn chat_regenerate_round(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    round_id: i64,
) -> Result<RegenerateRoundResult, String> {
    capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(member_id),
        Operation::Regenerate,
    )
    .await?;
    ConversationRepository::ensure_member_is_host(&state.db, conversation_id, member_id).await?;
    ChatService::regenerate_round(app, state.db.clone(), conversation_id, round_id, None).await
}

#[tauri::command]
pub async fn chat_submit_tool_result(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    round_id: i64,
    tool_use_id: String,
    content: String,
    is_error: bool,
) -> Result<serde_json::Value, String> {
    ChatService::submit_tool_result(
        app,
        state.db.clone(),
        conversation_id,
        round_id,
        tool_use_id,
        content,
        is_error,
    )
    .await
}

#[tauri::command]
pub async fn round_state_get(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
) -> Result<RoundState, String> {
    crate::repositories::round_repository::RoundRepository::load_state(
        &state.db,
        conversation_id,
        None,
    )
    .await
}

#[tauri::command]
pub async fn messages_update_content(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    message_id: i64,
    content: String,
) -> Result<(), String> {
    capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(member_id),
        Operation::Edit,
    )
    .await?;
    ChatService::update_message_content(&state.db, &app, conversation_id, member_id, message_id, content)
        .await
}

#[tauri::command]
pub async fn messages_switch_swipe(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    round_id: i64,
    target_message_id: i64,
) -> Result<UiMessage, String> {
    capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(member_id),
        Operation::Edit,
    )
    .await?;
    ChatService::switch_swipe(&state.db, conversation_id, member_id, round_id, target_message_id)
        .await
}

#[tauri::command]
pub async fn messages_delete(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    message_id: i64,
) -> Result<(), String> {
    capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(member_id),
        Operation::Delete,
    )
    .await?;
    ChatService::delete_message(&state.db, &app, conversation_id, member_id, message_id).await
}

#[tauri::command]
pub async fn abort_round_stream(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    round_id: i64,
) -> Result<(), String> {
    capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(member_id),
        Operation::SubmitAbort,
    )
    .await?;
    ChatService::abort_round_stream(&state.db, conversation_id, member_id, round_id).await
}

#[tauri::command]
pub async fn retry_failed_round(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    round_id: i64,
) -> Result<RetryFailedRoundResult, String> {
    capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(member_id),
        Operation::Regenerate,
    )
    .await?;
    ChatService::retry_failed_round(app, state.db.clone(), conversation_id, member_id, round_id)
        .await
}

#[tauri::command]
pub async fn get_conversation_token_usage(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
) -> Result<TokenUsageReport, String> {
    compile_token_usage_report(&state.db, conversation_id).await
}

#[tauri::command]
pub async fn update_conversation_context_window(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    context_window_size: i64,
) -> Result<(), String> {
    let provider_id: Option<i64> = sqlx::query_scalar(
        "SELECT provider_id FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?
    .flatten();

    let provider_id = provider_id
        .filter(|id| *id > 0)
        .ok_or_else(|| "会话未关联 API Provider".to_string())?;

    sqlx::query("UPDATE api_providers SET max_context_tokens = ? WHERE id = ?")
        .bind(context_window_size)
        .bind(provider_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let app_state = app.state::<crate::AppState>();
            let host_server = app_state.host_server.lock().await;
            if let Some(server) = host_server.as_ref() {
                let server = server.lock().await;
                let msg = crate::network::RoomMessage::ContextWindowChanged {
                    conversation_id,
                    context_window_size,
                };
                server.broadcast_message(&msg).await;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn rewind_to_round(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    target_round_id: i64,
) -> Result<(), String> {
    let mode = capability_guard::resolve_and_check(
        &state.db,
        conversation_id,
        Some(member_id),
        Operation::Rewind,
    )
    .await?;

    // SnapshotLimited 操作额外校验快照
    if mode.capabilities().get(Operation::Rewind) == OpCapability::SnapshotLimited {
        let (round_conv_id, round_index, _) =
            RoundRepository::find_round_meta(&state.db, target_round_id).await?;
        if round_conv_id != conversation_id {
            return Err(format!("轮次不属于当前会话: round_id={}", target_round_id));
        }
        capability_guard::check_snapshot_limited(&state.db, conversation_id, round_index).await?;
    }

    ChatService::rewind_to_round(state.db.clone(), &app, conversation_id, member_id, target_round_id)
        .await
}

/// 解析会话的能力模式，返回与前端 `ConversationMode` 类型对齐的 snake_case 字符串。
///
/// single 模式可省略 `member_id`；online 模式必须提供 `member_id` 以区分房主/房客。
/// 错误信息中的反斜杠会被替换为正斜杠，防止跨 IPC 的 JSON 解析问题。
#[tauri::command]
pub async fn resolve_conversation_mode(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: Option<i64>,
) -> Result<String, String> {
    let mode = capability_guard::resolve_mode(&state.db, conversation_id, member_id)
        .await
        .map_err(|e| e.replace('\\', "/"))?;
    Ok(mode.as_str().to_string())
}

use tauri::AppHandle;

use crate::models::{
    ChatAttachment, ChatSubmitInputResult, RegenerateRoundResult, RoundState, UiMessage,
};
use crate::repositories::conversation_repository::ConversationRepository;
use crate::services::chat_service::ChatService;
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
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    message_id: i64,
    content: String,
) -> Result<(), String> {
    ChatService::update_message_content(&state.db, conversation_id, member_id, message_id, content)
        .await
}

#[tauri::command]
pub async fn messages_switch_swipe(
    state: tauri::State<'_, AppState>,
    round_id: i64,
    target_message_id: i64,
) -> Result<UiMessage, String> {
    ChatService::switch_swipe(&state.db, round_id, target_message_id).await
}

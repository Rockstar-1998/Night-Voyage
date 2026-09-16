use tauri::{AppHandle, State};

use crate::models::game_state::DataContainer;
use crate::services::agent_guards::{BannedWordsFilter, BannedWordsViolation, DiceRollResult};
use crate::services::agent_runtime::{
    broadcast_hud_patch, execute_tool_call, load_session_state, reset_session_state, save_session_state,
};
use crate::AppState;

/// 获取会话当前的数据容器 (DataContainer / GameState)
#[tauri::command]
pub async fn session_game_state_get(
    session_id: i64,
    state: State<'_, AppState>,
) -> Result<DataContainer, String> {
    load_session_state(&state.db, session_id).await
}

/// 保存会话的数据容器并广播 HUD 原地刷新
#[tauri::command]
pub async fn session_game_state_save(
    session_id: i64,
    data: DataContainer,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    save_session_state(&state.db, session_id, &data).await?;
    broadcast_hud_patch(&app, session_id, &data, None);
    Ok(())
}

/// 重置会话的数据容器为初始默认状态
#[tauri::command]
pub async fn session_game_state_reset(
    session_id: i64,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<DataContainer, String> {
    let new_state = reset_session_state(&state.db, session_id).await?;
    broadcast_hud_patch(&app, session_id, &new_state, None);
    Ok(new_state)
}

/// 手动或由 Agent 触发执行 ToolCall 契约
#[tauri::command]
pub async fn session_tool_call_execute(
    session_id: i64,
    tool_name: String,
    arguments_json: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    execute_tool_call(&state.db, &app, session_id, &tool_name, &arguments_json).await
}

/// 执行确定性 D20 骰点检定
#[tauri::command]
pub fn agent_dice_roll(skill: String, dc: i64, modifier: i64) -> Result<DiceRollResult, String> {
    Ok(DiceRollResult::roll(&skill, dc, modifier))
}

/// 执行 Aho-Corasick 禁词检定
#[tauri::command]
pub fn agent_validate_banned_words(
    text: String,
    custom_words: Option<Vec<String>>,
) -> Result<(), BannedWordsViolation> {
    let filter = BannedWordsFilter::new_with_custom(&custom_words.unwrap_or_default())
        .map_err(|e| BannedWordsViolation {
            matched_words: vec![],
            feedback_instruction: e,
        })?;
    filter.validate(&text)
}

use serde::Serialize;

use crate::repositories::conversation_gate_repository::ConversationGateRepository;
use crate::repositories::conversation_gate_repository::ConversationGateSelection;
use crate::AppState;

/// IPC 传输用的 Gate 选择 DTO。字段以 camelCase 序列化，供前端直接消费。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationGateSelectionDto {
    pub conversation_id: i64,
    pub gate_id: String,
    pub selected_keys: Vec<String>,
}

impl From<ConversationGateSelection> for ConversationGateSelectionDto {
    fn from(sel: ConversationGateSelection) -> Self {
        Self {
            conversation_id: sel.conversation_id,
            gate_id: sel.gate_id,
            selected_keys: sel.selected_keys,
        }
    }
}

/// 更新（或清除）某会话下指定 Gate 的选择。当 `selected_keys` 为空时，
/// 仓库层会删除对应行，回到未配置状态。
#[tauri::command]
pub async fn update_gate_selection(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    gate_id: String,
    selected_keys: Vec<String>,
) -> Result<(), String> {
    ConversationGateRepository::upsert(
        &state.db,
        conversation_id,
        &gate_id,
        &selected_keys,
    )
    .await
    .map_err(|err| err.replace('\\', "/"))?;
    Ok(())
}

/// 加载某会话下的全部 Gate 选择，按 gate_id 升序返回。
#[tauri::command]
pub async fn load_gate_selections(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
) -> Result<Vec<ConversationGateSelectionDto>, String> {
    let selections = ConversationGateRepository::load_by_conversation(&state.db, conversation_id)
        .await
        .map_err(|err| err.replace('\\', "/"))?;
    Ok(selections.into_iter().map(ConversationGateSelectionDto::from).collect())
}

/// 清除某会话下指定 Gate 的选择（用户取消选择时调用）。幂等。
#[tauri::command]
pub async fn clear_gate_selection(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    gate_id: String,
) -> Result<(), String> {
    ConversationGateRepository::delete(&state.db, conversation_id, &gate_id)
        .await
        .map_err(|err| err.replace('\\', "/"))?;
    Ok(())
}

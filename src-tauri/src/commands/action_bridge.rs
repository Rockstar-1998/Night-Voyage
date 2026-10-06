//! 动作白名单的设置页读写命令（C10：白名单是设置数据，界面可增删）。
//!
//! M4 的设置页面板与 L3 动作件消费这些命令；M1 先把数据通路打通。

use serde_json::Value;
use tauri::State;

use crate::services::action_bridge;
use crate::AppState;

/// 读取动作命令白名单。
#[tauri::command]
pub async fn action_bridge_whitelist_get(state: State<'_, AppState>) -> Result<Value, String> {
    let commands = action_bridge::load_whitelist(&state.db).await?;
    Ok(serde_json::json!({ "commands": commands }))
}

/// 覆盖保存动作命令白名单。
#[tauri::command]
pub async fn action_bridge_whitelist_set(
    state: State<'_, AppState>,
    commands: Vec<String>,
) -> Result<(), String> {
    action_bridge::save_whitelist(&state.db, &commands).await
}

/// 前端动作件（HUD ActionButton / 产物卡按钮）点击入口：
/// 白名单校验 + 后端分发，返回结果 JSON（供 `result_schema_id` 资产渲染产物卡）。
#[tauri::command]
pub async fn action_bridge_invoke(
    state: State<'_, AppState>,
    conversation_id: i64,
    command: String,
    args: Value,
) -> Result<Value, String> {
    action_bridge::invoke(&state.db, conversation_id, &command, &args).await
}

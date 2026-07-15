use serde::Serialize;

use crate::models::blueprint::{BlueprintGraph, GateOption, GroupGateConfig, MutexGateConfig, NodeConfig};
use crate::repositories::preset_gate_repository::PresetGateRepository;
use crate::repositories::preset_gate_repository::PresetGateSelection;
use crate::AppState;

/// IPC 传输用的预设级 Gate 选择 DTO。字段以 camelCase 序列化，供前端直接消费。
///
/// 替代已废弃的 `ConversationGateSelectionDto`：Gate 选择从"会话级运行时"改为
/// "预设级配置期"，所有使用该预设的会话共享同一套选择。`node_id` 直接使用蓝图
/// 节点 ID（Gate 节点本身即分组单位，`gate_id` 字段已移除）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetGateSelectionDto {
    pub preset_id: i64,
    pub node_id: String,
    pub selected_keys: Vec<String>,
}

impl From<PresetGateSelection> for PresetGateSelectionDto {
    fn from(sel: PresetGateSelection) -> Self {
        Self {
            preset_id: sel.preset_id,
            node_id: sel.node_id,
            selected_keys: sel.selected_keys,
        }
    }
}

/// IPC 传输用的蓝图 Gate 节点 DTO，供预设详情视图渲染选择 UI。
///
/// `kind` 取值 `"mutex"` / `"group"`，对应 MutexGate / GroupGate 节点类型。
/// 其他节点类型（Prompt / SchemaField / ModeSwitch / RoleSwitch / SamplingParams）
/// 不暴露给用户选择，故不在此 DTO 中。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintGateDto {
    pub node_id: String,
    pub kind: String,
    pub label: String,
    pub options: Vec<BlueprintGateOptionDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintGateOptionDto {
    pub key: String,
    pub label: String,
    pub description: Option<String>,
}

impl From<&GateOption> for BlueprintGateOptionDto {
    fn from(opt: &GateOption) -> Self {
        Self {
            key: opt.key.clone(),
            label: opt.label.clone(),
            description: opt.description.clone(),
        }
    }
}

/// 更新（或清除）某预设下指定 Gate 节点的选择。当 `selected_keys` 为空时，
/// 仓库层会删除对应行，回到未配置状态。
#[tauri::command]
pub async fn update_preset_gate_selection(
    state: tauri::State<'_, AppState>,
    preset_id: i64,
    node_id: String,
    selected_keys: Vec<String>,
) -> Result<(), String> {
    PresetGateRepository::upsert(&state.db, preset_id, &node_id, &selected_keys)
        .await
        .map_err(|err| err.replace('\\', "/"))?;
    Ok(())
}

/// 加载某预设下的全部 Gate 选择，按 node_id 升序返回。
#[tauri::command]
pub async fn load_preset_gate_selections(
    state: tauri::State<'_, AppState>,
    preset_id: i64,
) -> Result<Vec<PresetGateSelectionDto>, String> {
    let selections = PresetGateRepository::load_by_preset(&state.db, preset_id)
        .await
        .map_err(|err| err.replace('\\', "/"))?;
    Ok(selections.into_iter().map(PresetGateSelectionDto::from).collect())
}

/// 清除某预设下指定 Gate 节点的选择（用户取消选择时调用）。幂等。
#[tauri::command]
pub async fn clear_preset_gate_selection(
    state: tauri::State<'_, AppState>,
    preset_id: i64,
    node_id: String,
) -> Result<(), String> {
    PresetGateRepository::delete(&state.db, preset_id, &node_id)
        .await
        .map_err(|err| err.replace('\\', "/"))?;
    Ok(())
}

/// 加载某预设蓝图中的全部 Gate 节点定义，供预设详情视图渲染选择 UI。
///
/// 仅返回 MutexGate / GroupGate 节点（kind 分别为 `"mutex"` / `"group"`）。
/// 蓝图 JSON 缺失或解析失败按 C2 零回退原则显式报错。
#[tauri::command]
pub async fn load_blueprint_gates(
    state: tauri::State<'_, AppState>,
    preset_id: i64,
) -> Result<Vec<BlueprintGateDto>, String> {
    let blueprint_graph_str: Option<String> = sqlx::query_scalar(
        "SELECT blueprint_graph FROM presets WHERE id = ? LIMIT 1",
    )
    .bind(preset_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string().replace('\\', "/"))?;

    let graph_str = blueprint_graph_str
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("preset {preset_id} has no blueprint_graph"))?;

    let graph: BlueprintGraph = serde_json::from_str(&graph_str).map_err(|err| {
        format!(
            "blueprint_graph JSON invalid for preset {preset_id}: {}",
            err.to_string().replace('\\', "/")
        )
    })?;

    let gates: Vec<BlueprintGateDto> = graph
        .nodes
        .iter()
        .filter_map(|node| match &node.config {
            NodeConfig::MutexGate(MutexGateConfig { label, options }) => Some(BlueprintGateDto {
                node_id: node.id.clone(),
                kind: "mutex".to_string(),
                label: label.clone(),
                options: options.iter().map(BlueprintGateOptionDto::from).collect(),
            }),
            NodeConfig::GroupGate(GroupGateConfig { label, options }) => Some(BlueprintGateDto {
                node_id: node.id.clone(),
                kind: "group".to_string(),
                label: label.clone(),
                options: options.iter().map(BlueprintGateOptionDto::from).collect(),
            }),
            _ => None,
        })
        .collect();

    Ok(gates)
}

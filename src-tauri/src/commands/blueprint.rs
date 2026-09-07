use std::collections::HashMap;
use serde::Serialize;

use crate::models::blueprint::{
    BlueprintCompilePreviewDto, BlueprintExecutionContext, BlueprintGraph, BlueprintPreviewBlockDto,
    GateOption, GateSelection, GroupGateConfig, MutexGateConfig, NodeConfig, PresetConversationOptionDto,
};
use crate::repositories::conversation_repository::ConversationRepository;
use crate::repositories::preset_gate_repository::PresetGateRepository;
use crate::repositories::preset_gate_repository::PresetGateSelection;
use crate::services::blueprint_executor::{execute_blueprint, normalize_legacy_value_edges};
use crate::AppState;

/// IPC DTO：归一化后的蓝图图 JSON。
///
/// `migrated` 为 true 表示拓扑被改写过（旧图升级为 value 引脚数据流），
/// 前端应提示用户保存，让迁移真正落库。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedBlueprintGraphDto {
    pub graph_json: String,
    pub migrated: bool,
}

/// 归一化蓝图图 JSON：把旧拓扑（Constant 串在 exec 链上）改写为
/// 「上游 → Branch(in)」+「Constant → Branch(value)」的 value 引脚数据流拓扑。
///
/// 拓扑改写是业务规则，留在后端（C1）；前端只负责渲染与提示保存，不在前端
/// 复制一套改写逻辑。`migrated = true` 必须可见地告知用户，禁止静默迁移（C2）。
#[tauri::command]
pub async fn normalize_blueprint_graph(
    graph_json: String,
) -> Result<NormalizedBlueprintGraphDto, String> {
    let mut graph: BlueprintGraph = serde_json::from_str(&graph_json).map_err(|err| {
        format!(
            "blueprint_graph JSON invalid: {}",
            err.to_string().replace('\\', "/")
        )
    })?;

    let migrated = normalize_legacy_value_edges(&mut graph) > 0;

    let normalized = serde_json::to_string(&graph)
        .map_err(|err| format!("blueprint_graph serialization failed: {err}"))?;

    Ok(NormalizedBlueprintGraphDto {
        graph_json: normalized,
        migrated,
    })
}

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
///
/// 空状态语义：预设尚未创建蓝图（`blueprint_graph` 为 NULL 或空串）是合法
/// 状态，返回空 vec，由前端渲染空状态提示。这**不是** C2 违规——C2 禁止
/// 吞掉意外错误，而非把"本就为空"正确表达为空集合。仅当 `blueprint_graph`
/// 非空但 JSON 解析失败（数据损坏）时才显式报错。
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
        .filter(|s| !s.is_empty());

    // 预设无蓝图 → 合法空状态，返回空 vec（非错误）
    let graph_str = match graph_str {
        Some(s) => s,
        None => return Ok(Vec::new()),
    };

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
            NodeConfig::Start => None,
            NodeConfig::End => None,
            NodeConfig::Prompt(_) => None,
            NodeConfig::SchemaField(_) => None,
            NodeConfig::ModeSwitch(_) => None,
            NodeConfig::RoleSwitch(_) => None,
            NodeConfig::SamplingParams(_) => None,
            NodeConfig::SamplingParamsOpenAi(_) => None,
            NodeConfig::SamplingParamsAnthropic(_) => None,
            NodeConfig::Constant(_) => None,
            NodeConfig::Branch(_) => None,
        })
        .collect();

    Ok(gates)
}

/// 列出与该预设关联（或近期活跃）的会话，供蓝图编译预览选择真实运行上下文。
#[tauri::command]
pub async fn list_preset_conversations(
    state: tauri::State<'_, AppState>,
    preset_id: i64,
) -> Result<Vec<PresetConversationOptionDto>, String> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        title: String,
        conversation_type: String,
        memory_mode: String,
        provider_kind: Option<String>,
        updated_at: i64,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT c.id, c.title, c.conversation_type, c.memory_mode, c.updated_at, \
                ap.provider_kind \
         FROM conversations c \
         LEFT JOIN api_providers ap ON ap.id = c.provider_id \
         ORDER BY (CASE WHEN c.preset_id = ? THEN 1 ELSE 0 END) DESC, c.updated_at DESC \
         LIMIT 20",
    )
    .bind(preset_id)
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| PresetConversationOptionDto {
            id: r.id,
            title: r.title,
            conversation_type: r.conversation_type,
            memory_mode: r.memory_mode,
            protocol: if r.provider_kind.as_deref() == Some("anthropic") {
                "anthropic".to_string()
            } else {
                "chat_completions".to_string()
            },
            updated_at: r.updated_at,
        })
        .collect())
}

/// 基于真实会话运行环境（或默认环境）预览编译当前画布上的蓝图图。
/// 产出纯净的文本块列表，每个块携带其对应的蓝图节点元数据与整体 Schema。
#[tauri::command]
pub async fn preview_blueprint_with_session(
    state: tauri::State<'_, AppState>,
    preset_id: i64,
    graph_json: String,
    conversation_id: Option<i64>,
) -> Result<BlueprintCompilePreviewDto, String> {
    let graph: BlueprintGraph = serde_json::from_str(&graph_json).map_err(|err| {
        format!(
            "blueprint_graph JSON invalid: {}",
            err.to_string().replace('\\', "/")
        )
    })?;

    let mut memory_mode = "stateless".to_string();
    let mut conversation_type = "single".to_string();
    let mut protocol = "chat_completions".to_string();
    let mut char_name: Option<String> = None;
    let mut gate_selections: HashMap<String, GateSelection> = HashMap::new();

    if let Some(cid) = conversation_id {
        #[derive(sqlx::FromRow)]
        struct ConvRow {
            conversation_type: String,
            memory_mode: String,
            character_id: Option<i64>,
        }

        if let Ok(Some(row)) = sqlx::query_as::<_, ConvRow>(
            "SELECT conversation_type, memory_mode, COALESCE(character_id, host_character_id) AS character_id FROM conversations WHERE id = ?",
        )
        .bind(cid)
        .fetch_optional(&state.db)
        .await
        {
            memory_mode = row.memory_mode;
            conversation_type = row.conversation_type;
            if let Some(char_id) = row.character_id {
                if let Ok(Some(name)) = sqlx::query_scalar::<_, String>(
                    "SELECT name FROM character_cards WHERE id = ?",
                )
                .bind(char_id)
                .fetch_optional(&state.db)
                .await
                {
                    char_name = Some(name);
                }
            }
        }

        protocol = ConversationRepository::resolve_conversation_protocol(&state.db, cid).await;

        #[derive(sqlx::FromRow)]
        struct GateRow {
            node_id: String,
            selected_keys: String,
        }

        if let Ok(rows) = sqlx::query_as::<_, GateRow>(
            "SELECT node_id, selected_keys FROM conversation_gate_selections WHERE conversation_id = ?",
        )
        .bind(cid)
        .fetch_all(&state.db)
        .await
        {
            for r in rows {
                if let Ok(keys) = serde_json::from_str::<Vec<String>>(&r.selected_keys) {
                    gate_selections.insert(r.node_id, GateSelection { keys });
                }
            }
        }
    }

    if gate_selections.is_empty() {
        if let Ok(preset_selections) = PresetGateRepository::load_by_preset(&state.db, preset_id).await {
            for sel in preset_selections {
                gate_selections.insert(sel.node_id, GateSelection { keys: sel.selected_keys });
            }
        }
    }

    let exec_context = BlueprintExecutionContext {
        memory_mode,
        conversation_type,
        protocol,
        gate_selections,
    };

    let blueprint_result = execute_blueprint(&graph, &exec_context)
        .await
        .map_err(|err| err.to_string().replace('\\', "/"))?;

    let mut blocks = Vec::new();
    let mut full_text_parts = Vec::new();

    for compiled in &blueprint_result.blocks {
        let mut text = compiled.content.clone();
        if let Some(ref cn) = char_name {
            text = text.replace("{{char}}", cn).replace("{{char_name}}", cn);
        }

        let node_label = graph
            .nodes
            .iter()
            .find(|n| Some(&n.id) == compiled.node_id.as_ref())
            .map(|n| match &n.config {
                NodeConfig::Prompt(cfg) => cfg.identifier.clone(),
                NodeConfig::SchemaField(cfg) => cfg.field_name.clone(),
                NodeConfig::MutexGate(cfg) => cfg.label.clone(),
                NodeConfig::GroupGate(cfg) => cfg.label.clone(),
                _ => n.id.clone(),
            })
            .unwrap_or_else(|| compiled.identifier.clone());

        if !text.trim().is_empty() {
            full_text_parts.push(text.clone());
        }

        blocks.push(BlueprintPreviewBlockDto {
            source_kind: "blueprint".to_string(),
            node_id: compiled.node_id.clone(),
            node_label: Some(node_label),
            identifier: compiled.identifier.clone(),
            content: text,
        });
    }

    let full_prompt_text = full_text_parts.join("\n\n");

    Ok(BlueprintCompilePreviewDto {
        blocks,
        structured_output_schema: blueprint_result.structured_output_schema,
        full_prompt_text,
    })
}

use std::collections::HashMap;
use serde::Serialize;

use crate::models::blueprint::{
    BlueprintCompilePreviewDto, BlueprintExecutionContext, BlueprintGraph, BlueprintPreviewBlockDto,
    ContractValidationResultDto, GateOption, GateSelection, GroupGateConfig, MutexGateConfig, NodeConfig,
    PresetConversationOptionDto,
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

/// IPC DTO：`.nv.ts` 导入结果（字段 camelCase 序列化）。
///
/// `graph_json` 为导入并归一化后的图 JSON，前端导入入口可免二次取数直接应用新图。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPresetCodeDto {
    pub message: String,
    pub bytes: usize,
    pub migrated: bool,
    pub graph_json: String,
}

/// 把预设蓝图图导出为 `.nv.ts` 代码（工单 05）。
///
/// MCP 工具 `nv_preset_export_code` 与前端「导出 .nv.ts」按钮共用本路径
/// （C10：前端挂载必须调用与 MCP 相同的后端服务）。
pub async fn export_preset_code(db: &sqlx::SqlitePool, preset_id: i64) -> Result<String, String> {
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT name, blueprint_graph FROM presets WHERE id = ? LIMIT 1",
    )
    .bind(preset_id)
    .fetch_optional(db)
    .await
    .map_err(|err| format!("读取预设失败: {}", err).replace('\\', "/"))?;
    let Some((preset_name, graph_json)) = row else {
        return Err(format!("预设 {preset_id} 不存在"));
    };
    let graph_json = graph_json.ok_or_else(|| format!("预设 {preset_id} 尚未保存蓝图图"))?;
    let graph: BlueprintGraph = serde_json::from_str(&graph_json)
        .map_err(|err| format!("蓝图图不是合法的图数据: {}", err).replace('\\', "/"))?;
    crate::services::blueprint_codec::export_graph_to_code(&graph, &preset_name)
}

/// 把 `.nv.ts` 代码导入为预设蓝图图并广播刷新事件（工单 05）。
///
/// MCP 工具 `nv_preset_import_code` 与前端「导入 .nv.ts」按钮共用本路径（C10）。
/// 广播失败必须显式报错（C2）：数据已落库但刷新信号未发出，调用方必须知道
/// 视图与库可能不一致，禁止 `let _ =` 吞错。
pub async fn import_preset_code(
    app: &tauri::AppHandle,
    db: &sqlx::SqlitePool,
    preset_id: i64,
    code: &str,
) -> Result<ImportedPresetCodeDto, String> {
    // 前向编译：oxc 解析 .nv.ts -> BlueprintGraph（模型层校验合法性）
    let graph = crate::services::blueprint_codec::import_code_to_graph(code)?;
    let graph_json = serde_json::to_string(&graph)
        .map_err(|err| format!("编译出的图序列化失败: {}", err).replace('\\', "/"))?;

    // 与编辑器保存同一条归一化校验路径，非法图不落库
    let normalized = normalize_blueprint_graph(graph_json).await?;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("取当前时间失败: {}", err).replace('\\', "/"))?
        .as_millis() as i64;

    let rows = sqlx::query("UPDATE presets SET blueprint_graph = ?, updated_at = ? WHERE id = ?")
        .bind(normalized.graph_json.clone())
        .bind(now_ms)
        .bind(preset_id)
        .execute(db)
        .await
        .map_err(|err| format!("保存蓝图图失败: {}", err).replace('\\', "/"))?;
    if rows.rows_affected() == 0 {
        return Err(format!("预设 {preset_id} 不存在，.nv.ts 未导入"));
    }

    // 广播视图刷新事件（spec §4：导入后 emit blueprint:refreshed）
    {
        use tauri::Emitter;
        app.emit(
            "blueprint:refreshed",
            serde_json::json!({ "presetId": preset_id }),
        )
        .map_err(|err| {
            format!(
                ".nv.ts 已写入预设 {preset_id} 的蓝图图，但 blueprint:refreshed 广播失败: {}（前端视图可能未刷新，请重新打开蓝图编辑器核对）",
                err.to_string().replace('\\', "/")
            )
        })?;
    }

    Ok(ImportedPresetCodeDto {
        message: format!(
            "已把 .nv.ts 导入预设 {preset_id} 的蓝图图（{} 字节，拓扑迁移={}），并已广播 blueprint:refreshed。",
            normalized.graph_json.len(),
            normalized.migrated
        ),
        bytes: normalized.graph_json.len(),
        migrated: normalized.migrated,
        graph_json: normalized.graph_json,
    })
}

/// 前端命令：导出预设蓝图图为 `.nv.ts` 代码（与 MCP `nv_preset_export_code` 同服务路径）。
#[tauri::command]
pub async fn blueprint_export_preset_code(
    state: tauri::State<'_, AppState>,
    preset_id: i64,
) -> Result<String, String> {
    export_preset_code(&state.db, preset_id).await
}

/// 前端命令：把 `.nv.ts` 代码导入为预设蓝图图（与 MCP `nv_preset_import_code` 同服务路径）。
#[tauri::command]
pub async fn blueprint_import_preset_code(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    preset_id: i64,
    code: String,
) -> Result<ImportedPresetCodeDto, String> {
    import_preset_code(&app, &state.db, preset_id, &code).await
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
            NodeConfig::InvokeSchema(_) => None,
            NodeConfig::ToolDefinition(_) => None,
            NodeConfig::Calculator(_) => None,
            NodeConfig::ConditionGate(_) => None,
            NodeConfig::ToolReturn(_) => None,
            NodeConfig::Inspector(_) => None,
            NodeConfig::Writer(_) => None,
            NodeConfig::Querier(_) => None,
            NodeConfig::BannedWordsConfig(_) => None,
            NodeConfig::ScriptwriterPipeline(_) => None,
            NodeConfig::AgentModeSwitch(_) => None,
            NodeConfig::DirectorConfig(_) => None,
            NodeConfig::ActorDefinition(_) => None,
            NodeConfig::UiLayoutConfig(_) => None,
            NodeConfig::InitialStateConfig(_) => None,
            NodeConfig::MacroInstance(_) => None,
            NodeConfig::MacroInputs(_) => None,
            NodeConfig::MacroOutputs(_) => None,
            NodeConfig::StepBudget(_) => None,
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
    .map_err(|err| err.to_string().replace('\\', "/"))?;

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

    let mut memory_mode = "legacy".to_string();
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
        let preset_selections = PresetGateRepository::load_by_preset(&state.db, preset_id)
            .await
            .map_err(|e| format!("加载 preset_selections 失败: {}", e).replace('\\', "/"))?;
        for sel in preset_selections {
            gate_selections.insert(sel.node_id, GateSelection { keys: sel.selected_keys });
        }
    }

    let mut preset_schemas = HashMap::new();
    let schema_list = crate::commands::schema::query_preset_schemas(&state.db, preset_id)
        .await
        .map_err(|e| format!("查询 preset_schemas 失败: {}", e).replace('\\', "/"))?;

    for s in schema_list {
        preset_schemas.insert(s.id.clone(), s);
    }

    let exec_context = BlueprintExecutionContext {
        memory_mode,
        conversation_type,
        protocol,
        gate_selections,
        preset_schemas,
        game_state: None,
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

    // 编译预览要能回答"我的工具与 HUD 到底激活了没有"：把激活项与执行计划一并带出。
    let active_tools = blueprint_result
        .active_tools
        .iter()
        .map(|tool| crate::models::blueprint::BlueprintPreviewToolDto {
            tool_name: tool.tool_name.clone(),
            description: tool.description.clone(),
        })
        .collect();

    let mut tool_plans: Vec<crate::models::blueprint::BlueprintPreviewToolPlanDto> = blueprint_result
        .tool_plans
        .values()
        .map(|plan| crate::models::blueprint::BlueprintPreviewToolPlanDto {
            tool_name: plan.tool_name.clone(),
            steps: plan
                .steps
                .iter()
                .map(|step| match step {
                    crate::models::tool_plan::ToolStep::Calculate(cfg) => {
                        format!("calc: {} {} {}", cfg.target, cfg.op, cfg.operand_a)
                    }
                    crate::models::tool_plan::ToolStep::Gate(cfg) => {
                        format!("gate: {} {}", cfg.gate_type, cfg.expression)
                    }
                    crate::models::tool_plan::ToolStep::Inspect(cfg) => {
                        format!("inspect: {} {}", cfg.inspect_kind, cfg.key_expr)
                    }
                    crate::models::tool_plan::ToolStep::Query(cfg) => {
                        format!("query: {} (白名单命令)", cfg.command)
                    }
                    crate::models::tool_plan::ToolStep::Write(cfg) => {
                        format!("write: {} <= {}", cfg.key_expr, cfg.value_template)
                    }
                })
                .collect(),
            has_return_template: plan
                .success_return
                .as_ref()
                .map(|cfg| !cfg.return_template.trim().is_empty())
                .unwrap_or(false),
        })
        .collect();
    tool_plans.sort_by(|a, b| a.tool_name.cmp(&b.tool_name));

    Ok(BlueprintCompilePreviewDto {
        blocks,
        structured_output_schema: blueprint_result.structured_output_schema,
        full_prompt_text,
        active_tools,
        active_ui_layout: blueprint_result.active_ui_layout,
        tool_plans,
    })
}

/// 静态校验蓝图图数据定义与 UI 数据契约（Ticket 01 & spec §1）。
///
/// 创作者在前端设计 UI 控件并绑定 `stats.*` / `flags.*` / `inventory` 时，
/// 后端以此命令进行静态对比，如果字段缺失或上下限越界则返回结构化错误。
#[tauri::command]
pub async fn blueprint_validate_ui_contract(
    state: tauri::State<'_, AppState>,
    preset_id: i64,
    graph_json: String,
) -> Result<ContractValidationResultDto, String> {
    let graph: BlueprintGraph = serde_json::from_str(&graph_json).map_err(|err| {
        format!(
            "blueprint_graph JSON invalid: {}",
            err.to_string().replace('\\', "/")
        )
    })?;

    let layout_interface = match crate::services::preset_service::PresetService::resolve_layout_data_interface_for_graph(
        &state.db,
        &graph,
        Some(preset_id),
    )
    .await
    {
        Ok(interface) => interface,
        Err(err) => {
            return Ok(ContractValidationResultDto {
                is_valid: false,
                missing_stats: vec![],
                missing_flags: vec![],
                missing_inventory: false,
                errors: vec![err],
            });
        }
    };

    let contract = layout_interface.unwrap_or_default();

    let result = crate::services::blueprint_executor::validate_blueprint_ui_contract(&graph, &contract);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::blueprint::{
        BlueprintEdge, BlueprintMacro, BlueprintNode, MacroPinDefinition, PinType, Position,
    };

    #[tokio::test]
    async fn test_normalize_blueprint_graph_preserves_macros() {
        let macro_def = BlueprintMacro {
            id: "m_test".to_string(),
            name: "Test Macro".to_string(),
            description: "Test macro desc".to_string(),
            category: "Utils".to_string(),
            inputs: vec![MacroPinDefinition {
                id: "in".to_string(),
                name: "in".to_string(),
                pin_type: PinType::Exec,
            }],
            outputs: vec![MacroPinDefinition {
                id: "out".to_string(),
                name: "out".to_string(),
                pin_type: PinType::Exec,
            }],
            nodes: vec![
                BlueprintNode {
                    id: "m_in".to_string(),
                    position: Position { x: 0.0, y: 0.0 },
                    config: NodeConfig::MacroInputs(crate::models::blueprint::MacroInputsConfig {
                        pins: vec![MacroPinDefinition {
                            id: "in".to_string(),
                            name: "in".to_string(),
                            pin_type: PinType::Exec,
                        }],
                    }),
                },
                BlueprintNode {
                    id: "m_out".to_string(),
                    position: Position { x: 200.0, y: 0.0 },
                    config: NodeConfig::MacroOutputs(crate::models::blueprint::MacroOutputsConfig {
                        pins: vec![MacroPinDefinition {
                            id: "out".to_string(),
                            name: "out".to_string(),
                            pin_type: PinType::Exec,
                        }],
                    }),
                },
            ],
            edges: vec![BlueprintEdge {
                id: "m_e1".to_string(),
                source: "m_in".to_string(),
                source_port: "in".to_string(),
                target: "m_out".to_string(),
                target_port: "out".to_string(),
                order: 0,
            }],
        };

        let graph = BlueprintGraph {
            version: 2,
            nodes: vec![
                BlueprintNode {
                    id: "n_start".to_string(),
                    position: Position { x: 0.0, y: 0.0 },
                    config: NodeConfig::Start,
                },
                BlueprintNode {
                    id: "n_end".to_string(),
                    position: Position { x: 300.0, y: 0.0 },
                    config: NodeConfig::End,
                },
            ],
            edges: vec![BlueprintEdge {
                id: "e1".to_string(),
                source: "n_start".to_string(),
                source_port: "out".to_string(),
                target: "n_end".to_string(),
                target_port: "in".to_string(),
                order: 0,
            }],
            comments: vec![],
            macros: vec![macro_def],
        };

        let input_json = serde_json::to_string(&graph).expect("serialize test graph");
        let result = normalize_blueprint_graph(input_json).await.expect("normalization must succeed");

        let normalized_graph: BlueprintGraph =
            serde_json::from_str(&result.graph_json).expect("deserialize normalized graph");

        assert_eq!(normalized_graph.macros.len(), 1, "macros must be preserved after normalize_blueprint_graph");
        assert_eq!(normalized_graph.macros[0].id, "m_test");
        assert_eq!(normalized_graph.macros[0].nodes.len(), 2);
        assert_eq!(normalized_graph.macros[0].edges.len(), 1);
    }
}

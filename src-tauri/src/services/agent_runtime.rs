use std::collections::HashMap;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter};

use crate::models::game_state::{DataContainer, DataContainerPatch};

/// 从数据库读取指定会话的 DataContainer 状态。若尚未创建则返回默认初始状态。
pub async fn load_session_state(db: &SqlitePool, session_id: i64) -> Result<DataContainer, String> {
    let row_opt = sqlx::query("SELECT state_json FROM session_states WHERE session_id = ?")
        .bind(session_id)
        .fetch_optional(db)
        .await
        .map_err(|e| format!("查询 session_states 失败: {}", e).replace('\\', "/"))?;

    if let Some(row) = row_opt {
        let json_str: String = row
            .try_get("state_json")
            .map_err(|e| format!("读取 session_state.state_json 失败: {}", e).replace('\\', "/"))?;
        let state: DataContainer = serde_json::from_str(&json_str)
            .map_err(|e| format!("解析 session_state 数据失败: {}", e).replace('\\', "/"))?;
        Ok(state)
    } else {
        Ok(DataContainer::default())
    }
}

/// 将会话的 DataContainer 状态持久化写入 SQLite
pub async fn save_session_state(
    db: &SqlitePool,
    session_id: i64,
    state: &DataContainer,
) -> Result<(), String> {
    let json_str = serde_json::to_string(state)
        .map_err(|e| format!("序列化 session_state 失败: {}", e).replace('\\', "/"))?;
    let now = crate::utils::now_ts();

    sqlx::query(
        "INSERT INTO session_states (session_id, state_json, updated_at) \
         VALUES (?, ?, ?) \
         ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
    )
    .bind(session_id)
    .bind(json_str)
    .bind(now)
    .execute(db)
    .await
    .map_err(|e| format!("持久化 session_state 失败: {}", e).replace('\\', "/"))?;

    Ok(())
}

/// 重置会话状态为初始状态
pub async fn reset_session_state(db: &SqlitePool, session_id: i64) -> Result<DataContainer, String> {
    let state = DataContainer::default();
    save_session_state(db, session_id, &state).await?;
    Ok(state)
}

/// 向前端常驻 HUD 广播增量更新事件 (session:hud_state_patch)
pub fn broadcast_hud_patch(
    app: &AppHandle,
    session_id: i64,
    state: &DataContainer,
    schema_patches: Option<HashMap<String, serde_json::Value>>,
) {
    let patch = DataContainerPatch {
        session_id,
        stats: Some(state.stats.clone()),
        inventory: Some(state.inventory.clone()),
        flags: Some(state.flags.clone()),
        schema_patches,
    };

    if let Err(e) = app.emit("session:hud_state_patch", patch) {
        crate::dbg_eprintln!("[agent_runtime] broadcast_hud_patch failed: {}", e);
    }
}

use crate::dbg_eprintln;

/// 报错文案里用的 JSON 类型名，避免把整段值打进错误信息。
fn args_type_name(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

/// 执行一次 ToolCall；`plan` 为编译期从蓝图收集的步骤链时走蓝图规则（计划 §5）。
///
/// 语义要点：
/// - **拦截不是错误处理路径**：门禁不通过时数据容器保持原样（`run_tool_plan` 提前返回），
///   这里把拦截理由作为 `Err` 交给上层，由上层以 `tool_result(is_error=true)` 回注模型——
///   既不静默吞掉，也不让模型以为操作成功；
/// - 没有计划时退回内置契约（无蓝图的手工调试路径），并写一条 debug 日志说明走的是哪条路，
///   不做静默降级。
/// 解析会话当前生效的指定 ToolCall 契约的蓝图执行计划。
///
/// 手工路径（调试抽屉按钮 / MCP `nv_tool_call_execute`）与模型回注路径共用同一套
/// 蓝图计划，保证"抽屉里点的"和"模型调的"行为完全一致；否则会出现
/// "抽屉里买药扣 50 金币、模型买药一分不扣"这类分叉。
///
/// 返回 `Ok(None)` 的情形（走内置契约）：会话无预设 / 预设无蓝图 / 该契约不是蓝图工具。
pub async fn resolve_tool_plan(
    db: &SqlitePool,
    session_id: i64,
    tool_name: &str,
) -> Result<Option<crate::models::tool_plan::ToolPlan>, String> {
    let preset_id: Option<i64> =
        sqlx::query_scalar("SELECT preset_id FROM conversations WHERE id = ?")
            .bind(session_id)
            .fetch_optional(db)
            .await
            .map_err(|e| format!("查询会话预设失败: {}", e).replace('\\', "/"))?
            .flatten();
    let Some(preset_id) = preset_id else {
        return Ok(None);
    };

    let graph_json: Option<String> =
        sqlx::query_scalar("SELECT blueprint_graph FROM presets WHERE id = ?")
            .bind(preset_id)
            .fetch_optional(db)
            .await
            .map_err(|e| format!("读取预设蓝图失败: {}", e).replace('\\', "/"))?;
    let Some(graph_json) = graph_json else {
        return Ok(None);
    };
    let graph: crate::models::blueprint::BlueprintGraph =
        serde_json::from_str(&graph_json).map_err(|e| {
            format!("blueprint_graph JSON invalid: {}", e).replace('\\', "/")
        })?;

    // 与编译预览命令（commands/blueprint.rs）保持同一套上下文装配。
    #[derive(sqlx::FromRow)]
    struct ConvRow {
        conversation_type: String,
        memory_mode: String,
    }
    let conv = sqlx::query_as::<_, ConvRow>(
        "SELECT conversation_type, memory_mode FROM conversations WHERE id = ?",
    )
    .bind(session_id)
    .fetch_optional(db)
    .await
    .map_err(|e| format!("查询会话失败: {}", e).replace('\\', "/"))?;
    let (conversation_type, memory_mode) = match conv {
        Some(row) => (row.conversation_type, row.memory_mode),
        None => ("single".to_string(), "stateless".to_string()),
    };

    let mut gate_selections: HashMap<String, crate::models::blueprint::GateSelection> =
        HashMap::new();
    #[derive(sqlx::FromRow)]
    struct GateRow {
        node_id: String,
        selected_keys: String,
    }
    if let Ok(rows) = sqlx::query_as::<_, GateRow>(
        "SELECT node_id, selected_keys FROM conversation_gate_selections WHERE conversation_id = ?",
    )
    .bind(session_id)
    .fetch_all(db)
    .await
    {
        for r in rows {
            if let Ok(keys) = serde_json::from_str::<Vec<String>>(&r.selected_keys) {
                gate_selections
                    .insert(r.node_id, crate::models::blueprint::GateSelection { keys });
            }
        }
    }
    if gate_selections.is_empty() {
        if let Ok(preset_selections) =
            crate::repositories::preset_gate_repository::PresetGateRepository::load_by_preset(
                db, preset_id,
            )
            .await
        {
            for sel in preset_selections {
                gate_selections.insert(
                    sel.node_id,
                    crate::models::blueprint::GateSelection {
                        keys: sel.selected_keys,
                    },
                );
            }
        }
    }

    let mut preset_schemas: HashMap<String, crate::models::schema::SchemaDefinition> =
        HashMap::new();
    if let Ok(rows) = sqlx::query(
        "SELECT id, preset_id, name, description, retention_depth, fields_json, created_at, updated_at \
         FROM preset_schemas WHERE preset_id = ?",
    )
    .bind(preset_id)
    .fetch_all(db)
    .await
    {
        for row in rows {
            match crate::models::schema::SchemaDefinition::from_row(&row) {
                Ok(schema) => {
                    preset_schemas.insert(schema.id.clone(), schema);
                }
                Err(err) => {
                    dbg_eprintln!(
                        "[agent-runtime] 解析 preset_schema 行失败（跳过）: {}",
                        err
                    );
                }
            }
        }
    }

    let exec_context = crate::models::blueprint::BlueprintExecutionContext {
        memory_mode,
        conversation_type,
        protocol: "chat_completions".to_string(),
        gate_selections,
        preset_schemas,
        game_state: None,
    };

    let result = crate::services::blueprint_executor::execute_blueprint(&graph, &exec_context)
        .await
        .map_err(|e| e.to_string().replace('\\', "/"))?;

    Ok(result.tool_plans.get(tool_name).cloned())
}

pub async fn execute_tool_call_with_plan(
    db: &SqlitePool,
    app: &AppHandle,
    session_id: i64,
    tool_name: &str,
    arguments_json: &str,
    plan: Option<&crate::models::tool_plan::ToolPlan>,
) -> Result<String, String> {
    // 蓝图未定义 = 显式报错（spec 不变量 I2）：内置契约兜底已废除——具体功能
    // 语义只存在于蓝图资产，代码不再携带任何具体实现。
    let Some(plan) = plan else {
        return Err(format!(
            "蓝图未定义契约「{tool_name}」——当前会话预设的蓝图中没有该 ToolDefinition 链\
             （未绑定预设 / 预设无图 / 所在分支未选中，同样视为未定义）。\
             请在蓝图中定义该契约后重试。"
        ));
    };

    let args: serde_json::Value = serde_json::from_str(arguments_json).map_err(|err| {
        format!(
            "ToolCall 参数不是合法 JSON（契约 {}）: {}",
            tool_name, err
        )
    })?;
    if !args.is_object() {
        return Err(format!(
            "ToolCall 参数必须是 JSON 对象（契约 {}），实际收到: {}",
            tool_name,
            args_type_name(&args)
        ));
    }

    // 契约校验：required 字段与基本类型必须过关才允许执行。
    // 缺 unit_price 还照常成交（扣 0 金币）比直接失败危害大得多（C2）。
    if let Some(schema) = &plan.parameters_schema {
        crate::models::tool_plan::validate_args_against_schema(&args, schema, tool_name)?;
    }

    let mut state = load_session_state(db, session_id).await?;
    // Querier 跨域读：经 action_bridge 白名单校验后代理既有命令（spec §2A.5）。
    // 回调返回 boxed future 由 async run_tool_plan 原生 await——在 tokio worker 内
    // 禁止 block_on（会 panic，见本轮实机抓到的崩溃），故不做跨 runtime 阻塞。
    let pool = db.clone();
    let query_exec = move |command: String,
                           payload: serde_json::Value|
          -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<serde_json::Value, String>> + Send>> {
        let pool = pool.clone();
        Box::pin(async move {
            crate::services::action_bridge::invoke(&pool, session_id, &command, &payload).await
        })
    };
    let outcome =
        crate::models::tool_plan::run_tool_plan(&mut state, plan, &args, &query_exec).await?;

    if outcome.is_blocked {
        // 被拦截：不落库、不广播，理由原样上抛给编排层回注。
        return Err(outcome.text);
    }

    save_session_state(db, session_id, &state).await?;
    broadcast_hud_patch(app, session_id, &state, None);
    Ok(outcome.text)
}

/// 执行 ToolCall 契约调用（手工触发路径：调试台按钮 / MCP 工具）。
///
/// 先按会话当前蓝图解析该契约的执行计划：命中即与模型自动调用走**同一条链**
/// （契约校验 → 门禁 → 计算 → 落库 → 广播），命不中才用内置契约。
/// 蓝图解析失败按错误上抛，不做静默降级（C2）。
pub async fn execute_tool_call(
    db: &SqlitePool,
    app: &AppHandle,
    session_id: i64,
    tool_name: &str,
    arguments_json: &str,
) -> Result<String, String> {
    let plan = resolve_tool_plan(db, session_id, tool_name).await?;
    match plan {
        Some(plan) => {
            execute_tool_call_with_plan(db, app, session_id, tool_name, arguments_json, Some(&plan))
                .await
        }
        None => Err(format!(
            "蓝图未定义契约「{tool_name}」——当前会话预设的蓝图中没有该 ToolDefinition 链\
             （未绑定预设 / 预设无图 / 所在分支未选中，同样视为未定义）。\
             请在蓝图中定义该契约后重试。"
        )),
    }
}

/// 加载会话预设的编排资产节点（BannedWordsConfig / ScriptwriterPipeline）。
///
/// 会话 → 预设 → 蓝图图 → `extract_orchestration_configs` 全图扫描。未绑定预设 /
/// 预设无图 → 两个 None（调用方按各自语义处理：禁词过滤为空、流水线参数缺省报错）。
pub async fn load_blueprint_configs_for_conversation(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<
    (
        Option<crate::models::blueprint::BannedWordsConfig>,
        Option<crate::models::blueprint::ScriptwriterPipelineConfig>,
    ),
    String,
> {
    let preset_id: Option<i64> =
        sqlx::query_scalar("SELECT preset_id FROM conversations WHERE id = ?")
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|e| format!("查询会话预设失败: {}", e).replace('\\', "/"))?
            .flatten();
    let Some(preset_id) = preset_id else {
        return Ok((None, None));
    };
    let graph_json: Option<String> =
        sqlx::query_scalar("SELECT blueprint_graph FROM presets WHERE id = ?")
            .bind(preset_id)
            .fetch_optional(db)
            .await
            .map_err(|e| format!("读取预设蓝图失败: {}", e).replace('\\', "/"))?;
    let Some(graph_json) = graph_json else {
        return Ok((None, None));
    };
    let graph: crate::models::blueprint::BlueprintGraph = serde_json::from_str(&graph_json)
        .map_err(|e| format!("blueprint_graph JSON invalid: {}", e).replace('\\', "/"))?;
    crate::services::blueprint_executor::extract_orchestration_configs(&graph)
        .map_err(|e| e.to_string().replace('\\', "/"))
}



use std::collections::HashMap;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter, Manager};

use crate::models::game_state::{DataContainer, DataContainerPatch};

/// 从数据库读取指定会话的 DataContainer 状态。若尚未创建则返回默认初始状态。
///
/// **回合内缓存优先**（计划 §2.1"单次结算持久化"）：若该会话存在未 flush 的
/// 回合内工作副本（AppState.session_state_cache），以缓存为准——回合内的多次
/// ToolCall 变动只落在内存，正文定稿后由 `flush_session_state_cache` 单次写库。
pub async fn load_session_state_cached(
    db: &SqlitePool,
    app: &tauri::AppHandle,
    session_id: i64,
) -> Result<DataContainer, String> {
    {
        let app_state = app.state::<crate::AppState>();
        let guard = app_state.session_state_cache.lock().await;
        if let Some(cached) = guard.get(&session_id) {
            return Ok(cached.clone());
        }
    }
    load_session_state(db, session_id).await
}

/// 直读数据库版本（MCP / 调试台等无回合上下文的调用）。
pub async fn load_session_state(db: &SqlitePool, session_id: i64) -> Result<DataContainer, String> {
    let row_opt = sqlx::query("SELECT state_json FROM session_states WHERE session_id = ?")
        .bind(session_id)
        .fetch_optional(db)
        .await
        .map_err(|e| format!("查询 session_states 失败: {}", e).replace(BACKSLASH, "/"))?;

    if let Some(row) = row_opt {
        let json_str: String = row
            .try_get("state_json")
            .map_err(|e| format!("读取 session_state.state_json 失败: {}", e).replace(BACKSLASH, "/"))?;
        let state: DataContainer = serde_json::from_str(&json_str)
            .map_err(|e| format!("解析 session_state 数据失败: {}", e).replace(BACKSLASH, "/"))?;
        Ok(state)
    } else {
        Ok(DataContainer::default())
    }
}

/// 反斜杠字符（Windows 路径分隔符归一化用；该字面量在代码生成中易被吞掉，提为常量）。
const BACKSLASH: char = '\\';

/// 将会话的 DataContainer 状态持久化写入 SQLite（**立即落库**：MCP / 调试台 /
/// 重置等回合外操作路径）。
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

/// 把回合内工作副本写入缓存（**不落库**——计划 §2.1：回合内变动全在内存瞬时执行，
/// 正文定稿后由 `flush_session_state_cache` 单次持久化）。
pub fn stage_session_state(app: &AppHandle, session_id: i64, state: &DataContainer) {
    let app = app.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        let app_state = app.state::<crate::AppState>();
        let mut guard = app_state.session_state_cache.lock().await;
        guard.insert(session_id, state);
    });
}

/// 回合末单次持久化（计划 §2.1）：缓存中的工作副本写 session_states 并清除。
/// 无缓存条目 = 无回合内变动，no-op。
pub async fn flush_session_state_cache(db: &SqlitePool, app: &AppHandle, session_id: i64) {
    let cached = {
        let app_state = tauri::Manager::state::<crate::AppState>(app);
        let mut guard = app_state.session_state_cache.lock().await;
        guard.remove(&session_id)
    };
    if let Some(state) = cached {
        if let Err(err) = save_session_state(db, session_id, &state).await {
            crate::dbg_eprintln!(
                "[agent_runtime] flush_session_state_cache failed: {}（缓存已回填，下次回合重试）",
                err
            );
            // 落库失败不能丢数据：回填缓存，等下一回合末重试。
            stage_session_state(app, session_id, &state);
        }
    }
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
        None => ("single".to_string(), "legacy".to_string()),
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
    // C2：装载失败上抛（静默空 map 会让所有 InvokeSchema 哑火）；坏行硬错不跳过。
    let schema_rows = sqlx::query(
        "SELECT id, preset_id, name, description, retention_depth, fields_json, created_at, updated_at \
         FROM preset_schemas WHERE preset_id = ?",
    )
    .bind(preset_id)
    .fetch_all(db)
    .await
    .map_err(|err| format!("加载预设 Schema 资产失败: {}", err))?;
    for row in schema_rows {
        let schema = crate::models::schema::SchemaDefinition::from_row(&row)?;
        preset_schemas.insert(schema.id.clone(), schema);
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
    round_id: i64,
    persist_immediately: bool,
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

    let mut state = load_session_state_cached(db, app, session_id).await?;
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

    // 门禁判定轨迹 → 时序泳道（计划 §9.3"门禁"环；后端事实发射，前端不再推断）。
    for trace in &outcome.gate_trace {
        crate::services::agent::timeline::emit(
            app,
            session_id,
            round_id,
            crate::services::agent::timeline::TimelineKind::Gate,
            if outcome.is_blocked {
                crate::services::agent::timeline::TimelineStatus::Blocked
            } else {
                crate::services::agent::timeline::TimelineStatus::Success
            },
            format!("门禁判定: {tool_name}"),
            trace.clone(),
        );
    }

    if outcome.is_blocked {
        // 被拦截：不落库、不广播，理由原样上抛给编排层回注。
        return Err(outcome.text);
    }

    // 持久化模式（计划 §2.1"单次结算持久化"）：
    // - 回合内（模型 ToolCall 回路）：只 stage 进内存工作副本，正文定稿后回合末单写；
    // - 手动路径（调试台 / MCP，round_id=0）：立即落库——否则回合外操作永不持久。
    stage_session_state(app, session_id, &state);
    if persist_immediately {
        flush_session_state_cache(db, app, session_id).await;
    }
    broadcast_hud_patch(app, session_id, &state, None);

    // 不可篡改检定卡广播（计划 §6.3）：d20 门禁的骰值以专用事件广播，
    // 前端据此渲染检定卡（结果由 OS CSPRNG 产出，非模型可操纵）。
    if let Some(roll) = outcome.dice_roll {
        let dc = plan
            .steps
            .iter()
            .find_map(|step| match step {
                crate::models::tool_plan::ToolStep::Gate(cfg)
                    if cfg.gate_type == "d20" =>
                {
                    cfg.expression.trim().parse::<f64>().ok()
                }
                _ => None,
            })
            .map(|v| v as i64)
            .unwrap_or(0);
        let modifier = args.get("modifier").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
        if let Err(err) = app.emit(
            "session:dice_roll",
            serde_json::json!({
                "sessionId": session_id,
                "roundId": round_id,
                "roll": roll,
                "modifier": modifier,
                "dc": dc,
                "passed": roll as f64 + modifier >= dc as f64,
                "tool": tool_name,
            }),
        ) {
            crate::dbg_eprintln!("[agent_runtime] dice_roll broadcast failed: {}", err);
        }
        crate::services::agent::timeline::emit(
            app,
            session_id,
            round_id,
            crate::services::agent::timeline::TimelineKind::Gate,
            if outcome.is_blocked {
                crate::services::agent::timeline::TimelineStatus::Blocked
            } else {
                crate::services::agent::timeline::TimelineStatus::Success
            },
            format!("D20 检定: {roll} vs DC {dc}"),
            format!("工具 {tool_name} 的 d20 门禁判定"),
        );
    }

    crate::services::agent::timeline::emit(
        app,
        session_id,
        round_id,
        crate::services::agent::timeline::TimelineKind::HudPatch,
        crate::services::agent::timeline::TimelineStatus::Success,
        format!("数据容器变更: {tool_name}"),
        outcome.text.clone(),
    );
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
            execute_tool_call_with_plan(
                db,
                app,
                session_id,
                0,
                true,
                tool_name,
                arguments_json,
                Some(&plan),
            )
            .await
        }
        None => Err(format!(
            "蓝图未定义契约「{tool_name}」——当前会话预设的蓝图中没有该 ToolDefinition 链\
             （未绑定预设 / 预设无图 / 所在分支未选中，同样视为未定义）。\
             请在蓝图中定义该契约后重试。"
        )),
    }
}

/// 加载会话预设的编排资产节点全集（BannedWords / ScriptwriterPipeline / AgentModeSwitch /
/// DirectorConfig / ActorDefinition）。未绑定预设 / 预设无图 → Default（调用方按语义处理）。
pub async fn load_blueprint_configs_for_conversation(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<crate::models::blueprint::OrchestrationConfigs, String> {
    let preset_id: Option<i64> =
        sqlx::query_scalar("SELECT preset_id FROM conversations WHERE id = ?")
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|e| format!("查询会话预设失败: {}", e).replace('\\', "/"))?
            .flatten();
    let Some(preset_id) = preset_id else {
        return Ok(Default::default());
    };
    let graph_json: Option<String> =
        sqlx::query_scalar("SELECT blueprint_graph FROM presets WHERE id = ?")
            .bind(preset_id)
            .fetch_optional(db)
            .await
            .map_err(|e| format!("读取预设蓝图失败: {}", e).replace('\\', "/"))?;
    let Some(graph_json) = graph_json else {
        return Ok(Default::default());
    };
    let graph: crate::models::blueprint::BlueprintGraph = serde_json::from_str(&graph_json)
        .map_err(|e| format!("blueprint_graph JSON invalid: {}", e).replace('\\', "/"))?;
    crate::services::blueprint_executor::extract_orchestration_configs(&graph)
        .map_err(|e| e.to_string().replace('\\', "/"))
}



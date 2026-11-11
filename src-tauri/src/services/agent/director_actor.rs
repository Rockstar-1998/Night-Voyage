//! 导演-演员流水线薄入口（工单 03 第 1 项，FanOut 入图）。
//!
//! 本模块不再持有任何硬编码编排实现：分镜 → 扇出 → 汇聚的执行语义全部在
//! [`super::graph_orchestrator`] 的拓扑执行器内（导演节点产出分镜集 →
//! FanOut 节点运行时按分镜数实例化演员节点 → 汇聚节点收尾）。本入口只做
//! 三件事：
//! 1. 装配编排资产（蓝图 `DirectorConfig` / `ActorDefinition`、工具契约表）；
//! 2. 经 [`super::graph_orchestrator::compile_director_plan`] 编译导演计划；
//! 3. 提供阶段调用闭包（导演 / 演员 / 装配三类阶段的真实 LLM 调用、视界
//!    裁剪、时间线事件与草稿记账），把计划交给图执行器游走。
//!
//! 导演分镜类型与解析函数（`DirectorBeat` / `DirectorPlan` /
//! `parse_director_plan` / `director_plan_schema`）已随计划 IR 归入
//! `graph_orchestrator`，此处再导出以保持既有引用路径不变。

use std::future::Future;
use std::sync::Arc;

use sqlx::SqlitePool;
use tauri::AppHandle;

use crate::models::ApiProvider;
use crate::services::agent::orchestrator::{
    record_draft, record_run_finish, record_run_start, stage_call,
};
use crate::services::agent::scratchpad::Scratchpad;
use crate::services::agent::subagent::{run_subagent, run_subagent_with_tools, SubAgentRequest};
use crate::services::agent::timeline::{self, TimelineKind, TimelineStatus};

#[allow(unused_imports)]
pub use super::graph_orchestrator::{
    director_plan_schema, parse_director_plan, DirectorBeat, DirectorPlan,
};

/// 无 AgentModeSwitch 资产时导演 / 演员工具循环的默认轮次上限：
/// 蓝图未声明模式切换节点则无从读取 `max_tool_rounds`，按此默认值封顶。
const DEFAULT_TOOL_MAX_ROUNDS: usize = 5;

/// 依据智能体权限配置解析生效的工具定义列表。
fn resolve_allowed_tool_definitions(
    agent: &impl crate::models::blueprint::HasAgentToolPermissions,
    tool_defs_by_name: &std::collections::HashMap<String, crate::llm::LlmToolDefinition>,
) -> Vec<crate::llm::LlmToolDefinition> {
    if let Some(perms) = agent.tool_permissions() {
        perms.filter_tool_definitions(tool_defs_by_name)
    } else {
        agent
            .fallback_tools()
            .iter()
            .filter_map(|name| tool_defs_by_name.get(name).cloned())
            .collect()
    }
}

/// 构建子代理工具执行回调（走 `execute_tool_call_with_plan` 同一条链：
/// 白名单 → 契约 → 门禁 → 容器）。
fn make_tool_execute(
    db: SqlitePool,
    app: AppHandle,
    conversation_id: i64,
    round_id: i64,
) -> impl Fn(String, String) -> std::pin::Pin<Box<dyn Future<Output = Result<String, String>> + Send>> {
    move |name: String, args_json: String| {
        let db = db.clone();
        let app = app.clone();
        std::pin::Pin::from(Box::pin(async move {
            let plan =
                crate::services::agent_runtime::resolve_tool_plan(&db, conversation_id, &name)
                    .await?;
            crate::services::agent_runtime::execute_tool_call_with_plan(
                &db,
                &app,
                conversation_id,
                round_id,
                false,
                &name,
                &args_json,
                plan.as_ref(),
            )
            .await
        }))
            as std::pin::Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
    }
}

/// 跑完导演-演员流水线，返回定稿正文（薄入口：编译导演计划 + 图执行器）。
///
/// 导演提示词与演员 persona 来自蓝图 `DirectorConfig` / `ActorDefinition`
/// 节点资产（D-5：节点缺失 = 显式报错）。执行失败时运行记录统一标记
/// `failed` 后显式返回错误（C2）。
pub async fn run_director_actor_pipeline(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider: &ApiProvider,
    system: &[String],
    user_input: &str,
) -> Result<String, String> {
    let run_id = record_run_start(db, conversation_id, round_id, "director_actor").await?;

    let result = run_director_plan_via_graph(
        app, db, run_id, conversation_id, round_id, provider, system, user_input,
    )
    .await;

    match result {
        Ok(final_text) => {
            record_run_finish(db, run_id, "completed").await?;
            Ok(final_text)
        }
        Err(err) => {
            let _ = record_run_finish(db, run_id, "failed").await;
            Err(err)
        }
    }
}

/// 编译导演计划并交图执行器游走（薄入口的实质部分：资产装配 + 闭包分发）。
#[allow(clippy::too_many_arguments)]
async fn run_director_plan_via_graph(
    app: &AppHandle,
    db: &SqlitePool,
    run_id: i64,
    conversation_id: i64,
    round_id: i64,
    provider: &ApiProvider,
    system: &[String],
    user_input: &str,
) -> Result<String, String> {
    // 编排资产（D-5）：导演提示词与演员定义来自蓝图节点
    let configs = crate::services::agent_runtime::load_blueprint_configs_for_conversation(
        db,
        conversation_id,
    )
    .await?;
    let director_cfg = configs.director_config.ok_or_else(|| {
        "蓝图缺少 DirectorConfig 节点，无法运行导演-演员流水线（请在该预设蓝图中添加）".to_string()
    })?;

    // 编译蓝图中声明的真实 ToolCall 契约（A12 闭环：使用真实的 parameters_schema 与 description）
    let mut tool_defs_by_name: std::collections::HashMap<String, crate::llm::LlmToolDefinition> = configs
        .declared_tool_definitions
        .iter()
        .map(|(tool_name, cfg)| {
            let schema_json = if cfg.parameters_schema.trim().is_empty() {
                r#"{"type":"object","properties":{}}"#.to_string()
            } else {
                cfg.parameters_schema.clone()
            };
            let input_schema: serde_json::Value = serde_json::from_str(&schema_json)
                .unwrap_or_else(|_| serde_json::json!({"type": "object", "properties": {}}));
            let description = if cfg.description.trim().is_empty() {
                Some(format!("蓝图契约 {tool_name}"))
            } else {
                Some(cfg.description.clone())
            };
            (
                tool_name.clone(),
                crate::llm::LlmToolDefinition {
                    name: tool_name.clone(),
                    description,
                    input_schema,
                },
            )
        })
        .collect();

    // 注入智能体权限中显式白名单化的其他全局能力池工具（如 MCP 工具与 ActionBridge 查询）
    let mut register_extra_tool = |tool_name: &str| -> Result<(), String> {
        if !tool_defs_by_name.contains_key(tool_name) {
            let def = crate::services::action_bridge::resolve_required_capability_tool_definition(tool_name)?;
            tool_defs_by_name.insert(tool_name.to_string(), def);
        }
        Ok(())
    };
    for t in director_cfg.effective_tools() {
        register_extra_tool(&t)?;
    }
    for actor in &configs.actors {
        for t in actor.effective_tools() {
            register_extra_tool(&t)?;
        }
    }

    let tool_max_rounds = configs
        .agent_mode_switch
        .as_ref()
        .map(|cfg| cfg.max_tool_rounds.max(1) as usize)
        .unwrap_or(DEFAULT_TOOL_MAX_ROUNDS);
    let schema_json = serde_json::to_string(&director_plan_schema())
        .map_err(|e| format!("序列化导演分镜 Schema 失败: {e}").replace('\\', "/"))?;

    // 图语义编排（工单 03 第 1 项）：资产先编译为导演计划（导演节点 →
    // FanOut 节点 → 汇聚节点），编译失败（演员名为空 / 重复）即显式报错。
    let plan = super::graph_orchestrator::compile_director_plan(&director_cfg, &configs.actors)?;

    let scratchpad = Scratchpad::new();
    let tool_defs = Arc::new(tool_defs_by_name);
    let schema_json = Arc::new(schema_json);
    let system_owned: Vec<String> = system.to_vec();
    let user_input_owned = user_input.to_string();

    super::graph_orchestrator::execute_orchestration_plan(
        &plan,
        user_input,
        &scratchpad,
        |stage_cfg, _label, instruction, payload, pad| {
            let app = app.clone();
            let db = db.clone();
            let provider = provider.clone();
            let system = system_owned.clone();
            let tool_defs = tool_defs.clone();
            let schema_json = schema_json.clone();
            let user_input = user_input_owned.clone();
            let stage = stage_cfg.clone();
            async move {
                if stage.stage == "director:plan" {
                    run_director_stage(
                        &app, &db, run_id, conversation_id, round_id, &provider, &system,
                        &stage, &payload, &tool_defs, &schema_json, &user_input, tool_max_rounds,
                    )
                    .await
                } else if stage.stage.starts_with("actor:") {
                    run_actor_stage(
                        &app, &db, run_id, conversation_id, round_id, &provider, &system,
                        &stage, &instruction, &payload, &pad, &tool_defs, tool_max_rounds,
                    )
                    .await
                } else if stage.stage == "director:assembly" {
                    stage_call(
                        &app, &db, run_id, conversation_id, round_id, &provider, &system,
                        "导演·装配", &instruction, &payload,
                    )
                    .await
                } else {
                    Err(format!(
                        "导演计划出现未知阶段 `{}`（图执行器分发失败，C2 显式报错）",
                        stage.stage
                    ))
                }
            }
        },
        |_state| {},
    )
    .await
}

/// 导演阶段真实调用：全量系统块 + 导演提示词，结构化 Schema 约束分镜产出；
/// 工具非空时走工具循环。成功后记草稿并发表演时间线（与旧实现一致）。
#[allow(clippy::too_many_arguments)]
async fn run_director_stage(
    app: &AppHandle,
    db: &SqlitePool,
    run_id: i64,
    conversation_id: i64,
    round_id: i64,
    provider: &ApiProvider,
    system: &[String],
    stage: &crate::models::blueprint::ScriptwriterStage,
    payload: &str,
    tool_defs_by_name: &std::collections::HashMap<String, crate::llm::LlmToolDefinition>,
    schema_json: &str,
    user_input: &str,
    max_rounds: usize,
) -> Result<String, String> {
    let director_system: Vec<String> = {
        let mut blocks = system.to_vec();
        if !stage.prompt.trim().is_empty() {
            blocks.push(stage.prompt.clone());
        }
        blocks
    };
    let director_tools = resolve_allowed_tool_definitions(stage, tool_defs_by_name);
    let req = SubAgentRequest::new(
        "导演·分镜",
        director_system,
        payload,
        provider.temperature,
        provider.max_tokens,
    )
    .with_structured_schema(schema_json);

    let res = if director_tools.is_empty() {
        run_subagent(provider, req).await?
    } else {
        let execute = make_tool_execute(db.clone(), app.clone(), conversation_id, round_id);
        let runtime = super::subagent::SubAgentToolRuntime {
            tools: director_tools,
            max_rounds,
            execute: &execute,
        };
        run_subagent_with_tools(provider, req, &runtime).await?
    };

    record_draft(db, run_id, "director:plan", &res.text, user_input).await?;
    timeline::emit(
        app,
        conversation_id,
        round_id,
        TimelineKind::SubAgent,
        TimelineStatus::Success,
        "导演·分镜".to_string(),
        format!("分镜计划产出 {} 字", res.text.chars().count()),
    );
    Ok(res.text)
}

/// 演员阶段真实调用：视界裁剪 + 工具循环（与旧实现逐项一致）。
///
/// 视界裁剪（计划 §6.1，D-5）——真裁剪，不叠加：
/// ① 执行器已按分镜 `character` 命中蓝图 `ActorDefinition` 时，演员阶段
///    资产的 `prompt` 即 persona：上下文 = **仅** persona + 本镜 focus 纸条；
/// ② 未命中（执行器经 Scratchpad `fanout:actor_def_missed` 显式信号）：
///    旧路径——只保留含该角色名的共享设定块；未命中任何设定块也不全量
///    放行，只用本镜 focus 出演，并以 Info 事件明示。
/// ③ tools 非空的演员进入工具循环（`run_subagent_with_tools`）。
#[allow(clippy::too_many_arguments)]
async fn run_actor_stage(
    app: &AppHandle,
    db: &SqlitePool,
    run_id: i64,
    conversation_id: i64,
    round_id: i64,
    provider: &ApiProvider,
    system: &[String],
    stage: &crate::models::blueprint::ScriptwriterStage,
    instruction: &str,
    payload: &str,
    pad: &Scratchpad,
    tool_defs_by_name: &std::collections::HashMap<String, crate::llm::LlmToolDefinition>,
    max_rounds: usize,
) -> Result<String, String> {
    // 当前镜头上下文由图执行器写入 Scratchpad（FanOut 实例化协议）。
    let beat_json = pad.read_text("fanout:current_beat")?;
    let beat: DirectorBeat = serde_json::from_str(&beat_json)
        .map_err(|e| format!("解析当前分镜上下文失败: {e}").replace('\\', "/"))?;
    let beat_index: usize = pad
        .read_text("fanout:beat_index")?
        .parse()
        .map_err(|_| "Scratchpad fanout:beat_index 不是合法序号".to_string())?;
    let beat_total: usize = pad
        .read_text("fanout:beat_total")?
        .parse()
        .map_err(|_| "Scratchpad fanout:beat_total 不是合法总数".to_string())?;

    // 未命中信号由图执行器显式写入 Scratchpad（与 fanout:beat_index 同
    // 协议，键缺失即显式报错）：不再靠 persona 是否为空反推——旧实现按
    // ActorDefinition 命中与否分流，命中但 persona 为空的演员同样只吃
    // persona，靠空串推断会把他误判进旧路径裁剪（C2 可见性修正）。
    let actor_def_missed = pad.read_text("fanout:actor_def_missed")? == "true";

    let mut actor_system: Vec<String> = Vec::new();
    if !actor_def_missed {
        // 视界裁剪：只给 persona（蓝图角色设定），不给共享设定全量。
        actor_system.push(format!("【你的角色设定】\n{}", stage.prompt));
    } else if let Some(character) = beat.character.as_deref() {
        // 旧路径：只把含该角色名的设定块留给这位演员（真裁剪）
        for block in system {
            if block.contains(character) {
                actor_system.push(block.clone());
            }
        }
        // 未命中任何设定块：不再全量放行——只用本镜 focus 出演（诚实裁剪）。
        if actor_system.is_empty() {
            timeline::emit(
                app,
                conversation_id,
                round_id,
                TimelineKind::SubAgent,
                TimelineStatus::Info,
                format!("演员 {character} 视界裁剪：未命中设定块"),
                "共享设定中无含该角色名的块——该演员仅以本镜 focus 指令出演（视界已裁剪）".to_string(),
            );
        }
    }
    // 本镜台词纸条约束指示（图执行器装配）
    actor_system.push(instruction.to_string());

    let actor_tools = resolve_allowed_tool_definitions(stage, tool_defs_by_name);
    let actor_label = format!("演员 {}", beat.slot_id);
    let response = if actor_tools.is_empty() {
        run_subagent(
            provider,
            SubAgentRequest::new(
                &actor_label,
                actor_system,
                payload,
                provider.temperature,
                provider.max_tokens,
            ),
        )
        .await
    } else {
        let execute = make_tool_execute(db.clone(), app.clone(), conversation_id, round_id);
        let runtime = super::subagent::SubAgentToolRuntime {
            tools: actor_tools,
            max_rounds,
            execute: &execute,
        };
        run_subagent_with_tools(
            provider,
            SubAgentRequest::new(
                &actor_label,
                actor_system,
                payload,
                provider.temperature,
                provider.max_tokens,
            ),
            &runtime,
        )
        .await
    };

    match response {
        Ok(response) => {
            record_draft(
                db,
                run_id,
                &format!("actor:{}", beat.slot_id),
                &response.text,
                &beat.focus,
            )
            .await?;
            timeline::emit(
                app,
                conversation_id,
                round_id,
                TimelineKind::SubAgent,
                TimelineStatus::Success,
                format!("演员 {} 出演 {}（{}/{}）", beat.slot_id, beat.focus, beat_index, beat_total),
                format!("产出 {} 字", response.text.chars().count()),
            );
            Ok(response.text)
        }
        Err(err) => {
            timeline::emit(
                app,
                conversation_id,
                round_id,
                TimelineKind::SubAgent,
                TimelineStatus::Failed,
                format!("演员 {} 演出失败", beat.slot_id),
                err.clone(),
            );
            Err(err)
        }
    }
}

/// 禁词 Nudge 单趟重写（导演-演员路径）：以驳回意见为指令，单模型调用重写终稿。
#[allow(clippy::too_many_arguments)]
pub async fn run_director_nudge_pass(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider: &ApiProvider,
    system: &[String],
    rewrite_input: &str,
) -> Result<String, String> {
    let run_id = record_run_start(db, conversation_id, round_id, "director_nudge").await?;
    let text = stage_call(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        system,
        "导演·禁词自纠",
        "你是导演。上一版终稿被禁词门禁驳回，请按指令重写完整正文，只输出重写后的正文。",
        rewrite_input,
    )
    .await;
    let _ = record_run_finish(db, run_id, if text.is_ok() { "completed" } else { "failed" }).await;
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_director_plan_schema_structure() {
        let schema = director_plan_schema();
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["required"], serde_json::json!(["beats"]));

        let beats_prop = &schema["properties"]["beats"];
        assert_eq!(beats_prop["type"], "array");

        let item_props = &beats_prop["items"]["properties"];
        assert!(item_props["slot_id"].is_object());
        assert!(item_props["character"].is_object());
        assert!(item_props["focus"].is_object());
        assert_eq!(
            beats_prop["items"]["required"],
            serde_json::json!(["slot_id", "focus"])
        );
    }

    #[test]
    fn test_parse_director_plan_valid() {
        let json_str = r#"{
            "beats": [
                { "slot_id": "b1", "character": "Alice", "focus": "走进房间并发现线索" },
                { "slot_id": "b2", "character": null, "focus": "门外传来脚步声" }
            ]
        }"#;

        let plan = parse_director_plan(json_str).expect("parse valid plan");
        assert_eq!(plan.beats.len(), 2);
        assert_eq!(plan.beats[0].slot_id, "b1");
        assert_eq!(plan.beats[0].character.as_deref(), Some("Alice"));
        assert_eq!(plan.beats[0].focus, "走进房间并发现线索");

        assert_eq!(plan.beats[1].slot_id, "b2");
        assert_eq!(plan.beats[1].character, None);
        assert_eq!(plan.beats[1].focus, "门外传来脚步声");
    }

    #[test]
    fn test_parse_director_plan_code_block() {
        let raw = "```json\n{\n  \"beats\": [\n    {\"slot_id\": \"slot_intro\", \"character\": \"侦探\", \"focus\": \"观察现场\"}\n  ]\n}\n```";
        let plan = parse_director_plan(raw).expect("parse markdown json");
        assert_eq!(plan.beats.len(), 1);
        assert_eq!(plan.beats[0].slot_id, "slot_intro");
        assert_eq!(plan.beats[0].character.as_deref(), Some("侦探"));
        assert_eq!(plan.beats[0].focus, "观察现场");
    }

    #[test]
    fn test_parse_director_plan_errors() {
        // Not a JSON object
        assert!(parse_director_plan("not a json").is_err());
        assert!(parse_director_plan("[]").is_err());

        // Missing beats
        assert!(parse_director_plan(r#"{"other": 123}"#).is_err());

        // Empty beats
        assert!(parse_director_plan(r#"{"beats": []}"#).is_err());

        // Missing required field slot_id
        assert!(parse_director_plan(r#"{"beats": [{"focus": "something"}]}"#).is_err());

        // Missing required field focus
        assert!(parse_director_plan(r#"{"beats": [{"slot_id": "b1"}]}"#).is_err());
    }
}

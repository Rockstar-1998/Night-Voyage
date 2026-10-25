//! 导演-演员流水线（计划 §6.1）。
//!
//! 分两步走，中间是"视界裁剪"：
//! 1. **导演**：产出结构化分镜计划（JSON），每个镜头一个槽位（`slot_id` + 角色 + 该镜头要点）；
//! 2. **演员**：每个槽位一次独立调用，且**只给该演员该看的东西**——
//!    角色设定只放自己那一份，上下文只放本镜头要点，避免演员看到别人的戏；
//! 3. **导演装配**：把各槽位产出按 `slot_id` 顺序缝合成定稿。
//!
//! 所有调用都走 [`super::subagent`]；中间稿写 `agent_drafts`，全程发 `SubAgent` 时序事件。
//! 导演计划不是合法 JSON / 缺槽位时**报错**，不做"按空计划继续"的兜底。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::AppHandle;

use crate::models::ApiProvider;
use crate::services::agent::orchestrator::{
    record_draft, record_run_finish, record_run_start, stage_call,
};
use crate::services::agent::subagent::{run_subagent, run_subagent_with_tools, SubAgentRequest};
use std::future::Future;
use crate::services::agent::timeline::{self, TimelineKind, TimelineStatus};

/// 导演产出的一个分镜槽位。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorBeat {
    pub slot_id: String,
    /// 该镜头由哪个角色出演（用于视界裁剪）
    pub character: Option<String>,
    /// 这一镜要发生什么
    pub focus: String,
}

/// 导演分镜计划。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorPlan {
    pub beats: Vec<DirectorBeat>,
}

/// 返回导演分镜计划（DirectorPlan）的标准 JSON Schema 定义。
///
/// 遵循 `InvokeSchema` 规范，用于强制约束模型以标准 JSON 产出分镜槽位。
pub fn director_plan_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "beats": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "slot_id": { "type": "string" },
                        "character": { "type": "string" },
                        "focus": { "type": "string" }
                    },
                    "required": ["slot_id", "focus"]
                }
            }
        },
        "required": ["beats"]
    })
}

/// 解析导演计划：必须是 JSON 对象且含非空 `beats` 数组。
///
/// 允许模型把 JSON 包在 ```json 代码块里；除此之外任何偏差都报错——
/// 解析失败就改写或降级，等于让导演"什么都没说"也照演。
pub fn parse_director_plan(raw: &str) -> Result<DirectorPlan, String> {
    let cleaned = raw.trim().trim_start_matches("```json").trim_end_matches("```").trim();
    let value: Value = serde_json::from_str(cleaned)
        .map_err(|err| format!("导演计划不是合法 JSON: {}（原文前 200 字：{}）", err, cleaned.chars().take(200).collect::<String>()))?;
    let object = value
        .as_object()
        .ok_or_else(|| "导演计划必须是 JSON 对象".to_string())?;
    let beats_value = object
        .get("beats")
        .ok_or_else(|| "导演计划缺少 beats 数组".to_string())?;
    let beats_raw = beats_value
        .as_array()
        .ok_or_else(|| "导演计划的 beats 必须是数组".to_string())?;
    if beats_raw.is_empty() {
        return Err("导演计划的 beats 为空：本轮没有可演的镜头".to_string());
    }

    let mut beats = Vec::with_capacity(beats_raw.len());
    for (index, raw_beat) in beats_raw.iter().enumerate() {
        let beat_object = raw_beat
            .as_object()
            .ok_or_else(|| format!("分镜 #{} 不是 JSON 对象", index + 1))?;
        let slot_id = beat_object
            .get("slot_id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("分镜 #{} 缺少 slot_id", index + 1))?
            .to_string();
        let focus = beat_object
            .get("focus")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("分镜 `{}` 缺少 focus", slot_id))?
            .to_string();
        let character = beat_object
            .get("character")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        beats.push(DirectorBeat { slot_id, character, focus });
    }

    Ok(DirectorPlan { beats })
}

/// 跑完导演-演员流水线，返回定稿正文。
///
/// 导演提示词与演员 persona 来自蓝图 `DirectorConfig` / `ActorDefinition` 节点资产
/// （D-5：节点缺失 = 显式报错 I2）。演员的 `tools` 声明用于子代理 function-calling。
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

    // 编排资产（D-5）：导演提示词与演员定义来自蓝图节点
    let configs = crate::services::agent_runtime::load_blueprint_configs_for_conversation(
        db,
        conversation_id,
    )
    .await?;
    let director_cfg = configs.director_config.ok_or_else(|| {
        "蓝图缺少 DirectorConfig 节点，无法运行导演-演员流水线（请在该预设蓝图中添加）".to_string()
    })?;
    let actor_defs: std::collections::HashMap<&str, &crate::models::blueprint::ActorDefinition> =
        configs.actors.iter().map(|a| (a.actor_name.as_str(), a)).collect();

    let director_system: Vec<String> = {
        let mut blocks = system.to_vec();
        if !director_cfg.director_prompt.trim().is_empty() {
            blocks.push(director_cfg.director_prompt.clone());
        }
        blocks
    };

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

    let director_tools = resolve_allowed_tool_definitions(&director_cfg, &tool_defs_by_name);

    let schema_json = serde_json::to_string(&director_plan_schema())
        .map_err(|e| format!("序列化导演分镜 Schema 失败: {e}"))?;

    let plan_raw = if director_tools.is_empty() {
        let req = SubAgentRequest::new(
            "导演·分镜",
            director_system.clone(),
            user_input,
            provider.temperature,
            provider.max_tokens,
        )
        .with_structured_schema(&schema_json);
        let res = run_subagent(provider, req).await?;
        record_draft(
            db,
            run_id,
            "director:plan",
            &res.text,
            user_input,
        )
        .await?;
        timeline::emit(
            app,
            conversation_id,
            round_id,
            TimelineKind::SubAgent,
            TimelineStatus::Success,
            "导演·分镜".to_string(),
            format!("分镜计划产出 {} 字", res.text.chars().count()),
        );
        res.text
    } else {
        let max_rounds = configs
            .agent_mode_switch
            .as_ref()
            .map(|cfg| cfg.max_tool_rounds.max(1) as usize)
            .unwrap_or(5);
        let execute = {
            let db = db.clone();
            let app = app.clone();
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
        };
        let runtime = super::subagent::SubAgentToolRuntime {
            tools: director_tools,
            max_rounds,
            execute: &execute,
        };
        let req = SubAgentRequest::new(
            "导演·分镜",
            director_system.clone(),
            user_input,
            provider.temperature,
            provider.max_tokens,
        )
        .with_structured_schema(&schema_json);
        let res = run_subagent_with_tools(
            provider,
            req,
            &runtime,
        )
        .await?;
        record_draft(
            db,
            run_id,
            "director:plan",
            &res.text,
            user_input,
        )
        .await?;
        timeline::emit(
            app,
            conversation_id,
            round_id,
            TimelineKind::SubAgent,
            TimelineStatus::Success,
            "导演·分镜".to_string(),
            format!("分镜计划产出 {} 字", res.text.chars().count()),
        );
        res.text
    };

    let plan = parse_director_plan(&plan_raw)?;

    // 演员视界裁剪（计划 §6.1"视界裁剪"，D-5）——真裁剪，不叠加：
    // ① 蓝图 ActorDefinition 命中：演员上下文 = **仅** persona + 本镜 focus 纸条；
    //    全量共享设定一律不给（此前"persona 追加在全量设定之上"= 全知演员，已修）。
    // ② 旧路径（无蓝图定义）：仅保留名称命中的设定块；未命中也不得全量放行——
    //    只用本镜 focus 出演，并以 Info 事件明示（诚实呈现裁剪结果）。
    // ③ tools 非空的演员进入工具循环（run_subagent_with_tools）：真实参数 Schema 来自蓝图，
    //    执行走 execute_tool_call_with_plan 同一条链（白名单→契约→门禁→容器）。
    let mut performed: Vec<(String, String)> = Vec::with_capacity(plan.beats.len());

    for (index, beat) in plan.beats.iter().enumerate() {
        let actor_def = beat
            .character
            .as_deref()
            .and_then(|name| actor_defs.get(name))
            .copied();

        let mut actor_system: Vec<String> = Vec::new();
        match actor_def {
            Some(def) => {
                // 视界裁剪：只给 persona（蓝图角色设定），不给共享设定全量。
                actor_system.push(format!("【你的角色设定】\n{}", def.persona));
            }
            None => {
                let character = beat.character.as_deref();
                if let Some(character) = character {
                    // 旧路径：只把含该角色名的设定块留给这位演员（真裁剪）
                    for block in system {
                        if block.contains(character) {
                            actor_system.push(block.clone());
                        }
                    }
                }
                // 未命中任何设定块：不再全量放行——只用本镜 focus 出演（诚实裁剪）。
                if let Some(character) = character {
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
            }
        }
        // 本镜台词纸条约束指示
        actor_system.push(format!(
            "你现在只出演这一镜：{}。只写这一镜的表演，不要替其他角色写戏，不要写总结。",
            beat.focus
        ));

        // 装配演员用户提示词：前序分镜演出 + 当前分镜任务（台词纸条）+ 玩家输入
        let mut actor_user_prompt = String::new();
        if !performed.is_empty() {
            actor_user_prompt.push_str("【本轮前序分镜演出】\n");
            for (prev_slot, prev_text) in &performed {
                actor_user_prompt.push_str(&format!("分镜 {}:\n{}\n\n", prev_slot, prev_text));
            }
        }
        actor_user_prompt.push_str(&format!(
            "【当前分镜任务（台词纸条）】\n{}\n\n【玩家输入】\n{}",
            beat.focus, user_input
        ));

        // 工具循环：蓝图 tools / tool_permissions 非空的演员启用 function-calling 闭环。
        let actor_tools = actor_def
            .map(|def| resolve_allowed_tool_definitions(def, &tool_defs_by_name))
            .unwrap_or_default();

        let execute = {
            let db = db.clone();
            let app = app.clone();
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
        };

        let actor_label = format!("演员 {}", beat.slot_id);
        let response = if actor_tools.is_empty() {
            run_subagent(
                provider,
                SubAgentRequest::new(
                    &actor_label,
                    actor_system,
                    actor_user_prompt,
                    provider.temperature,
                    provider.max_tokens,
                ),
            )
            .await
        } else {
            let max_rounds = configs
                .agent_mode_switch
                .as_ref()
                .map(|cfg| cfg.max_tool_rounds.max(1) as usize)
                .unwrap_or(5);
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
                    actor_user_prompt,
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
                    format!("演员 {} 出演 {}（{}/{}）", beat.slot_id, beat.focus, index + 1, plan.beats.len()),
                    format!("产出 {} 字", response.text.chars().count()),
                );
                performed.push((beat.slot_id.clone(), response.text));
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
                let _ = record_run_finish(db, run_id, "failed").await;
                return Err(err);
            }
        }
    }

    // 导演装配：把各槽位按 slot_id 顺序交给导演缝合，避免生硬拼接导致前后不连贯。
    let assembly_input = {
        let mut joined = String::from("以下各镜头的演出成品（按 slot_id 顺序）：\n\n");
        for (slot_id, text) in &performed {
            joined.push_str(&format!("【{}】\n{}\n\n", slot_id, text));
        }
        joined.push_str("请把以上镜头缝合成一整段顺畅的正文。保持每个镜头已发生的事实不变，不要新增事实。");
        joined
    };

    let final_text = stage_call(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        system,
        "导演·装配",
        "你是导演，负责把分镜成品缝合成最终正文。只输出正文。",
        &assembly_input,
    )
    .await?;

    record_run_finish(db, run_id, "completed").await?;
    Ok(final_text)
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

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

    let plan_raw = stage_call(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        &director_system,
        "导演·分镜",
        "请只输出一个 JSON 对象：{\"beats\":[{\"slot_id\":\"b1\",\"character\":\"角色名\",\"focus\":\"这一镜要发生什么\"}]}。\
         不要输出解释文字。",
        user_input,
    )
    .await?;

    let plan = parse_director_plan(&plan_raw)?;

    // 演员视界裁剪（计划 §6.1"视界裁剪"，D-5）——真裁剪，不叠加：
    // ① 蓝图 ActorDefinition 命中：演员上下文 = **仅** persona + 本镜 focus 纸条；
    //    全量共享设定一律不给（此前"persona 追加在全量设定之上"= 全知演员，已修）。
    // ② 旧路径（无蓝图定义）：仅保留名称命中的设定块；未命中也不得全量放行——
    //    只用本镜 focus 出演，并以 Info 事件明示（诚实呈现裁剪结果）。
    // ③ tools 非空的演员进入工具循环（run_subagent_with_tools）：清单来自蓝图，
    //    执行走 execute_tool_call_with_plan 同一条链（白名单→契约→门禁→容器）。
    let mut performed: Vec<(String, String)> = Vec::with_capacity(plan.beats.len());
    let tool_defs_by_name: std::collections::HashMap<String, crate::llm::LlmToolDefinition> = configs
        .actors
        .iter()
        .flat_map(|a| a.tools.iter().cloned())
        .map(|tool_name| {
            // 工具契约的 function-calling 清单（参数 schema 已在 collect_tool_plan
            // 时随契约校验；执行走 execute_tool_call_with_plan 同一条链）。
            (
                tool_name.clone(),
                crate::llm::LlmToolDefinition {
                    name: tool_name.clone(),
                    description: Some(format!("蓝图契约 {tool_name}")),
                    input_schema: serde_json::Value::Null,
                },
            )
        })
        .collect();

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
        // 本镜台词纸条（导演 focus 指示）永远在场。
        actor_system.push(format!(
            "你现在只出演这一镜：{}。只写这一镜的表演，不要替其他角色写戏，不要写总结。",
            beat.focus
        ));

        // 工具循环：蓝图 tools 非空的演员启用 function-calling 闭环。
        let actor_tools: Vec<crate::llm::LlmToolDefinition> = actor_def
            .map(|def| {
                def.tools
                    .iter()
                    .filter_map(|name| tool_defs_by_name.get(name).cloned())
                    .collect()
            })
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

        let response = if actor_tools.is_empty() {
            run_subagent(
                provider,
                SubAgentRequest {
                    label: &format!("演员 {}", beat.slot_id),
                    system: actor_system,
                    user: user_input.to_string(),
                    temperature: provider.temperature,
                    max_output_tokens: provider.max_tokens,
                },
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
                SubAgentRequest {
                    label: &format!("演员 {}", beat.slot_id),
                    system: actor_system,
                    user: user_input.to_string(),
                    temperature: provider.temperature,
                    max_output_tokens: provider.max_tokens,
                },
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

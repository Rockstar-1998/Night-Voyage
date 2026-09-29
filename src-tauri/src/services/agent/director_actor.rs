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
use crate::services::agent::subagent::{run_subagent, SubAgentRequest};
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

    // 演员视界裁剪（D-5）：优先使用 ActorDefinition.persona（蓝图资产），
    // 其次回退到旧的角色名包含过滤。ActorDefinition.tools 声明该演员的可用契约
    // （暂作视界标注——子代理工具循环在后续里程碑中接通）。
    let mut performed: Vec<(String, String)> = Vec::with_capacity(plan.beats.len());
    for (index, beat) in plan.beats.iter().enumerate() {
        let mut actor_system: Vec<String> = Vec::with_capacity(system.len() + 2);
        let actor_def = beat
            .character
            .as_deref()
            .and_then(|name| actor_defs.get(name))
            .copied();
        match actor_def {
            Some(def) => {
                // 蓝图 ActorDefinition：persona 即视界内容
                actor_system.push(format!("【你的角色设定】\n{}", def.persona));
                for block in system {
                    actor_system.push(block.clone());
                }
                if !def.tools.is_empty() {
                    actor_system.push(format!(
                        "【可用工具】{}",
                        def.tools.join(", ")
                    ));
                }
            }
            None => match beat.character.as_deref() {
                Some(character) => {
                    // 旧路径：只把含该角色名的设定块留给这位演员
                    for block in system {
                        if block.contains(character) {
                            actor_system.push(block.clone());
                        }
                    }
                    if actor_system.is_empty() {
                        actor_system = system.to_vec();
                        timeline::emit(
                            app,
                            conversation_id,
                            round_id,
                            TimelineKind::SubAgent,
                            TimelineStatus::Info,
                            format!("演员 {} 未命中角色设定", character),
                            "预设中没有含该角色名的设定块，本次使用完整共享设定出演".to_string(),
                        );
                    }
                }
                None => actor_system = system.to_vec(),
            },
        }
        if let Some(character) = &beat.character {
            if !actor_defs.contains_key(character.as_str()) {
                timeline::emit(
                    app,
                    conversation_id,
                    round_id,
                    TimelineKind::SubAgent,
                    TimelineStatus::Info,
                    format!("演员 {} 无 ActorDefinition 节点", character),
                    "分镜引用了未经蓝图定义的角色——该演员仅使用共享设定出演".to_string(),
                );
            }
        }
        actor_system.push(format!(
            "你现在只出演这一镜：{}。只写这一镜的表演，不要替其他角色写戏，不要写总结。",
            beat.focus
        ));

        let response = run_subagent(
            provider,
            SubAgentRequest {
                label: &format!("演员 {}", beat.slot_id),
                system: actor_system,
                user: user_input.to_string(),
                temperature: provider.temperature,
                max_output_tokens: provider.max_tokens,
            },
        )
        .await;

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

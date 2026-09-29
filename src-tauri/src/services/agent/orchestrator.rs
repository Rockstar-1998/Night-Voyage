//! 多智能体编排：决定"这一轮由谁写"，并驱动对应流水线。
//!
//! 两条流水线（计划 §6.1 / §6.2）：
//! - **导演-演员**：导演产出结构化分镜计划 → 演员按裁剪后的视界各自演出 → 导演按槽位装配定稿；
//! - **剧本流水线**：`draft` → `critique` → `refiner`，最终稿替代单模型直出。
//!
//! 编排层只做三件事：选流水线、串子角色、把最终稿交回聊天链路落盘。
//! 每次子角色调用都走 [`super::subagent`]，不存在第二套推理实现。

use sqlx::SqlitePool;
use tauri::AppHandle;

use crate::models::ApiProvider;
use crate::repositories::preset_gate_repository::PresetGateRepository;
use crate::services::agent::subagent::{run_subagent, SubAgentRequest};
use crate::services::agent::timeline::{self, TimelineKind, TimelineStatus};
use crate::services::prompt_compiler::{
    compile_prompt, PromptBudget, PromptCompileInput, PromptCompileMode,
};

/// 本轮实际采用的流水线。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentPipeline {
    /// 单模型直出（默认）
    Single,
    /// 导演-演员
    DirectorActor,
    /// 剧本流水线
    Scriptwriter,
}

impl AgentPipeline {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Single => "单智能体直出",
            Self::DirectorActor => "导演-演员双 Agent",
            Self::Scriptwriter => "剧本流水线",
        }
    }
}

/// 解析本轮流水线：只有 agent 模式 + 预设蓝图含 AgentModeSwitch 节点时才启用多智能体。
///
/// **按节点类型发现**（D-3：`AGENT_GATE_NODE_ID` 硬编码 id 已废除）——从编排资产
/// 全图提取中获取 `AgentModeSwitch` 节点 id 与缺省模式；Gate 面板选择覆盖缺省。
/// agent 模式但蓝图缺节点 → 显式报错（I2）。
pub async fn resolve_pipeline(
    db: &SqlitePool,
    conversation_id: i64,
    chat_mode: &str,
) -> Result<AgentPipeline, String> {
    if chat_mode != "director_agents" {
        return Ok(AgentPipeline::Single);
    }

    let configs = crate::services::agent_runtime::load_blueprint_configs_for_conversation(
        db,
        conversation_id,
    )
    .await?;

    let Some(switch_cfg) = &configs.agent_mode_switch else {
        return Err(format!(
            "agent 模式会话 {conversation_id} 的蓝图中缺少 AgentModeSwitch 节点，\
             无法确定智能体架构（请在预设蓝图中添加）"
        ));
    };
    let switch_node_id = &configs.agent_mode_switch_node_id;
    let preset_id: Option<i64> =
        sqlx::query_scalar("SELECT preset_id FROM conversations WHERE id = ? LIMIT 1")
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| format!("读取会话预设失败: {}", err))?
            .flatten();

    let key = match preset_id {
        Some(pid) => {
            let selection = PresetGateRepository::load_one(db, pid, switch_node_id)
                .await
                .map_err(|err| format!("读取智能体架构 Gate 失败: {}", err))?;
            selection
                .map(|s| s.selected_keys)
                .unwrap_or_default()
                .first()
                .map(String::as_str)
                .unwrap_or(switch_cfg.default_mode.as_str())
                .to_string()
        }
        None => switch_cfg.default_mode.clone(),
    };

    match key.as_str() {
        "single" => Ok(AgentPipeline::Single),
        "director_actor" => Ok(AgentPipeline::DirectorActor),
        "scriptwriter" => Ok(AgentPipeline::Scriptwriter),
        other => Err(format!(
            "未知的智能体架构选项 `{other}`（期望 single / director_actor / scriptwriter）"
        )),
    }
}

/// 组装子角色共享的上下文：预设/角色/世界书等 system 块 + 本轮用户输入。
///
/// 走与主链路同一个 `compile_prompt`，因此子角色看到的设定与单模型路径完全一致，
/// 不会出现"主模型知道、演员不知道"的错位。
pub async fn assemble_context(
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_kind: &str,
    model_name: &str,
) -> Result<(Vec<String>, String), String> {
    let input = PromptCompileInput {
        conversation_id,
        mode: PromptCompileMode::ClassicChat,
        target_round_id: Some(round_id),
        provider_kind: provider_kind.to_string(),
        model_name: model_name.to_string(),
        include_streaming_seed: false,
        budget: PromptBudget {
            max_total_tokens: None,
            reserve_output_tokens: None,
            max_summary_tokens: None,
            max_world_book_tokens: None,
            max_retrieved_detail_tokens: None,
        },
        log_dir: None,
        // 子角色不需要纠偏指令；它们各自的角色指令单独注入。
        ephemeral_instruction: None,
    };

    let compiled = compile_prompt(db, &input, 0, None).await?;
    let system: Vec<String> = compiled
        .system_blocks
        .iter()
        .map(|block| block.content.clone())
        .collect();
    let user = compiled.current_user_block.content.clone();

    Ok((system, user))
}

/// 剧本流水线：`draft` → `critique` → `refiner`（计划 §6.2）。
///
/// refiner 阶段做 **Layer 1 锚点涂黑**：把历史正文替换为 `[前文背景已锁定]`，
/// 仅保留最近 50 字作为**尾锚**，防止润色时接不上上文或把已发生的事实改写。
/// 三个阶段的中间稿都写进 `agent_drafts`，便于事后复盘。
pub async fn run_scriptwriter_pipeline(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider: &ApiProvider,
    system: &[String],
    user_input: &str,
) -> Result<String, String> {
    let run_id = record_run_start(db, conversation_id, round_id, "scriptwriter_pipeline").await?;

    // 锚点涂黑参数来自蓝图 ScriptwriterPipeline 节点资产（spec §2A.3/2A.4，D-2）。
    // 节点缺失 = 显式报错（I2）：跑流水线的预设必须定义流水线参数。
    let configs = crate::services::agent_runtime::load_blueprint_configs_for_conversation(db, conversation_id)
        .await?;
    let pipeline_cfg = configs.scriptwriter_pipeline.ok_or_else(|| {
        "蓝图缺少 ScriptwriterPipeline 节点，无法运行剧本流水线（请在该预设蓝图中添加）".to_string()
    })?;

    let draft = stage_call(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        system,
        "初稿",
        "你是剧本初稿作者。请按设定与用户输入写出这一段的完整正文，只输出正文本身。",
        user_input,
    )
    .await?;

    let critique = stage_call(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        system,
        "批注",
        "你是严格的剧本批注者。指出初稿在人物一致性、节奏、逻辑连贯与用词机械感上的具体问题，\
         逐条给出可执行的修改方向；不要重写正文。",
        &draft,
    )
    .await?;

    // 尾锚：只保留初稿末尾 N 字（节点资产 anchor_tail_chars），头部用涂黑标记
    // （节点资产 blackout_marker），避免润色时重写既有事实。
    let tail_anchor: String = {
        let chars: Vec<char> = draft.chars().collect();
        let start = chars.len().saturating_sub(pipeline_cfg.anchor_tail_chars as usize);
        chars[start..].iter().collect()
    };
    let refine_user = format!(
        "{}\n{tail_anchor}\n\n\
         【批注意见】\n{critique}\n\n\
         请依据批注重写这一段，保持剧情走向与已完成的事实不变，只输出重写后的正文。",
        pipeline_cfg.blackout_marker
    );

    let final_text = stage_call(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        system,
        "润色",
        "你是剧本润色者。你要在不改变事实与走向的前提下提升文笔，并彻底消除机械感套话。",
        &refine_user,
    )
    .await?;

    record_run_finish(db, run_id, "completed").await?;
    Ok(final_text)
}

/// 单阶段子角色调用 + 落 `agent_drafts` + 发时序事件。
#[allow(clippy::too_many_arguments)]
pub async fn stage_call(
    app: &AppHandle,
    db: &SqlitePool,
    run_id: i64,
    conversation_id: i64,
    round_id: i64,
    provider: &ApiProvider,
    system: &[String],
    stage: &str,
    instruction: &str,
    payload: &str,
) -> Result<String, String> {
    let mut stage_system: Vec<String> = system.to_vec();
    stage_system.push(instruction.to_string());

    let response = run_subagent(
        provider,
        SubAgentRequest {
            label: stage,
            system: stage_system,
            user: payload.to_string(),
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
                &format!("scriptwriter:{stage}"),
                &response.text,
                stage,
            )
            .await?;
            timeline::emit(
                app,
                conversation_id,
                round_id,
                TimelineKind::SubAgent,
                TimelineStatus::Success,
                format!("剧本流水线 · {}", stage),
                format!(
                    "产出 {} 字{}",
                    response.text.chars().count(),
                    response
                        .completion_tokens
                        .map(|tokens| format!("，completion_tokens={tokens}"))
                        .unwrap_or_default()
                ),
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
                format!("剧本流水线 · {} 失败", stage),
                err.clone(),
            );
            Err(err)
        }
    }
}

pub async fn record_run_start(
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    mode: &str,
) -> Result<i64, String> {
    let now = crate::utils::now_ts();
    sqlx::query(
        "INSERT INTO agent_runs (round_id, conversation_id, orchestration_mode, provider_decision, status, started_at, finished_at) \
         VALUES (?, ?, ?, ?, 'running', ?, NULL)",
    )
    .bind(round_id)
    .bind(conversation_id)
    .bind(mode)
    .bind(format!("pipeline={mode}"))
    .bind(now)
    .execute(db)
    .await
    .map(|result| result.last_insert_rowid())
    .map_err(|err| format!("写入 agent_runs 失败: {}", err))
}

pub async fn record_run_finish(db: &SqlitePool, run_id: i64, status: &str) -> Result<(), String> {
    sqlx::query("UPDATE agent_runs SET status = ?, finished_at = ? WHERE id = ?")
        .bind(status)
        .bind(crate::utils::now_ts())
        .bind(run_id)
        .execute(db)
        .await
        .map(|_| ())
        .map_err(|err| format!("更新 agent_runs 失败: {}", err))
}

pub async fn record_draft(
    db: &SqlitePool,
    run_id: i64,
    agent_key: &str,
    content: &str,
    intent: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO agent_drafts (run_id, agent_key, character_id, draft_content, draft_intent, status, created_at) \
         VALUES (?, ?, NULL, ?, ?, 'produced', ?)",
    )
    .bind(run_id)
    .bind(agent_key)
    .bind(content)
    .bind(intent)
    .bind(crate::utils::now_ts())
    .execute(db)
    .await
    .map(|_| ())
    .map_err(|err| format!("写入 agent_drafts 失败: {}", err))
}

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
use crate::services::agent::scratchpad::{
    execute_scratchpad_tool, native_scratchpad_tools, Scratchpad,
};
use crate::services::agent::subagent::{
    run_subagent_with_tools, SubAgentRequest, SubAgentToolRuntime,
};
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
        max_context_tokens: None,
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
///
/// 纯内存工作区（零磁盘 I/O，spec §1）：中间各阶段稿件（`draft`、`critique`、`final` 等）
/// 严格存留于瞬时 in-memory Scratchpad 中，向 SQLite `agent_drafts` 插入 0 行。
/// 回合结束时工作区自动丢弃清空。
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

    // 阶段提示词消费蓝图 ScriptwriterStage 资产（B7：资产驱动，消除硬编码旁路）；
    // stages 数组按序执行（stage 名 = drafter/critic/refiner 时与既有行为对齐）。
    let stages: Vec<(String, String, String)> = if pipeline_cfg.stages.is_empty() {
        return Err(
            "ScriptwriterPipeline.stages 未配置阶段资产（至少需要 2 个阶段，如 draft 与 refiner，C2/C11 严禁代码硬编码兜底）".to_string()
        );
    } else {
        pipeline_cfg
            .stages
            .iter()
            .map(|stage| (stage.stage.clone(), format!("阶段 {}", stage.stage), stage.prompt.clone()))
            .collect()
    };
    if stages.len() < 2 {
        return Err(format!(
            "ScriptwriterPipeline.stages 至少需要 2 个阶段（当前 {} 个）：draft→critique→refiner 的接力语义无法成立",
            stages.len()
        ));
    }

    // 实例化本轮纯内存 Scratchpad（全生命周期在内存中流转，零磁盘 I/O）
    let scratchpad = Scratchpad::new();

    // 阶段一：产出初稿（工作区变量 draft，计划 §6.2）
    let draft_stage = &stages[0];
    let draft = stage_call_with_scratchpad(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        system,
        &draft_stage.1,
        &draft_stage.2,
        user_input,
        &scratchpad,
    )
    .await?;
    scratchpad.write_text("draft", &draft);
    scratchpad.write_text(&draft_stage.0, &draft);

    // 中间阶段（critique 等）：逐阶段接力，上一阶段产出从 scratchpad 读取
    let mut critique = String::new();
    if stages.len() > 2 {
        let mid_stage = &stages[1];
        let mid_input = scratchpad.read_text("draft").unwrap_or_else(|_| draft.clone());
        critique = stage_call_with_scratchpad(
            app,
            db,
            run_id,
            conversation_id,
            round_id,
            provider,
            system,
            &mid_stage.1,
            &mid_stage.2,
            &mid_input,
            &scratchpad,
        )
        .await?;
        scratchpad.write_text("critique", &critique);
        scratchpad.write_text(&mid_stage.0, &critique);
    }

    // 尾锚：只保留初稿末尾 N 字（节点资产 anchor_tail_chars），头部用涂黑标记
    // （节点资产 blackout_marker），避免润色时重写既有事实。
    let draft_content = scratchpad.read_text("draft").unwrap_or_else(|_| draft.clone());
    let tail_anchor: String = {
        let chars: Vec<char> = draft_content.chars().collect();
        let start = chars.len().saturating_sub(pipeline_cfg.anchor_tail_chars as usize);
        chars[start..].iter().collect()
    };
    let mut refine_user = format!(
        "{}\n{tail_anchor}\n\n",
        pipeline_cfg.blackout_marker
    );
    if !critique.is_empty() {
        refine_user.push_str(&format!("【批注意见】\n{critique}\n\n"));
    }
    refine_user.push_str("请依据批注重写这一段，保持剧情走向与已完成的事实不变，只输出重写后的正文。");

    // 末阶段：润色定稿
    let last_stage = &stages[stages.len() - 1];
    let final_text = stage_call_with_scratchpad(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        system,
        &last_stage.1,
        &last_stage.2,
        &refine_user,
        &scratchpad,
    )
    .await?;
    scratchpad.write_text("final", &final_text);
    scratchpad.write_text(&last_stage.0, &final_text);

    record_run_finish(db, run_id, "completed").await?;
    // 回合结束：释放纯内存缓冲，彻底丢弃工作区（零磁盘残留）
    scratchpad.clear();
    Ok(final_text)
}

/// 禁词 Nudge 单趟重写（计划 §6.3）：以驳回意见为指令，单模型调用重写整段终稿。
/// 仅重写正文——不重跑整个多阶段流水线（成本/时延约束），语义等价于"注入合成
/// Critic Nudge 后的重写指令"。
#[allow(clippy::too_many_arguments)]
pub async fn run_scriptwriter_nudge_pass(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider: &ApiProvider,
    system: &[String],
    rewrite_input: &str,
) -> Result<String, String> {
    let run_id = record_run_start(db, conversation_id, round_id, "scriptwriter_nudge").await?;
    let text = stage_call(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        system,
        "禁词自纠",
        "你是剧本润色者。上一版终稿被禁词门禁驳回，请按指令重写完整正文，只输出重写后的正文。",
        rewrite_input,
    )
    .await;
    let _ = record_run_finish(db, run_id, if text.is_ok() { "completed" } else { "failed" }).await;
    text
}

/// 单阶段子角色调用（带纯内存 Scratchpad 注入与原生 read_text/write_text 工具循环）。
///
/// 零磁盘 I/O（spec §1）：不向 SQLite `agent_drafts` 写入任何记录。
#[allow(clippy::too_many_arguments)]
pub async fn stage_call_with_scratchpad(
    app: &AppHandle,
    _db: &SqlitePool,
    _run_id: i64,
    conversation_id: i64,
    round_id: i64,
    provider: &ApiProvider,
    system: &[String],
    stage: &str,
    instruction: &str,
    payload: &str,
    scratchpad: &Scratchpad,
) -> Result<String, String> {
    let mut stage_system: Vec<String> = system.to_vec();
    stage_system.push(instruction.to_string());

    let tools = native_scratchpad_tools();
    let pad = scratchpad.clone();
    let execute = move |name: String, args_json: String| {
        let pad = pad.clone();
        std::pin::Pin::from(Box::pin(async move {
            match execute_scratchpad_tool(&pad, &name, &args_json) {
                Some(res) => res,
                None => Err(format!("未知的工作区工具 `{name}`")),
            }
        }))
            as std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
    };

    let runtime = SubAgentToolRuntime {
        tools,
        max_rounds: 5,
        execute: &execute,
    };

    let response = run_subagent_with_tools(
        provider,
        SubAgentRequest {
            label: stage,
            system: stage_system,
            user: payload.to_string(),
            temperature: provider.temperature,
            max_output_tokens: provider.max_tokens,
        },
        &runtime,
    )
    .await;

    match response {
        Ok(response) => {
            // 纯内存工作区记账（0 disk I/O，不写 SQLite agent_drafts 表）
            scratchpad.write_text(format!("scriptwriter:{stage}"), &response.text);
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

/// 单阶段子角色调用（兼容入口，创建独立 Scratchpad 转发）。
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
    let scratchpad = Scratchpad::new();
    stage_call_with_scratchpad(
        app,
        db,
        run_id,
        conversation_id,
        round_id,
        provider,
        system,
        stage,
        instruction,
        payload,
        &scratchpad,
    )
    .await
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

/// 兼容旧签名的草稿记账函数。
///
/// 零磁盘 I/O（spec §1）：所有中间草稿仅存留于内存 Scratchpad 中，
/// 不向持久化 SQLite `agent_drafts` 表执行任何写入。返回 Ok(()) 保持无害。
pub async fn record_draft(
    _db: &SqlitePool,
    _run_id: i64,
    _agent_key: &str,
    _content: &str,
    _intent: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite::memory:");
        sqlx::migrate!()
            .run(&pool)
            .await
            .expect("run migrations");
        pool
    }

    #[tokio::test]
    async fn test_record_draft_produces_zero_sqlite_rows() {
        let pool = setup_test_db().await;

        // Setup fixture conversation and round
        sqlx::query("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (1, 'test', 0, 0)")
            .execute(&pool)
            .await
            .expect("insert test conversation");
        sqlx::query("INSERT INTO message_rounds (id, conversation_id, round_index, status, created_at, updated_at) VALUES (1, 1, 1, 'completed', 0, 0)")
            .execute(&pool)
            .await
            .expect("insert test round");

        let run_id = record_run_start(&pool, 1, 1, "scriptwriter_pipeline")
            .await
            .expect("record_run_start");

        // Initial count should be 0
        let count_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_drafts")
            .fetch_one(&pool)
            .await
            .expect("count before");
        assert_eq!(count_before, 0);

        // Call record_draft multiple times across intermediate drafting stages
        record_draft(&pool, run_id, "scriptwriter:draft", "初稿内容", "draft")
            .await
            .expect("record draft 1");
        record_draft(&pool, run_id, "scriptwriter:critique", "批注意见", "critique")
            .await
            .expect("record draft 2");
        record_draft(&pool, run_id, "scriptwriter:final", "定稿正文", "final")
            .await
            .expect("record draft 3");

        // Verify that exactly 0 rows were inserted into agent_drafts (zero disk I/O)
        let count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_drafts")
            .fetch_one(&pool)
            .await
            .expect("count after");
        assert_eq!(count_after, 0, "agent_drafts 表必须为 0 行（零磁盘 I/O）");
    }

    #[test]
    fn test_scratchpad_stage_storage_and_lifecycle() {
        let scratchpad = Scratchpad::new();

        // 阶段一初稿写入
        scratchpad.write_text("draft", "这是第一阶段初稿");
        scratchpad.write_text("stage:drafter", "这是第一阶段初稿");

        // 阶段二读取初稿并写入批注
        let draft_input = scratchpad.read_text("draft").expect("read draft");
        assert_eq!(draft_input, "这是第一阶段初稿");
        scratchpad.write_text("critique", "批注：增强环境描写");

        // 阶段三润色读取批注和初稿并写入终稿
        let critique_input = scratchpad.read_text("critique").expect("read critique");
        assert_eq!(critique_input, "批注：增强环境描写");
        scratchpad.write_text("final", "这是最终润色后的正文");

        // 验证各阶段在内存中均能正常检索
        assert_eq!(scratchpad.read_text("final").unwrap(), "这是最终润色后的正文");
        assert_eq!(scratchpad.snapshot().len(), 4);

        // 回合结束：清空工作区，缓冲区彻底回收释放
        scratchpad.clear();
        assert!(scratchpad.read_text("draft").is_err());
        assert!(scratchpad.read_text("final").is_err());
        assert_eq!(scratchpad.snapshot().len(), 0);
    }
}

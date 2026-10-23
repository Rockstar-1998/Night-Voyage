//! 多智能体编排：决定"这一轮由谁写"，并驱动对应流水线。
//!
//! 两条流水线（计划 §6.1 / §6.2）：
//! - **导演-演员**：导演产出结构化分镜计划 → 演员按裁剪后的视界各自演出 → 导演按槽位装配定稿；
//! - **剧本流水线**：`draft` → `critique` → `refiner`，最终稿替代单模型直出。
//!
//! 编排层只做三件事：选流水线、串子角色、把最终稿交回聊天链路落盘。
//! 每次子角色调用都走 [`super::subagent`]，不存在第二套推理实现。

use std::future::Future;
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

/// 动态执行剧本流水线的通用核心逻辑。
///
/// 接收 $N$ 个阶段（$N \ge 2$）：
/// - 阶段 0：接收初始用户输入与该阶段提示词，产出初稿存入 `scratchpad`；
/// - 中间阶段 ($1..N-2$)：按序接力执行，把上一阶段产出与该阶段提示词传给模型，产出存入 `scratchpad`；
/// - 最终阶段 ($N-1$)：接收累积的批注/上下文与经过 `blackout_marker` 涂黑的尾锚（保留 `anchor_tail_chars` 字），产出定稿存入 `scratchpad`。
pub async fn execute_dynamic_scriptwriter_pipeline<F, Fut>(
    stages: &[crate::models::blueprint::ScriptwriterStage],
    anchor_tail_chars: u32,
    blackout_marker: &str,
    user_input: &str,
    scratchpad: &Scratchpad,
    mut call_stage: F,
) -> Result<String, String>
where
    F: FnMut(String, String, String, Scratchpad) -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    let num_stages = stages.len();
    if num_stages < 2 {
        return Err(format!(
            "ScriptwriterPipeline.stages 至少需要 2 个阶段（当前 {num_stages} 个）：接力流水线语义无法成立"
        ));
    }

    // 阶段 0：初始初稿生成
    let stage0 = &stages[0];
    let stage0_label = format!("阶段 {}", stage0.stage);
    let stage0_key = if !stage0.workspace_key.trim().is_empty() {
        stage0.workspace_key.trim()
    } else {
        stage0.stage.trim()
    };
    let draft = call_stage(
        stage0_label,
        stage0.prompt.clone(),
        user_input.to_string(),
        scratchpad.clone(),
    )
    .await?;

    scratchpad.write_text("draft", &draft);
    scratchpad.write_text(stage0_key, &draft);
    scratchpad.write_text(&stage0.stage, &draft);

    // 中间阶段（1..N-2）：按序接力执行
    let mut prev_output = draft.clone();
    let mut accumulated_critiques: Vec<(String, String)> = Vec::new();

    for stage_cfg in &stages[1..num_stages - 1] {
        let stage_label = format!("阶段 {}", stage_cfg.stage);
        let stage_key = if !stage_cfg.workspace_key.trim().is_empty() {
            stage_cfg.workspace_key.trim()
        } else {
            stage_cfg.stage.trim()
        };

        let output = call_stage(
            stage_label,
            stage_cfg.prompt.clone(),
            prev_output.clone(),
            scratchpad.clone(),
        )
        .await?;

        scratchpad.write_text(stage_key, &output);
        scratchpad.write_text(&stage_cfg.stage, &output);
        accumulated_critiques.push((stage_cfg.stage.clone(), output.clone()));
        prev_output = output;
    }

    // 若恰好有 1 个中间阶段，为了向后兼容也将输出写入 "critique"
    if accumulated_critiques.len() == 1 {
        scratchpad.write_text("critique", &accumulated_critiques[0].1);
    }

    // 尾锚：只保留初稿末尾 N 字（节点资产 anchor_tail_chars），头部用涂黑标记
    // （节点资产 blackout_marker），避免润色时重写既有事实。
    let draft_content = scratchpad.read_text("draft").unwrap_or_else(|_| draft.clone());
    let tail_anchor: String = {
        let chars: Vec<char> = draft_content.chars().collect();
        let start = chars.len().saturating_sub(anchor_tail_chars as usize);
        chars[start..].iter().collect()
    };

    let mut refine_user = format!("{}\n{tail_anchor}\n\n", blackout_marker);
    if !accumulated_critiques.is_empty() {
        if accumulated_critiques.len() == 1 {
            refine_user.push_str(&format!("【批注意见】\n{}\n\n", accumulated_critiques[0].1));
        } else {
            for (stage_name, critique_text) in &accumulated_critiques {
                refine_user.push_str(&format!("【批注意见 · {}】\n{}\n\n", stage_name, critique_text));
            }
        }
        refine_user.push_str("请依据批注重写这一段，保持剧情走向与已完成的事实不变，只输出重写后的正文。");
    } else {
        refine_user.push_str("请依据要求润色这一段，保持剧情走向与已完成的事实不变，只输出重写后的正文。");
    }

    let final_stage = &stages[num_stages - 1];
    let final_label = format!("阶段 {}", final_stage.stage);
    let final_key = if !final_stage.workspace_key.trim().is_empty() {
        final_stage.workspace_key.trim()
    } else {
        final_stage.stage.trim()
    };

    let final_text = call_stage(
        final_label,
        final_stage.prompt.clone(),
        refine_user,
        scratchpad.clone(),
    )
    .await?;

    scratchpad.write_text("final", &final_text);
    scratchpad.write_text(final_key, &final_text);
    scratchpad.write_text(&final_stage.stage, &final_text);

    Ok(final_text)
}

/// 剧本流水线：动态按序执行 blueprint 中定义的 $N$ 个阶段（计划 §6.2）。
///
/// 阶段定义由 `ScriptwriterPipelineConfig.stages` 提供：
/// - 阶段 0：初始生成（初稿放入 `draft`）；
/// - 中间阶段 ($1..N-2$)：按序接力，传递前序产出与指令，产出存入 `scratchpad`；
/// - 末尾阶段 ($N-1$)：做 **Layer 1 锚点涂黑**（保留最近 N 字尾锚），接收累积的批注或上下文，产出定稿。
///
/// 纯内存工作区（零磁盘 I/O，spec §1）：所有中间各阶段稿件
/// 严格存留于瞬时 in-memory Scratchpad 中，向 SQLite `agent_drafts` 插入 0 行。
/// 回合结束时工作区自动丢弃清空（无论成功或失败）。
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

    if pipeline_cfg.stages.is_empty() {
        let _ = record_run_finish(db, run_id, "failed").await;
        return Err(
            "ScriptwriterPipeline.stages 未配置阶段资产（至少需要 2 个阶段，如 draft 与 refiner，C2/C11 严禁代码硬编码兜底）".to_string()
        );
    }
    if pipeline_cfg.stages.len() < 2 {
        let _ = record_run_finish(db, run_id, "failed").await;
        return Err(format!(
            "ScriptwriterPipeline.stages 至少需要 2 个阶段（当前 {} 个）：接力流水线语义无法成立",
            pipeline_cfg.stages.len()
        ));
    }

    // 实例化本轮纯内存 Scratchpad（全生命周期在内存中流转，零磁盘 I/O）
    let scratchpad = Scratchpad::new();

    let result = execute_dynamic_scriptwriter_pipeline(
        &pipeline_cfg.stages,
        pipeline_cfg.anchor_tail_chars,
        &pipeline_cfg.blackout_marker,
        user_input,
        &scratchpad,
        |stage_label, instruction, payload, pad| {
            let app = app.clone();
            let db = db.clone();
            let provider = provider.clone();
            let system = system.to_vec();
            async move {
                stage_call_with_scratchpad(
                    &app,
                    &db,
                    run_id,
                    conversation_id,
                    round_id,
                    &provider,
                    &system,
                    &stage_label,
                    &instruction,
                    &payload,
                    &pad,
                )
                .await
            }
        },
    )
    .await;

    // 回合结束：释放纯内存缓冲，彻底丢弃工作区（零磁盘残留）
    scratchpad.clear();

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
        SubAgentRequest::new(
            stage,
            stage_system,
            payload,
            provider.temperature,
            provider.max_tokens,
        ),
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

    #[tokio::test]
    async fn test_dynamic_pipeline_two_stages() {
        use crate::models::blueprint::ScriptwriterStage;
        let stages = vec![
            ScriptwriterStage {
                stage: "draft".to_string(),
                workspace_key: "draft".to_string(),
                prompt: "你是初稿编写者".to_string(),
                tools: vec![],
                tool_permissions: None,
            },
            ScriptwriterStage {
                stage: "refiner".to_string(),
                workspace_key: "final".to_string(),
                prompt: "你是定稿润色者".to_string(),
                tools: vec![],
                tool_permissions: None,
            },
        ];

        let scratchpad = Scratchpad::new();
        let executed_stages = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let executed_clone = executed_stages.clone();

        let final_result = execute_dynamic_scriptwriter_pipeline(
            &stages,
            20,
            "【背景锁定】",
            "玩家探索走廊",
            &scratchpad,
            move |label, instruction, payload, pad| {
                let executed = executed_clone.clone();
                async move {
                    executed.lock().unwrap().push((label.clone(), instruction.clone(), payload.clone()));
                    if label.contains("draft") {
                        Ok("幽暗的走廊里有微弱的灯光".to_string())
                    } else {
                        // 验证润色阶段接收到了尾锚与背景锁定标记
                        assert!(payload.contains("【背景锁定】"));
                        assert!(payload.contains("幽暗的走廊里有微弱的灯光"));
                        // 阶段 1 中间阶段为空，因而不需要批注意见标题
                        assert!(!payload.contains("【批注意见】"));
                        // 且能够从 scratchpad 中读取到初稿
                        let prev_draft = pad.read_text("draft").expect("read draft in final stage");
                        assert_eq!(prev_draft, "幽暗的走廊里有微弱的灯光");
                        Ok("幽暗的走廊深处，微弱灯光若隐若现。".to_string())
                    }
                }
            },
        )
        .await
        .expect("pipeline execution success");

        assert_eq!(final_result, "幽暗的走廊深处，微弱灯光若隐若现。");
        assert_eq!(executed_stages.lock().unwrap().len(), 2);

        // 验证中间结果均在 scratchpad 中
        assert_eq!(scratchpad.read_text("draft").unwrap(), "幽暗的走廊里有微弱的灯光");
        assert_eq!(scratchpad.read_text("final").unwrap(), "幽暗的走廊深处，微弱灯光若隐若现。");

        // 验证清理工作区
        scratchpad.clear();
        assert_eq!(scratchpad.snapshot().len(), 0);
    }

    #[tokio::test]
    async fn test_dynamic_pipeline_four_stages() {
        use crate::models::blueprint::ScriptwriterStage;
        let stages = vec![
            ScriptwriterStage {
                stage: "outline".to_string(),
                workspace_key: "outline".to_string(),
                prompt: "提炼分镜大纲".to_string(),
                tools: vec![],
                tool_permissions: None,
            },
            ScriptwriterStage {
                stage: "draft".to_string(),
                workspace_key: "draft_content".to_string(),
                prompt: "展开剧情初稿".to_string(),
                tools: vec![],
                tool_permissions: None,
            },
            ScriptwriterStage {
                stage: "critique".to_string(),
                workspace_key: "critique_notes".to_string(),
                prompt: "检查逻辑漏洞与节奏".to_string(),
                tools: vec![],
                tool_permissions: None,
            },
            ScriptwriterStage {
                stage: "polish".to_string(),
                workspace_key: "final".to_string(),
                prompt: "终稿修辞打磨".to_string(),
                tools: vec![],
                tool_permissions: None,
            },
        ];

        let scratchpad = Scratchpad::new();
        let executed_stages = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let executed_clone = executed_stages.clone();

        let final_result = execute_dynamic_scriptwriter_pipeline(
            &stages,
            30,
            "【前情锁定】",
            "调查失窃的秘宝",
            &scratchpad,
            move |label, instruction, payload, pad| {
                let executed = executed_clone.clone();
                async move {
                    executed.lock().unwrap().push((label.clone(), instruction.clone(), payload.clone()));
                    if label.contains("outline") {
                        assert_eq!(payload, "调查失窃的秘宝");
                        Ok("大纲：密室现场、窗户破损、神秘足迹".to_string())
                    } else if label.contains("draft") {
                        assert_eq!(payload, "大纲：密室现场、窗户破损、神秘足迹");
                        Ok("探长推开沉重的木门，密室内一片狼藉，窗框上残留着神秘的灰烬。".to_string())
                    } else if label.contains("critique") {
                        assert!(payload.contains("探长推开沉重的木门"));
                        Ok("批注：增加对足迹走向的描写。".to_string())
                    } else {
                        // 终稿润色阶段验证：包含前情锁定与中间阶段批注
                        assert!(payload.contains("【前情锁定】"));
                        assert!(payload.contains("【批注意见 · draft】") || payload.contains("【批注意见 · critique】"));
                        assert!(payload.contains("增加对足迹走向的描写。"));
                        // 验证 scratchpad 累积了各阶段变量
                        assert!(pad.read_text("outline").is_ok());
                        assert!(pad.read_text("draft_content").is_ok());
                        assert!(pad.read_text("critique_notes").is_ok());
                        Ok("探长推开沉重的橡木门，密室内一片狼藉，一行灰白足迹直指破碎的窗棂。".to_string())
                    }
                }
            },
        )
        .await
        .expect("execute 4 stages");

        assert_eq!(final_result, "探长推开沉重的橡木门，密室内一片狼藉，一行灰白足迹直指破碎的窗棂。");
        assert_eq!(executed_stages.lock().unwrap().len(), 4);

        // 验证各阶段产出都写入了工作区
        assert_eq!(scratchpad.read_text("outline").unwrap(), "大纲：密室现场、窗户破损、神秘足迹");
        assert_eq!(scratchpad.read_text("draft_content").unwrap(), "探长推开沉重的木门，密室内一片狼藉，窗框上残留着神秘的灰烬。");
        assert_eq!(scratchpad.read_text("critique_notes").unwrap(), "批注：增加对足迹走向的描写。");
        assert_eq!(scratchpad.read_text("final").unwrap(), "探长推开沉重的橡木门，密室内一片狼藉，一行灰白足迹直指破碎的窗棂。");

        scratchpad.clear();
        assert_eq!(scratchpad.snapshot().len(), 0);
    }

    #[tokio::test]
    async fn test_dynamic_pipeline_insufficient_stages() {
        let scratchpad = Scratchpad::new();
        let res = execute_dynamic_scriptwriter_pipeline(
            &[],
            10,
            "MARKER",
            "input",
            &scratchpad,
            |_l, _i, _p, _pad| async { Ok("res".to_string()) },
        )
        .await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("至少需要 2 个阶段"));
    }
}

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

    /// 图上 Branch 值源 `agent_pipeline` 使用的架构键（蛇形命名）。
    pub fn as_pipeline_key(&self) -> &'static str {
        match self {
            Self::Single => "single",
            Self::DirectorActor => "director_actor",
            Self::Scriptwriter => "scriptwriter",
        }
    }
}

/// 解析本轮流水线：编排架构完全由预设蓝图的 `AgentModeSwitch` 节点资产决定
/// （全 Agent 统一执行架构，工单 06：会话级 `chat_mode` 旧模式拦截已彻底
/// 移除，生产代码不再按会话标志分流）。
///
/// **按节点类型发现**（D-3：`AGENT_GATE_NODE_ID` 硬编码 id 已废除）——从编排资产
/// 全图提取中获取 `AgentModeSwitch` 节点 id 与缺省模式；Gate 面板选择覆盖缺省。
/// 蓝图缺该节点 = 该预设未声明多智能体编排，按单智能体直出（图即权威，
/// 不是静默回退：预设的编排意图只由其图资产表达）。
pub async fn resolve_pipeline(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<AgentPipeline, String> {
    let configs = crate::services::agent_runtime::load_blueprint_configs_for_conversation(
        db,
        conversation_id,
    )
    .await?;

    let Some(switch_cfg) = &configs.agent_mode_switch else {
        return Ok(AgentPipeline::Single);
    };
    let switch_node_id = &configs.agent_mode_switch_node_id;
    let preset_id: Option<i64> =
        sqlx::query_scalar("SELECT preset_id FROM conversations WHERE id = ? LIMIT 1")
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| format!("读取会话预设失败: {}", err))?
            .flatten();

    let selection = match preset_id {
        Some(pid) => PresetGateRepository::load_one(db, pid, switch_node_id)
            .await
            .map_err(|err| format!("读取智能体架构 Gate 失败: {}", err))?
            .map(|sel| crate::models::blueprint::GateSelection {
                keys: sel.selected_keys,
            }),
        None => None,
    };
    resolve_pipeline_key(switch_cfg, selection.as_ref())
}

/// 由 mode_switch 配置与 Gate 选择解析智能体架构（纯函数，无 IO）。
///
/// `resolve_pipeline`（运行期管道选择）与蓝图执行上下文的 `agent_pipeline`
/// 值源（图上 Branch 按真实管道路由执行流）共用本判定，保证 Gate 选择 →
/// 架构语义在全仓库只有一处实现。
///
/// Gate 选择取其第一个键；未选择 / 选择为空 / 无预设关联时回退
/// `default_mode`（与既有语义一致）。
pub fn resolve_pipeline_key(
    switch_cfg: &crate::models::blueprint::AgentModeSwitchConfig,
    selection: Option<&crate::models::blueprint::GateSelection>,
) -> Result<AgentPipeline, String> {
    let key = selection
        .and_then(|sel| sel.keys.first().cloned())
        .unwrap_or_else(|| switch_cfg.default_mode.clone());
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

/// 审阅裁决枚举，消除字符串原始类型偏执 (Primitive Obsession)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewVerdict {
    Approved,
    Rejected,
}

impl ReviewVerdict {
    pub fn parse(text: &str) -> Result<Self, String> {
        let upper = text.to_uppercase();
        let is_rejected = upper.contains("[REJECT]")
            || upper.contains("[REJECTED]")
            || upper.contains("[VERDICT: REJECT]")
            || upper.contains("[VERDICT:REJECT]")
            || text.contains("[打回]")
            || text.contains("[不合格]")
            || text.contains("[不通过]");
        let is_approved = upper.contains("[APPROVE]")
            || upper.contains("[APPROVED]")
            || upper.contains("[PASS]")
            || upper.contains("[VERDICT: APPROVE]")
            || upper.contains("[VERDICT:APPROVE]")
            || upper.contains("[VERDICT: PASS]")
            || upper.contains("[VERDICT:PASS]")
            || text.contains("[通过]")
            || text.contains("[合格]")
            || text.contains("合格通过")
            || text.contains("审核通过");

        if is_rejected && !is_approved {
            Ok(Self::Rejected)
        } else if is_approved && !is_rejected {
            Ok(Self::Approved)
        } else if is_rejected && is_approved {
            Err(format!(
                "审阅阶段输出同时包含了通过与打回冲突标记，无法决断: {}",
                text.chars().take(120).collect::<String>()
            ))
        } else {
            Err(format!(
                "审阅阶段输出未包含有效的裁决标记 (期望包含 [APPROVE] / [PASS] / [合格] 或 [REJECT] / [打回])，原文: {}",
                text.chars().take(120).collect::<String>()
            ))
        }
    }

    pub fn is_rejected(&self) -> bool {
        matches!(self, Self::Rejected)
    }

    pub fn is_rejected_text(text: &str) -> bool {
        let upper = text.to_uppercase();
        upper.contains("[REJECT]")
            || upper.contains("[REJECTED]")
            || upper.contains("[VERDICT: REJECT]")
            || upper.contains("[VERDICT:REJECT]")
            || text.contains("[打回]")
            || text.contains("[不合格]")
            || text.contains("[不通过]")
    }
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

    // 图语义编排（工单 03）：蓝图资产先编译为显式编排计划（节点 + Exec 出边 +
    // 门禁回边），编译失败（阶段不足 / 打回目标不存在）即显式报错终止。
    let plan = match crate::services::agent::graph_orchestrator::compile_scriptwriter_plan(
        &pipeline_cfg,
    ) {
        Ok(plan) => plan,
        Err(err) => {
            let _ = record_run_finish(db, run_id, "failed").await;
            return Err(err);
        }
    };

    // 实例化本轮纯内存 Scratchpad（全生命周期在内存中流转，零磁盘 I/O）
    let scratchpad = Scratchpad::new();

    let result = crate::services::agent::graph_orchestrator::execute_orchestration_plan(
        &plan,
        user_input,
        &scratchpad,
        |stage_cfg, stage_label, instruction, payload, pad| {
            let app = app.clone();
            let db = db.clone();
            let provider = provider.clone();
            let system = system.to_vec();
            let perms = stage_cfg.tool_permissions.clone();
            let fallback_tools = stage_cfg.tools.clone();
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
                    perms.as_ref(),
                    Some(&fallback_tools),
                )
                .await
            }
        },
        |loop_state: &crate::models::blueprint::RejectionLoopState| {
            crate::services::agent::timeline::emit(
                app,
                conversation_id,
                round_id,
                crate::services::agent::timeline::TimelineKind::LoopReject,
                crate::services::agent::timeline::TimelineStatus::Info,
                format!(
                    "审阅打回 ({} 第 {}/{} 次)",
                    loop_state.loop_id, loop_state.current_iteration, loop_state.max_iterations
                ),
                loop_state.last_critique.clone().unwrap_or_default(),
            );
        },
    )
    .await;

    if scratchpad.read_text("circuit_breaker_tripped").is_ok() {
        crate::services::agent::timeline::emit(
            app,
            conversation_id,
            round_id,
            crate::services::agent::timeline::TimelineKind::LoopReject,
            crate::services::agent::timeline::TimelineStatus::Blocked,
            "打回循环熔断 (Circuit Breaker Tripped)",
            "审阅打回已达上限次数，触发熔断保护并安全推进至终稿",
        );
    }

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
/// 工具权限按 Spec §4 规则过滤：若配置了 `tool_permissions`，仅挂载被允许的工具。
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
    tool_permissions: Option<&crate::models::blueprint::AgentToolPermissions>,
    fallback_tools: Option<&[String]>,
) -> Result<String, String> {
    let mut stage_system: Vec<String> = system.to_vec();
    stage_system.push(instruction.to_string());

    let mut all_tools = native_scratchpad_tools();
    if let Some(perms) = tool_permissions {
        for name in &perms.allowed_tools {
            if !all_tools.iter().any(|t| &t.name == name) {
                let def = crate::services::action_bridge::resolve_required_capability_tool_definition(name)?;
                all_tools.push(def);
            }
        }
    }
    if let Some(fb) = fallback_tools {
        for name in fb {
            if !all_tools.iter().any(|t| &t.name == name) {
                let def = crate::services::action_bridge::resolve_required_capability_tool_definition(name)?;
                all_tools.push(def);
            }
        }
    }
    let tools: Vec<crate::llm::LlmToolDefinition> = if let Some(perms) = tool_permissions {
        let tool_map: std::collections::HashMap<String, crate::llm::LlmToolDefinition> = all_tools
            .into_iter()
            .map(|t| (t.name.clone(), t))
            .collect();
        perms.filter_tool_definitions(&tool_map)
    } else if let Some(fb) = fallback_tools {
        if fb.is_empty() {
            all_tools
        } else {
            all_tools
                .into_iter()
                .filter(|t| fb.iter().any(|name| name == &t.name))
                .collect()
        }
    } else {
        all_tools
    };

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
        None,
        None,
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

    

    

    

    

    

    

    

    

    #[test]
    fn test_stage_tool_permissions_filtering() {
        use crate::models::blueprint::AgentToolPermissions;

        let all_tools = native_scratchpad_tools();
        assert_eq!(all_tools.len(), 2);

        // 1. allow_all = true -> both read_text and write_text
        let perms_all = AgentToolPermissions {
            allow_all: true,
            allowed_tools: vec![],
            require_approval: vec![],
        };
        let filtered_all: Vec<_> = all_tools
            .iter()
            .filter(|t| perms_all.is_tool_allowed(&t.name))
            .collect();
        assert_eq!(filtered_all.len(), 2);

        // 2. Critic stage with only read_text allowed -> write_text omitted
        let perms_readonly = AgentToolPermissions {
            allow_all: false,
            allowed_tools: vec!["read_text".to_string()],
            require_approval: vec![],
        };
        let filtered_readonly: Vec<_> = all_tools
            .iter()
            .filter(|t| perms_readonly.is_tool_allowed(&t.name))
            .collect();
        assert_eq!(filtered_readonly.len(), 1);
        assert_eq!(filtered_readonly[0].name, "read_text");

        // 3. allow_all = false with empty allowed_tools -> 0 tools
        let perms_none = AgentToolPermissions {
            allow_all: false,
            allowed_tools: vec![],
            require_approval: vec![],
        };
        let filtered_none: Vec<_> = all_tools
            .iter()
            .filter(|t| perms_none.is_tool_allowed(&t.name))
            .collect();
        assert_eq!(filtered_none.len(), 0);

        // 4. require_approval correctly identifies high-risk tools needing gating
        let perms_approval = AgentToolPermissions {
            allow_all: true,
            allowed_tools: vec!["write_text".to_string()],
            require_approval: vec!["write_text".to_string()],
        };
        assert!(perms_approval.requires_approval("write_text"));
        assert!(!perms_approval.requires_approval("read_text"));
    }
}

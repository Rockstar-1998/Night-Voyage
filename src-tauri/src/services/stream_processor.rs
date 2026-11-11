use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{Duration, Instant};

use crate::llm::{
    LlmBinarySource, LlmChatRequest, LlmContentPart, LlmRole, LlmToolDefinition,
    ProviderHttpRequest,
};
use crate::models::{ApiProvider, ChatAttachment, StreamErrorEvent, StreamRetryEvent};
use crate::services::agent::cycle::{
    AgentCycleConfig, AgentCycleOutcome, AgentCycleRuntime, AgentFinishReason, AgentStepResponse,
    AgentToolCall,
};
use crate::services::agent::stream_cycle::{
    short_circuit_narrative, translate_step_budget, StreamingStepBackend, StreamingStepProvider,
    StreamingToolBackend, StreamingToolExecutor,
};
use crate::repositories::conversation_repository::ConversationRepository;
use crate::repositories::message_repository::{
    normalize_tool_use_input_json,
};
use crate::repositories::message_repository::{
    MessageRepository, PendingMessageContentPart, PendingToolUseSkeleton,
};
use crate::repositories::llm_retry_snapshot_repository::{
    RetrySnapshotRepository, RetrySnapshotSeed,
};
use crate::repositories::round_repository::RoundRepository;
use crate::services::chat_service::{
    broadcast_stream_end, emit_llm_stream_event, emit_object_field_complete_event,
    emit_round_state, emit_stream_message_stop, emit_structured_field_delta_event,
    build_compatibility_fallback_json, emit_compatibility_mode_event,
    finalize_streamed_response, flush_text_delta_event, save_agent_debug_log,
    save_llm_debug_log,
};
use crate::services::prompt_compiler::{
    PromptBudget, PromptCompileInput, PromptCompileMode, PromptCompileResult,
};
use crate::services::provider_adapter::{
    build_llm_chat_request, build_provider_http_request, ProviderCapabilityMatrix,
};
use crate::dbg_eprintln;

const STREAM_ABORTED_ERROR: &str = "__stream_aborted__";

struct StreamResponseData {
    full_content: String,
    thinking_content: Option<String>,
    stop_reason: Option<String>,
    /// 本轮模型请求执行的工具调用（Anthropic `tool_use` / OpenAI `tool_calls`）。
    ///
    /// 非空时调用方必须执行这些工具并把 `tool_result` 回注后继续下一跳——
    /// 这里**不再**用 `Err` 终止流（旧实现以错误收场，ToolCall 回路因此断掉）。
    pending_tool_uses: Vec<PendingToolUseSkeleton>,
}

/// 流式 ToolCall 静默拼装缓冲（分而治之流式管线的工具侧通道）。
///
/// 对白 Token 走前端打字机通道实时发射；工具 Token 只进本缓冲逐片拼装，
/// 不产生任何对白事件。流终止时由 [`StreamingToolAccumulator::finish`]
/// 一次性做全量校验（id/name 齐备、arguments 为合法 JSON），校验通过才把
/// 骨架清单交给编排层执行——任一骨架残缺即整批硬错（C2），绝不让半成品
/// 工具调用流入执行层后再逐个失败。
#[derive(Debug, Default)]
pub struct StreamingToolAccumulator {
    slots: Vec<PendingToolUseSkeleton>,
}

impl StreamingToolAccumulator {
    /// 新建空缓冲。
    pub fn new() -> Self {
        Self { slots: Vec::new() }
    }

    /// 缓冲内是否尚无任何工具调用分片。
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// 当前拼装中的骨架只读视图（流式期间增量刷新 content part 用）。
    pub fn skeletons(&self) -> &[PendingToolUseSkeleton] {
        &self.slots
    }

    /// 喂入一片 OpenAI `delta.tool_calls`。
    ///
    /// OpenAI 按 `index` 分片下发：id / function.name 通常只在首片出现，
    /// arguments 逐片拼接。本方法只做拼装不做校验，校验收口在 `finish`。
    pub fn feed_openai_delta(&mut self, call: &Value) {
        let index = call.get("index").and_then(|v| v.as_i64()).unwrap_or(0);
        let slot = match self
            .slots
            .iter_mut()
            .find(|skeleton| skeleton.provider_part_index == index)
        {
            Some(existing) => existing,
            None => {
                self.slots.push(PendingToolUseSkeleton {
                    provider_part_index: index,
                    tool_use_id: String::new(),
                    tool_name: String::new(),
                    input_json: String::new(),
                });
                let last = self.slots.len() - 1;
                &mut self.slots[last]
            }
        };
        if let Some(id) = call.get("id").and_then(|v| v.as_str()) {
            if !id.is_empty() {
                slot.tool_use_id = id.to_string();
            }
        }
        if let Some(name) = call
            .get("function")
            .and_then(|function| function.get("name"))
            .and_then(|v| v.as_str())
        {
            if !name.is_empty() {
                slot.tool_name = name.to_string();
            }
        }
        if let Some(arguments) = call
            .get("function")
            .and_then(|function| function.get("arguments"))
            .and_then(|v| v.as_str())
        {
            slot.input_json.push_str(arguments);
        }
    }

    /// 登记一个 Anthropic `content_block_start(tool_use)` 骨架。
    ///
    /// Anthropic 在 block 开始时即给出完整 id/name，arguments 随后由
    /// `input_json_delta` 逐片补齐，因此这里不需要 OpenAI 式的空槽占位。
    pub fn begin_anthropic_tool_use(
        &mut self,
        provider_part_index: i64,
        tool_use_id: &str,
        tool_name: &str,
    ) {
        self.slots.push(PendingToolUseSkeleton {
            provider_part_index,
            tool_use_id: tool_use_id.to_string(),
            tool_name: tool_name.to_string(),
            input_json: String::new(),
        });
    }

    /// 喂入一片 Anthropic `input_json_delta`，返回拼装中的骨架供调用方
    /// 增量刷新 content part。找不到对应骨架即硬错（C2，不静默丢片）。
    pub fn feed_anthropic_json_delta(
        &mut self,
        provider_part_index: i64,
        partial_json: &str,
    ) -> Result<&PendingToolUseSkeleton, String> {
        let slot = self
            .slots
            .iter_mut()
            .find(|skeleton| skeleton.provider_part_index == provider_part_index)
            .ok_or_else(|| {
                "Anthropic tool_use input_json_delta 缺少 pending tool_use 上下文".to_string()
            })?;
        slot.input_json.push_str(partial_json);
        Ok(slot)
    }

    /// 流终止定稿：全量校验后产出可执行骨架清单。
    ///
    /// 校验规则（任一不过即整批 Err，调用方不得执行任何一条）：
    /// - 每个骨架必须有非空 `tool_use_id` 与 `tool_name`；
    /// - `input_json` 归一化后必须是合法 JSON（空参数归一为 `{}`）。
    pub fn finish(self) -> Result<Vec<PendingToolUseSkeleton>, String> {
        let mut skeletons = self.slots;
        for skeleton in &mut skeletons {
            if skeleton.tool_use_id.is_empty() {
                return Err(format!(
                    "流式 ToolCall 拼装残缺：index={} 的工具调用缺少 id",
                    skeleton.provider_part_index
                ));
            }
            if skeleton.tool_name.is_empty() {
                return Err(format!(
                    "流式 ToolCall 拼装残缺：id={} 的工具调用缺少 name",
                    skeleton.tool_use_id
                ));
            }
            let normalized = normalize_tool_use_input_json(&skeleton.input_json);
            if let Err(err) = serde_json::from_str::<Value>(&normalized) {
                return Err(format!(
                    "ToolCall {}（{}）的 arguments 不是合法 JSON: {}",
                    skeleton.tool_name, skeleton.tool_use_id, err
                ));
            }
            skeleton.input_json = normalized;
        }
        Ok(skeletons)
    }
}

/// 一条工具执行回执的旁白摘要视图（工具名 + 成败）。
///
/// 旁白合成只消费这一最小视图，不接触回执正文，避免把可能很长的工具
/// 输出整段塞进对白气泡。
#[derive(Debug, Clone, Copy)]
pub struct ToolReceiptSummary<'a> {
    /// 工具名（来自蓝图工具定义）。
    pub tool_name: &'a str,
    /// 是否失败或被门禁拦截。
    pub is_error: bool,
}

/// 零延迟旁白合成（spec §3）：模型只发 ToolCall、没写对白时，依据工具
/// 回执在服务端合成一条极简行为旁白，杜绝空白消息气泡；不发起第二次
/// 模型请求。无回执时返回 `None`（没有发生过交互结算，不许凭空编旁白）。
pub fn synthesize_fallback_narrative(receipts: &[ToolReceiptSummary<'_>]) -> Option<String> {
    if receipts.is_empty() {
        return None;
    }
    let summary = receipts
        .iter()
        .map(|receipt| {
            format!(
                "{} {}",
                receipt.tool_name,
                if receipt.is_error { "失败" } else { "成功" }
            )
        })
        .collect::<Vec<_>>()
        .join("、");
    Some(format!("*（完成了交互结算：[{}]）*", summary))
}

/// 把零延迟旁白回填到本轮助手消息（仅当正文为空白时）。
///
/// 返回 `true` 表示确实回填了旁白。回填点选在工具执行完毕、回注下一跳
/// 之前：此刻回执齐备，且合成文本会随历史进入下一跳上下文，模型读到的
/// 自己上一 hop 的发言与玩家看到的气泡保持一致。
pub async fn fill_fallback_narrative_if_empty(
    db: &SqlitePool,
    round_id: i64,
    receipts: &[ToolReceiptSummary<'_>],
) -> Result<bool, String> {
    let Some(narrative) = synthesize_fallback_narrative(receipts) else {
        return Ok(false);
    };
    let assistant_message_id: Option<i64> = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT active_assistant_message_id FROM message_rounds WHERE id = ?",
    )
    .bind(round_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?
    .flatten();
    let Some(assistant_message_id) = assistant_message_id else {
        return Ok(false);
    };
    let current_content: String =
        sqlx::query_scalar("SELECT content FROM messages WHERE id = ?")
            .bind(assistant_message_id)
            .fetch_one(db)
            .await
            .map_err(|err| err.to_string())?;
    if !current_content.trim().is_empty() {
        return Ok(false);
    }
    MessageRepository::update_content(db, assistant_message_id, &narrative).await?;
    Ok(true)
}

/// 工具轮次的统一收尾：校验缓冲 → 骨架落盘 → 逐条发射 tool_use 事件 →
/// 把待执行清单交回编排层。
///
/// OpenAI 的 `[DONE]` / 流自然结束与 Anthropic 的 `stop_reason=tool_use`
/// 三条路径共用本收尾，保证「工具只在流终止后、校验通过才进入执行层」
/// 在各 provider 下行为一致（此前 OpenAI 的 `[DONE]` 分支会把已拼装的
/// 工具调用直接丢弃并按纯文本定稿）。
#[allow(clippy::too_many_arguments)]
async fn complete_tool_use_turn(
    accumulator: StreamingToolAccumulator,
    content_parts: &mut Vec<PendingMessageContentPart>,
    content_part_lookup: &mut HashMap<String, usize>,
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    assistant_message_id: i64,
    provider_kind: &str,
    full_content: String,
    thinking_content: String,
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
) -> Result<StreamResponseData, String> {
    let pending_tool_uses = accumulator.finish()?;

    for skeleton in &pending_tool_uses {
        let next_index = content_parts.len() as i64;
        let content_index = ensure_content_part_by_key(
            content_parts,
            content_part_lookup,
            &skeleton.tool_use_id,
            next_index,
            "tool_use",
        );
        content_parts[content_index].tool_use_id = Some(skeleton.tool_use_id.clone());
        content_parts[content_index].tool_name = Some(skeleton.tool_name.clone());
        content_parts[content_index].json_value = Some(skeleton.input_json.clone());
    }

    RoundRepository::persist_tool_use_skeletons(
        db,
        conversation_id,
        round_id,
        assistant_message_id,
        provider_kind,
        &full_content,
        content_parts.as_slice(),
        &pending_tool_uses,
    )
    .await?;

    for skeleton in &pending_tool_uses {
        emit_llm_stream_event(
            app,
            conversation_id,
            round_id,
            assistant_message_id,
            provider_kind,
            "tool_use",
            Some(skeleton.provider_part_index),
            Some("tool_use"),
            None,
            Some(skeleton.input_json.clone()),
            Some(crate::models::LlmStreamToolUseEvent {
                id: skeleton.tool_use_id.clone(),
                name: skeleton.tool_name.clone(),
            }),
            Some("tool_use"),
            prompt_tokens,
            completion_tokens,
        )?;
    }

    Ok(StreamResponseData {
        full_content,
        thinking_content: if thinking_content.is_empty() {
            None
        } else {
            Some(thinking_content)
        },
        stop_reason: Some("tool_use".to_string()),
        pending_tool_uses,
    })
}

fn map_structured_field_part_type(key: &str) -> &'static str {
    match key {
        "thinking" => "thinking",
        _ => "structured_output",
    }
}

fn ensure_content_part_by_key(
    content_parts: &mut Vec<PendingMessageContentPart>,
    content_part_lookup: &mut HashMap<String, usize>,
    key: &str,
    next_index: i64,
    part_type: &str,
) -> usize {
    if let Some(index) = content_part_lookup.get(key) {
        return *index;
    }
    let index = content_parts.len();
    content_parts.push(PendingMessageContentPart {
        part_index: next_index,
        part_type: part_type.to_string(),
        text_value: None,
        json_value: None,
        asset_id: None,
        mime_type: None,
        tool_use_id: None,
        tool_name: None,
        is_hidden: false,
    });
    content_part_lookup.insert(key.to_string(), index);
    index
}

fn append_content_part_text(part: &mut PendingMessageContentPart, delta: &str) {
    let text = part.text_value.get_or_insert_with(String::new);
    text.push_str(delta);
}

async fn is_round_aborted(db: &SqlitePool, round_id: i64, assistant_message_id: i64) -> Result<bool, String> {
    let row: Option<(Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT status, active_assistant_message_id FROM message_rounds WHERE id = ? LIMIT 1",
    )
    .bind(round_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    match row {
        None => Ok(true),
        Some((status, active_msg_id)) => {
            if status.as_deref() == Some("aborted") {
                return Ok(true);
            }
            if active_msg_id != Some(assistant_message_id) {
                dbg_eprintln!(
                    "[chat] is_round_aborted: active_assistant_message_id mismatch, expected={}, got={:?}, treating as aborted",
                    assistant_message_id, active_msg_id
                );
                return Ok(true);
            }
            let msg_exists: bool = sqlx::query_scalar(
                "SELECT COUNT(*) FROM messages WHERE id = ?",
            )
            .bind(assistant_message_id)
            .fetch_one(db)
            .await
            .map(|count: i64| count > 0)
            .unwrap_or(false);
            if !msg_exists {
                dbg_eprintln!(
                    "[chat] is_round_aborted: assistant_message_id={} no longer exists, treating as aborted",
                    assistant_message_id
                );
                return Ok(true);
            }
            Ok(false)
        }
    }
}

/// Maximum number of LLM request attempts for a single chat round when
/// automatic retry is enabled (i.e. after the user clicks "自动重试").
/// The initial send is not auto-retry and is not counted here.
const MAX_CHAT_AUTO_RETRY_ATTEMPTS: i64 = 4;

/// 多智能体的一轮：按蓝图资产选定的编排计划分发 → 最终稿作为本轮正文落盘。
///
/// 终局定位（工单 01-S1 双轨整合后）：本函数只剩「按 `AgentPipeline`
/// 标签分发图编排计划」一件事——导演-演员与编剧线均已在阶段 2 改走
/// 图编排计划（FanOut 扇出 / 编排计划执行器），单智能体轮次则由
/// `AgentCycleRuntime` 经流式 Adapter 驱动（见 `stream_llm_response`），
/// `Single` 永不路由到这里（误入即显式报错）。因此它不再是与单智能体
/// 并行的第二条执行轨道：内部不含任何步进 / 短路 / 熔断逻辑，终稿后
/// 的禁词 Nudge 是内容门禁重试而非步长政策。保留原名是因为其职责
/// （多智能体一轮的分发与收尾）未变，改名只会制造无意义的符号漂移。
///
/// 与单智能体路径的差别（如实告知，不假装等价）：
/// - 正文**不是逐字流式**（流水线要等各子角色产出完毕），前端收到的是一个整段 chunk；
/// - 不产出结构化输出，因此 schema 类 HUD 补丁在本轮为空（预置的 Schema 联动在单智能体路径上）。
async fn run_multi_agent_round(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    pipeline: crate::services::agent::orchestrator::AgentPipeline,
) {
    let fail = |error: String| {
        let app = app.clone();
        let db = db.clone();
        async move {
            let _ = RoundRepository::mark_failed(&db, round_id).await;
            let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;
            let _ = app.emit(
                "llm-stream-error",
                StreamErrorEvent {
                    conversation_id,
                    round_id,
                    message_id: assistant_message_id,
                    error,
                },
            );
            broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
        }
    };

    let provider = match ConversationRepository::load_provider(db, provider_id).await {
        Ok(provider) => provider,
        Err(err) => return fail(format!("剧本流水线加载 provider 失败: {}", err)).await,
    };

    let (system, user_input) = match crate::services::agent::orchestrator::assemble_context(
        db,
        conversation_id,
        round_id,
        &provider.provider_kind,
        &provider.model_name,
    )
    .await
    {
        Ok(context) => context,
        Err(err) => return fail(format!("剧本流水线装配上下文失败: {}", err)).await,
    };

    let final_text = match pipeline {
        crate::services::agent::orchestrator::AgentPipeline::Scriptwriter => {
            crate::services::agent::orchestrator::run_scriptwriter_pipeline(
                app, db, conversation_id, round_id, &provider, &system, &user_input,
            )
            .await
        }
        crate::services::agent::orchestrator::AgentPipeline::DirectorActor => {
            crate::services::agent::director_actor::run_director_actor_pipeline(
                app, db, conversation_id, round_id, &provider, &system, &user_input,
            )
            .await
        }
        // 单模型不会走到这里：调用方只把两条流水线路由进来。
        crate::services::agent::orchestrator::AgentPipeline::Single => {
            return fail("内部错误：单模型流水线不应进入多智能体执行路径".to_string()).await
        }
    };

    // 禁词门禁同样作用于流水线终稿：流水线不豁免内容合规。
    // 词库来自蓝图 BannedWordsConfig 节点资产（spec §2A.3，D-6）。
    // 命中 → 注入 Nudge 改写指令重跑流水线末段，最多 2 次（计划 §6.3"命中则阻断提交
    // （最多重试 2 次），注入高优先级合成 Critic Nudge 改写指令"——A14 整改：
    // 此前流水线路径直接作废不重试）。
    let banned_config = match crate::services::agent_runtime::load_blueprint_configs_for_conversation(
        db,
        conversation_id,
    )
    .await
    {
        Ok(configs) => configs.banned_words,
        Err(err) => return fail(format!("加载蓝图编排配置失败: {}", err)).await,
    };
    let filter_result = crate::services::agent_guards::BannedWordsFilter::from_words(
        &banned_config.map(|cfg| cfg.words).unwrap_or_default(),
    );
    let mut final_text = match final_text {
        Ok(text) => text,
        Err(err) => return fail(format!("{}执行失败: {}", pipeline.label(), err)).await,
    };
    match filter_result {
        Ok(filter) => {
            const MAX_NUDGE_RETRIES: usize = 2;
            let mut nudge_attempts: usize = 0;
            loop {
                match filter.validate(&final_text) {
                    Ok(()) => break,
                    Err(violation) => {
                        if nudge_attempts >= MAX_NUDGE_RETRIES {
                            let reason = format!(
                                "剧本流水线终稿 {} 次自纠后仍命中禁词（{}），本轮内容作废：{}",
                                nudge_attempts,
                                violation.matched_words.join("、"),
                                violation.feedback_instruction
                            );
                            crate::services::agent::timeline::emit(
                                app,
                                conversation_id,
                                round_id,
                                crate::services::agent::timeline::TimelineKind::NudgeRetry,
                                crate::services::agent::timeline::TimelineStatus::Failed,
                                "剧本流水线终稿自纠失败".to_string(),
                                reason.clone(),
                            );
                            return fail(reason).await;
                        }
                        nudge_attempts += 1;
                        // Nudge 改写：把禁词驳回意见作为指令重跑流水线末段
                        //（Scriptwriter → 只重跑润色段；DirectorActor → 重跑装配缝合段）。
                        crate::services::agent::timeline::emit(
                            app,
                            conversation_id,
                            round_id,
                            crate::services::agent::timeline::TimelineKind::NudgeRetry,
                            crate::services::agent::timeline::TimelineStatus::Blocked,
                            format!("禁词命中，第 {}/{} 次自纠", nudge_attempts, MAX_NUDGE_RETRIES),
                            violation.matched_words.join("、"),
                        );
                        let rewrite_input = format!(
                            "{}\n\n【禁词自纠指令（第 {} 次重写）】\n上一版终稿命中禁词（{}）。请在保持剧情走向与已完成事实不变的前提下重写完整正文，彻底消除上述禁词，只输出重写后的正文。\n\n【上一版终稿】\n{}",
                            violation.feedback_instruction,
                            nudge_attempts,
                            violation.matched_words.join("、"),
                            final_text
                        );
                        let rewritten = match pipeline {
                            crate::services::agent::orchestrator::AgentPipeline::Scriptwriter => {
                                crate::services::agent::orchestrator::run_scriptwriter_nudge_pass(
                                    app, db, conversation_id, round_id, &provider, &system,
                                    &rewrite_input,
                                )
                                .await
                            }
                            crate::services::agent::orchestrator::AgentPipeline::DirectorActor => {
                                crate::services::agent::director_actor::run_director_nudge_pass(
                                    app, db, conversation_id, round_id, &provider, &system,
                                    &rewrite_input,
                                )
                                .await
                            }
                            crate::services::agent::orchestrator::AgentPipeline::Single => {
                                return fail("内部错误：单模型流水线不应进入多智能体执行路径".to_string()).await
                            }
                        };
                        match rewritten {
                            Ok(text) if !text.trim().is_empty() => final_text = text,
                            Ok(_) => {
                                return fail("流水线自纠返回空内容，本轮作废".to_string()).await
                            }
                            Err(err) => {
                                return fail(format!("禁词自纠重写失败: {}", err)).await
                            }
                        }
                    }
                }
            }
        }
        Err(err) => return fail(err).await,
    }

    if let Err(err) = MessageRepository::update_content(db, assistant_message_id, &final_text).await {
        return fail(format!("写入流水线终稿失败: {}", err)).await;
    }
    if let Err(err) = MessageRepository::replace_content_parts(
        db,
        assistant_message_id,
        &[PendingMessageContentPart {
            part_index: 0,
            part_type: "text".to_string(),
            text_value: Some(final_text.clone()),
            json_value: None,
            asset_id: None,
            mime_type: None,
            tool_use_id: None,
            tool_name: None,
            is_hidden: false,
        }],
    )
    .await
    {
        return fail(format!("写入流水线终稿 parts 失败: {}", err)).await;
    }

    let _ = RetrySnapshotRepository::mark_succeeded(db, round_id).await;
    let _ = emit_llm_stream_event(
        app,
        conversation_id,
        round_id,
        assistant_message_id,
        &provider.provider_kind,
        "text",
        Some(0),
        Some("text"),
        Some(final_text.clone()),
        None,
        None,
        None,
        None,
        None,
    );
    broadcast_stream_end(app, conversation_id, round_id, assistant_message_id).await;

    // 轮后任务：记忆提取 / 摘要 / 结构化持久化等，单模型路径该做的事流水线也一样要做。
    spawn_post_round_tasks(
        app,
        db,
        conversation_id,
        round_id,
        provider_id,
        assistant_message_id,
        &HashMap::new(),
        &std::collections::HashSet::new(),
        &final_text,
    )
    .await;
}

pub fn spawn_stream_task(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    attachments: Vec<ChatAttachment>,
    auto_retry_enabled: bool,
) {
    tauri::async_runtime::spawn(async move {
        dbg_eprintln!(
            "[chat] spawn_stream_task: starting stream_llm_response, conversation_id={}, round_id={}, provider_id={}, assistant_message_id={}",
            conversation_id, round_id, provider_id, assistant_message_id
        );

        // 工单 04：每轮 Agent 执行前捕获状态快照基线（首次捕获为准，同轮
        // 重试不覆盖）。Regenerate/Delete/Rewind 的状态回滚以此为基线；
        // 捕获失败 = 本轮无回滚保障，按 C2 显式失败收尾，绝不静默裸奔。
        if let Err(err) = crate::repositories::round_snapshot_repository::RoundSnapshotRepository::capture_baseline(
            &db,
            conversation_id,
            round_id,
        )
        .await
        {
            let _ = RoundRepository::mark_failed(&db, round_id).await;
            let _ = app.emit(
                "llm-stream-error",
                StreamErrorEvent {
                    conversation_id,
                    round_id,
                    message_id: assistant_message_id,
                    error: format!("轮次状态快照捕获失败: {}", err),
                },
            );
            broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
            return;
        }

        // Auto-retry loop: keep retrying until the model responds successfully
        // or the user aborts. Each retry reuses the same assistant_message_id
        // and round, clearing previous partial content.
        //
        // Nudge 状态与循环同寿命：同一回合内的禁词纠偏次数在这里累计。
        // 词库与 Nudge 参数来自蓝图 BannedWordsConfig 节点资产（spec §2A.3，D-1/D-6）；
        // 加载失败属确定性故障：按本任务统一失败路径收尾，不放行未校验内容。
        let banned_config: crate::models::blueprint::BannedWordsConfig = match
            crate::services::agent_runtime::load_blueprint_configs_for_conversation(
                &db, conversation_id,
            )
            .await
        {
            Ok(configs) => configs.banned_words.unwrap_or_default(),
            Err(err) => {
                let _ = RoundRepository::mark_failed(&db, round_id).await;
                let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &err).await;
                let _ = app.emit(
                    "llm-stream-error",
                    StreamErrorEvent {
                        conversation_id,
                        round_id,
                        message_id: assistant_message_id,
                        error: err,
                    },
                );
                broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                return;
            }
        };
        let mut nudge_guard = crate::services::agent::nudge::NudgeGuard::new(
            banned_config.max_nudge_retries,
            banned_config.nudge_instruction_template.clone(),
        );
        let mut ephemeral_instruction: Option<String> = None;

        // 多智能体编排：本轮是"单模型直出"还是某条流水线，先定下来。
        // 编排只由蓝图 AgentModeSwitch 资产决定（工单 06：chat_mode 拦截已
        // 移除）；解析失败（Gate 选项未知）即报错收尾——不默认落到单模型，
        // 否则用户以为在跑流水线、实际是单模型直出。
        let pipeline = match crate::services::agent::orchestrator::resolve_pipeline(
            &db,
            conversation_id,
        )
        .await
        {
            Ok(pipeline) => pipeline,
            Err(err) => {
                let _ = RoundRepository::mark_failed(&db, round_id).await;
                let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &err).await;
                let _ = app.emit(
                    "llm-stream-error",
                    StreamErrorEvent {
                        conversation_id,
                        round_id,
                        message_id: assistant_message_id,
                        error: err,
                    },
                );
                broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                return;
            }
        };

        if pipeline != crate::services::agent::orchestrator::AgentPipeline::Single {
            run_multi_agent_round(
                &app,
                &db,
                conversation_id,
                round_id,
                provider_id,
                assistant_message_id,
                pipeline,
            )
            .await;
            return;
        }
        loop {
            // Mark the retry attempt in the snapshot (tracks attempt_count).
            // Capture the snapshot to read attempt_count for retry notifications.
            let attempt_count = RetrySnapshotRepository::mark_attempt_started(&db, round_id)
                .await
                .map(|s| s.attempt_count)
                .unwrap_or(0);

            // Cap automatic retries to avoid hammering a permanently failing provider.
            if auto_retry_enabled && attempt_count > MAX_CHAT_AUTO_RETRY_ATTEMPTS {
                let error = format!(
                    "已达到最大自动重试次数（{} 次），请检查 provider 网络或稍后手动重试",
                    MAX_CHAT_AUTO_RETRY_ATTEMPTS
                );
                dbg_eprintln!(
                    "[chat] spawn_stream_task: max auto retries reached, conversation_id={}, round_id={}, attempt_count={}",
                    conversation_id, round_id, attempt_count
                );
                let _ = RoundRepository::mark_failed(&db, round_id).await;
                let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;
                let _ = app.emit(
                    "llm-stream-error",
                    StreamErrorEvent {
                        conversation_id,
                        round_id,
                        message_id: assistant_message_id,
                        error,
                    },
                );
                broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                break;
            }

            let stream_result = stream_llm_response(
                app.clone(),
                db.clone(),
                conversation_id,
                round_id,
                provider_id,
                assistant_message_id,
                attachments.clone(),
                ephemeral_instruction.as_deref(),
            )
            .await;

            match stream_result {
                Err(error) => {
                    dbg_eprintln!(
                        "[chat] spawn_stream_task: stream_llm_response FAILED (attempt), conversation_id={}, round_id={}, error={}",
                        conversation_id, round_id, error
                    );
                    crate::services::chat_service::chat_debug_log(
                        &app,
                        &format!(
                            "stream FAILED (will retry): conv={}, round={}, error={}",
                            conversation_id, round_id, error
                        ),
                    );

                    // If the user aborted, stop the loop immediately.
                    if error == STREAM_ABORTED_ERROR {
                        let _ = RoundRepository::mark_failed(&db, round_id).await;
                        let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;
                        let _ = app.emit(
                            "llm-stream-error",
                            StreamErrorEvent {
                                conversation_id,
                                round_id,
                                message_id: assistant_message_id,
                                error,
                            },
                        );
                        broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                        break;
                    }

                    // Prompt compilation errors (e.g. mem0 retrieval failure)
                    // are deterministic — retrying will not fix them. Emit
                    // the error to the UI and stop.
                    if error.contains("mem0 retrieval failed")
                        || error.contains("Prompt Compiler")
                    {
                        let _ = RoundRepository::mark_failed(&db, round_id).await;
                        let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;
                        let _ = app.emit(
                            "llm-stream-error",
                            StreamErrorEvent {
                                conversation_id,
                                round_id,
                                message_id: assistant_message_id,
                                error,
                            },
                        );
                        broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                        break;
                    }

                    // Check if the user aborted during the stream (status = 'aborted').
                    if let Ok(true) = is_round_aborted(&db, round_id, assistant_message_id).await {
                        dbg_eprintln!(
                            "[chat] spawn_stream_task: round aborted by user, stopping retry loop, round_id={}",
                            round_id
                        );
                        // 工单 04 SubmitAbort：物理丢弃未提交的回合内状态缓冲
                        // （暂存缓存中的工具突变 + 本任务局部的流式工具累积器
                        // 随任务结束一并析构），确保无脏数据落盘。
                        crate::services::agent_runtime::discard_session_state_cache(
                            &app,
                            conversation_id,
                        )
                        .await;
                        let _ = RetrySnapshotRepository::mark_aborted(&db, round_id).await;
                        broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                        break;
                    }

                    // Mark the snapshot as failed (but keep the round in streaming
                    // state so the next retry attempt can proceed).
                    let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &error).await;

                    // Notify the frontend that a retry is being attempted.
                    let _ = app.emit(
                        "llm-stream-retry",
                        StreamRetryEvent {
                            conversation_id,
                            round_id,
                            message_id: assistant_message_id,
                            error: error.clone(),
                            attempt_count,
                            auto_retry_enabled,
                        },
                    );

                    {
                        let state = app.state::<crate::AppState>();
                        let host_server = state.host_server.lock().await;
                        if let Some(server) = host_server.as_ref() {
                            let server = server.lock().await;
                            let msg = crate::network::RoomMessage::StreamRetry {
                                conversation_id,
                                round_id,
                                message_id: assistant_message_id,
                                error: error.clone(),
                                attempt_count,
                                auto_retry_enabled,
                            };
                            server.broadcast_message(&msg).await;
                        }
                    }

                    // Reset the assistant message content for the next attempt.
                    let now = crate::utils::now_ts();
                    let _ = sqlx::query("UPDATE messages SET content = '' WHERE id = ?")
                        .bind(assistant_message_id)
                        .execute(&db)
                        .await;
                    let _ = sqlx::query(
                        "DELETE FROM message_content_parts WHERE message_id = ?",
                    )
                    .bind(assistant_message_id)
                    .execute(&db)
                    .await;
                    let _ = sqlx::query(
                        "UPDATE message_rounds SET status = 'streaming', updated_at = ? WHERE id = ?",
                    )
                    .bind(now)
                    .bind(round_id)
                    .execute(&db)
                    .await;

                    if !auto_retry_enabled {
                        // 首次失败不自动重试，等待用户点击"自动重试"按钮
                        dbg_eprintln!(
                            "[chat] spawn_stream_task: first failure, auto_retry disabled, breaking loop, conversation_id={}, round_id={}",
                            conversation_id, round_id
                        );
                        break;
                    }

                    // Brief delay before retrying to avoid hammering the API.
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

                    dbg_eprintln!(
                        "[chat] spawn_stream_task: retrying stream_llm_response, conversation_id={}, round_id={}",
                        conversation_id, round_id
                    );
                    // Continue the loop to retry.
                    continue;
                }
                Ok((data, db_mappings, persistent_hud_keys)) => {
                    // 禁词门禁：在终稿对外可见/进入历史之前拦。
                    // 命中且有额度 → 作废本轮正文、注入纠偏指令重生成；
                    // 额度用尽 → 硬错收尾，且**不把违规文本留在库里**。
                    let guard = match crate::services::agent_guards::BannedWordsFilter::from_words(
                        &banned_config.words,
                    ) {
                        Ok(guard) => guard,
                        Err(err) => {
                            // 门禁构建失败属确定性故障：报错收尾，不放行未校验内容。
                            let _ = RoundRepository::mark_failed(&db, round_id).await;
                            let _ = app.emit(
                                "llm-stream-error",
                                StreamErrorEvent {
                                    conversation_id,
                                    round_id,
                                    message_id: assistant_message_id,
                                    error: err.clone(),
                                },
                            );
                            broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                            break;
                        }
                    };
                    if let Err(violation) = guard.validate(&data.full_content) {
                        match nudge_guard.on_violation(&violation) {
                            crate::services::agent::nudge::NudgeDecision::Retry { attempt, instruction } => {
                                let _ = sqlx::query("DELETE FROM message_content_parts WHERE message_id = ?")
                                    .bind(assistant_message_id)
                                    .execute(&db)
                                    .await;
                                let _ = sqlx::query("UPDATE messages SET content = '' WHERE id = ?")
                                    .bind(assistant_message_id)
                                    .execute(&db)
                                    .await;
                                let _ = sqlx::query(
                                    "UPDATE message_rounds SET status = 'streaming', updated_at = ? WHERE id = ?",
                                )
                                .bind(crate::utils::now_ts())
                                .bind(round_id)
                                .execute(&db)
                                .await;

                                crate::services::agent::timeline::emit(
                                    &app,
                                    conversation_id,
                                    round_id,
                                    crate::services::agent::timeline::TimelineKind::NudgeRetry,
                                    crate::services::agent::timeline::TimelineStatus::Blocked,
                                    format!("禁词命中，第 {}/{} 次自纠重写", attempt, nudge_guard.max_retries()),
                                    format!("命中: {}", violation.matched_words.join("、")),
                                );
                                ephemeral_instruction = Some(instruction);
                                continue;
                            }
                            crate::services::agent::nudge::NudgeDecision::GiveUp { message, .. } => {
                                let _ = sqlx::query("DELETE FROM message_content_parts WHERE message_id = ?")
                                    .bind(assistant_message_id)
                                    .execute(&db)
                                    .await;
                                let _ = sqlx::query("UPDATE messages SET content = '' WHERE id = ?")
                                    .bind(assistant_message_id)
                                    .execute(&db)
                                    .await;
                                let _ = RoundRepository::mark_failed(&db, round_id).await;
                                let _ = RetrySnapshotRepository::mark_failed(&db, round_id, &message).await;
                                crate::services::agent::timeline::emit(
                                    &app,
                                    conversation_id,
                                    round_id,
                                    crate::services::agent::timeline::TimelineKind::NudgeRetry,
                                    crate::services::agent::timeline::TimelineStatus::Failed,
                                    "禁词自纠额度用尽，本轮作废".to_string(),
                                    message.clone(),
                                );
                                let _ = app.emit(
                                    "llm-stream-error",
                                    StreamErrorEvent {
                                        conversation_id,
                                        round_id,
                                        message_id: assistant_message_id,
                                        error: message,
                                    },
                                );
                                broadcast_stream_end(&app, conversation_id, round_id, assistant_message_id).await;
                                break;
                            }
                        }
                    }
                    // 未被拦截：清掉临时指令，本次成功收尾。
                    ephemeral_instruction = None;
                    let _ = RetrySnapshotRepository::mark_succeeded(&db, round_id).await;
                    if !data.full_content.is_empty() {
                        spawn_post_round_tasks(
                            &app,
                            &db,
                            conversation_id,
                            round_id,
                            provider_id,
                            assistant_message_id,
                            &db_mappings,
                            &persistent_hud_keys,
                            &data.full_content,
                        )
                        .await;
                    }
                    if let Ok(round) =
                        RoundRepository::load_state(&db, conversation_id, Some(round_id)).await
                    {
                        let _ = emit_round_state(&app, round);
                    }
                    break;
                }
            }
        }
    });
}

/// Unified post-round task spawner with three-mode gating:
/// - mem0: only memory extraction
/// - legacy: plot_summary placeholder + batch processing + world variable generation
/// - stateless: world variable generation only (preset-gated)
///
/// Blueprint `db_mappings` persistence (mode-independent): when the active
/// preset has a blueprint with SchemaField nodes declaring `db_mapping`,
/// the AI's structured_output fields are extracted and written to the
/// corresponding `message_rounds` columns (e.g. `world_variables`).
/// This runs before the mode-specific tasks and applies to all modes.
async fn spawn_post_round_tasks(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    db_mappings: &HashMap<String, String>,
    persistent_hud_keys: &std::collections::HashSet<String>,
    structured_content: &str,
) {
    // Blueprint db_mappings persistence: extract declared fields from the
    // AI's structured_output and write them to message_rounds columns.
    // Empty db_mappings (no blueprint or blueprint without db_mapping nodes)
    // is a no-op — preserves compatibility with legacy presets.
    if !db_mappings.is_empty() {
        if let Err(err) = persist_db_mapping_fields(db, round_id, db_mappings, structured_content)
            .await
        {
            dbg_eprintln!(
                "[stream] spawn_post_round_tasks: persist_db_mapping_fields failed: {err}"
            );
        }
    }

    // Broadcast HUD state patch if structured_content contains schema fields.
    //
    // 只发 `DisplayTarget::PersistentHUD` 的字段（计划 §4.3 通道 B）：
    // `InlineMessage` 字段（narrative / thinking 之类）属于气泡流内容，
    // 一起塞进常驻面板会让面板变成"什么都有"的垃圾桶；`persistent_hud_keys` 为空
    // （没有激活任何 Schema，或 Schema 没标 PersistentHUD 字段）时**不发** schema 补丁，
    // 通道 A（DataContainer 的 stats/inventory/flags）不受影响。
    if !structured_content.trim().is_empty() && !persistent_hud_keys.is_empty() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(structured_content) {
            if let Some(obj) = parsed.as_object() {
                let patches: std::collections::HashMap<String, serde_json::Value> = obj
                    .iter()
                    .filter(|(key, _)| persistent_hud_keys.contains(key.as_str()))
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect();
                if !patches.is_empty() {
                    // 回合内缓存优先（计划 §2.1）：ToolCall 的变动此刻可能还在内存工作副本里。
                    let current_state = match crate::services::agent_runtime::load_session_state_cached(db, app, conversation_id).await {
                        Ok(st) => st,
                        Err(err) => {
                            crate::dbg_eprintln!("[stream_processor] 加载 session_state 失败，终止 HUD 补丁广播（C2 拒绝静默空容器兜底）: {}", err);
                            return;
                        }
                    };
                    let detail_keys: Vec<String> = {
                        let mut keys: Vec<String> = patches.keys().cloned().collect();
                        keys.sort();
                        keys
                    };
                    crate::services::agent_runtime::broadcast_hud_patch(
                        app,
                        conversation_id,
                        &current_state,
                        Some(patches),
                    );
                    // Schema 补丁 → 时序泳道（计划 §9.3"Schema 流式解析→HUD 补丁"环）
                    crate::services::agent::timeline::emit(
                        app,
                        conversation_id,
                        round_id,
                        crate::services::agent::timeline::TimelineKind::SchemaPatch,
                        crate::services::agent::timeline::TimelineStatus::Success,
                        "Schema 补丁 → 常驻 HUD",
                        format!("字段: {}", detail_keys.join(", ")),
                    );
                }
            }
        }
    }

    // 回合末单次持久化（计划 §2.1"单次结算持久化"）：正文已定稿，此刻把回合内
    // 多次 ToolCall 变动的内存工作副本单次写入 session_states 并清除。传统模式
    // / 无回合内变动 = 无缓存条目，no-op。
    crate::services::agent_runtime::flush_session_state_cache(db, app, conversation_id).await;

    let memory_mode =
        crate::services::prompt_compiler::load_memory_mode(db, conversation_id).await;

    match memory_mode.as_str() {
        m if m == crate::services::prompt_compiler::MEMORY_MODE_MEM0 => {
            // Mem0: only spawn memory extraction task.
            crate::services::chat_service::spawn_memory_extraction_task(
                app.clone(),
                db.clone(),
                conversation_id,
                round_id,
                assistant_message_id,
            );
        }
        m if m == crate::services::prompt_compiler::MEMORY_MODE_LEGACY => {
            // Legacy: PlotSummary placeholder + batch processing + world variable.
            // Fetch round_index for the placeholder.
            let round_index: Option<i64> = sqlx::query_scalar(
                "SELECT round_index FROM message_rounds WHERE id = ? LIMIT 1",
            )
            .bind(round_id)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();

            if let Some(ri) = round_index {
                if let Err(err) = crate::services::plot_summaries::create_round_placeholder(
                    db, conversation_id, round_id, ri,
                ).await {
                    dbg_eprintln!(
                        "[stream] spawn_post_round_tasks: create_round_placeholder failed: {err}"
                    );
                }
            }

            crate::services::plot_summaries::spawn_plot_summary_processing_task(
                app.clone(),
                db.clone(),
                conversation_id,
                provider_id,
            );
        }
        _ => {
            // Stateless: only world variable generation (preset-gated).
        }
    }
}

/// Extract fields declared in `db_mappings` from the AI's structured_output
/// JSON and persist them to the corresponding columns on `message_rounds`.
///
/// `db_mappings` maps schema field names (e.g. `"world_variables"`) to
/// `message_rounds` column names (e.g. `"world_variables"`). Only columns
/// in the validated allowlist are accepted — this prevents SQL injection
/// via dynamic column names (column identifiers cannot be parameterized).
///
/// Empty `db_mappings` is a no-op (legacy preset compatibility). Fields
/// present in `db_mappings` but absent from the structured_output are
/// skipped with a debug log (the field may be optional in the schema).
async fn persist_db_mapping_fields(
    db: &SqlitePool,
    round_id: i64,
    db_mappings: &HashMap<String, String>,
    structured_content: &str,
) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(structured_content)
        .map_err(|err| {
            format!(
                "db_mappings persist: structured_output is not valid JSON (len={}): {}",
                structured_content.len(),
                err
            )
        })?;
    let obj = parsed
        .as_object()
        .ok_or_else(|| "db_mappings persist: structured_output is not a JSON object".to_string())?;

    for (field_name, db_column) in db_mappings {
        if !is_valid_message_rounds_column(db_column) {
            return Err(format!(
                "db_mappings persist: db_column `{db_column}` (field `{field_name}`) is not a \
                 supported message_rounds column. Supported: `world_variables`, `plot_summary`."
            ));
        }
        let Some(value) = obj.get(field_name) else {
            dbg_eprintln!(
                "[stream] db_mappings persist: field `{field_name}` (db_column `{db_column}`) \
                 not present in structured_output, skipping"
            );
            continue;
        };
        let serialized = serde_json::to_string(value).map_err(|err| {
            format!("db_mappings persist: failed to serialize field `{field_name}`: {err}")
        })?;
        // Safe: db_column is validated against the allowlist above.
        let sql = format!("UPDATE message_rounds SET {db_column} = ? WHERE id = ?");
        sqlx::query(&sql)
            .bind(&serialized)
            .bind(round_id)
            .execute(db)
            .await
            .map_err(|err| {
                format!("db_mappings persist: UPDATE message_rounds.{db_column} failed: {err}")
            })?;
    }
    Ok(())
}

/// Validate that a `db_mapping` column name is a known, existing column on
/// the `message_rounds` table. This is a security allowlist — column names
/// cannot be SQL-parameterized, so only allowlisted identifiers are inserted
/// into the dynamic UPDATE statement.
fn is_valid_message_rounds_column(column: &str) -> bool {
    matches!(column, "world_variables" | "plot_summary")
}

/// 单智能体一轮的流式链会话（工单 01-S1）：由 step backend 与 tool
/// backend 共享，承载「当前跳」的轮次坐标、待执行清单与回执收集。
///
/// 运行器串行驱动（provider 返回后才调 executor、各工具顺序执行），
/// 不存在并发访问；锁只作跨 backend 的状态交接，任何临界区都不跨
/// `await` 持有。
struct StreamingCycleSession {
    /// 当前跳的 round id（续跳落盘后切换为新一轮）。
    round_id: i64,
    /// 当前跳的助手消息 id。
    assistant_message_id: i64,
    /// 预检编译好的第一跳（`prepare_first_step` 填充，第一步消费）。
    first_step: Option<CompiledStreamStep>,
    /// 已完成的流式跳数（>0 时下一步先做回执链式落盘再开新跳）。
    steps_started: usize,
    /// 当前跳待执行的工具骨架清单（执行序与运行器调用序一致）。
    pending_tool_uses: Vec<PendingToolUseSkeleton>,
    /// 当前跳的工具执行计划（本跳编译结果）。
    tool_plans: HashMap<String, crate::models::tool_plan::ToolPlan>,
    /// 当前跳已收集的工具回执（续跳落盘 / 短路保底的输入）。
    receipts: Vec<crate::services::chat_service::ToolResultInput>,
    /// 回执的旁白摘要视图（工具名 + 成败，与 `receipts` 同序）。
    receipt_summaries: Vec<(String, bool)>,
    /// 下一个待执行骨架的下标（运行器按 `tool_calls` 顺序调用执行器）。
    next_tool_index: usize,
    /// 最后一跳的流式产物（整轮收尾时交回 `spawn_stream_task`）。
    last_data: Option<StreamResponseData>,
    /// 最后一跳编译的 db_mappings。
    last_db_mappings: HashMap<String, String>,
    /// 最后一跳编译的常驻 HUD 字段白名单。
    last_persistent_hud_keys: std::collections::HashSet<String>,
}

impl StreamingCycleSession {
    fn new(round_id: i64, assistant_message_id: i64) -> Self {
        Self {
            round_id,
            assistant_message_id,
            first_step: None,
            steps_started: 0,
            pending_tool_uses: Vec::new(),
            tool_plans: HashMap::new(),
            receipts: Vec::new(),
            receipt_summaries: Vec::new(),
            next_tool_index: 0,
            last_data: None,
            last_db_mappings: HashMap::new(),
            last_persistent_hud_keys: std::collections::HashSet::new(),
        }
    }
}

fn lock_cycle_session<'a>(
    session: &'a Mutex<StreamingCycleSession>,
) -> Result<std::sync::MutexGuard<'a, StreamingCycleSession>, String> {
    session
        .lock()
        .map_err(|_| "流式链会话锁已毒化（内部状态不一致）".to_string())
}

/// 第一跳预检编译的装配材料：步长盖章 + `AgentCycleConfig` 的三要素，
/// 全部取自与第一跳执行完全相同的一次编译（不二次编译、无漂移）。
struct FirstStepFacts {
    step_budget: Option<usize>,
    short_circuit_on_first_step: Option<bool>,
    system_blocks: Vec<String>,
    user_prompt: String,
    allowed_tools: Vec<LlmToolDefinition>,
}

/// 生产流式 step backend：一步 = 一跳 DB 轮次的流式请求。
///
/// 第 1 步消费预检编译；第 2 步起先把上一跳回执链式落盘（旁白保底
/// 回填 → `persist_tool_results_round` 创建新一轮 → 新轮快照基线），
/// 再为新一轮重新编译并执行流式请求。提示词逐跳经 `prompt_compiler`
/// 按 DB 最新历史物化（已含回注的 ToolResult），与整合前逐跳 spawn
/// 的编译语义一致；是否续跳只由运行器决定，本 backend 无权自行续跳。
struct DbStreamingStepBackend {
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    provider_id: i64,
    attachments: Vec<ChatAttachment>,
    ephemeral_instruction: Option<String>,
    session: Arc<Mutex<StreamingCycleSession>>,
}

impl DbStreamingStepBackend {
    /// 预检：编译第一跳并缓存，把装配材料交回驱动层组装
    /// `AgentCycleConfig`（步长盖章来自这次编译，Option 语义原样）。
    async fn prepare_first_step(&self) -> Result<FirstStepFacts, String> {
        let (round_id, assistant_message_id) = {
            let session = lock_cycle_session(&self.session)?;
            (session.round_id, session.assistant_message_id)
        };
        let step = compile_stream_step(
            self.app.clone(),
            self.db.clone(),
            self.conversation_id,
            round_id,
            self.provider_id,
            assistant_message_id,
            self.attachments.clone(),
            self.ephemeral_instruction.as_deref(),
        )
        .await?;
        let facts = FirstStepFacts {
            step_budget: step.compiled_prompt.step_budget,
            short_circuit_on_first_step: step.compiled_prompt.short_circuit_on_first_step,
            system_blocks: step
                .compiled_prompt
                .system_blocks
                .iter()
                .map(|block| block.content.clone())
                .collect(),
            user_prompt: step.compiled_prompt.current_user_block.content.clone(),
            allowed_tools: step.compiled_prompt.tools.clone(),
        };
        let mut session = lock_cycle_session(&self.session)?;
        session.first_step = Some(step);
        Ok(facts)
    }

    /// 链式落盘：上一跳回执 → 旁白保底回填 → 回注落盘创建新一轮 →
    /// 新轮快照基线 → 会话坐标切换到新一轮。
    async fn chain_previous_step(&self) -> Result<(), String> {
        let (prev_round_id, receipts, summaries) = {
            let mut session = lock_cycle_session(&self.session)?;
            (
                session.round_id,
                std::mem::take(&mut session.receipts),
                std::mem::take(&mut session.receipt_summaries),
            )
        };
        if receipts.is_empty() {
            return Err("内部错误：流式链续跳时上一跳没有工具回执".to_string());
        }
        // 零延迟旁白保底（工单 02 / spec §3）：回填必须在回注落盘之前
        // 完成，使合成文本随历史进入下一跳上下文（与整合前一致）。
        let summary_refs: Vec<ToolReceiptSummary<'_>> = summaries
            .iter()
            .map(|(tool_name, is_error)| ToolReceiptSummary {
                tool_name: tool_name.as_str(),
                is_error: *is_error,
            })
            .collect();
        fill_fallback_narrative_if_empty(&self.db, prev_round_id, &summary_refs).await?;
        let submitted = crate::services::chat_service::ChatService::persist_tool_results_round(
            &self.db,
            self.conversation_id,
            prev_round_id,
            receipts,
        )
        .await?;
        // 工单 04：新一轮同样需要状态快照基线（整合前由每跳的
        // spawn_stream_task 捕获，链式续跳在此等价补齐）；捕获失败
        // 按 C2 显式失败，不静默裸奔。
        crate::repositories::round_snapshot_repository::RoundSnapshotRepository::capture_baseline(
            &self.db,
            self.conversation_id,
            submitted.new_round_id,
        )
        .await
        .map_err(|err| format!("轮次状态快照捕获失败: {}", err))?;
        let mut session = lock_cycle_session(&self.session)?;
        session.round_id = submitted.new_round_id;
        session.assistant_message_id = submitted.assistant_message_id;
        Ok(())
    }
}

#[async_trait]
impl StreamingStepBackend for DbStreamingStepBackend {
    async fn run_streaming_step(&self) -> Result<AgentStepResponse, String> {
        let steps_started = lock_cycle_session(&self.session)?.steps_started;
        if steps_started > 0 {
            self.chain_previous_step().await?;
        }
        let (round_id, assistant_message_id) = {
            let session = lock_cycle_session(&self.session)?;
            (session.round_id, session.assistant_message_id)
        };
        let compiled = {
            let mut session = lock_cycle_session(&self.session)?;
            session.first_step.take()
        };
        let compiled = match compiled {
            Some(step) => step,
            None => {
                compile_stream_step(
                    self.app.clone(),
                    self.db.clone(),
                    self.conversation_id,
                    round_id,
                    self.provider_id,
                    assistant_message_id,
                    Vec::new(),
                    None,
                )
                .await?
            }
        };
        let artifacts = execute_stream_step(
            self.app.clone(),
            self.db.clone(),
            self.conversation_id,
            round_id,
            assistant_message_id,
            compiled,
        )
        .await?;

        let tool_calls = artifacts
            .data
            .pending_tool_uses
            .iter()
            .map(|skeleton| {
                let input_json: Value = serde_json::from_str(&skeleton.input_json).map_err(|err| {
                    format!(
                        "ToolCall {}（{}）的 arguments 不是合法 JSON: {}",
                        skeleton.tool_name, skeleton.tool_use_id, err
                    )
                })?;
                Ok(AgentToolCall {
                    id: skeleton.tool_use_id.clone(),
                    name: skeleton.tool_name.clone(),
                    input_json,
                })
            })
            .collect::<Result<Vec<AgentToolCall>, String>>()?;
        let finish_reason = match artifacts.data.stop_reason.as_deref() {
            Some("tool_use") | Some("tool_calls") => AgentFinishReason::ToolCalls,
            Some("length") | Some("max_tokens") => AgentFinishReason::Length,
            Some("stop") | Some("end_turn") | Some("stop_sequence") => AgentFinishReason::Stop,
            Some(other) => AgentFinishReason::Other(other.to_string()),
            None => {
                if tool_calls.is_empty() {
                    AgentFinishReason::Stop
                } else {
                    AgentFinishReason::ToolCalls
                }
            }
        };
        let response = AgentStepResponse {
            text: artifacts.data.full_content.clone(),
            tool_calls,
            finish_reason,
        };

        let mut session = lock_cycle_session(&self.session)?;
        session.tool_plans = artifacts.tool_plans;
        session.pending_tool_uses = artifacts.data.pending_tool_uses.clone();
        session.receipts.clear();
        session.receipt_summaries.clear();
        session.next_tool_index = 0;
        session.last_db_mappings = artifacts.db_mappings;
        session.last_persistent_hud_keys = artifacts.persistent_hud_keys;
        session.last_data = Some(artifacts.data);
        session.steps_started += 1;
        Ok(response)
    }
}

/// 生产流式 tool backend：一次执行 = 一条 ToolCall 走
/// `execute_tool_call_with_plan` 全链（白名单 → 契约 → 门禁 → 容器
/// 落盘），回执与旁白摘要按执行序收集进会话，时序泳道发射真实回执
/// （与整合前的批量派发路径逐项一致）。
struct DbStreamingToolBackend {
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    session: Arc<Mutex<StreamingCycleSession>>,
}

#[async_trait]
impl StreamingToolBackend for DbStreamingToolBackend {
    async fn execute_streaming_tool(
        &self,
        name: &str,
        arguments_json: &str,
    ) -> Result<String, String> {
        let (round_id, tool_use_id, plan) = {
            let session = lock_cycle_session(&self.session)?;
            let skeleton = session
                .pending_tool_uses
                .get(session.next_tool_index)
                .ok_or_else(|| {
                    "内部错误：工具执行序超出本跳待执行清单".to_string()
                })?;
            if skeleton.tool_name != name {
                return Err(format!(
                    "内部错误：工具执行序错位，待执行清单为 {}，运行器请求 {}",
                    skeleton.tool_name, name
                ));
            }
            (
                session.round_id,
                skeleton.tool_use_id.clone(),
                session.tool_plans.get(name).cloned(),
            )
        };

        let outcome = crate::services::agent_runtime::execute_tool_call_with_plan(
            &self.db,
            &self.app,
            self.conversation_id,
            round_id,
            false,
            name,
            arguments_json,
            plan.as_ref(),
        )
        .await;

        let (content, is_error) = match &outcome {
            Ok(text) => (text.clone(), false),
            Err(err) => (err.clone(), true),
        };

        // 时序泳道要看到"真实发生的事"，所以事件由后端发射（含拦截原文），
        // 前端不再靠流事件推断。
        crate::services::agent::timeline::emit(
            &self.app,
            self.conversation_id,
            round_id,
            crate::services::agent::timeline::TimelineKind::ToolCall,
            if is_error {
                crate::services::agent::timeline::TimelineStatus::Blocked
            } else {
                crate::services::agent::timeline::TimelineStatus::Success
            },
            format!(
                "ToolCall: {} ({})",
                name,
                if is_error { "被拦截/失败" } else { "执行成功" }
            ),
            content.clone(),
        );

        let mut session = lock_cycle_session(&self.session)?;
        session.next_tool_index += 1;
        session.receipts.push(crate::services::chat_service::ToolResultInput {
            tool_use_id,
            content,
            is_error,
        });
        session.receipt_summaries.push((name.to_string(), is_error));
        outcome
    }
}

/// 生产单智能体一轮（工单 01-S1）：整轮由 [`AgentCycleRuntime`] 驱动。
///
/// 装配流程：预检编译第一跳 → 步长盖章经
/// [`translate_step_budget`] 显式翻译（`None` = 不限制步数，禁止当 1）
/// → 组装 `AgentCycleConfig` → 运行器经流式 Adapter 逐步驱动
/// （步进 / 短路 / 熔断只在运行器一处判定）。终局处理：
/// - `TextDelivered`：最后一跳产物即整轮产物；
/// - `ShortCircuitedWithTools`：旁白保底落盘到当前跳助手消息（正文
///   为空 + 有回执时），整轮就此收尾，不再回注、不再发起请求；
/// - `CircuitBreakerTripped`：按 C2 显式报错收尾（诊断含步数与原因）。
async fn stream_llm_response(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    attachments: Vec<ChatAttachment>,
    ephemeral_instruction: Option<&str>,
) -> Result<
    (
        StreamResponseData,
        HashMap<String, String>,
        std::collections::HashSet<String>,
    ),
    String,
> {
    let session = Arc::new(Mutex::new(StreamingCycleSession::new(
        round_id,
        assistant_message_id,
    )));
    let step_backend = DbStreamingStepBackend {
        app: app.clone(),
        db: db.clone(),
        conversation_id,
        provider_id,
        attachments,
        ephemeral_instruction: ephemeral_instruction.map(str::to_string),
        session: session.clone(),
    };
    let facts = step_backend.prepare_first_step().await?;
    let (max_steps, short_circuit_on_first_step) =
        translate_step_budget(facts.step_budget, facts.short_circuit_on_first_step);
    let config = AgentCycleConfig {
        max_steps,
        short_circuit_on_first_step,
        system_blocks: facts.system_blocks,
        user_prompt: facts.user_prompt,
        allowed_tools: facts.allowed_tools,
    };
    let tool_backend = DbStreamingToolBackend {
        app: app.clone(),
        db: db.clone(),
        conversation_id,
        session: session.clone(),
    };
    let provider_adapter = StreamingStepProvider::new(step_backend);
    let tool_adapter = StreamingToolExecutor::new(tool_backend);

    let outcome =
        AgentCycleRuntime::run_cycle(&config, &provider_adapter, &tool_adapter).await?;

    let take_last = |session: &Arc<Mutex<StreamingCycleSession>>| -> Result<
        (
            StreamResponseData,
            HashMap<String, String>,
            std::collections::HashSet<String>,
        ),
        String,
    > {
        let mut session = lock_cycle_session(session)?;
        let data = session
            .last_data
            .take()
            .ok_or_else(|| "内部错误：运行器已收尾但没有流式步产物".to_string())?;
        Ok((
            data,
            session.last_db_mappings.clone(),
            session.last_persistent_hud_keys.clone(),
        ))
    };

    match outcome {
        AgentCycleOutcome::TextDelivered { .. } => take_last(&session),
        AgentCycleOutcome::ShortCircuitedWithTools {
            text,
            executed_tools,
        } => {
            // 零延迟旁白保底落盘（工单 02 / spec §3）：正文为空 + 有工具
            // 执行时把合成旁白写进当前跳助手消息，杜绝空白气泡；整轮
            // 就此结束（回执不回注、无下一跳），与 spec 单步语义一致。
            let (current_round_id, summaries) = {
                let session = lock_cycle_session(&session)?;
                (
                    session.round_id,
                    session.receipt_summaries.clone(),
                )
            };
            let summary_refs: Vec<ToolReceiptSummary<'_>> = summaries
                .iter()
                .map(|(tool_name, is_error)| ToolReceiptSummary {
                    tool_name: tool_name.as_str(),
                    is_error: *is_error,
                })
                .collect();
            let filled =
                fill_fallback_narrative_if_empty(&db, current_round_id, &summary_refs).await?;
            let (mut data, db_mappings, persistent_hud_keys) = take_last(&session)?;
            if filled && data.full_content.trim().is_empty() {
                // 内存中的整轮产物与落盘保持一致：spawn 层的禁词校验与
                // 轮后任务消费的是回填后的旁白文本。
                if let Some(narrative) = short_circuit_narrative(&text, &executed_tools) {
                    data.full_content = narrative;
                }
            }
            Ok((data, db_mappings, persistent_hud_keys))
        }
        AgentCycleOutcome::CircuitBreakerTripped {
            steps_taken,
            reason,
        } => Err(format!(
            "Agent 步长预算熔断（已执行 {} 步）: {}",
            steps_taken, reason
        )),
    }
}

/// 一跳流式请求的编译产物：provider + 编译结果 + 已装配的 HTTP 请求，
/// 供 [`execute_stream_step`] 直接发送与流式处理。
struct CompiledStreamStep {
    provider: ApiProvider,
    compiled_prompt: PromptCompileResult,
    http_request: ProviderHttpRequest,
    request_body: Value,
    debug_log_dir: Option<std::path::PathBuf>,
}

/// 编译一跳：加载 provider → 装配上下文 → `compile_prompt` → 构建
/// 请求体 → 写入重试快照种子。每一跳独立编译（提示词按 DB 最新历史
/// 物化，含上一跳回注的 ToolResult 与世界书 / 记忆的最新状态）。
async fn compile_stream_step(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
    assistant_message_id: i64,
    attachments: Vec<ChatAttachment>,
    ephemeral_instruction: Option<&str>,
) -> Result<CompiledStreamStep, String> {
    let provider = ConversationRepository::load_provider(&db, provider_id).await?;

    dbg_eprintln!(
        "[chat] stream_llm_response: loaded provider, provider_kind={}, model_name={}, base_url_len={}",
        provider.provider_kind, provider.model_name, provider.base_url.len()
    );
    crate::services::chat_service::chat_debug_log(
        &app,
        &format!(
            "stream_llm_response: provider={}/{}, base_url_len={}",
            provider.provider_kind, provider.model_name, provider.base_url.len()
        ),
    );

    let debug_log_dir: Option<std::path::PathBuf> = app
        .path()
        .app_data_dir()
        .ok();

    if !attachments.is_empty() {
        let capabilities = ProviderCapabilityMatrix::for_provider_kind(&provider.provider_kind)?;
        if !capabilities.supports_image_input {
            return Err(format!(
                "当前 provider ({}) 不支持图片输入",
                provider.provider_kind
            ));
        }
    }

    let compile_mode = resolve_prompt_compile_mode(&db, round_id, assistant_message_id).await?;
    dbg_eprintln!("[chat] stream_llm_response: compile_mode={:?}", compile_mode);

    let conv_preset_id: Option<i64> = sqlx::query_scalar(
        "SELECT preset_id FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(&db)
    .await
    .ok()
    .flatten();
    let all_presets: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, name FROM presets ORDER BY id ASC",
    )
    .fetch_all(&db)
    .await
    .unwrap_or_default();
    let preset_listing = all_presets.iter().map(|(id, name)| format!("[{}] {}", id, name)).collect::<Vec<_>>().join(", ");
    crate::services::chat_service::chat_debug_log(
        &app,
        &format!(
            "before compile: conv_preset_id={:?}, available_presets=[{}]", conv_preset_id, preset_listing
        ),
    );
    let effective_max_tokens = provider.max_tokens.filter(|&v| v > 0);
    let compile_input = PromptCompileInput {
        conversation_id,
        mode: compile_mode,
        target_round_id: Some(round_id),
        provider_kind: provider.provider_kind.clone(),
        model_name: provider.model_name.clone(),
        include_streaming_seed: false,
        max_context_tokens: provider.max_context_tokens,
        budget: PromptBudget {
            max_total_tokens: None,
            reserve_output_tokens: effective_max_tokens
                .and_then(|value| usize::try_from(value).ok()),
            max_summary_tokens: None,
            max_world_book_tokens: None,
            max_retrieved_detail_tokens: None,
        },
        log_dir: debug_log_dir.clone(),
        ephemeral_instruction: ephemeral_instruction.map(str::to_string),
    };
    dbg_eprintln!("[chat] stream_llm_response: calling compile_prompt...");
    // Build the memory backend lazily for mem0-mode conversations only.
    // Non-mem0 conversations pass None so compile_prompt skips retrieval.
    // Build errors propagate rather than silently degrading.
    let memory_mode =
        crate::services::prompt_compiler::load_memory_mode(&db, conversation_id).await;
    let memory_service = if memory_mode == crate::services::prompt_compiler::MEMORY_MODE_MEM0 {
        let state = app.state::<crate::AppState>();
        Some(
            crate::services::memory_providers::get_or_build_memory_service(
                &state.db,
                &state.memory_service,
                conversation_id,
            )
            .await?,
        )
    } else {
        None
    };
    let mut compiled_prompt =
        crate::services::prompt_compiler::compile_prompt(
            &db,
            &compile_input,
            assistant_message_id,
            memory_service.as_ref(),
        )
        .await?;
    dbg_eprintln!(
        "[chat] stream_llm_response: compile_prompt done, response_mode={:?}, structured_output_schema={:?}, system_blocks={}, history_blocks={}",
        compiled_prompt.params.response_mode,
        compiled_prompt.params.structured_output_schema.as_ref().map(|s| {
            if let Some((idx, _)) = s.char_indices().nth(80) {
                format!("{}...", &s[..idx])
            } else {
                s.clone()
            }
        }),
        compiled_prompt.system_blocks.len(),
        compiled_prompt.history_blocks.len(),
    );
    crate::services::chat_service::chat_debug_log(
        &app,
        &format!(
            "compile_prompt done: response_mode={:?}, schema={}, sys_blocks={}, hist_blocks={}",
            compiled_prompt.params.response_mode,
            compiled_prompt.params.structured_output_schema.is_some(),
            compiled_prompt.system_blocks.len(),
            compiled_prompt.history_blocks.len(),
        ),
    );
    let mut request = build_llm_chat_request(
        &mut compiled_prompt,
        &provider.provider_kind,
        &provider.model_name,
        true,
        provider.temperature,
        effective_max_tokens,
    )?;
    inject_image_parts_into_request(&mut request, &attachments)?;
    dbg_eprintln!(
        "[chat] stream_llm_response: provider={}/{}, max_output_tokens={:?}, model={}, messages_count={}, system_blocks={}, estimated_input_tokens={}",
        provider.provider_kind,
        provider.model_name,
        request.max_output_tokens,
        request.model,
        request.messages.len(),
        request.system.len(),
        compiled_prompt.debug.total_token_estimate_after_trim,
    );
    let http_request =
        build_provider_http_request(&request, &provider.base_url, &provider.api_key)?;
    let request_body = serde_json::to_value(&http_request.body).unwrap_or(serde_json::Value::Null);

    let validation_snapshot = compiled_prompt.retry_output_validator_snapshot();
    let _ = RetrySnapshotRepository::ensure_prepared(
        &db,
        RetrySnapshotSeed {
            round_id,
            conversation_id,
            assistant_message_id,
            provider_id,
            provider_kind: provider.provider_kind.clone(),
            model_name: provider.model_name.clone(),
            response_mode: compiled_prompt.params.response_mode.clone(),
            request: http_request.clone(),
            validation_rules: validation_snapshot,
        },
    )
    .await;

    dbg_eprintln!(
        "[chat] request body preview: messages_count={}, system_count={}, model={}, stream={}",
        request_body.get("messages").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        request_body.get("system").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        request_body.get("model").and_then(|v| v.as_str()).unwrap_or("?"),
        request_body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false),
    );

    Ok(CompiledStreamStep {
        provider,
        compiled_prompt,
        http_request,
        request_body,
        debug_log_dir,
    })
}

/// 一跳流式请求的执行产物：流式数据 + 本跳编译的执行材料（工具计划、
/// db_mappings、HUD 白名单），供 step backend 组装 `AgentStepResponse`
/// 与会话状态。步长盖章与装配要素走预检编译的 `FirstStepFacts` 通道，
/// 不在此重复携带。
struct CycleStepArtifacts {
    data: StreamResponseData,
    tool_plans: HashMap<String, crate::models::tool_plan::ToolPlan>,
    db_mappings: HashMap<String, String>,
    persistent_hud_keys: std::collections::HashSet<String>,
}

/// 执行一跳：发送 HTTP 请求 → 按 provider 分发到流式解复用通道
/// （文本逐块即时发射、工具分片静默拼装、流终止原子收尾）→ 保存
/// 调试日志。工具的执行与回注不在本函数：待执行清单随产物交回
/// 运行器，由运行器决定执行 / 短路 / 熔断（工单 01-S1）。
async fn execute_stream_step(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    assistant_message_id: i64,
    step: CompiledStreamStep,
) -> Result<CycleStepArtifacts, String> {
    let CompiledStreamStep {
        provider,
        compiled_prompt,
        http_request,
        request_body,
        debug_log_dir,
    } = step;

    let response = execute_provider_http_request(&http_request).await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        save_llm_debug_log(
            conversation_id,
            round_id,
            &provider.provider_kind,
            &provider.model_name,
            &request_body,
            &text,
            true,
            Some(&compiled_prompt.system_blocks),
            debug_log_dir.as_deref(),
        );
        save_agent_debug_log(
            conversation_id,
            round_id,
            &provider.provider_kind,
            &provider.model_name,
            &request_body,
            &text,
            true,
            Some(&compiled_prompt.system_blocks),
            debug_log_dir.as_deref(),
        );
        return Err(format!("LLM 请求失败: {} {}", status, text));
    }

    let stream_result = match provider.provider_kind.as_str() {
        "openai_compatible" => {
            stream_openai_text_response(
                response,
                &app,
                &db,
                conversation_id,
                round_id,
                assistant_message_id,
                &compiled_prompt,
                compiled_prompt.params.response_mode.as_deref(),
                compiled_prompt.params.structured_output_schema.as_deref(),
            )
            .await
        }
        "anthropic" => {
            stream_anthropic_text_response(
                response,
                &app,
                &db,
                conversation_id,
                round_id,
                assistant_message_id,
                &compiled_prompt,
                compiled_prompt.params.response_mode.as_deref(),
                compiled_prompt.params.structured_output_schema.as_deref(),
            )
            .await
        }
        other => Err(format!("当前聊天链路暂不支持 provider_kind='{}'", other)),
    };

    let debug_response_body = match &stream_result {
        Ok(data) => {
            match provider.provider_kind.as_str() {
                "anthropic" => {
                    let mut content_array = Vec::new();
                    if let Some(ref thinking) = data.thinking_content {
                        content_array.push(serde_json::json!({
                            "type": "thinking",
                            "thinking": thinking,
                        }));
                    }
                    content_array.push(serde_json::json!({
                        "type": "text",
                        "text": data.full_content,
                    }));
                    let mut response = serde_json::Map::new();
                    response.insert("content".to_string(), serde_json::Value::Array(content_array));
                    if let Some(ref stop_reason) = data.stop_reason {
                        response.insert("stop_reason".to_string(), serde_json::Value::String(stop_reason.clone()));
                    }
                    serde_json::Value::Object(response).to_string()
                }
                _ => {
                    let mut message = serde_json::Map::new();
                    message.insert("role".to_string(), serde_json::Value::String("assistant".to_string()));
                    if let Some(ref thinking) = data.thinking_content {
                        message.insert("reasoning_content".to_string(), serde_json::Value::String(thinking.clone()));
                    }
                    message.insert("content".to_string(), serde_json::Value::String(data.full_content.clone()));
                    let mut choice = serde_json::Map::new();
                    choice.insert("message".to_string(), serde_json::Value::Object(message));
                    choice.insert("finish_reason".to_string(), serde_json::Value::String(
                        data.stop_reason.clone().unwrap_or_else(|| "stop".to_string())
                    ));
                    serde_json::json!({
                        "choices": [serde_json::Value::Object(choice)],
                    }).to_string()
                }
            }
        }
        Err(e) => serde_json::json!({
            "error": e,
        }).to_string(),
    };
    save_llm_debug_log(
        conversation_id,
        round_id,
        &provider.provider_kind,
        &provider.model_name,
        &request_body,
        &debug_response_body,
        true,
        Some(&compiled_prompt.system_blocks),
        debug_log_dir.as_deref(),
    );
    save_agent_debug_log(
        conversation_id,
        round_id,
        &provider.provider_kind,
        &provider.model_name,
        &request_body,
        &debug_response_body,
        true,
        Some(&compiled_prompt.system_blocks),
        debug_log_dir.as_deref(),
    );

    // 模型请求了工具调用：待执行清单随产物交回运行器（工单 01-S1）——
    // 执行、回注、短路与熔断全部由运行器经 Adapter 驱动，本函数只
    // 负责这一跳的流式收尾（放在 debug 日志之后、返回之前，串行完成，
    // 避免"流还没收尾就并发开新跳"）。工具可用性由蓝图声明的工具计划
    // 决定（工单 06：chat_mode 拦截已移除）：未声明工具的预设不会向
    // 模型提供工具，自然不会产生待执行 ToolCall。
    let data = stream_result?;
    Ok(CycleStepArtifacts {
        tool_plans: compiled_prompt.tool_plans.clone(),
        db_mappings: compiled_prompt.db_mappings.clone(),
        persistent_hud_keys: compiled_prompt.persistent_hud_keys.clone(),
        data,
    })
}

async fn execute_provider_http_request(
    http_request: &ProviderHttpRequest,
) -> Result<reqwest::Response, String> {
    dbg_eprintln!(
        "[chat] HTTP POST url={}, body_size={}",
        http_request.url,
        http_request.body.to_string().len(),
    );
    let client = crate::services::http_client::shared_permissive_http_client();
    // 传输层重试：仅针对连接级失败（is_connect/is_request），与用户的内容级 auto_retry 开关解耦。
    // 死连接已被 hyper 移出池，重试会新建/复用活连接；失败发生在取得任何响应字节前，重发幂等。
    const TRANSPORT_RETRY_LIMIT: usize = 1;
    let mut attempt = 0usize;
    let response = loop {
        let mut attempt_builder = client.post(&http_request.url);
        for header in &http_request.headers {
            attempt_builder = attempt_builder.header(&header.name, &header.value);
        }
        match attempt_builder.json(&http_request.body).send().await {
            Ok(resp) => break resp,
            Err(err) => {
                let is_connect = err.is_connect();
                let is_timeout = err.is_timeout();
                let is_request = err.is_request();
                let is_body = err.is_body();
                let is_decode = err.is_decode();
                let is_redirect = err.is_redirect();
                let cause = {
                    let first = std::error::Error::source(&err);
                    let second = first.and_then(std::error::Error::source);
                    match (first, second) {
                        (Some(f), Some(s)) => format!("{} <- {}", f, s),
                        (Some(f), None) => f.to_string(),
                        _ => "<none>".to_string(),
                    }
                };
                let formatted = format!(
                    "HTTP 请求发送失败: {} | connect={} timeout={} request={} body={} decode={} redirect={} | cause={}",
                    err, is_connect, is_timeout, is_request, is_body, is_decode, is_redirect, cause
                );
                let is_transport_connection_error = is_connect || is_request;
                if is_transport_connection_error && attempt < TRANSPORT_RETRY_LIMIT {
                    dbg_eprintln!(
                        "[chat] HTTP 连接级失败，传输层自动重试 (第 {} 次): {}",
                        attempt + 1,
                        formatted
                    );
                    attempt += 1;
                    continue;
                }
                return Err(formatted);
            }
        }
    };
    let status = response.status();
    let content_encoding = response.headers()
        .get("content-encoding")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none")
        .to_string();
    let content_type = response.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none")
        .to_string();
    dbg_eprintln!(
        "[chat] HTTP response: status={}, content-encoding={}, content-type={}",
        status, content_encoding, content_type
    );
    Ok(response)
}

async fn stream_openai_text_response(
    response: reqwest::Response,
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    assistant_message_id: i64,
    _compiled_prompt: &PromptCompileResult,
    response_mode: Option<&str>,
    schema_json: Option<&str>,
) -> Result<StreamResponseData, String> {
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut thinking_content = String::new();
    let mut pending = String::new();
    let mut last_emit = Instant::now();
    let mut content_parts: Vec<PendingMessageContentPart> = Vec::new();
    let mut content_part_lookup: HashMap<String, usize> = HashMap::new();
    let mut finish_reason: Option<String> = None;
    let provider_kind: &str = "openai_compatible";
    let mut raw_prose = String::new();
    let mut prompt_tokens: Option<i64> = None;
    let mut completion_tokens: Option<i64> = None;
    let mut last_abort_check = Instant::now();
    let mut tool_accumulator = StreamingToolAccumulator::new();

    let mut structured_parser = if response_mode == Some("structured_json") {
        Some(crate::services::structured_output_parser::StructuredOutputParser::new())
    } else {
        None
    };

    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|err| {
            let is_timeout = err.is_timeout();
            let is_body = err.is_body();
            let is_decode = err.is_decode();
            dbg_eprintln!(
                "[chat] bytes_stream error: {} | timeout={} body={} decode={}",
                err, is_timeout, is_body, is_decode
            );
            let category = if is_timeout {
                "流式响应读取超时"
            } else {
                "流式响应解码失败"
            };
            format!(
                "{}: {} | timeout={} body={} decode={}",
                category, err, is_timeout, is_body, is_decode
            )
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let raw_line = buffer[..pos].to_string();
            buffer = buffer[pos + 1..].to_string();
            let line = raw_line.trim();

            if !line.starts_with("data:") {
                continue;
            }

            let data = line.trim_start_matches("data:").trim();
            if data == "[DONE]" {
                flush_text_delta_event(
                    app,
                    conversation_id,
                    round_id,
                    assistant_message_id,
                    "openai_compatible",
                    &mut pending,
                )?;
                // 流终止时缓冲里有工具调用：与流自然结束走同一条工具收尾，
                // 不得按纯文本定稿把已拼装的 ToolCall 丢弃。
                if !tool_accumulator.is_empty() {
                    return complete_tool_use_turn(
                        tool_accumulator,
                        &mut content_parts,
                        &mut content_part_lookup,
                        app,
                        db,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        provider_kind,
                        full_content,
                        thinking_content,
                        prompt_tokens,
                        completion_tokens,
                    )
                    .await;
                }
                let mut structured_json_content: Option<String> = None;
                if let Some(parser) = structured_parser.take() {
                    match parser.finish() {
                        Ok(result) => {
                            let mut full_json = serde_json::Map::new();
                            for (key, value) in &result.fields {
                                full_json.insert(key.clone(), value.clone());
                            }
                            structured_json_content = Some(serde_json::Value::Object(full_json).to_string());
                            for (key, value) in result.fields {
                                let part_type = map_structured_field_part_type(&key);
                                let next_index = content_parts.len() as i64;
                                let content_index = ensure_content_part_by_key(
                                    &mut content_parts, &mut content_part_lookup,
                                    &key, next_index, part_type,
                                );
                                if value.is_string() {
                                    append_content_part_text(&mut content_parts[content_index], value.as_str().unwrap_or(""));
                                } else if value.is_object() {
                                    content_parts[content_index].json_value = Some(value.to_string());
                                } else if value.is_array() {
                                    content_parts[content_index].json_value = Some(value.to_string());
                                }
                                if part_type == "structured_output" {
                                    content_parts[content_index].tool_name = Some(key);
                                }
                            }
                        }
                        Err(err) => {
                            dbg_eprintln!("[structured_output] finish error, entering compatibility mode: {}", err);
                            if !raw_prose.trim().is_empty() {
                                structured_json_content = Some(build_compatibility_fallback_json(
                                    &raw_prose,
                                    schema_json,
                                ));
                                if let Err(e) = emit_compatibility_mode_event(
                                    app,
                                    conversation_id,
                                    round_id,
                                    assistant_message_id,
                                    provider_kind,
                                    "结构化 JSON 解析失败，已启用兼容模式：流式解析未完成或结构非法，原文已整体转入 narrative 字段。",
                                ) {
                                    dbg_eprintln!("[compatibility_mode] failed to emit notice: {}", e);
                                }
                            }
                        }
                    }
                }
                emit_stream_message_stop(
                    app,
                    conversation_id,
                    round_id,
                    assistant_message_id,
                    "openai_compatible",
                    None,
                    prompt_tokens,
                    completion_tokens,
                )?;
                let content_to_save = structured_json_content.as_deref().unwrap_or(&full_content);
                finalize_streamed_response(
                    db,
                    round_id,
                    assistant_message_id,
                    content_to_save,
                    content_parts.as_slice(),
                    &[],
                    prompt_tokens,
                )
                .await?;
                return Ok(StreamResponseData {
                    full_content: structured_json_content.unwrap_or(full_content),
                    thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                    stop_reason: finish_reason,
                    pending_tool_uses: Vec::new(),
                });
            }

            let value: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => {
                    dbg_eprintln!("[chat] stream_openai_text: failed to parse SSE data as JSON, len={}", data.len());
                    continue;
                }
            };

            let has_content = value.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")).and_then(|d| d.get("content")).is_some();
            let has_reasoning = value.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")).and_then(|d| d.get("reasoning_content")).is_some();
            let has_finish = value.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("finish_reason")).is_some();
            if !has_content && !has_reasoning && !has_finish {
                dbg_eprintln!("[chat] stream_openai_text: unrecognized SSE event, keys={:?}", value.as_object().map(|o| o.keys().collect::<Vec<_>>()));
            }

            if let Some(delta) = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("content"))
                .and_then(|content| content.as_str())
            {
                if !delta.is_empty() {
                    if let Some(ref mut parser) = structured_parser {
                        raw_prose.push_str(delta);
                        let has_backslash = delta.contains('\\');
                        let has_raw_newline = delta.contains('\n');
                        if has_backslash || has_raw_newline {
                            dbg_eprintln!(
                                "[structured_output] feed delta contains escape chars: len={}, has_backslash={}, has_raw_newline={}, preview={:?}",
                                delta.len(), has_backslash, has_raw_newline,
                                if delta.len() > 80 { &delta[..delta.ceil_char_boundary(80)] } else { delta }
                            );
                        }
                        let events = parser.feed(delta);
                        for event in events {
                            match event {
                                crate::services::structured_output_parser::StructuredOutputEvent::StringFieldDelta { key, delta } => {
                    if key == "content" {
                        full_content.push_str(&delta);
                    }
                    let next_index = content_parts.len() as i64;
                    let part_type = map_structured_field_part_type(&key);
                    let content_index = ensure_content_part_by_key(
                        &mut content_parts, &mut content_part_lookup,
                        &key, next_index, part_type,
                    );
                    if part_type == "structured_output" {
                        content_parts[content_index].tool_name = Some(key.clone());
                    }
                    append_content_part_text(&mut content_parts[content_index], &delta);
                    emit_structured_field_delta_event(
                        app, conversation_id, round_id, assistant_message_id,
                        "openai_compatible", &key, content_index as i64, &delta,
                    )?;
                }
                                crate::services::structured_output_parser::StructuredOutputEvent::ObjectFieldComplete { key, value } => {
                                    let json_str = serde_json::Value::Object(value).to_string();
                                    let next_index = content_parts.len() as i64;
                                    let part_type = map_structured_field_part_type(&key);
                                    let content_index = ensure_content_part_by_key(
                                        &mut content_parts, &mut content_part_lookup,
                                        &key, next_index, part_type,
                                    );
                                    content_parts[content_index].json_value = Some(json_str.clone());
                                    if part_type == "structured_output" {
                                        content_parts[content_index].tool_name = Some(key.clone());
                                    }
                                    emit_object_field_complete_event(
                                        app, conversation_id, round_id, assistant_message_id,
                                        "openai_compatible", &key, content_index as i64, &json_str,
                                    )?;
                                }
                                crate::services::structured_output_parser::StructuredOutputEvent::ArrayFieldComplete { key, value } => {
                                    let json_str = value.to_string();
                                    let next_index = content_parts.len() as i64;
                                    let part_type = map_structured_field_part_type(&key);
                                    let content_index = ensure_content_part_by_key(
                                        &mut content_parts, &mut content_part_lookup,
                                        &key, next_index, part_type,
                                    );
                                    content_parts[content_index].json_value = Some(json_str.clone());
                                    if part_type == "structured_output" {
                                        content_parts[content_index].tool_name = Some(key.clone());
                                    }
                                    emit_object_field_complete_event(
                                        app, conversation_id, round_id, assistant_message_id,
                                        "openai_compatible", &key, content_index as i64, &json_str,
                                    )?;
                                }
                                crate::services::structured_output_parser::StructuredOutputEvent::ParseError(err) => {
                                    dbg_eprintln!("[structured_output] parse error: {}", err);
                                }
                            }
                        }
                    } else {
                        full_content.push_str(delta);
                        pending.push_str(delta);
                    }
                }
            }

            let reasoning_opt = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| {
                    delta.get("reasoning_content")
                        .or_else(|| delta.get("reasoning"))
                        .or_else(|| delta.get("thinking"))
                })
                .and_then(|rc| rc.as_str());

            if let Some(reasoning) = reasoning_opt {
                if !reasoning.is_empty() {
                    thinking_content.push_str(reasoning);
                    let content_index = ensure_content_part_by_key(
                        &mut content_parts,
                        &mut content_part_lookup,
                        "thinking_0",
                        0,
                        "thinking",
                    );
                    append_content_part_text(&mut content_parts[content_index], reasoning);
                    emit_llm_stream_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        "openai_compatible",
                        "thinking_delta",
                        Some(0),
                        Some("thinking"),
                        Some(reasoning.to_string()),
                        None,
                        None,
                        None,
                        None,
                        None,
                    )?;
                }
            }

            // OpenAI 的流式工具调用：`delta.tool_calls` 按 index 分片下发，
            // 全部 divert 进静默缓冲拼装，不产生对白事件（分而治之）。
            if let Some(tool_calls) = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("tool_calls"))
                .and_then(|calls| calls.as_array())
            {
                for call in tool_calls {
                    tool_accumulator.feed_openai_delta(call);
                }
            }

            if let Some(reason) = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("finish_reason"))
                .and_then(|fr| fr.as_str())
            {
                if !reason.is_empty() {
                    finish_reason = Some(reason.to_string());
                }
            }

            if let Some(usage) = value.get("usage") {
                if prompt_tokens.is_none() {
                    prompt_tokens = usage.get("prompt_tokens").and_then(|v| v.as_i64());
                }
                if completion_tokens.is_none() {
                    completion_tokens = usage.get("completion_tokens").and_then(|v| v.as_i64());
                }
            }

            if last_emit.elapsed() >= Duration::from_millis(50) && !pending.is_empty() {
                flush_text_delta_event(
                    app,
                    conversation_id,
                    round_id,
                    assistant_message_id,
                    "openai_compatible",
                    &mut pending,
                )?;
                last_emit = Instant::now();
            }
        }

        if last_abort_check.elapsed() >= Duration::from_millis(500) {
            last_abort_check = Instant::now();
            if is_round_aborted(db, round_id, assistant_message_id).await? {
                break;
            }
        }
    }

    if !pending.is_empty() {
        flush_text_delta_event(
            app,
            conversation_id,
            round_id,
            assistant_message_id,
            "openai_compatible",
            &mut pending,
        )?;
    }
    let mut structured_json_content: Option<String> = None;
    if let Some(parser) = structured_parser.take() {
        match parser.finish() {
            Ok(result) => {
                let mut full_json = serde_json::Map::new();
                for (key, value) in &result.fields {
                    full_json.insert(key.clone(), value.clone());
                }
                structured_json_content = Some(serde_json::Value::Object(full_json).to_string());
                for (key, value) in result.fields {
                    let part_type = map_structured_field_part_type(&key);
                    let next_index = content_parts.len() as i64;
                    let content_index = ensure_content_part_by_key(
                        &mut content_parts, &mut content_part_lookup,
                        &key, next_index, part_type,
                    );
                    if value.is_string() {
                        append_content_part_text(&mut content_parts[content_index], value.as_str().unwrap_or(""));
                    } else if value.is_object() {
                        content_parts[content_index].json_value = Some(value.to_string());
                    }
                    if part_type == "structured_output" {
                        content_parts[content_index].tool_name = Some(key);
                    }
                }
            }
            Err(err) => {
                dbg_eprintln!("[structured_output] finish error, entering compatibility mode: {}", err);
                if !raw_prose.trim().is_empty() {
                    structured_json_content = Some(build_compatibility_fallback_json(
                        &raw_prose,
                        schema_json,
                    ));
                    if let Err(e) = emit_compatibility_mode_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        provider_kind,
                        "结构化 JSON 解析失败，已启用兼容模式：模型回复未返回合法 JSON，原文已整体转入 narrative 字段。",
                    ) {
                        dbg_eprintln!("[compatibility_mode] failed to emit notice: {}", e);
                    }
                }
            }
        }
    }
    if structured_json_content.is_none() && !full_content.is_empty() {
        let next_index = content_parts.len() as i64;
        let content_index = ensure_content_part_by_key(
            &mut content_parts,
            &mut content_part_lookup,
            "text",
            next_index,
            "text",
        );
        append_content_part_text(&mut content_parts[content_index], &full_content);
    }
    // OpenAI 的 finish_reason=tool_calls：统一工具收尾（校验 → 落盘 → emit），
    // 把待执行清单交回调用方。这里**不走** finalize（本轮没有正文终稿），
    // 由编排层执行工具、回注 tool_result 后继续。
    if !tool_accumulator.is_empty() {
        return complete_tool_use_turn(
            tool_accumulator,
            &mut content_parts,
            &mut content_part_lookup,
            app,
            db,
            conversation_id,
            round_id,
            assistant_message_id,
            provider_kind,
            full_content,
            thinking_content,
            prompt_tokens,
            completion_tokens,
        )
        .await;
    }

    emit_stream_message_stop(
        app,
        conversation_id,
        round_id,
        assistant_message_id,
        "openai_compatible",
        None,
        prompt_tokens,
        completion_tokens,
    )?;

    let content_to_save = structured_json_content.as_deref().unwrap_or(&full_content);
    if content_to_save.is_empty() {
        let msg_exists: bool = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE id = ?")
            .bind(assistant_message_id)
            .fetch_one(db)
            .await
            .map(|count: i64| count > 0)
            .unwrap_or(false);
        if !msg_exists {
            dbg_eprintln!("[chat] stream_openai: content empty and message {} deleted, silently returning", assistant_message_id);
            return Ok(StreamResponseData {
                full_content: String::new(),
                thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                stop_reason: finish_reason,
                pending_tool_uses: Vec::new(),
            });
        }
        return Err("LLM 响应为空".to_string());
    }

    finalize_streamed_response(
        db,
        round_id,
        assistant_message_id,
        content_to_save,
        content_parts.as_slice(),
        &[],
        prompt_tokens,
    )
    .await?;

    Ok(StreamResponseData {
        full_content: structured_json_content.unwrap_or(full_content),
        thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
        stop_reason: finish_reason,
        pending_tool_uses: Vec::new(),
    })
}

async fn stream_anthropic_text_response(
    response: reqwest::Response,
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    assistant_message_id: i64,
    _compiled_prompt: &PromptCompileResult,
    response_mode: Option<&str>,
    schema_json: Option<&str>,
) -> Result<StreamResponseData, String> {
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut thinking_content = String::new();
    let mut pending = String::new();
    let mut last_emit = Instant::now();
    let mut content_parts: Vec<PendingMessageContentPart> = Vec::new();
    let mut content_part_lookup: HashMap<String, usize> = HashMap::new();
    let mut latest_stop_reason: Option<String> = None;
    let provider_kind: &str = "anthropic";
    let mut raw_prose = String::new();
    let mut tool_accumulator = StreamingToolAccumulator::new();
    let mut prompt_tokens: Option<i64> = None;
    let mut completion_tokens: Option<i64> = None;
    let mut last_abort_check = Instant::now();
    let mut structured_parser = if response_mode == Some("structured_json") {
        Some(crate::services::structured_output_parser::StructuredOutputParser::new())
    } else {
        None
    };

    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|err| {
            let is_timeout = err.is_timeout();
            let is_body = err.is_body();
            let is_decode = err.is_decode();
            dbg_eprintln!(
                "[chat] bytes_stream error (anthropic): {} | timeout={} body={} decode={}",
                err, is_timeout, is_body, is_decode
            );
            format!(
                "流式响应解码失败: {} | timeout={} body={} decode={}",
                err, is_timeout, is_body, is_decode
            )
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let raw_line = buffer[..pos].to_string();
            buffer = buffer[pos + 1..].to_string();
            let line = raw_line.trim();

            if !line.starts_with("data:") {
                continue;
            }

            let data = line.trim_start_matches("data:").trim();
            let value: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let event_type = value
                .get("type")
                .and_then(|event_type| event_type.as_str())
                .unwrap_or_default();

            match event_type {
                "content_block_start" => {
                    let block_type = value
                        .get("content_block")
                        .and_then(|content_block| content_block.get("type"))
                        .and_then(|block_type| block_type.as_str())
                        .unwrap_or_default();
                    let provider_part_index = value
                        .get("index")
                        .and_then(|index| index.as_i64())
                        .unwrap_or(content_parts.len() as i64);
                    match block_type {
                        "" | "text" => {
                            emit_llm_stream_event(
                                app,
                                conversation_id,
                                round_id,
                                assistant_message_id,
                                "anthropic",
                                "content_block_start",
                                Some(provider_part_index),
                                Some("text"),
                                None,
                                None,
                                None,
                                None,
                                None,
                                None,
                            )?;
                        }
                        "tool_use" => {
                            let content_block = value.get("content_block").ok_or_else(|| {
                                "Anthropic tool_use 缺少 content_block".to_string()
                            })?;
                            let tool_use_id = content_block
                                .get("id")
                                .and_then(|id| id.as_str())
                                .ok_or_else(|| "Anthropic tool_use 缺少 id".to_string())?
                                .to_string();
                            let tool_name = content_block
                                .get("name")
                                .and_then(|name| name.as_str())
                                .ok_or_else(|| "Anthropic tool_use 缺少 name".to_string())?
                                .to_string();
                            let content_index = ensure_content_part_by_key(
                                &mut content_parts,
                                &mut content_part_lookup,
                                &tool_use_id,
                                provider_part_index,
                                "tool_use",
                            );
                            content_parts[content_index].tool_use_id = Some(tool_use_id.clone());
                            content_parts[content_index].tool_name = Some(tool_name.clone());
                            content_parts[content_index].json_value = content_block
                                .get("input")
                                .map(|input| input.to_string())
                                .or_else(|| Some("{}".to_string()));
                            tool_accumulator.begin_anthropic_tool_use(
                                provider_part_index,
                                &tool_use_id,
                                &tool_name,
                            );
                            emit_llm_stream_event(
                                app,
                                conversation_id,
                                round_id,
                                assistant_message_id,
                                "anthropic",
                                "content_block_start",
                                Some(provider_part_index),
                                Some("tool_use"),
                                None,
                                None,
                                Some(crate::models::LlmStreamToolUseEvent {
                                    id: tool_use_id,
                                    name: tool_name,
                                }),
                                None,
                                None,
                                None,
                            )?;
                        }
                        "thinking" | "redacted_thinking" => {
                            let content_index = ensure_content_part_by_key(
                                &mut content_parts,
                                &mut content_part_lookup,
                                &format!("{}_{}", block_type, provider_part_index),
                                provider_part_index,
                                block_type,
                            );
                            if block_type == "redacted_thinking" {
                                if let Some(data_value) = value
                                    .get("content_block")
                                    .and_then(|content_block| content_block.get("data"))
                                {
                                    content_parts[content_index].json_value =
                                        Some(data_value.to_string());
                                }
                            }
                            emit_llm_stream_event(
                                app,
                                conversation_id,
                                round_id,
                                assistant_message_id,
                                "anthropic",
                                "content_block_start",
                                Some(provider_part_index),
                                Some(block_type),
                                None,
                                None,
                                None,
                                None,
                                None,
                                None,
                            )?;
                        }
                        other => {
                            return Err(format!(
                                "当前聊天主链路尚未支持 Anthropic content_block.type='{}'",
                                other
                            ))
                        }
                    }
                }
                "content_block_delta" => {
                    let delta_type = value
                        .get("delta")
                        .and_then(|delta| delta.get("type"))
                        .and_then(|delta_type| delta_type.as_str())
                        .unwrap_or_default();
                    let provider_part_index = value
                        .get("index")
                        .and_then(|index| index.as_i64())
                        .unwrap_or(content_parts.len() as i64);
                    match delta_type {
                        "text_delta" => {
                            let delta = value
                                .get("delta")
                                .and_then(|delta| delta.get("text"))
                                .and_then(|text| text.as_str())
                                .unwrap_or_default();
                            if !delta.is_empty() {
                                if let Some(ref mut parser) = structured_parser {
                                    raw_prose.push_str(delta);
                                    let events = parser.feed(delta);
                                    for event in events {
                                        match event {
                                            crate::services::structured_output_parser::StructuredOutputEvent::StringFieldDelta { key, delta: field_delta } => {
                                                if key == "content" || key == "text" {
                                                    full_content.push_str(&field_delta);
                                                }
                                                let next_index = content_parts.len() as i64;
                                                let part_type = map_structured_field_part_type(&key);
                                                let content_index = ensure_content_part_by_key(
                                                    &mut content_parts, &mut content_part_lookup,
                                                    &key, next_index, part_type,
                                                );
                                                if part_type == "structured_output" {
                                                    content_parts[content_index].tool_name = Some(key.clone());
                                                }
                                                append_content_part_text(&mut content_parts[content_index], &field_delta);
                                                emit_structured_field_delta_event(
                                                    app, conversation_id, round_id, assistant_message_id,
                                                    "anthropic", &key, content_index as i64, &field_delta,
                                                )?;
                                            }
                                            crate::services::structured_output_parser::StructuredOutputEvent::ObjectFieldComplete { key, value } => {
                                                let json_str = serde_json::Value::Object(value).to_string();
                                                let next_index = content_parts.len() as i64;
                                                let part_type = map_structured_field_part_type(&key);
                                                let content_index = ensure_content_part_by_key(
                                                    &mut content_parts, &mut content_part_lookup,
                                                    &key, next_index, part_type,
                                                );
                                                content_parts[content_index].json_value = Some(json_str.clone());
                                                if part_type == "structured_output" {
                                                    content_parts[content_index].tool_name = Some(key.clone());
                                                }
                                                emit_object_field_complete_event(
                                                    app, conversation_id, round_id, assistant_message_id,
                                                    "anthropic", &key, content_index as i64, &json_str,
                                                )?;
                                            }
                                            crate::services::structured_output_parser::StructuredOutputEvent::ArrayFieldComplete { key, value } => {
                                                let json_str = value.to_string();
                                                let next_index = content_parts.len() as i64;
                                                let part_type = map_structured_field_part_type(&key);
                                                let content_index = ensure_content_part_by_key(
                                                    &mut content_parts, &mut content_part_lookup,
                                                    &key, next_index, part_type,
                                                );
                                                content_parts[content_index].json_value = Some(json_str.clone());
                                                if part_type == "structured_output" {
                                                    content_parts[content_index].tool_name = Some(key.clone());
                                                }
                                                emit_object_field_complete_event(
                                                    app, conversation_id, round_id, assistant_message_id,
                                                    "anthropic", &key, content_index as i64, &json_str,
                                                )?;
                                            }
                                            crate::services::structured_output_parser::StructuredOutputEvent::ParseError(err) => {
                                                dbg_eprintln!("[structured_output] parse error: {}", err);
                                            }
                                        }
                                    }
                                } else {
                                    full_content.push_str(delta);
                                    pending.push_str(delta);
                                }
                            }
                        }
                        "input_json_delta" => {
                            let partial_json = value
                                .get("delta")
                                .and_then(|delta| delta.get("partial_json"))
                                .and_then(|partial_json| partial_json.as_str())
                                .unwrap_or_default();
                            if let Some(ref mut parser) = structured_parser {
                                let events = parser.feed(partial_json);
                                for event in events {
                                    match event {
                                        crate::services::structured_output_parser::StructuredOutputEvent::StringFieldDelta { key, delta } => {
                                            if key == "content" {
                                                full_content.push_str(&delta);
                                            }
                                            let next_index = content_parts.len() as i64;
                                            let part_type = map_structured_field_part_type(&key);
                                            let content_index = ensure_content_part_by_key(
                                                &mut content_parts, &mut content_part_lookup,
                                                &key, next_index, part_type,
                                            );
                                            if part_type == "structured_output" {
                                                content_parts[content_index].tool_name = Some(key.clone());
                                            }
                                            append_content_part_text(&mut content_parts[content_index], &delta);
                                            emit_structured_field_delta_event(
                                                app, conversation_id, round_id, assistant_message_id,
                                                "anthropic", &key, content_index as i64, &delta,
                                            )?;
                                        }
                                        crate::services::structured_output_parser::StructuredOutputEvent::ObjectFieldComplete { key, value } => {
                                            let json_str = serde_json::Value::Object(value).to_string();
                                            let next_index = content_parts.len() as i64;
                                            let part_type = map_structured_field_part_type(&key);
                                            let content_index = ensure_content_part_by_key(
                                                &mut content_parts, &mut content_part_lookup,
                                                &key, next_index, part_type,
                                            );
                                            content_parts[content_index].json_value = Some(json_str.clone());
                                            if part_type == "structured_output" {
                                                content_parts[content_index].tool_name = Some(key.clone());
                                            }
                                            emit_object_field_complete_event(
                                                app, conversation_id, round_id, assistant_message_id,
                                                "anthropic", &key, content_index as i64, &json_str,
                                            )?;
                                        }
                                        crate::services::structured_output_parser::StructuredOutputEvent::ArrayFieldComplete { key, value } => {
                                            let json_str = value.to_string();
                                            let next_index = content_parts.len() as i64;
                                            let part_type = map_structured_field_part_type(&key);
                                            let content_index = ensure_content_part_by_key(
                                                &mut content_parts, &mut content_part_lookup,
                                                &key, next_index, part_type,
                                            );
                                            content_parts[content_index].json_value = Some(json_str.clone());
                                            if part_type == "structured_output" {
                                                content_parts[content_index].tool_name = Some(key.clone());
                                            }
                                            emit_object_field_complete_event(
                                                app, conversation_id, round_id, assistant_message_id,
                                                "anthropic", &key, content_index as i64, &json_str,
                                            )?;
                                        }
                                        crate::services::structured_output_parser::StructuredOutputEvent::ParseError(err) => {
                                            dbg_eprintln!("[structured_output] parse error: {}", err);
                                        }
                                    }
                                }
                            } else {
                                // 按事件里的 index 找到对应的 pending tool_use（一轮可能并发多个），
                                // 分片只进静默缓冲拼装，不产生对白事件（分而治之）。
                                let (tool_use_id, tool_name, assembled_json) = {
                                    let skeleton = tool_accumulator
                                        .feed_anthropic_json_delta(
                                            provider_part_index,
                                            partial_json,
                                        )?;
                                    (
                                        skeleton.tool_use_id.clone(),
                                        skeleton.tool_name.clone(),
                                        normalize_tool_use_input_json(&skeleton.input_json),
                                    )
                                };
                                let content_index = ensure_content_part_by_key(
                                    &mut content_parts,
                                    &mut content_part_lookup,
                                    &tool_use_id,
                                    provider_part_index,
                                    "tool_use",
                                );
                                content_parts[content_index].tool_use_id =
                                    Some(tool_use_id.clone());
                                content_parts[content_index].tool_name =
                                    Some(tool_name.clone());
                                content_parts[content_index].json_value = Some(assembled_json);
                                emit_llm_stream_event(
                                    app,
                                    conversation_id,
                                    round_id,
                                    assistant_message_id,
                                    "anthropic",
                                    "tool_use",
                                    Some(provider_part_index),
                                    Some("tool_use"),
                                    None,
                                    Some(partial_json.to_string()),
                                    Some(crate::models::LlmStreamToolUseEvent {
                                        id: tool_use_id,
                                        name: tool_name,
                                    }),
                                    None,
                                    None,
                                    None,
                                )?;
                            }
                        }
                        "thinking_delta" => {
                            let content_index = ensure_content_part_by_key(
                                &mut content_parts,
                                &mut content_part_lookup,
                                &format!("thinking_{}", provider_part_index),
                                provider_part_index,
                                "thinking",
                            );
                            let delta = value
                                .get("delta")
                                .and_then(|delta| delta.get("thinking"))
                                .and_then(|thinking| thinking.as_str())
                                .unwrap_or_default();
                            if !delta.is_empty() {
                                thinking_content.push_str(delta);
                                append_content_part_text(&mut content_parts[content_index], delta);
                                emit_llm_stream_event(
                                    app,
                                    conversation_id,
                                    round_id,
                                    assistant_message_id,
                                    "anthropic",
                                    "thinking_delta",
                                    Some(provider_part_index),
                                    Some("thinking"),
                                    Some(delta.to_string()),
                                    None,
                                    None,
                                    None,
                                    None,
                                    None,
                                )?;
                            }
                        }
                        "signature_delta" => {
                            let content_index = ensure_content_part_by_key(
                                &mut content_parts,
                                &mut content_part_lookup,
                                &format!("thinking_{}", provider_part_index),
                                provider_part_index,
                                "thinking",
                            );
                            let signature_delta = value
                                .get("delta")
                                .and_then(|delta| delta.get("signature"))
                                .and_then(|signature| signature.as_str())
                                .unwrap_or_default();
                            if !signature_delta.is_empty() {
                                content_parts[content_index].json_value =
                                    Some(signature_delta.to_string());
                                emit_llm_stream_event(
                                    app,
                                    conversation_id,
                                    round_id,
                                    assistant_message_id,
                                    "anthropic",
                                    "thinking_delta",
                                    Some(provider_part_index),
                                    Some("thinking"),
                                    None,
                                    Some(signature_delta.to_string()),
                                    None,
                                    None,
                                    None,
                                    None,
                                )?;
                            }
                        }
                        "" => {}
                        other => {
                            return Err(format!(
                                "当前聊天主链路尚未支持 Anthropic delta.type='{}'",
                                other
                            ))
                        }
                    }
                }
                "message_delta" => {
                    let stop_reason = value
                        .get("delta")
                        .and_then(|delta| delta.get("stop_reason"))
                        .and_then(|stop_reason| stop_reason.as_str())
                        .unwrap_or_default();
                    if completion_tokens.is_none() {
                        completion_tokens = value
                            .get("usage")
                            .and_then(|usage| usage.get("output_tokens"))
                            .and_then(|v| v.as_i64());
                    }
                    if !stop_reason.is_empty() {
                        latest_stop_reason = Some(stop_reason.to_string());
                        if stop_reason != "tool_use" {
                            emit_llm_stream_event(
                                app,
                                conversation_id,
                                round_id,
                                assistant_message_id,
                                "anthropic",
                                "message_stop",
                                None,
                                None,
                                None,
                                None,
                                None,
                                Some(stop_reason),
                                None,
                                None,
                            )?;
                        }
                    }
                    if stop_reason == "tool_use" {
                        if tool_accumulator.is_empty() {
                            return Err(
                                "Anthropic 返回 stop_reason=tool_use 但未找到已解析 tool_use block"
                                    .to_string(),
                            );
                        }
                        flush_text_delta_event(
                            app,
                            conversation_id,
                            round_id,
                            assistant_message_id,
                            "anthropic",
                            &mut pending,
                        )?;
                        // 不再以错误终止：统一工具收尾后把待执行的工具交回调用方，
                        // 由编排层执行并回注 tool_result。
                        return complete_tool_use_turn(
                            tool_accumulator,
                            &mut content_parts,
                            &mut content_part_lookup,
                            app,
                            db,
                            conversation_id,
                            round_id,
                            assistant_message_id,
                            provider_kind,
                            full_content,
                            thinking_content,
                            None,
                            None,
                        )
                        .await;
                    }
                }
                "message_stop" => {
                    flush_text_delta_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        "anthropic",
                        &mut pending,
                    )?;
                    let mut structured_json_content: Option<String> = None;
                    if let Some(parser) = structured_parser.take() {
                        match parser.finish() {
                            Ok(result) => {
                                let mut full_json = serde_json::Map::new();
                                for (key, value) in &result.fields {
                                    full_json.insert(key.clone(), value.clone());
                                }
                                structured_json_content = Some(serde_json::Value::Object(full_json).to_string());
                                for (key, value) in result.fields {
                                    let part_type = map_structured_field_part_type(&key);
                                    let next_index = content_parts.len() as i64;
                                    let content_index = ensure_content_part_by_key(
                                        &mut content_parts, &mut content_part_lookup,
                                        &key, next_index, part_type,
                                    );
                                    if value.is_string() {
                                        append_content_part_text(&mut content_parts[content_index], value.as_str().unwrap_or(""));
                                    } else if value.is_object() {
                                        content_parts[content_index].json_value = Some(value.to_string());
                                    }
                                    if part_type == "structured_output" {
                                        content_parts[content_index].tool_name = Some(key);
                                    }
                                }
                            }
                            Err(err) => {
                                dbg_eprintln!("[structured_output] finish error, entering compatibility mode: {}", err);
                                if !raw_prose.trim().is_empty() {
                                    structured_json_content = Some(build_compatibility_fallback_json(
                                        &raw_prose,
                                        schema_json,
                                    ));
                                    if let Err(e) = emit_compatibility_mode_event(
                                        app,
                                        conversation_id,
                                        round_id,
                                        assistant_message_id,
                                        provider_kind,
                                        "结构化 JSON 解析失败，已启用兼容模式：流式解析未完成或结构非法，原文已整体转入 narrative 字段。",
                                    ) {
                                        dbg_eprintln!("[compatibility_mode] failed to emit notice: {}", e);
                                    }
                                }
                            }
                        }
                    }
                    emit_stream_message_stop(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        "anthropic",
                        latest_stop_reason.as_deref(),
                        prompt_tokens,
                        completion_tokens,
                    )?;
                    let content_to_save = structured_json_content.as_deref().unwrap_or(&full_content);
                    finalize_streamed_response(
                        db,
                        round_id,
                        assistant_message_id,
                        content_to_save,
                        content_parts.as_slice(),
                        &[],
                        prompt_tokens,
                    )
                    .await?;
                    return Ok(StreamResponseData {
                        full_content: structured_json_content.unwrap_or(full_content),
                        thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                        stop_reason: latest_stop_reason.clone(),
                        pending_tool_uses: Vec::new(),
                    });
                }
                "content_block_stop" => {
                    let provider_part_index = value.get("index").and_then(|index| index.as_i64());
                    emit_llm_stream_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        "anthropic",
                        "content_block_stop",
                        provider_part_index,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                    )?;
                }
                "ping" | "message_start"
                    if event_type == "message_start"
                        && prompt_tokens.is_none() => {
                            prompt_tokens = value
                                .get("message")
                                .and_then(|msg| msg.get("usage"))
                                .and_then(|usage| usage.get("input_tokens"))
                                .and_then(|v| v.as_i64());
                        }
                _ => {}
            }

            if last_emit.elapsed() >= Duration::from_millis(50) && !pending.is_empty() {
                flush_text_delta_event(
                    app,
                    conversation_id,
                    round_id,
                    assistant_message_id,
                    "anthropic",
                    &mut pending,
                )?;
                last_emit = Instant::now();
            }
        }

        if last_abort_check.elapsed() >= Duration::from_millis(500) {
            last_abort_check = Instant::now();
            if is_round_aborted(db, round_id, assistant_message_id).await? {
                break;
            }
        }
    }

    if !pending.is_empty() {
        flush_text_delta_event(
            app,
            conversation_id,
            round_id,
            assistant_message_id,
            "anthropic",
            &mut pending,
        )?;
    }
    let mut structured_json_content: Option<String> = None;
    if let Some(parser) = structured_parser.take() {
        match parser.finish() {
            Ok(result) => {
                let mut full_json = serde_json::Map::new();
                for (key, value) in &result.fields {
                    full_json.insert(key.clone(), value.clone());
                }
                structured_json_content = Some(serde_json::Value::Object(full_json).to_string());
                for (key, value) in result.fields {
                    let part_type = map_structured_field_part_type(&key);
                    let next_index = content_parts.len() as i64;
                    let content_index = ensure_content_part_by_key(
                        &mut content_parts, &mut content_part_lookup,
                        &key, next_index, part_type,
                    );
                    if value.is_string() {
                        append_content_part_text(&mut content_parts[content_index], value.as_str().unwrap_or(""));
                    } else if value.is_object() {
                        content_parts[content_index].json_value = Some(value.to_string());
                    }
                    if part_type == "structured_output" {
                        content_parts[content_index].tool_name = Some(key);
                    }
                }
            }
            Err(err) => {
                dbg_eprintln!("[structured_output] finish error, entering compatibility mode: {}", err);
                if !raw_prose.trim().is_empty() {
                    structured_json_content = Some(build_compatibility_fallback_json(
                        &raw_prose,
                        schema_json,
                    ));
                    if let Err(e) = emit_compatibility_mode_event(
                        app,
                        conversation_id,
                        round_id,
                        assistant_message_id,
                        provider_kind,
                        "结构化 JSON 解析失败，已启用兼容模式：模型回复未返回合法 JSON，原文已整体转入 narrative 字段。",
                    ) {
                        dbg_eprintln!("[compatibility_mode] failed to emit notice: {}", e);
                    }
                }
            }
        }
    }
    if structured_json_content.is_none() && !full_content.is_empty() && !content_parts.iter().any(|p| p.part_type == "text") {
        let next_index = content_parts.len() as i64;
        let content_index = ensure_content_part_by_key(
            &mut content_parts,
            &mut content_part_lookup,
            "text",
            next_index,
            "text",
        );
        append_content_part_text(&mut content_parts[content_index], &full_content);
    }
    emit_stream_message_stop(
        app,
        conversation_id,
        round_id,
        assistant_message_id,
        "anthropic",
        latest_stop_reason.as_deref(),
        prompt_tokens,
        completion_tokens,
    )?;

    let content_to_save = structured_json_content.as_deref().unwrap_or(&full_content);
    if content_to_save.is_empty() {
        let msg_exists: bool = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE id = ?")
            .bind(assistant_message_id)
            .fetch_one(db)
            .await
            .map(|count: i64| count > 0)
            .unwrap_or(false);
        if !msg_exists {
            dbg_eprintln!("[chat] stream_anthropic: content empty and message {} deleted, silently returning", assistant_message_id);
            return Ok(StreamResponseData {
                full_content: String::new(),
                thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
                stop_reason: latest_stop_reason.clone(),
                pending_tool_uses: Vec::new(),
            });
        }
        return Err("LLM 响应为空".to_string());
    }

    finalize_streamed_response(
        db,
        round_id,
        assistant_message_id,
        content_to_save,
        content_parts.as_slice(),
        &[],
        prompt_tokens,
    )
    .await?;

    Ok(StreamResponseData {
        full_content: structured_json_content.unwrap_or(full_content),
        thinking_content: if thinking_content.is_empty() { None } else { Some(thinking_content) },
        stop_reason: latest_stop_reason.clone(),
        pending_tool_uses: Vec::new(),
    })
}

async fn resolve_prompt_compile_mode(
    db: &SqlitePool,
    round_id: i64,
    assistant_message_id: i64,
) -> Result<PromptCompileMode, String> {
    let has_prior =
        MessageRepository::has_prior_assistant_in_round(db, round_id, assistant_message_id).await?;
    Ok(if has_prior {
        PromptCompileMode::ClassicRegenerate
    } else {
        PromptCompileMode::ClassicChat
    })
}

fn inject_image_parts_into_request(
    request: &mut LlmChatRequest,
    attachments: &[ChatAttachment],
) -> Result<(), String> {
    if attachments.is_empty() {
        return Ok(());
    }

    let user_msg_index = request
        .messages
        .iter()
        .rposition(|msg| msg.role == LlmRole::User)
        .ok_or_else(|| "cannot find user message to inject image parts".to_string())?;

    let image_parts: Vec<LlmContentPart> = attachments
        .iter()
        .map(|attachment| LlmContentPart::Image {
            media_type: attachment.mime_type.clone(),
            source: LlmBinarySource::Base64 {
                media_type: attachment.mime_type.clone(),
                data_base64: attachment.base64_data.clone(),
            },
        })
        .collect();

    let message = &mut request.messages[user_msg_index];
    let mut new_parts = image_parts;
    new_parts.append(&mut message.parts);
    message.parts = new_parts;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn openai_call_fragment(index: i64, id: &str, name: &str, arguments: &str) -> Value {
        serde_json::json!({
            "index": index,
            "id": id,
            "type": "function",
            "function": { "name": name, "arguments": arguments }
        })
    }

    #[test]
    fn accumulator_assembles_interleaved_openai_tool_calls() {
        // 混洗分片：两条工具调用交错下发，arguments 逐片拼接，id/name 只在首片出现。
        let mut accumulator = StreamingToolAccumulator::new();
        accumulator.feed_openai_delta(&openai_call_fragment(0, "call_a", "buy_item", "{\"item\":"));
        accumulator.feed_openai_delta(&openai_call_fragment(1, "call_b", "add_todo", "{\"text\":"));
        accumulator.feed_openai_delta(&serde_json::json!({
            "index": 0, "function": { "arguments": "\"sword\",\"count\":1}" }
        }));
        accumulator.feed_openai_delta(&serde_json::json!({
            "index": 1, "function": { "arguments": "\"buy milk\"}" }
        }));

        // 文本通道与工具通道分离：拼装期间缓冲只持有骨架，不产出任何对白文本。
        assert_eq!(accumulator.skeletons().len(), 2);

        let skeletons = accumulator.finish().expect("finish should succeed");
        assert_eq!(skeletons.len(), 2);
        assert_eq!(skeletons[0].tool_use_id, "call_a");
        assert_eq!(skeletons[0].tool_name, "buy_item");
        assert_eq!(skeletons[0].input_json, "{\"item\":\"sword\",\"count\":1}");
        assert_eq!(skeletons[1].tool_use_id, "call_b");
        assert_eq!(skeletons[1].tool_name, "add_todo");
        assert_eq!(skeletons[1].input_json, "{\"text\":\"buy milk\"}");
    }

    #[test]
    fn accumulator_finish_rejects_malformed_arguments_json() {
        let mut accumulator = StreamingToolAccumulator::new();
        accumulator.feed_openai_delta(&openai_call_fragment(0, "call_a", "buy_item", "{not json"));
        let err = accumulator.finish().expect_err("malformed JSON must fail the whole batch");
        assert!(err.contains("buy_item"), "error should name the tool: {err}");
        assert!(err.contains("不是合法 JSON"), "error: {err}");
    }

    #[test]
    fn accumulator_finish_rejects_missing_id_or_name() {
        let mut no_id = StreamingToolAccumulator::new();
        no_id.feed_openai_delta(&serde_json::json!({
            "index": 0, "function": { "name": "buy_item", "arguments": "{}" }
        }));
        let err = no_id.finish().expect_err("missing id must fail");
        assert!(err.contains("缺少 id"), "error: {err}");

        let mut no_name = StreamingToolAccumulator::new();
        no_name.feed_openai_delta(&serde_json::json!({
            "index": 0, "id": "call_x", "function": { "arguments": "{}" }
        }));
        let err = no_name.finish().expect_err("missing name must fail");
        assert!(err.contains("缺少 name"), "error: {err}");
    }

    #[test]
    fn accumulator_finish_normalizes_empty_arguments() {
        let mut accumulator = StreamingToolAccumulator::new();
        accumulator.feed_openai_delta(&openai_call_fragment(0, "call_a", "get_gold", ""));
        let skeletons = accumulator.finish().expect("empty arguments are valid (no-arg tool)");
        assert_eq!(skeletons[0].input_json, "{}");
    }

    #[test]
    fn accumulator_assembles_anthropic_tool_use_deltas() {
        let mut accumulator = StreamingToolAccumulator::new();
        accumulator.begin_anthropic_tool_use(2, "toolu_1", "deduct_gold");
        let skeleton = accumulator
            .feed_anthropic_json_delta(2, "{\"amount\":")
            .expect("delta for known block");
        assert_eq!(skeleton.tool_use_id, "toolu_1");
        accumulator
            .feed_anthropic_json_delta(2, "30}")
            .expect("second delta");
        let skeletons = accumulator.finish().expect("finish should succeed");
        assert_eq!(skeletons.len(), 1);
        assert_eq!(skeletons[0].provider_part_index, 2);
        assert_eq!(skeletons[0].input_json, "{\"amount\":30}");
    }

    #[test]
    fn accumulator_anthropic_delta_without_begin_is_hard_error() {
        let mut accumulator = StreamingToolAccumulator::new();
        let err = accumulator
            .feed_anthropic_json_delta(0, "{}")
            .expect_err("delta without begin must fail loudly (C2)");
        assert!(err.contains("缺少 pending tool_use 上下文"), "error: {err}");
    }

    #[test]
    fn fallback_narrative_synthesizes_from_receipts() {
        assert!(synthesize_fallback_narrative(&[]).is_none());
        let single = [ToolReceiptSummary { tool_name: "buy_item", is_error: false }];
        assert_eq!(
            synthesize_fallback_narrative(&single).as_deref(),
            Some("*（完成了交互结算：[buy_item 成功]）*")
        );
        let mixed = [
            ToolReceiptSummary { tool_name: "deduct_gold", is_error: false },
            ToolReceiptSummary { tool_name: "buy_item", is_error: true },
        ];
        assert_eq!(
            synthesize_fallback_narrative(&mixed).as_deref(),
            Some("*（完成了交互结算：[deduct_gold 成功、buy_item 失败]）*")
        );
    }

    async fn setup_narrative_db() -> SqlitePool {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("connect sqlite::memory:");
        sqlx::query(
            "CREATE TABLE message_rounds (id INTEGER PRIMARY KEY, active_assistant_message_id INTEGER)",
        )
        .execute(&pool)
        .await
        .expect("create message_rounds");
        sqlx::query(
            "CREATE TABLE messages (id INTEGER PRIMARY KEY, content TEXT NOT NULL DEFAULT '')",
        )
        .execute(&pool)
        .await
        .expect("create messages");
        pool
    }

    #[tokio::test]
    async fn fallback_narrative_lands_in_sqlite_for_empty_tool_turn() {
        let pool = setup_narrative_db().await;
        sqlx::query("INSERT INTO messages (id, content) VALUES (10, '')")
            .execute(&pool)
            .await
            .expect("insert assistant message");
        sqlx::query("INSERT INTO message_rounds (id, active_assistant_message_id) VALUES (5, 10)")
            .execute(&pool)
            .await
            .expect("insert round");

        let receipts = [ToolReceiptSummary { tool_name: "buy_item", is_error: false }];
        let filled = fill_fallback_narrative_if_empty(&pool, 5, &receipts)
            .await
            .expect("fill should succeed");
        assert!(filled, "empty tool turn must receive the synthesized narrative");

        let content: String = sqlx::query_scalar("SELECT content FROM messages WHERE id = 10")
            .fetch_one(&pool)
            .await
            .expect("read back content");
        assert_eq!(content, "*（完成了交互结算：[buy_item 成功]）*");
    }

    #[tokio::test]
    async fn fallback_narrative_never_overwrites_existing_text() {
        let pool = setup_narrative_db().await;
        sqlx::query("INSERT INTO messages (id, content) VALUES (10, '原有对白')")
            .execute(&pool)
            .await
            .expect("insert assistant message");
        sqlx::query("INSERT INTO message_rounds (id, active_assistant_message_id) VALUES (5, 10)")
            .execute(&pool)
            .await
            .expect("insert round");

        let receipts = [ToolReceiptSummary { tool_name: "buy_item", is_error: false }];
        let filled = fill_fallback_narrative_if_empty(&pool, 5, &receipts)
            .await
            .expect("fill should succeed");
        assert!(!filled);
        let content: String = sqlx::query_scalar("SELECT content FROM messages WHERE id = 10")
            .fetch_one(&pool)
            .await
            .expect("read back content");
        assert_eq!(content, "原有对白");
    }

    #[tokio::test]
    async fn fallback_narrative_skips_without_receipts_or_active_message() {
        let pool = setup_narrative_db().await;
        sqlx::query("INSERT INTO messages (id, content) VALUES (10, '')")
            .execute(&pool)
            .await
            .expect("insert assistant message");
        sqlx::query("INSERT INTO message_rounds (id, active_assistant_message_id) VALUES (5, 10)")
            .execute(&pool)
            .await
            .expect("insert round");
        sqlx::query("INSERT INTO message_rounds (id, active_assistant_message_id) VALUES (6, NULL)")
            .execute(&pool)
            .await
            .expect("insert round without active message");

        let receipts = [ToolReceiptSummary { tool_name: "buy_item", is_error: false }];
        assert!(
            !fill_fallback_narrative_if_empty(&pool, 5, &[])
                .await
                .expect("no receipts"),
            "no tool execution means no synthesized narrative"
        );
        assert!(
            !fill_fallback_narrative_if_empty(&pool, 6, &receipts)
                .await
                .expect("no active message"),
            "round without an active assistant message cannot be filled"
        );
    }
}

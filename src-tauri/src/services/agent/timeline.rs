//! 运行期时序事件：把"真实发生的事情"推给前端调试抽屉。
//!
//! 此前抽屉里的泳道条目来自前端对 `llm-stream-event` 的二次推断，
//! 只能猜出"可能有工具调用"，看不到门禁判定、HUD 补丁、Nudge 重试这些后端事实。
//! 这里统一从后端发射 `agent:timeline_event`，前端直接落条目。

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// 事件名（前端 `listen` 的字符串必须与此一致）。
pub const AGENT_TIMELINE_EVENT: &str = "agent:timeline_event";

/// 泳道条目类型。前端按此着色，不做语义推断。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimelineKind {
    /// 模型发起工具调用
    ToolCall,
    /// 门禁判定（放行或拦截）
    Gate,
    /// 数据容器落库与 HUD 补丁广播
    HudPatch,
    /// 结构化输出解析与 Schema 补丁
    SchemaPatch,
    /// 禁词命中触发的重试
    NudgeRetry,
    /// 多智能体子任务（导演/演员/初稿/批注/润色）
    SubAgent,
}

/// 条目状态：成功 / 被拦截 / 失败 / 仅信息。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimelineStatus {
    Success,
    Blocked,
    Failed,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub conversation_id: i64,
    pub round_id: i64,
    pub kind: TimelineKind,
    pub status: TimelineStatus,
    pub title: String,
    pub detail: String,
    /// 事件发生的毫秒级 Unix 时间戳（计划 §9.3"毫秒级回放"；emit_timeline 自动填充）
    #[serde(rename = "tsMs")]
    pub ts_ms: i64,
}

/// 发一条时序事件。
///
/// 发射失败只记录 debug 日志——事件是**观测手段**，它失败不该影响推理主链路；
/// 但也不静默：日志里能看到哪条事件没发出去。
pub fn emit_timeline(app: &AppHandle, mut event: TimelineEvent) {
    if event.ts_ms == 0 {
        event.ts_ms = crate::utils::now_ts_millis();
    }
    if let Err(err) = app.emit(AGENT_TIMELINE_EVENT, &event) {
        crate::dbg_eprintln!(
            "[agent-timeline] emit failed: {} | title={}",
            err,
            event.title
        );
    }
}

/// 便捷构造 + 发射。
#[allow(clippy::too_many_arguments)]
pub fn emit(
    app: &AppHandle,
    conversation_id: i64,
    round_id: i64,
    kind: TimelineKind,
    status: TimelineStatus,
    title: impl Into<String>,
    detail: impl Into<String>,
) {
    emit_timeline(
        app,
        TimelineEvent {
            conversation_id,
            ts_ms: crate::utils::now_ts_millis(),
            round_id,
            kind,
            status,
            title: title.into(),
            detail: detail.into(),
        },
    );
}

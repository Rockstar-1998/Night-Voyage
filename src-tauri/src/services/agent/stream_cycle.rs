//! 生产流式路径接入统一运行器的 Adapter 层（工单 01-S1 / spec 解法 1）。
//!
//! [`super::cycle::AgentCycleRuntime`] 是全仓唯一的循环政策所在地：步长
//! 预算判定、首步短路、步长熔断只在运行器一处实现（Locality）。本模块的
//! 两个 Adapter 把 `stream_processor` 既有的流式管线接到运行器的两个
//! trait 接缝（Seam）上，使生产单智能体轮次真实改由运行器驱动：
//!
//! - [`StreamingStepProvider`]（[`AgentStepProvider`] 的 Adapter）：后端
//!   [`StreamingStepBackend`] 执行「一跳流式请求」——SSE 逐块发射对白、
//!   工具分片静默拼装（`StreamingToolAccumulator`）、流终止走
//!   `complete_tool_use_turn` 原子收尾。流式细节全部留在 backend 一侧，
//!   运行器只看到一步的正文 / 工具调用 / 结束原因。
//! - [`StreamingToolExecutor`]（[`AgentToolExecutor`] 的 Adapter）：后端
//!   [`StreamingToolBackend`] 执行一次本地工具调用（生产侧走
//!   `execute_tool_call_with_plan` 同一条链：白名单 → 契约 → 门禁 →
//!   容器落盘，并向时序泳道发射真实回执）。
//!
//! 接缝契约（生产 backend 与 mock backend 的共同约定）：
//! - `run_step` 的 `system_blocks` / `history` / `tools` 参数是为内存型
//!   调用方（如 [`super::cycle::HttpStepProvider`]）准备的物化视图；生产
//!   流式 backend 的提示词权威物化在 DB 一侧——每一跳由
//!   `prompt_compiler` 按最新落盘历史（已含上一跳回注的 ToolResult）
//!   重新编译，因此 backend 不消费这三个参数，改为在每一跳内部完成
//!   编译 → 请求装配 → 流式发射。循环政策（走几步、何时短路、何时
//!   熔断）仍完全由运行器依据 `AgentCycleConfig` 决定，backend 无权
//!   自行续跳或截断。
//! - backend 的每一次 `run_streaming_step` 恰好对应一次模型 API 往返；
//!   「provider 调用计数」即 backend 被调用次数，短路断言落在此处。

use async_trait::async_trait;

use crate::llm::{LlmMessage, LlmToolDefinition};
use crate::services::agent::cycle::{
    AgentStepProvider, AgentStepResponse, AgentToolExecutor, ExecutedToolReceipt,
};
use crate::services::stream_processor::{synthesize_fallback_narrative, ToolReceiptSummary};

/// 一跳流式请求的后端接缝：执行恰好一次模型 API 往返（流式发射 +
/// 工具拼装 + 原子收尾），返回该步的正文与待执行工具调用。
#[async_trait]
pub trait StreamingStepBackend: Send + Sync {
    /// 执行一跳流式请求。失败（网络 / 协议 / 落盘）显式返回 `Err`，
    /// 由运行器原样上抛（C2），backend 不得自行重试或续跳。
    async fn run_streaming_step(&self) -> Result<AgentStepResponse, String>;
}

/// 一次本地工具执行的后端接缝。
#[async_trait]
pub trait StreamingToolBackend: Send + Sync {
    /// 执行名为 `name` 的工具。成功返回输出文本；失败返回错误信息
    /// （运行器将其转为 `is_error` 回执，不吞异常，C2）。
    async fn execute_streaming_tool(
        &self,
        name: &str,
        arguments_json: &str,
    ) -> Result<String, String>;
}

/// [`AgentStepProvider`] 的流式 Adapter：把一跳流式管线包成运行器的
/// 一步。自身不持有任何步进 / 短路 / 熔断逻辑。
pub struct StreamingStepProvider<B> {
    backend: B,
}

impl<B> StreamingStepProvider<B> {
    /// 以给定流式 backend 构造 Adapter。
    pub fn new(backend: B) -> Self {
        Self { backend }
    }
}

#[async_trait]
impl<B> AgentStepProvider for StreamingStepProvider<B>
where
    B: StreamingStepBackend,
{
    async fn run_step(
        &self,
        _system_blocks: &[String],
        _history: &[LlmMessage],
        _tools: &[LlmToolDefinition],
    ) -> Result<AgentStepResponse, String> {
        // 提示词物化归 backend（见模块文档的接缝契约）：生产 backend
        // 逐跳经 prompt_compiler 按 DB 历史编译，运行器传入的内存视图
        // 不在此消费。步进政策仍由运行器独占。
        self.backend.run_streaming_step().await
    }
}

/// [`AgentToolExecutor`] 的流式 Adapter：把一次本地工具执行包成运行器
/// 的执行接缝。自身不持有任何批量 / 回注 / 续跳逻辑。
pub struct StreamingToolExecutor<B> {
    backend: B,
}

impl<B> StreamingToolExecutor<B> {
    /// 以给定工具 backend 构造 Adapter。
    pub fn new(backend: B) -> Self {
        Self { backend }
    }
}

#[async_trait]
impl<B> AgentToolExecutor for StreamingToolExecutor<B>
where
    B: StreamingToolBackend,
{
    async fn execute(&self, name: &str, arguments_json: &str) -> Result<String, String> {
        self.backend.execute_streaming_tool(name, arguments_json).await
    }
}

/// 图未声明步长预算（`step_budget == None`）时的显式翻译值：不限制
/// 步数。运行器的熔断判定是 `steps_taken >= max_steps`，取
/// `usize::MAX` 使该判定在任何现实步数下不触发——这正是「不限制」
/// 的语义，而不是某个隐含的小默认值。
pub const UNLIMITED_STEP_BUDGET: usize = usize::MAX;

/// 步长盖章（阶段 1b 的 `Option` 语义）→ `AgentCycleConfig` 的显式
/// 翻译规则（装配点在 `stream_processor::stream_llm_response`）：
///
/// - `Some(max_steps)`：按图声明装配；短路取盖章值，盖章缺失
///   （`short_circuit == None`，仅旧载荷可能出现）显式翻译为不短路；
/// - `None`（图未声明预算）：翻译为
///   `(UNLIMITED_STEP_BUDGET, false)`——不限制步数、不短路。
///   **禁止把 `None` 默默当 1**：那会把未声明预算的预设全部截断为
///   单步，与阶段 1b「无声明 = 无限制」的定案相悖。
pub fn translate_step_budget(
    step_budget: Option<usize>,
    short_circuit_on_first_step: Option<bool>,
) -> (usize, bool) {
    match step_budget {
        Some(max_steps) => (max_steps, short_circuit_on_first_step.unwrap_or(false)),
        None => (UNLIMITED_STEP_BUDGET, false),
    }
}

/// 短路收尾的旁白保底（工单 02 / spec §3）：短路步正文为空且确有工具
/// 执行时，按回执合成极简行为旁白；正文非空或无回执时返回 `None`。
///
/// 与多步路径共用同一合成函数
/// [`synthesize_fallback_narrative`]：生产驱动层在短路后调用
/// `fill_fallback_narrative_if_empty` 把同一合成结果落盘到助手消息，
/// 本函数是该行为在 Adapter 接缝上的纯函数视图（同一事实、同一文案）。
pub fn short_circuit_narrative(
    text: &str,
    executed_tools: &[ExecutedToolReceipt],
) -> Option<String> {
    if !text.trim().is_empty() {
        return None;
    }
    let summaries: Vec<ToolReceiptSummary<'_>> = executed_tools
        .iter()
        .map(|receipt| ToolReceiptSummary {
            tool_name: &receipt.name,
            is_error: receipt.is_error,
        })
        .collect();
    synthesize_fallback_narrative(&summaries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent::cycle::{
        AgentCycleConfig, AgentCycleOutcome, AgentCycleRuntime, AgentFinishReason, AgentToolCall,
    };
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// 脚本化流式 step backend：逐跳返回预设响应并计数——「短路后
    /// backend 恰好被调用 1 次」即 spec 要求的 provider 调用计数断言。
    struct ScriptedStepBackend {
        responses: Mutex<VecDeque<AgentStepResponse>>,
        call_count: Mutex<usize>,
    }

    impl ScriptedStepBackend {
        fn new(responses: Vec<AgentStepResponse>) -> Self {
            Self {
                responses: Mutex::new(responses.into()),
                call_count: Mutex::new(0),
            }
        }

        fn call_count(&self) -> usize {
            *self.call_count.lock().unwrap_or_else(|p| p.into_inner())
        }
    }

    #[async_trait]
    impl StreamingStepBackend for ScriptedStepBackend {
        async fn run_streaming_step(&self) -> Result<AgentStepResponse, String> {
            let mut count = self.call_count.lock().unwrap_or_else(|p| p.into_inner());
            *count += 1;
            self.responses
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .pop_front()
                .ok_or_else(|| "scripted step backend exhausted".to_string())
        }
    }

    /// 脚本化工具 backend：记录执行过的工具名，全部成功。
    struct ScriptedToolBackend {
        executed: Mutex<Vec<String>>,
    }

    impl ScriptedToolBackend {
        fn new() -> Self {
            Self { executed: Mutex::new(Vec::new()) }
        }

        fn executed_names(&self) -> Vec<String> {
            self.executed.lock().unwrap_or_else(|p| p.into_inner()).clone()
        }
    }

    #[async_trait]
    impl StreamingToolBackend for ScriptedToolBackend {
        async fn execute_streaming_tool(
            &self,
            name: &str,
            _arguments_json: &str,
        ) -> Result<String, String> {
            self.executed
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .push(name.to_string());
            Ok(format!("receipt for {name}"))
        }
    }

    fn text_step(text: &str) -> AgentStepResponse {
        AgentStepResponse {
            text: text.to_string(),
            tool_calls: vec![],
            finish_reason: AgentFinishReason::Stop,
        }
    }

    fn tool_step(text: &str, name: &str) -> AgentStepResponse {
        AgentStepResponse {
            text: text.to_string(),
            tool_calls: vec![AgentToolCall {
                id: "call_1".to_string(),
                name: name.to_string(),
                input_json: serde_json::json!({ "amount": 30 }),
            }],
            finish_reason: AgentFinishReason::ToolCalls,
        }
    }

    fn config_from_stamp(step_budget: Option<usize>, short_circuit: Option<bool>) -> AgentCycleConfig {
        let (max_steps, short_circuit_on_first_step) =
            translate_step_budget(step_budget, short_circuit);
        AgentCycleConfig {
            max_steps,
            short_circuit_on_first_step,
            system_blocks: vec!["test system block".to_string()],
            user_prompt: "玩家：买一把铁剑".to_string(),
            allowed_tools: vec![],
        }
    }

    /// 翻译规则全表：盖章原样、无盖章短路默认关、无预算 = 不限制。
    #[test]
    fn translate_step_budget_covers_all_stamp_combinations() {
        assert_eq!(translate_step_budget(Some(1), Some(true)), (1, true));
        assert_eq!(translate_step_budget(Some(5), Some(false)), (5, false));
        assert_eq!(translate_step_budget(Some(3), None), (3, false));
        assert_eq!(
            translate_step_budget(None, None),
            (UNLIMITED_STEP_BUDGET, false)
        );
        assert_eq!(
            translate_step_budget(None, Some(true)),
            (UNLIMITED_STEP_BUDGET, false),
            "无预算声明时短路盖章不单独生效：未声明 = 不限制且不短路"
        );
    }

    /// Adapter 驱动 + max_steps=1：单步工具调用短路，流式 backend
    /// 恰好被调用 1 次（脚本备有第 2 跳响应作探针，误续跳即暴露）。
    #[tokio::test]
    async fn adapter_single_step_tool_call_short_circuits_with_one_provider_call() {
        let step_backend = ScriptedStepBackend::new(vec![
            tool_step("成交！铁剑归你了。", "buy_item"),
            text_step("这段文本永远不该被请求到"),
        ]);
        let tool_backend = ScriptedToolBackend::new();
        let provider = StreamingStepProvider::new(step_backend);
        let executor = StreamingToolExecutor::new(tool_backend);

        let outcome = AgentCycleRuntime::run_cycle(
            &config_from_stamp(Some(1), Some(true)),
            &provider,
            &executor,
        )
        .await
        .expect("adapter-driven cycle must succeed");

        match outcome {
            AgentCycleOutcome::ShortCircuitedWithTools { text, executed_tools } => {
                assert_eq!(text, "成交！铁剑归你了。");
                assert_eq!(executed_tools.len(), 1);
                assert_eq!(executed_tools[0].name, "buy_item");
                assert!(!executed_tools[0].is_error);
            }
            other => panic!("expected ShortCircuitedWithTools, got {other:?}"),
        }
        assert_eq!(
            provider.backend.call_count(),
            1,
            "short-circuit must never issue a 2nd streaming step"
        );
        assert_eq!(
            executor.backend.executed_names(),
            vec!["buy_item".to_string()]
        );
    }

    /// 无预算声明（None 翻译为不限制）时，Adapter 驱动的多步循环
    /// 正常跑完：两跳工具 + 第三跳文本定稿，backend 共被调用 3 次。
    #[tokio::test]
    async fn adapter_unlimited_budget_runs_multi_step_cycle_to_completion() {
        let step_backend = ScriptedStepBackend::new(vec![
            tool_step("", "inspect_inventory"),
            tool_step("", "inspect_shop"),
            text_step("你背包里有 30 金币，正好够买铁剑。"),
        ]);
        let tool_backend = ScriptedToolBackend::new();
        let provider = StreamingStepProvider::new(step_backend);
        let executor = StreamingToolExecutor::new(tool_backend);

        let outcome = AgentCycleRuntime::run_cycle(
            &config_from_stamp(None, None),
            &provider,
            &executor,
        )
        .await
        .expect("unlimited cycle must succeed");

        assert_eq!(
            outcome,
            AgentCycleOutcome::TextDelivered {
                text: "你背包里有 30 金币，正好够买铁剑。".to_string(),
                steps_taken: 3,
            }
        );
        assert_eq!(provider.backend.call_count(), 3);
        assert_eq!(
            executor.backend.executed_names(),
            vec!["inspect_inventory".to_string(), "inspect_shop".to_string()]
        );
    }

    /// Adapter 路径的旁白保底：短路步正文为空 + 有工具执行 →
    /// 合成旁白存在且文案与生产落盘路径一致；正文非空时不合成。
    #[tokio::test]
    async fn adapter_short_circuit_with_empty_text_yields_fallback_narrative() {
        let step_backend = ScriptedStepBackend::new(vec![tool_step("", "buy_item")]);
        let tool_backend = ScriptedToolBackend::new();
        let provider = StreamingStepProvider::new(step_backend);
        let executor = StreamingToolExecutor::new(tool_backend);

        let outcome = AgentCycleRuntime::run_cycle(
            &config_from_stamp(Some(1), Some(true)),
            &provider,
            &executor,
        )
        .await
        .expect("adapter-driven cycle must succeed");

        match outcome {
            AgentCycleOutcome::ShortCircuitedWithTools { text, executed_tools } => {
                assert!(text.is_empty());
                let narrative = short_circuit_narrative(&text, &executed_tools)
                    .expect("empty short-circuited text with receipts must synthesize a narrative");
                assert_eq!(narrative, "*（完成了交互结算：[buy_item 成功]）*");
                // 正文非空时保底不触发（不覆盖模型原话）。
                assert_eq!(
                    short_circuit_narrative("成交！", &executed_tools),
                    None
                );
            }
            other => panic!("expected ShortCircuitedWithTools, got {other:?}"),
        }
        assert_eq!(provider.backend.call_count(), 1);
    }
}

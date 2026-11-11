//! 通用单核 Agent 循环运行器（全 Agent 统一执行架构工单 01 / spec §1）。
//!
//! 所有 LLM 交互统一走 [`AgentCycleRuntime::run_cycle`] 一个状态机，由
//! [`AgentCycleConfig::max_steps`] 步长预算驱动：
//! - `max_steps == 1` 是单步充填（Single-Pass）：一次 API 往返内同时收对白
//!   与工具调用，工具本地执行完毕后若 `short_circuit_on_first_step` 为真，
//!   立即短路返回，**绝不发起第 2 次 API 调用**；
//! - `max_steps >= 2` 是多步推理（Multi-Pass）：工具回执以
//!   [`LlmContentPart::ToolResult`] 回注历史后续跑，直到模型给出纯文本，
//!   或步长耗尽触发熔断（[`AgentCycleOutcome::CircuitBreakerTripped`]，C2）。
//!
//! 运行器只依赖两个 trait 接缝（[`AgentStepProvider`] = 一次模型往返、
//! [`AgentToolExecutor`] = 一次本地工具执行），不内嵌任何业务流水线：
//! 导演/演员/审查等协作拓扑一律由蓝图图语义表达（GLOSSARY「图语义编排」）。
//! 生产步进器 [`HttpStepProvider`] 复用 `provider_adapter` 装配请求体与
//! `http_client` 共享连接池，不新起第二套 HTTP 栈。

use async_trait::async_trait;
use serde_json::Value;

use crate::llm::{
    LlmChatRequest, LlmContentPart, LlmMessage, LlmRole, LlmToolChoice, LlmToolDefinition,
};
use crate::models::ApiProvider;
use crate::services::provider_adapter::build_provider_http_request;

/// 单次循环运行的配置。步长字段通常来自蓝图编译结果
/// （`BlueprintExecutionResult::step_budget` /
/// `short_circuit_on_first_step`，由 StepBudget 节点物理盖章为 `Some(..)`）。
/// 编译结果为 `None` 时表示图未声明预算：装配本配置的调用方必须显式
/// 决定步长（本运行器不设隐含默认，更不得把 `None` 翻译成单步 1）。
#[derive(Debug, Clone)]
pub struct AgentCycleConfig {
    /// 步长预算上限：1 = 单步充填，>= 2 = 多步推理。0 为无效配置，运行期硬错。
    pub max_steps: usize,
    /// 第 1 步工具执行完毕后是否立即短路截断（单步模式下为 true）。
    pub short_circuit_on_first_step: bool,
    /// 系统提示块（按顺序装配进请求的 system 字段）。
    pub system_blocks: Vec<String>,
    /// 本轮用户输入（作为历史的第一条 user 消息）。
    pub user_prompt: String,
    /// 本轮授权的工具定义白名单（仅这些工具会出现在请求中）。
    pub allowed_tools: Vec<LlmToolDefinition>,
}

/// 模型在一步内请求的一次工具调用（与 [`LlmContentPart::ToolUse`] 同形）。
#[derive(Debug, Clone, PartialEq)]
pub struct AgentToolCall {
    /// 供应商侧工具调用 ID，回注 ToolResult 时按此对齐。
    pub id: String,
    /// 工具名（必须在 `allowed_tools` 白名单内，由执行器侧校验）。
    pub name: String,
    /// 工具参数（JSON 对象）。
    pub input_json: Value,
}

/// 一次工具执行的确定性回执。执行失败不吞异常：以 `is_error = true` 的
/// 结构化回执进入结果与历史（C2），让模型/创作者能看到失败原因。
#[derive(Debug, Clone, PartialEq)]
pub struct ExecutedToolReceipt {
    /// 对应 [`AgentToolCall::id`]。
    pub tool_use_id: String,
    /// 工具名。
    pub name: String,
    /// 执行输出（成功时为工具返回文本，失败时为错误信息）。
    pub output: String,
    /// 该次执行是否失败。
    pub is_error: bool,
}

/// 模型一步的结束原因。用枚举而非字符串/布尔表达，供应商原始值保留在
/// [`AgentFinishReason::Other`] 中不丢失。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentFinishReason {
    /// 模型自然结束（纯文本定稿）。
    Stop,
    /// 模型发起了工具调用。
    ToolCalls,
    /// 输出被长度上限截断。
    Length,
    /// 供应商特有的其他结束原因（保留原始字符串）。
    Other(String),
}

/// 一步模型往返的完整结果：正文 + 工具调用 + 结束原因。
#[derive(Debug, Clone, PartialEq)]
pub struct AgentStepResponse {
    /// 本步正文（可为空，如模型只发工具调用时；保底旁白合成是上层
    /// 流式管线的职责，见工单 03，运行器只如实上报）。
    pub text: String,
    /// 本步请求的工具调用（空 = 纯文本步）。
    pub tool_calls: Vec<AgentToolCall>,
    /// 结束原因。判定循环走向以 `tool_calls` 是否为空为准（与既有
    /// subagent 循环一致），本字段供观测与诊断。
    pub finish_reason: AgentFinishReason,
}

/// 循环的三种终局（spec §1）。
#[derive(Debug, Clone, PartialEq)]
pub enum AgentCycleOutcome {
    /// 模型给出纯文本，正常定稿。`steps_taken` 为实际 API 往返次数。
    TextDelivered { text: String, steps_taken: usize },
    /// 单步短路：第 1 步的工具已全部本地执行，携带回执直接收工——
    /// 此结果返回后运行器保证不会再调用 provider（零二次 API 请求）。
    ShortCircuitedWithTools {
        text: String,
        executed_tools: Vec<ExecutedToolReceipt>,
    },
    /// 步长耗尽时模型仍在请求工具调用：熔断并给出结构化诊断（C2，
    /// 严禁静默截断或假装完成）。
    CircuitBreakerTripped { steps_taken: usize, reason: String },
}

/// 一次模型 API 往返的接缝。生产实现是 [`HttpStepProvider`]，
/// 测试以 mock 实现验证循环状态机（spec Testing Decisions 接缝 1）。
#[async_trait]
pub trait AgentStepProvider: Send + Sync {
    /// 用给定 system 块、历史与工具白名单执行一步模型调用。
    async fn run_step(
        &self,
        system_blocks: &[String],
        history: &[LlmMessage],
        tools: &[LlmToolDefinition],
    ) -> Result<AgentStepResponse, String>;
}

/// 一次本地工具执行的接缝。生产侧应走 `execute_tool_call_with_plan`
/// 同一条链（白名单 → 契约 → 门禁 → 容器落盘）。
#[async_trait]
pub trait AgentToolExecutor: Send + Sync {
    /// 执行名为 `name` 的工具，`arguments_json` 为参数 JSON 文本。
    /// 成功返回输出文本；失败返回错误信息（运行器会将其转为
    /// `is_error` 回执，而非吞掉）。
    async fn execute(&self, name: &str, arguments_json: &str) -> Result<String, String>;
}

/// 通用单核 Agent 循环运行器（无状态，全部状态在单次 `run_cycle` 内）。
pub struct AgentCycleRuntime;

impl AgentCycleRuntime {
    /// 按 `config` 的步长预算驱动循环。
    ///
    /// 循环不变量（spec §1）：
    /// 1. 每轮恰好调用一次 `provider.run_step`，`steps_taken` 即往返计数；
    /// 2. 无工具调用 → [`AgentCycleOutcome::TextDelivered`]；
    /// 3. 有工具调用 → 全部本地执行生成回执，然后依次判定：
    ///    a. `short_circuit_on_first_step && steps_taken == 1` →
    ///       [`AgentCycleOutcome::ShortCircuitedWithTools`]（在此 return，
    ///       循环不可能再触达 provider，第 2 次调用结构上不存在）；
    ///    b. `steps_taken >= max_steps` →
    ///       [`AgentCycleOutcome::CircuitBreakerTripped`]；
    ///    c. 否则回注 ToolUse/ToolResult 到历史，进入下一步。
    pub async fn run_cycle<P, T>(
        config: &AgentCycleConfig,
        provider: &P,
        tool_executor: &T,
    ) -> Result<AgentCycleOutcome, String>
    where
        P: AgentStepProvider + ?Sized,
        T: AgentToolExecutor + ?Sized,
    {
        if config.max_steps == 0 {
            return Err(
                "AgentCycleConfig.max_steps must be >= 1 (0 allows not even the first step)"
                    .to_string(),
            );
        }
        if config.user_prompt.trim().is_empty() {
            return Err("AgentCycleConfig.user_prompt must not be empty".to_string());
        }

        let mut history: Vec<LlmMessage> = vec![LlmMessage::text(
            LlmRole::User,
            config.user_prompt.clone(),
        )];
        let mut steps_taken: usize = 0;

        loop {
            let response = provider
                .run_step(&config.system_blocks, &history, &config.allowed_tools)
                .await?;
            steps_taken += 1;

            if response.tool_calls.is_empty() {
                return Ok(AgentCycleOutcome::TextDelivered {
                    text: response.text,
                    steps_taken,
                });
            }

            // 本步工具全部本地执行。单个工具失败不中断其余工具，也不吞
            // 异常：失败转为 is_error 回执（C2 确定性结构化回执）。
            let mut executed_tools: Vec<ExecutedToolReceipt> =
                Vec::with_capacity(response.tool_calls.len());
            for call in &response.tool_calls {
                let arguments_json = serde_json::to_string(&call.input_json)
                    .map_err(|err| format!("failed to serialize tool arguments: {err}"))?;
                let (output, is_error) = match tool_executor.execute(&call.name, &arguments_json).await {
                    Ok(output) => (output, false),
                    Err(err) => (err, true),
                };
                executed_tools.push(ExecutedToolReceipt {
                    tool_use_id: call.id.clone(),
                    name: call.name.clone(),
                    output,
                    is_error,
                });
            }

            // 单步短路：必须在回注历史与任何后续 provider 调用之前 return。
            if config.short_circuit_on_first_step && steps_taken == 1 {
                return Ok(AgentCycleOutcome::ShortCircuitedWithTools {
                    text: response.text,
                    executed_tools,
                });
            }

            // 步长熔断：预算耗尽而模型仍要调工具，显式报错诊断（C2）。
            if steps_taken >= config.max_steps {
                return Ok(AgentCycleOutcome::CircuitBreakerTripped {
                    steps_taken,
                    reason: format!(
                        "step budget exhausted: {steps_taken} step(s) taken \
                         (max_steps = {}), model still requesting tool calls",
                        config.max_steps
                    ),
                });
            }

            // 多步回注：assistant 的 ToolUse 与逐条 ToolResult 入历史，续跑。
            let mut assistant_parts: Vec<LlmContentPart> = Vec::new();
            if !response.text.is_empty() {
                assistant_parts.push(LlmContentPart::text(response.text.clone()));
            }
            for call in &response.tool_calls {
                assistant_parts.push(LlmContentPart::ToolUse {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    input_json: call.input_json.clone(),
                });
            }
            history.push(LlmMessage {
                role: LlmRole::Assistant,
                parts: assistant_parts,
            });
            for receipt in &executed_tools {
                history.push(LlmMessage {
                    role: LlmRole::User,
                    parts: vec![LlmContentPart::ToolResult {
                        tool_use_id: receipt.tool_use_id.clone(),
                        content_parts: vec![LlmContentPart::text(receipt.output.clone())],
                        is_error: receipt.is_error,
                    }],
                });
            }
        }
    }
}

/// 生产步进器：基于既有 [`ApiProvider`] 的非流式一步调用。
///
/// 复用 `provider_adapter::build_provider_http_request` 装配双协议请求体、
/// `http_client` 共享连接池发送、按 provider_kind 解析响应（正文 + 工具
/// 调用 + finish_reason）。流式打字机路径由工单 02 的分而治之管线承担，
/// 本步进器服务于非流式子角色与工具循环场景。
pub struct HttpStepProvider<'a> {
    /// 供应商配置（端点、密钥、模型）。
    pub provider: &'a ApiProvider,
    /// 采样温度覆盖（None = 用 provider 配置）。
    pub temperature: Option<f64>,
    /// 最大输出 token 覆盖（None = 用 provider 配置）。
    pub max_output_tokens: Option<i64>,
}

#[async_trait]
impl AgentStepProvider for HttpStepProvider<'_> {
    async fn run_step(
        &self,
        system_blocks: &[String],
        history: &[LlmMessage],
        tools: &[LlmToolDefinition],
    ) -> Result<AgentStepResponse, String> {
        let provider = self.provider;
        let llm_request = LlmChatRequest {
            provider_kind: provider.provider_kind.clone(),
            model: provider.model_name.clone(),
            system: system_blocks.to_vec(),
            messages: history.to_vec(),
            temperature: self.temperature.or(provider.temperature),
            max_output_tokens: self.max_output_tokens.or(provider.max_tokens),
            top_p: None,
            top_k: None,
            presence_penalty: None,
            frequency_penalty: None,
            response_mode: None,
            stop_sequences: vec![],
            stream: false,
            tools: tools.to_vec(),
            tool_choice: if tools.is_empty() {
                None
            } else {
                Some(LlmToolChoice::Auto)
            },
            thinking: None,
            beta_features: vec![],
            structured_output_schema: None,
            structured_output_display: None,
        };

        let http_request =
            build_provider_http_request(&llm_request, &provider.base_url, &provider.api_key)?;
        let client = crate::services::http_client::shared_permissive_http_client();
        let mut builder = client.post(&http_request.url);
        for header in &http_request.headers {
            builder = builder.header(&header.name, &header.value);
        }

        let response = builder
            .json(&http_request.body)
            .send()
            .await
            .map_err(|err| format!("agent cycle step request failed: {err}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| format!("agent cycle step response read failed: {err}"))?;
        if !status.is_success() {
            return Err(format!(
                "agent cycle step call failed: {} {}",
                status,
                body.chars().take(500).collect::<String>()
            ));
        }

        let value: Value = serde_json::from_str(&body)
            .map_err(|err| format!("agent cycle step response is not valid JSON: {err}"))?;
        parse_step_response(&provider.provider_kind, &value)
    }
}

/// 解析一步的非流式响应（双协议）：正文 + 工具调用 + 结束原因。
///
/// OpenAI 兼容：`choices[0].message.content` + `message.tool_calls` +
/// `choices[0].finish_reason`；Anthropic：`content[]` 的 text/tool_use 块 +
/// `stop_reason`。响应结构缺失一律显式报错（C2），不以空结果顶替。
fn parse_step_response(provider_kind: &str, value: &Value) -> Result<AgentStepResponse, String> {
    match provider_kind {
        "anthropic" => {
            let content = value
                .get("content")
                .and_then(|content| content.as_array())
                .ok_or_else(|| "Anthropic response missing content array".to_string())?;
            let mut text = String::new();
            let mut tool_calls = Vec::new();
            for block in content {
                match block.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                            text.push_str(t);
                        }
                    }
                    Some("tool_use") => {
                        let id = block
                            .get("id")
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| "Anthropic tool_use block missing id".to_string())?
                            .to_string();
                        let name = block
                            .get("name")
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| "Anthropic tool_use block missing name".to_string())?
                            .to_string();
                        let input_json = block.get("input").cloned().unwrap_or(Value::Null);
                        tool_calls.push(AgentToolCall { id, name, input_json });
                    }
                    Some(other) => {
                        // 本运行器不消费的块类型（如 thinking /
                        // server_tool_use）：显式记录类型名后跳过，使「忽略」
                        // 成为有日志的行为，禁止 `_ =>` 无声吞没未知变体
                        // （C2 / Code Style；code-review 2026-11-11 修正）。
                        crate::dbg_eprintln!(
                            "[agent/cycle] skipping unconsumed Anthropic content block type: {other}"
                        );
                    }
                    None => {
                        crate::dbg_eprintln!(
                            "[agent/cycle] skipping Anthropic content block without a type field"
                        );
                    }
                }
            }
            let finish_reason = match value.get("stop_reason").and_then(|v| v.as_str()) {
                Some("tool_use") => AgentFinishReason::ToolCalls,
                Some("max_tokens") => AgentFinishReason::Length,
                Some("end_turn") | Some("stop_sequence") => AgentFinishReason::Stop,
                Some(other) => AgentFinishReason::Other(other.to_string()),
                None => {
                    if tool_calls.is_empty() {
                        AgentFinishReason::Stop
                    } else {
                        AgentFinishReason::ToolCalls
                    }
                }
            };
            Ok(AgentStepResponse { text, tool_calls, finish_reason })
        }
        _ => {
            let choice = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .ok_or_else(|| "OpenAI response missing choices[0]".to_string())?;
            let message = choice
                .get("message")
                .ok_or_else(|| "OpenAI response missing choices[0].message".to_string())?;
            let text = message
                .get("content")
                .and_then(|content| content.as_str())
                .unwrap_or_default()
                .to_string();
            let mut tool_calls = Vec::new();
            if let Some(calls) = message.get("tool_calls").and_then(|c| c.as_array()) {
                for call in calls {
                    let id = call
                        .get("id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "OpenAI tool_call missing id".to_string())?
                        .to_string();
                    let function = call
                        .get("function")
                        .ok_or_else(|| "OpenAI tool_call missing function".to_string())?;
                    let name = function
                        .get("name")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "OpenAI tool_call missing function.name".to_string())?
                        .to_string();
                    let arguments = function
                        .get("arguments")
                        .and_then(|v| v.as_str())
                        .unwrap_or("{}");
                    let input_json: Value = serde_json::from_str(arguments).map_err(|err| {
                        format!("OpenAI tool_call arguments are not valid JSON: {err}")
                    })?;
                    tool_calls.push(AgentToolCall { id, name, input_json });
                }
            }
            let finish_reason = match choice.get("finish_reason").and_then(|v| v.as_str()) {
                Some("tool_calls") | Some("function_call") => AgentFinishReason::ToolCalls,
                Some("length") => AgentFinishReason::Length,
                Some("stop") => AgentFinishReason::Stop,
                Some(other) => AgentFinishReason::Other(other.to_string()),
                None => {
                    if tool_calls.is_empty() {
                        AgentFinishReason::Stop
                    } else {
                        AgentFinishReason::ToolCalls
                    }
                }
            };
            Ok(AgentStepResponse { text, tool_calls, finish_reason })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// 按脚本逐个返回预设响应的 mock provider，并记录被调用次数——
    /// 「绝不发起第 2 次调用」的断言就落在 `call_count` 上。
    struct ScriptedProvider {
        responses: Mutex<VecDeque<AgentStepResponse>>,
        call_count: Mutex<usize>,
        last_history_len: Mutex<usize>,
    }

    impl ScriptedProvider {
        fn new(responses: Vec<AgentStepResponse>) -> Self {
            Self {
                responses: Mutex::new(responses.into()),
                call_count: Mutex::new(0),
                last_history_len: Mutex::new(0),
            }
        }

        fn call_count(&self) -> usize {
            *self.call_count.lock().unwrap_or_else(|p| p.into_inner())
        }

        fn last_history_len(&self) -> usize {
            *self.last_history_len.lock().unwrap_or_else(|p| p.into_inner())
        }
    }

    #[async_trait]
    impl AgentStepProvider for ScriptedProvider {
        async fn run_step(
            &self,
            _system_blocks: &[String],
            history: &[LlmMessage],
            _tools: &[LlmToolDefinition],
        ) -> Result<AgentStepResponse, String> {
            let mut count = self.call_count.lock().unwrap_or_else(|p| p.into_inner());
            *count += 1;
            let mut len = self.last_history_len.lock().unwrap_or_else(|p| p.into_inner());
            *len = history.len();
            self.responses
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .pop_front()
                .ok_or_else(|| "scripted provider exhausted".to_string())
        }
    }

    /// 记录每次执行的工具名，并按名返回脚本化结果的 mock 执行器。
    struct RecordingExecutor {
        executed: Mutex<Vec<String>>,
        fail_tools: Vec<String>,
    }

    impl RecordingExecutor {
        fn new() -> Self {
            Self { executed: Mutex::new(Vec::new()), fail_tools: Vec::new() }
        }

        fn failing(tool: &str) -> Self {
            Self { executed: Mutex::new(Vec::new()), fail_tools: vec![tool.to_string()] }
        }

        fn executed_names(&self) -> Vec<String> {
            self.executed.lock().unwrap_or_else(|p| p.into_inner()).clone()
        }
    }

    #[async_trait]
    impl AgentToolExecutor for RecordingExecutor {
        async fn execute(&self, name: &str, _arguments_json: &str) -> Result<String, String> {
            self.executed
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .push(name.to_string());
            if self.fail_tools.iter().any(|t| t == name) {
                Err(format!("tool {name} rejected by gate"))
            } else {
                Ok(format!("receipt for {name}"))
            }
        }
    }

    fn text_response(text: &str) -> AgentStepResponse {
        AgentStepResponse {
            text: text.to_string(),
            tool_calls: vec![],
            finish_reason: AgentFinishReason::Stop,
        }
    }

    fn tool_response(text: &str, calls: Vec<(&str, &str)>) -> AgentStepResponse {
        AgentStepResponse {
            text: text.to_string(),
            tool_calls: calls
                .into_iter()
                .map(|(id, name)| AgentToolCall {
                    id: id.to_string(),
                    name: name.to_string(),
                    input_json: serde_json::json!({ "amount": 30 }),
                })
                .collect(),
            finish_reason: AgentFinishReason::ToolCalls,
        }
    }

    fn config(max_steps: usize, short_circuit: bool) -> AgentCycleConfig {
        AgentCycleConfig {
            max_steps,
            short_circuit_on_first_step: short_circuit,
            system_blocks: vec!["test system block".to_string()],
            user_prompt: "玩家：买一把铁剑".to_string(),
            allowed_tools: vec![],
        }
    }

    /// 工单 01 核心断言：max_steps=1 + 工具调用 → 执行后短路，
    /// provider 恰好被调用 1 次（脚本里故意备了第 2 个响应，若循环
    /// 误发第 2 次调用，call_count 与结果都会暴露）。
    #[tokio::test]
    async fn single_step_tool_call_short_circuits_without_second_api_call() {
        let provider = ScriptedProvider::new(vec![
            tool_response("成交！铁剑归你了。", vec![("call_1", "buy_item")]),
            text_response("这段文本永远不该被请求到"),
        ]);
        let executor = RecordingExecutor::new();

        let outcome = AgentCycleRuntime::run_cycle(&config(1, true), &provider, &executor)
            .await
            .expect("single-pass cycle must succeed");

        match outcome {
            AgentCycleOutcome::ShortCircuitedWithTools { text, executed_tools } => {
                assert_eq!(text, "成交！铁剑归你了。");
                assert_eq!(executed_tools.len(), 1);
                assert_eq!(executed_tools[0].name, "buy_item");
                assert_eq!(executed_tools[0].tool_use_id, "call_1");
                assert_eq!(executed_tools[0].output, "receipt for buy_item");
                assert!(!executed_tools[0].is_error);
            }
            other => panic!("expected ShortCircuitedWithTools, got {other:?}"),
        }
        assert_eq!(provider.call_count(), 1, "single-pass must never issue a 2nd API call");
        assert_eq!(executor.executed_names(), vec!["buy_item".to_string()]);
    }

    /// max_steps=1 的纯文本响应：第 1 步直接定稿。
    #[tokio::test]
    async fn single_step_plain_text_delivers_in_one_call() {
        let provider = ScriptedProvider::new(vec![text_response("旅店老板向你点头。")]);
        let executor = RecordingExecutor::new();

        let outcome = AgentCycleRuntime::run_cycle(&config(1, true), &provider, &executor)
            .await
            .expect("single-pass text cycle must succeed");

        assert_eq!(
            outcome,
            AgentCycleOutcome::TextDelivered {
                text: "旅店老板向你点头。".to_string(),
                steps_taken: 1,
            }
        );
        assert_eq!(provider.call_count(), 1);
        assert!(executor.executed_names().is_empty());
    }

    /// spec 接缝 1：max_steps=3，前两步工具调用、第三步文本定稿；
    /// 且第二步时历史里必须已回注 ToolResult（历史长度增长）。
    #[tokio::test]
    async fn multi_step_loops_on_tool_calls_then_delivers_text() {
        let provider = ScriptedProvider::new(vec![
            tool_response("", vec![("c1", "inspect_inventory")]),
            tool_response("", vec![("c2", "inspect_shop")]),
            text_response("你背包里有 30 金币，正好够买铁剑。"),
        ]);
        let executor = RecordingExecutor::new();

        let outcome = AgentCycleRuntime::run_cycle(&config(3, false), &provider, &executor)
            .await
            .expect("multi-pass cycle must succeed");

        assert_eq!(
            outcome,
            AgentCycleOutcome::TextDelivered {
                text: "你背包里有 30 金币，正好够买铁剑。".to_string(),
                steps_taken: 3,
            }
        );
        assert_eq!(provider.call_count(), 3);
        assert_eq!(
            executor.executed_names(),
            vec!["inspect_inventory".to_string(), "inspect_shop".to_string()]
        );
        // 第 3 步调用时历史 = 初始 user + (assistant ToolUse + user ToolResult) x2 = 5 条。
        assert_eq!(provider.last_history_len(), 5);
    }

    /// 步长熔断：max_steps=2 且模型持续发工具调用 → 第 2 步后熔断，
    /// 不再发起第 3 次调用（脚本备有第 3 个响应作探针）。
    #[tokio::test]
    async fn exceeding_step_budget_trips_circuit_breaker() {
        let provider = ScriptedProvider::new(vec![
            tool_response("", vec![("c1", "probe")]),
            tool_response("", vec![("c2", "probe")]),
            tool_response("", vec![("c3", "probe")]),
        ]);
        let executor = RecordingExecutor::new();

        let outcome = AgentCycleRuntime::run_cycle(&config(2, false), &provider, &executor)
            .await
            .expect("circuit breaker is an outcome, not an Err");

        match outcome {
            AgentCycleOutcome::CircuitBreakerTripped { steps_taken, reason } => {
                assert_eq!(steps_taken, 2);
                assert!(reason.contains("max_steps = 2"), "reason must carry diagnostics: {reason}");
            }
            other => panic!("expected CircuitBreakerTripped, got {other:?}"),
        }
        assert_eq!(provider.call_count(), 2, "breaker must stop further API calls");
    }

    /// max_steps=1 但未开启短路：工具执行后无预算续跑 → 熔断而非续跑/假完成。
    #[tokio::test]
    async fn single_step_without_short_circuit_trips_breaker_after_tools() {
        let provider = ScriptedProvider::new(vec![
            tool_response("……", vec![("c1", "buy_item")]),
            text_response("不该被请求"),
        ]);
        let executor = RecordingExecutor::new();

        let outcome = AgentCycleRuntime::run_cycle(&config(1, false), &provider, &executor)
            .await
            .expect("breaker outcome expected");

        assert!(matches!(
            outcome,
            AgentCycleOutcome::CircuitBreakerTripped { steps_taken: 1, .. }
        ));
        assert_eq!(provider.call_count(), 1);
    }

    /// 工具失败不吞异常也不中断短路：失败以 is_error 回执进入结果。
    #[tokio::test]
    async fn tool_failure_becomes_error_receipt_not_silent_drop() {
        let provider = ScriptedProvider::new(vec![tool_response(
            "我来帮你买。",
            vec![("c1", "buy_item"), ("c2", "open_shop")],
        )]);
        let executor = RecordingExecutor::failing("buy_item");

        let outcome = AgentCycleRuntime::run_cycle(&config(1, true), &provider, &executor)
            .await
            .expect("tool failure must surface as receipt, not Err");

        match outcome {
            AgentCycleOutcome::ShortCircuitedWithTools { executed_tools, .. } => {
                assert_eq!(executed_tools.len(), 2);
                assert!(executed_tools[0].is_error);
                assert!(executed_tools[0].output.contains("rejected by gate"));
                assert!(!executed_tools[1].is_error);
            }
            other => panic!("expected ShortCircuitedWithTools, got {other:?}"),
        }
        assert_eq!(provider.call_count(), 1);
    }

    /// 无效配置当场硬错（C2）：max_steps=0 不允许被静默修正为 1。
    #[tokio::test]
    async fn zero_max_steps_is_rejected() {
        let provider = ScriptedProvider::new(vec![text_response("x")]);
        let executor = RecordingExecutor::new();

        let err = AgentCycleRuntime::run_cycle(&config(0, true), &provider, &executor)
            .await
            .expect_err("max_steps=0 must be an error");
        assert!(err.contains("max_steps"));
        assert_eq!(provider.call_count(), 0);
    }

    #[test]
    fn parse_openai_tool_calls_response() {
        let value = serde_json::json!({
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "content": "成交！",
                    "tool_calls": [{
                        "id": "call_9",
                        "function": { "name": "buy_item", "arguments": "{\"amount\":30}" }
                    }]
                }
            }]
        });
        let parsed = parse_step_response("openai_compatible", &value)
            .expect("openai step response must parse");
        assert_eq!(parsed.text, "成交！");
        assert_eq!(parsed.finish_reason, AgentFinishReason::ToolCalls);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].id, "call_9");
        assert_eq!(parsed.tool_calls[0].name, "buy_item");
        assert_eq!(parsed.tool_calls[0].input_json, serde_json::json!({ "amount": 30 }));
    }

    #[test]
    fn parse_anthropic_tool_use_response() {
        let value = serde_json::json!({
            "stop_reason": "tool_use",
            "content": [
                { "type": "text", "text": "我看看你的背包。" },
                { "type": "tool_use", "id": "toolu_1", "name": "inspect_inventory", "input": { "slot": 3 } }
            ]
        });
        let parsed = parse_step_response("anthropic", &value)
            .expect("anthropic step response must parse");
        assert_eq!(parsed.text, "我看看你的背包。");
        assert_eq!(parsed.finish_reason, AgentFinishReason::ToolCalls);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].input_json, serde_json::json!({ "slot": 3 }));
    }

    #[test]
    fn parse_anthropic_response_skips_unknown_block_types() {
        // C2 回归（code-review 2026-11-11）：本运行器不消费的块类型
        // （thinking 等）被显式记录后跳过——正文与工具调用照常解析，
        // 未知块既不污染结果，也不被无声吞没成错误数据。
        let value = serde_json::json!({
            "stop_reason": "tool_use",
            "content": [
                { "type": "thinking", "thinking": "内部推理", "signature": "sig" },
                { "type": "text", "text": "可见正文" },
                { "type": "tool_use", "id": "toolu_9", "name": "buy_item", "input": { "amount": 30 } },
                { "type": "redacted_thinking", "data": "opaque" }
            ]
        });
        let parsed = parse_step_response("anthropic", &value)
            .expect("unknown block types must be skipped, not fatal");
        assert_eq!(parsed.text, "可见正文");
        assert_eq!(parsed.finish_reason, AgentFinishReason::ToolCalls);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "buy_item");
    }

    #[test]
    fn parse_malformed_response_is_explicit_error() {
        let value = serde_json::json!({ "unexpected": true });
        assert!(parse_step_response("openai_compatible", &value).is_err());
        assert!(parse_step_response("anthropic", &value).is_err());
    }
}

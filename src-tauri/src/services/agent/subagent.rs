//! 子智能体的**非流式**整段补全。
//!
//! 导演-演员与剧本流水线里的每个子角色（导演 / 演员 / 初稿 / 批注 / 润色）都需要
//! "一次调用拿一整段文本"，而不是往气泡流里推增量——它们产出的是**中间稿**，
//! 最终由装配阶段一次性定稿。
//!
//! 复用既有基础设施：`provider_adapter` 装配请求体、`http_client` 的共享连接池，
//! **不新起第二套 HTTP 栈**（C9）。

use serde_json::Value;
use std::future::Future;

use crate::llm::{
    LlmChatRequest, LlmContentPart, LlmMessage, LlmRole, LlmToolDefinition, LlmToolChoice,
};
use crate::models::ApiProvider;
use crate::services::provider_adapter::{build_provider_http_request, ProviderCapabilityMatrix};

/// 子智能体调用入参。
pub struct SubAgentRequest<'a> {
    pub label: &'a str,
    pub system: Vec<String>,
    pub user: String,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<i64>,
}

/// 子智能体调用结果：整段文本 + 用量。
#[derive(Debug, Clone)]
pub struct SubAgentResponse {
    pub label: String,
    pub text: String,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
}

/// 子代理工具循环的运行时（计划 §6.1：演员的 tools 引用 → 真实闭环）。
///
/// `tools` = 编译期校验过的 function-calling 清单；`execute` = 执行回调
/// （走 execute_tool_call_with_plan 同一条链：白名单→契约→门禁→容器）。
pub struct SubAgentToolRuntime<'a> {
    pub tools: Vec<LlmToolDefinition>,
    pub max_rounds: usize,
    pub execute: &'a (dyn Fn(String, String) -> std::pin::Pin<Box<dyn Future<Output = Result<String, String>> + Send>> + Send + Sync),
}

/// 执行一次子智能体补全（无工具循环）。
///
/// 失败一律返回 `Err`：子角色失败时上层要么显式降级（记录原因），要么整体失败，
/// **不允许**用空串顶替——否则"导演没说话"和"导演说了空话"无法区分。
pub async fn run_subagent(
    provider: &ApiProvider,
    request: SubAgentRequest<'_>,
) -> Result<SubAgentResponse, String> {
    run_subagent_inner(provider, request, None).await
}

/// 执行子智能体补全，带工具循环（计划 §6.1：演员 tools 闭环）。
///
/// 循环语义：模型响应含 tool_calls → 逐个执行回调 → 结果以 ToolResult 回注 →
/// 续调模型，直到模型给出纯文本（或达 `runtime.max_rounds` 上限——达限时**报错**
/// 而非截断返回，C2）。消息历史用 LlmContentPart::ToolUse / ToolResult 表达，
/// 双协议装配复用 provider_adapter 既有转换。
pub async fn run_subagent_with_tools(
    provider: &ApiProvider,
    request: SubAgentRequest<'_>,
    runtime: &SubAgentToolRuntime<'_>,
) -> Result<SubAgentResponse, String> {
    run_subagent_inner(provider, request, Some(runtime)).await
}

async fn run_subagent_inner(
    provider: &ApiProvider,
    request: SubAgentRequest<'_>,
    tool_runtime: Option<&SubAgentToolRuntime<'_>>,
) -> Result<SubAgentResponse, String> {
    if request.user.trim().is_empty() {
        return Err(format!("子智能体 `{}` 的用户输入为空", request.label));
    }

    let capabilities = ProviderCapabilityMatrix::for_provider_kind(&provider.provider_kind)?;
    if !capabilities.supports_system_message && !request.system.is_empty() {
        return Err(format!(
            "provider `{}` 不支持 system message，但子智能体 `{}` 需要系统指令",
            provider.provider_kind, request.label
        ));
    }

    // 工具循环的多轮消息历史（system 走 LlmChatRequest 独立字段，此处只放轮转消息）。
    let mut history: Vec<LlmMessage> = vec![LlmMessage {
        role: LlmRole::User,
        parts: vec![LlmContentPart::text(request.user.clone())],
    }];

    let mut prompt_tokens: Option<i64> = None;
    let mut completion_tokens: Option<i64> = None;
    let mut text = String::new();
    let mut round = 0usize;

    loop {
        let llm_request = LlmChatRequest {
            provider_kind: provider.provider_kind.clone(),
            model: provider.model_name.clone(),
            system: request.system.clone(),
            messages: history.clone(),
            temperature: request.temperature.or(provider.temperature),
            max_output_tokens: request.max_output_tokens.or(provider.max_tokens),
            top_p: None,
            top_k: None,
            presence_penalty: None,
            frequency_penalty: None,
            response_mode: None,
            stop_sequences: vec![],
            // 非流式：一次拿完整段落。
            stream: false,
            tools: tool_runtime.map(|rt| rt.tools.clone()).unwrap_or_default(),
            tool_choice: if tool_runtime.is_some() {
                Some(LlmToolChoice::Auto)
            } else {
                None
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
            .map_err(|err| format!("子智能体 `{}` 请求失败: {}", request.label, err))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| format!("子智能体 `{}` 读取响应失败: {}", request.label, err))?;

        if !status.is_success() {
            return Err(format!(
                "子智能体 `{}` 调用失败: {} {}",
                request.label,
                status,
                body.chars().take(500).collect::<String>()
            ));
        }

        let value: Value = serde_json::from_str(&body)
            .map_err(|err| format!("子智能体 `{}` 响应不是合法 JSON: {}", request.label, err))?;

        let (round_text, tool_uses, pt, ct) = parse_subagent_response(provider, &value)?;
        prompt_tokens = pt.or(prompt_tokens);
        completion_tokens = ct.or(completion_tokens);

        if tool_uses.is_empty() {
            text = round_text;
            break;
        }

        // 有工具调用：assistant 消息（含 ToolUse）入历史，逐个执行后回注结果。
        round += 1;
        if let Some(rt) = tool_runtime {
            if round > rt.max_rounds {
                return Err(format!(
                    "子智能体 `{}` 工具循环超过 {} 轮上限仍未产出正文（C2：报错而非截断）",
                    request.label, rt.max_rounds
                ));
            }
        } else {
            // 无运行时却返回 tool_calls = 清单装配与解析不一致，显式报错。
            return Err(format!(
                "子智能体 `{}` 返回了工具调用但本请求未启用工具",
                request.label
            ));
        }

        let mut parts: Vec<LlmContentPart> = Vec::new();
        for (id, name, input_json) in &tool_uses {
            parts.push(LlmContentPart::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input_json: input_json.clone(),
            });
        }
        history.push(LlmMessage {
            role: LlmRole::Assistant,
            parts,
        });

        if let Some(rt) = tool_runtime {
            for (id, name, input_json) in &tool_uses {
                let arguments_json = if input_json.is_string() {
                    input_json.as_str().unwrap_or("{}").to_string()
                } else {
                    serde_json::to_string(&input_json).unwrap_or_else(|_| "{}".to_string())
                };
                let result = (rt.execute)(name.clone(), arguments_json).await;
                let (content, is_error) = match result {
                    Ok(text) => (text, false),
                    Err(err) => (err, true),
                };
                history.push(LlmMessage {
                    role: LlmRole::User,
                    parts: vec![LlmContentPart::ToolResult {
                        tool_use_id: id.clone(),
                        content_parts: vec![LlmContentPart::Text { text: content }],
                        is_error,
                    }],
                });
            }
        }
    }

    if text.trim().is_empty() {
        return Err(format!(
            "子智能体 `{}` 返回了空内容（provider={}）",
            request.label, provider.provider_kind
        ));
    }

    Ok(SubAgentResponse {
        label: request.label.to_string(),
        text,
        prompt_tokens,
        completion_tokens,
    })
}

/// 解析非流式响应：正文 + 工具调用 + 用量。
///
/// OpenAI：`choices[0].message.content` + `message.tool_calls[{id,function:{name,arguments}}]`；
/// Anthropic：`content[]` 里的 text 块 + `tool_use` 块（input 为对象）。
fn parse_subagent_response(
    provider: &ApiProvider,
    value: &Value,
) -> Result<(String, Vec<(String, String, Value)>, Option<i64>, Option<i64>), String> {
    let _ = provider;
    match provider.provider_kind.as_str() {
        "anthropic" => {
            let content = value
                .get("content")
                .and_then(|content| content.as_array())
                .ok_or_else(|| "Anthropic 响应缺少 content 数组".to_string())?;
            let mut text = String::new();
            let mut tool_uses = Vec::new();
            for block in content {
                match block.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        text.push_str(block.get("text").and_then(|t| t.as_str()).unwrap_or_default());
                    }
                    Some("tool_use") => {
                        let id = block.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                        let name = block.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                        let input = block.get("input").cloned().unwrap_or(Value::Null);
                        tool_uses.push((id, name, input));
                    }
                    _ => {}
                }
            }
            let usage = value.get("usage");
            Ok((
                text,
                tool_uses,
                usage.and_then(|u| u.get("input_tokens")).and_then(|v| v.as_i64()),
                usage.and_then(|u| u.get("output_tokens")).and_then(|v| v.as_i64()),
            ))
        }
        _ => {
            let message = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("message"))
                .cloned()
                .ok_or_else(|| "OpenAI 响应缺少 choices[0].message".to_string())?;
            let text = message
                .get("content")
                .and_then(|content| content.as_str())
                .unwrap_or_default()
                .to_string();
            let mut tool_uses = Vec::new();
            if let Some(calls) = message.get("tool_calls").and_then(|c| c.as_array()) {
                for call in calls {
                    let id = call.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    let function = call.get("function");
                    let name = function
                        .and_then(|f| f.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let arguments = function
                        .and_then(|f| f.get("arguments"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("{}");
                    let input: Value = serde_json::from_str(arguments)
                        .unwrap_or(Value::Null);
                    tool_uses.push((id, name, input));
                }
            }
            let usage = value.get("usage");
            Ok((
                text,
                tool_uses,
                usage.and_then(|u| u.get("prompt_tokens")).and_then(|v| v.as_i64()),
                usage.and_then(|u| u.get("completion_tokens")).and_then(|v| v.as_i64()),
            ))
        }
    }
}

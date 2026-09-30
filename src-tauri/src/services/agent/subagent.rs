//! 子智能体的**非流式**整段补全。
//!
//! 导演-演员与剧本流水线里的每个子角色（导演 / 演员 / 初稿 / 批注 / 润色）都需要
//! "一次调用拿一整段文本"，而不是往气泡流里推增量——它们产出的是**中间稿**，
//! 最终由装配阶段一次性定稿。
//!
//! 复用既有基础设施：`provider_adapter` 装配请求体、`http_client` 的共享连接池，
//! **不新起第二套 HTTP 栈**（C9）。

use serde_json::Value;

use crate::llm::{LlmChatRequest, LlmContentPart, LlmMessage, LlmRole};
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

/// 执行一次子智能体补全。
///
/// 失败一律返回 `Err`：子角色失败时上层要么显式降级（记录原因），要么整体失败，
/// **不允许**用空串顶替——否则"导演没说话"和"导演说了空话"无法区分。
pub async fn run_subagent(
    provider: &ApiProvider,
    request: SubAgentRequest<'_>,
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

    let llm_request = LlmChatRequest {
        provider_kind: provider.provider_kind.clone(),
        model: provider.model_name.clone(),
        system: request.system.clone(),
        messages: vec![LlmMessage {
            role: LlmRole::User,
            parts: vec![LlmContentPart::text(request.user.clone())],
        }],
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
        tools: vec![],
        tool_choice: None,
        thinking: None,
        beta_features: vec![],
        structured_output_schema: None,
        structured_output_display: None,
    };

    let http_request = build_provider_http_request(&llm_request, &provider.base_url, &provider.api_key)?;
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

    let (text, prompt_tokens, completion_tokens) = match provider.provider_kind.as_str() {
        "anthropic" => {
            let text = value
                .get("content")
                .and_then(|content| content.as_array())
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter_map(|block| {
                            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                block.get("text").and_then(|t| t.as_str())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("")
                })
                .unwrap_or_default();
            let usage = value.get("usage");
            (
                text,
                usage.and_then(|u| u.get("input_tokens")).and_then(|v| v.as_i64()),
                usage.and_then(|u| u.get("output_tokens")).and_then(|v| v.as_i64()),
            )
        }
        _ => {
            let text = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("message"))
                .and_then(|message| message.get("content"))
                .and_then(|content| content.as_str())
                .unwrap_or_default()
                .to_string();
            let usage = value.get("usage");
            (
                text,
                usage.and_then(|u| u.get("prompt_tokens")).and_then(|v| v.as_i64()),
                usage.and_then(|u| u.get("completion_tokens")).and_then(|v| v.as_i64()),
            )
        }
    };

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

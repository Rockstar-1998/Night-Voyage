use serde_json::{json, Value};

use crate::{
    llm::{
        ChatMessage, LlmBinarySource, LlmChatRequest, LlmContentPart, LlmMessage, LlmRole,
        LlmThinkingConfig, LlmToolChoice, ProviderHttpHeader, ProviderHttpRequest,
        ANTHROPIC_API_VERSION,
    },
    services::prompt_compiler::{PromptCompileResult, PromptRole},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderCapabilityMatrix {
    pub provider_kind: String,
    pub supports_system_message: bool,
    pub supports_stop_sequences: bool,
    pub supports_temperature: bool,
    pub supports_top_p: bool,
    pub supports_top_k: bool,
    pub supports_presence_penalty: bool,
    pub supports_frequency_penalty: bool,
    pub supports_tools: bool,
    pub supports_thinking: bool,
    pub supports_image_input: bool,
    pub supports_thinking_config: bool,
    pub supports_structured_json_output: bool,
}

impl ProviderCapabilityMatrix {
    pub fn for_provider_kind(provider_kind: &str) -> Result<Self, String> {
        match provider_kind {
            "openai_compatible" => Ok(Self {
                provider_kind: provider_kind.to_string(),
                supports_system_message: true,
                supports_stop_sequences: true,
                supports_temperature: true,
                supports_top_p: true,
                supports_top_k: true,
                supports_presence_penalty: true,
                supports_frequency_penalty: true,
                supports_tools: false,
                supports_thinking: false,
                supports_image_input: false,
                supports_thinking_config: false,
                supports_structured_json_output: true,
            }),
            "anthropic" => Ok(Self {
                provider_kind: provider_kind.to_string(),
                supports_system_message: true,
                supports_stop_sequences: true,
                supports_temperature: true,
                supports_top_p: true,
                supports_top_k: false,
                supports_presence_penalty: false,
                supports_frequency_penalty: false,
                supports_tools: true,
                supports_thinking: true,
                supports_image_input: true,
                supports_thinking_config: true,
                supports_structured_json_output: true,
            }),
            "test_no_structured_json" => Ok(Self {
                provider_kind: provider_kind.to_string(),
                supports_system_message: true,
                supports_stop_sequences: true,
                supports_temperature: true,
                supports_top_p: true,
                supports_top_k: false,
                supports_presence_penalty: false,
                supports_frequency_penalty: false,
                supports_tools: false,
                supports_thinking: false,
                supports_image_input: false,
                supports_thinking_config: false,
                supports_structured_json_output: false,
            }),
            other => Err(format!(
                "Prompt Compiler V1 暂不支持 provider_kind='{}' 的请求适配",
                other
            )),
        }
    }

    pub fn describe_checks(&self) -> Vec<String> {
        vec![
            format!("provider_kind={}", self.provider_kind),
            format!("supports_system_message={}", self.supports_system_message),
            format!("supports_stop_sequences={}", self.supports_stop_sequences),
            format!("supports_temperature={}", self.supports_temperature),
            format!("supports_top_p={}", self.supports_top_p),
            format!("supports_top_k={}", self.supports_top_k),
            format!(
                "supports_presence_penalty={}",
                self.supports_presence_penalty
            ),
            format!(
                "supports_frequency_penalty={}",
                self.supports_frequency_penalty
            ),
            format!("supports_tools={}", self.supports_tools),
            format!("supports_thinking={}", self.supports_thinking),
            format!("supports_image_input={}", self.supports_image_input),
            format!("supports_thinking_config={}", self.supports_thinking_config),
            format!(
                "supports_structured_json_output={}",
                self.supports_structured_json_output
            ),
        ]
    }
}

pub fn build_llm_chat_request(
    result: &mut PromptCompileResult,
    provider_kind: &str,
    model: &str,
    stream: bool,
    fallback_temperature: Option<f64>,
    fallback_max_output_tokens: Option<i64>,
) -> Result<LlmChatRequest, String> {
    let capabilities = ProviderCapabilityMatrix::for_provider_kind(provider_kind)?;
    result
        .debug
        .capability_checks
        .extend(capabilities.describe_checks());

    validate_prompt_for_provider(result, &capabilities)?;

    let resolved_max_output_tokens = result
        .params
        .max_output_tokens
        .or(fallback_max_output_tokens)
        .or_else(|| {
            if provider_kind == "anthropic" {
                Some(4096)
            } else {
                None
            }
        });

    let thinking = resolve_thinking_config(
        provider_kind,
        model,
        result.params.thinking_enabled,
        result.params.thinking_budget_tokens,
        resolved_max_output_tokens,
    );
    result
        .debug
        .capability_checks
        .push(format!("thinking_enabled={}", thinking.is_some()));

    let mut system = merge_system_blocks(&result.system_blocks);
    let mut messages = Vec::new();
    messages.extend(result.history_blocks.iter().map(block_to_llm_message));
    messages.push(block_to_llm_message(&result.current_user_block));

    let request = LlmChatRequest {
        provider_kind: provider_kind.to_string(),
        model: model.to_string(),
        system,
        messages,
        temperature: result.params.temperature.or(fallback_temperature),
        max_output_tokens: resolved_max_output_tokens,
        top_p: result.params.top_p,
        top_k: if capabilities.supports_top_k {
            result.params.top_k
        } else {
            None
        },
        presence_penalty: if capabilities.supports_presence_penalty {
            result.params.presence_penalty
        } else {
            None
        },
        frequency_penalty: if capabilities.supports_frequency_penalty {
            result.params.frequency_penalty
        } else {
            None
        },
        response_mode: result.params.response_mode.clone(),
        stop_sequences: if capabilities.supports_stop_sequences {
            result.params.stop_sequences.clone()
        } else {
            vec![]
        },
        stream,
        tools: vec![],
        tool_choice: None,
        thinking,
        beta_features: result.params.beta_features.clone(),
        structured_output_schema: result.params.structured_output_schema.clone(),
        structured_output_display: result.params.structured_output_display.clone(),
    };

    if result.params.response_mode.as_deref() == Some("structured_json")
        && !capabilities.supports_structured_json_output
    {
        return Err("当前 provider 不支持结构化 JSON 输出 (structured_json)".to_string());
    }

    Ok(request)
}

pub fn build_provider_http_request(
    request: &LlmChatRequest,
    base_url: &str,
    api_key: &str,
) -> Result<ProviderHttpRequest, String> {
    match request.provider_kind.as_str() {
        "openai_compatible" => build_openai_http_request(request, base_url, api_key),
        "anthropic" => build_anthropic_http_request(request, base_url, api_key),
        other => Err(format!("不支持 provider_kind='{}' 的 HTTP 请求构造", other)),
    }
}

pub fn adapt_prompt_compile_result_to_openai_messages(
    result: &mut PromptCompileResult,
    provider_kind: &str,
) -> Result<Vec<ChatMessage>, String> {
    let request = build_llm_chat_request(result, provider_kind, "", false, None, None)?;
    flatten_request_to_legacy_chat_messages(&request)
}

fn validate_prompt_for_provider(
    result: &mut PromptCompileResult,
    capabilities: &ProviderCapabilityMatrix,
) -> Result<(), String> {
    if !capabilities.supports_system_message && !result.system_blocks.is_empty() {
        return Err("当前 provider 不支持 system message".to_string());
    }

    if !capabilities.supports_stop_sequences && !result.params.stop_sequences.is_empty() {
        return Err("当前 provider 不支持 stop sequences".to_string());
    }

    Ok(())
}

fn resolve_thinking_config(
    provider_kind: &str,
    model: &str,
    thinking_enabled: Option<bool>,
    thinking_budget_tokens: Option<i64>,
    max_output_tokens: Option<i64>,
) -> Option<LlmThinkingConfig> {
    if provider_kind != "anthropic" {
        return None;
    }

    match thinking_enabled {
        Some(true) => {
            let budget = thinking_budget_tokens
                .or_else(|| max_output_tokens.map(|t| t.clamp(128, 4096)))
                .unwrap_or(1024)
                .clamp(128, 128000);
            Some(LlmThinkingConfig {
                enabled: true,
                budget_tokens: Some(budget),
            })
        }
        Some(false) => None,
        None => {
            let normalized_model = model.trim().to_ascii_lowercase();
            if normalized_model.is_empty() || !normalized_model.contains("thinking") {
                return None;
            }
            Some(LlmThinkingConfig {
                enabled: true,
                budget_tokens: Some(max_output_tokens.unwrap_or(1024).clamp(128, 4096)),
            })
        }
    }
}

fn merge_system_blocks(blocks: &[crate::services::prompt_compiler::PromptBlock]) -> Vec<String> {
    use crate::services::prompt_compiler::PromptBlockKind;
    let mut groups: Vec<(PromptBlockKind, Vec<String>)> = Vec::new();
    for block in blocks {
        let content = block.content.trim().to_string();
        if content.is_empty() {
            continue;
        }
        if let Some(group) = groups.iter_mut().find(|(kind, _)| *kind == block.kind) {
            group.1.push(content);
        } else {
            groups.push((block.kind.clone(), vec![content]));
        }
    }
    groups
        .into_iter()
        .map(|(_, contents)| contents.join("\n\n"))
        .collect()
}

fn block_to_llm_message(block: &crate::services::prompt_compiler::PromptBlock) -> LlmMessage {
    LlmMessage::text(prompt_role_to_llm_role(&block.role), block.content.clone())
}

fn prompt_role_to_llm_role(role: &PromptRole) -> LlmRole {
    match role {
        PromptRole::System => LlmRole::System,
        PromptRole::User => LlmRole::User,
        PromptRole::Assistant => LlmRole::Assistant,
    }
}

fn flatten_request_to_legacy_chat_messages(
    request: &LlmChatRequest,
) -> Result<Vec<ChatMessage>, String> {
    let mut messages = Vec::new();

    // OpenAI-compatible endpoints here only accept one leading system message.
    let system_text = request
        .system
        .iter()
        .map(|system_text| system_text.trim())
        .filter(|system_text| !system_text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if !system_text.is_empty() {
        messages.push(ChatMessage::new("system", system_text));
    }

    for message in &request.messages {
        if message.role == LlmRole::System {
            continue;
        }
        messages.push(ChatMessage::new(
            message.role.as_str(),
            extract_text_only_content(message)?,
        ));
    }

    Ok(messages)
}

fn extract_text_only_content(message: &LlmMessage) -> Result<String, String> {
    let mut text_segments = Vec::new();
    for part in &message.parts {
        match part {
            LlmContentPart::Text { text } => text_segments.push(text.as_str()),
            other => {
                return Err(format!(
                    "当前路径只支持纯文本消息，遇到不支持的 content part: {}",
                    describe_content_part(other)
                ))
            }
        }
    }

    Ok(text_segments.join(""))
}

fn describe_content_part(part: &LlmContentPart) -> &'static str {
    match part {
        LlmContentPart::Text { .. } => "text",
        LlmContentPart::Image { .. } => "image",
        LlmContentPart::ToolUse { .. } => "tool_use",
        LlmContentPart::ToolResult { .. } => "tool_result",
        LlmContentPart::Thinking { .. } => "thinking",
        LlmContentPart::RedactedThinking { .. } => "redacted_thinking",
    }
}

fn build_openai_http_request(
    request: &LlmChatRequest,
    base_url: &str,
    api_key: &str,
) -> Result<ProviderHttpRequest, String> {
    if !request.tools.is_empty() || request.tool_choice.is_some() {
        return Err("当前 OpenAI 兼容路径尚未接入 tools 请求体编译".to_string());
    }

    if let Some(thinking) = &request.thinking {
        if thinking.enabled {
            return Err("当前 OpenAI 兼容路径不支持 thinking".to_string());
        }
    }

    let messages = flatten_request_to_legacy_chat_messages(request)?
        .into_iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content,
            })
        })
        .collect::<Vec<_>>();

    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), json!(request.model));
    body.insert("messages".to_string(), Value::Array(messages));
    body.insert("stream".to_string(), json!(request.stream));

    if let Some(temperature) = request.temperature {
        body.insert("temperature".to_string(), json!(temperature));
    }
    if let Some(top_p) = request.top_p {
        body.insert("top_p".to_string(), json!(top_p));
    }
    if let Some(presence_penalty) = request.presence_penalty {
        body.insert("presence_penalty".to_string(), json!(presence_penalty));
    }
    if let Some(frequency_penalty) = request.frequency_penalty {
        body.insert("frequency_penalty".to_string(), json!(frequency_penalty));
    }
    if let Some(max_tokens) = request.max_output_tokens {
        body.insert("max_tokens".to_string(), json!(max_tokens));
    }
    match request.response_mode.as_deref() {
        None | Some("pseudo_xml") => {}
        Some("structured_json") => {
            match request.structured_output_schema.as_deref() {
                Some(schema_json) if !schema_json.trim().is_empty() => {
                    let response_format = crate::llm::build_openai_structured_json_response_format(schema_json)?;
                    body.insert("response_format".to_string(), response_format);
                }
                _ => {
                    return Err("structured_json 模式必须提供 JSON Schema（structured_output_schema 不能为空）".to_string());
                }
            }
        }
        Some(other) => return Err(format!("unsupported compiled response mode: {other}")),
    }
    match request.stop_sequences.as_slice() {
        [] => {}
        [single] => {
            body.insert("stop".to_string(), json!(single));
        }
        multiple => {
            body.insert("stop".to_string(), json!(multiple));
        }
    }

    Ok(ProviderHttpRequest {
        url: build_openai_chat_completions_url(base_url),
        headers: vec![
            ProviderHttpHeader {
                name: "Authorization".to_string(),
                value: format!("Bearer {}", api_key),
            },
            ProviderHttpHeader {
                name: "Content-Type".to_string(),
                value: "application/json".to_string(),
            },
            ProviderHttpHeader {
                name: "Accept".to_string(),
                value: if request.stream {
                    "text/event-stream".to_string()
                } else {
                    "application/json".to_string()
                },
            },
        ],
        body: Value::Object(body),
        stream: request.stream,
    })
}

fn inject_additional_properties_false(value: &mut Value) {
    match value {
        Value::Object(map) => {
            if map.get("type").and_then(|v| v.as_str()) == Some("object") {
                if !map.contains_key("additionalProperties") {
                    map.insert("additionalProperties".to_string(), Value::Bool(false));
                }
            }
            for (_, child) in map.iter_mut() {
                inject_additional_properties_false(child);
            }
        }
        Value::Array(arr) => {
            for child in arr.iter_mut() {
                inject_additional_properties_false(child);
            }
        }
        _ => {}
    }
}

fn build_anthropic_http_request(
    request: &LlmChatRequest,
    base_url: &str,
    api_key: &str,
) -> Result<ProviderHttpRequest, String> {
    if request.model.trim().is_empty() {
        return Err(
            "Anthropic 请求必须提供 model 名称（当前 provider 的 model_name 为空）".to_string(),
        );
    }
    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), json!(request.model));
    body.insert(
        "max_tokens".to_string(),
        json!(request
            .max_output_tokens
            .ok_or_else(|| "Anthropic 请求必须显式提供 max_output_tokens".to_string())?),
    );
    body.insert("stream".to_string(), json!(request.stream));

    if !request.system.is_empty() {
        body.insert(
            "system".to_string(),
            Value::Array(
                request
                    .system
                    .iter()
                    .map(|text| {
                        json!({
                            "type": "text",
                            "text": text,
                        })
                    })
                    .collect(),
            ),
        );
    }
    if request.response_mode.as_deref() == Some("structured_json") {
        match request.structured_output_schema.as_deref() {
            Some(schema_json) if !schema_json.trim().is_empty() => {
                let mut schema_value: serde_json::Value = serde_json::from_str(schema_json)
                    .map_err(|e| format!("invalid JSON Schema: {}", e))?;
                inject_additional_properties_false(&mut schema_value);
                body.insert(
                    "output_config".to_string(),
                    json!({
                        "format": {
                            "type": "json_schema",
                            "schema": schema_value,
                        }
                    }),
                );
            }
            _ => {
                return Err("structured_json 模式必须提供 JSON Schema（structured_output_schema 不能为空）".to_string());
            }
        }
    }
    if let Some(temperature) = request.temperature {
        body.insert("temperature".to_string(), json!(temperature));
    }
    if let Some(top_p) = request.top_p {
        body.insert("top_p".to_string(), json!(top_p));
    }
    if let Some(top_k) = request.top_k {
        body.insert("top_k".to_string(), json!(top_k));
    }
    if !request.stop_sequences.is_empty() {
        body.insert("stop_sequences".to_string(), json!(request.stop_sequences));
    }
    if let Some(thinking) = &request.thinking {
        insert_anthropic_thinking(&mut body, thinking)?;
    }
    if !request.tools.is_empty() {
        body.insert(
            "tools".to_string(),
            Value::Array(
                request
                    .tools
                    .iter()
                    .map(|tool| {
                        json!({
                            "name": tool.name,
                            "description": tool.description,
                            "input_schema": tool.input_schema,
                        })
                    })
                    .collect(),
            ),
        );
    }
    if let Some(tool_choice) = &request.tool_choice {
        body.insert(
            "tool_choice".to_string(),
            match tool_choice {
                LlmToolChoice::Auto => json!({ "type": "auto" }),
                LlmToolChoice::Any => json!({ "type": "any" }),
                LlmToolChoice::Tool { name } => json!({
                    "type": "tool",
                    "name": name,
                }),
            },
        );
    }
    let messages = request
        .messages
        .iter()
        .map(anthropic_message_to_json)
        .collect::<Result<Vec<_>, _>>()?;
    body.insert("messages".to_string(), Value::Array(messages));

    Ok(ProviderHttpRequest {
        url: build_anthropic_messages_url(base_url),
        headers: {
            let mut headers = vec![
                ProviderHttpHeader {
                    name: "x-api-key".to_string(),
                    value: api_key.to_string(),
                },
                ProviderHttpHeader {
                    name: "anthropic-version".to_string(),
                    value: ANTHROPIC_API_VERSION.to_string(),
                },
                ProviderHttpHeader {
                    name: "Content-Type".to_string(),
                    value: "application/json".to_string(),
                },
                ProviderHttpHeader {
                    name: "Accept".to_string(),
                    value: if request.stream {
                        "text/event-stream".to_string()
                    } else {
                        "application/json".to_string()
                    },
                },
            ];
            if !request.beta_features.is_empty() {
                headers.push(ProviderHttpHeader {
                    name: "anthropic-beta".to_string(),
                    value: request.beta_features.join(","),
                });
            }
            headers
        },
        body: Value::Object(body),
        stream: request.stream,
    })
}

fn insert_anthropic_thinking(
    body: &mut serde_json::Map<String, Value>,
    thinking: &LlmThinkingConfig,
) -> Result<(), String> {
    if !thinking.enabled {
        return Ok(());
    }

    let budget_tokens = thinking
        .budget_tokens
        .ok_or_else(|| "thinking.enabled=true 时必须提供 budget_tokens".to_string())?;
    body.insert(
        "thinking".to_string(),
        json!({
            "type": "enabled",
            "budget_tokens": budget_tokens,
        }),
    );
    Ok(())
}

fn anthropic_message_to_json(message: &LlmMessage) -> Result<Value, String> {
    if message.role == LlmRole::System {
        return Err(
            "Anthropic messages 列表不允许出现 system role；system 必须走顶层字段".to_string(),
        );
    }

    Ok(json!({
        "role": message.role.as_str(),
        "content": message
            .parts
            .iter()
            .map(anthropic_content_part_to_json)
            .collect::<Result<Vec<_>, _>>()?,
    }))
}

fn anthropic_content_part_to_json(part: &LlmContentPart) -> Result<Value, String> {
    match part {
        LlmContentPart::Text { text } => Ok(json!({
            "type": "text",
            "text": text,
        })),
        LlmContentPart::Image { media_type, source } => Ok(json!({
            "type": "image",
            "source": anthropic_binary_source_to_json(media_type, source)?,
        })),
        LlmContentPart::ToolUse {
            id,
            name,
            input_json,
        } => Ok(json!({
            "type": "tool_use",
            "id": id,
            "name": name,
            "input": input_json,
        })),
        LlmContentPart::ToolResult {
            tool_use_id,
            content_parts,
            is_error,
        } => Ok(json!({
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "is_error": is_error,
            "content": content_parts
                .iter()
                .map(anthropic_content_part_to_json)
                .collect::<Result<Vec<_>, _>>()?,
        })),
        LlmContentPart::Thinking { text, signature } => Ok(json!({
            "type": "thinking",
            "thinking": text,
            "signature": signature,
        })),
        LlmContentPart::RedactedThinking { data } => Ok(json!({
            "type": "redacted_thinking",
            "data": data,
        })),
    }
}

fn anthropic_binary_source_to_json(
    media_type: &str,
    source: &LlmBinarySource,
) -> Result<Value, String> {
    match source {
        LlmBinarySource::Base64 {
            media_type: source_media_type,
            data_base64,
        } => {
            let final_media_type = if source_media_type.trim().is_empty() {
                media_type.to_string()
            } else {
                source_media_type.clone()
            };
            Ok(json!({
                "type": "base64",
                "media_type": final_media_type,
                "data": data_base64,
            }))
        }
        LlmBinarySource::Asset { asset_id } => Err(format!(
            "Anthropic 图片请求暂不支持直接使用 asset_id={}；请先转换为 base64 source",
            asset_id
        )),
    }
}

fn build_openai_chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{}/chat/completions", trimmed)
    } else {
        format!("{}/v1/chat/completions", trimmed)
    }
}

fn build_anthropic_messages_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{}/messages", trimmed)
    } else {
        format!("{}/v1/messages", trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        adapt_prompt_compile_result_to_openai_messages, build_llm_chat_request,
        build_provider_http_request,
    };
    use crate::{
        llm::{LlmChatRequest, LlmContentPart, LlmMessage, LlmRole},
        services::prompt_compiler::{
            CompiledSamplingParams, PromptBlock, PromptBlockKind, PromptBlockSource,
            PromptCompileDebugReport, PromptCompileResult, PromptRole,
        },
    };

    fn block(kind: PromptBlockKind, role: PromptRole, content: &str) -> PromptBlock {
        PromptBlock {
            kind,
            priority: 0,
            role,
            title: None,
            content: content.to_string(),
            source: PromptBlockSource::Compiler,
            token_cost_estimate: Some(1),
            required: false,
        }
    }

    fn empty_result() -> PromptCompileResult {
        PromptCompileResult {
            system_blocks: vec![],
            history_blocks: vec![],
            current_user_block: block(PromptBlockKind::CurrentUser, PromptRole::User, "当前输入"),
            output_validators: vec![],
            params: CompiledSamplingParams::default(),
            debug: PromptCompileDebugReport::default(),
        }
    }

    #[test]
    fn adapter_keeps_history_outside_system() {
        let mut result = PromptCompileResult {
            system_blocks: vec![
                block(PromptBlockKind::PresetRule, PromptRole::System, "system-a"),
                block(PromptBlockKind::CharacterBase, PromptRole::System, "system-b"),
            ],
            history_blocks: vec![
                block(PromptBlockKind::RecentHistory, PromptRole::User, "user-old"),
                block(PromptBlockKind::RecentHistory, PromptRole::Assistant, "assistant-old"),
            ],
            current_user_block: block(PromptBlockKind::CurrentUser, PromptRole::User, "current-user"),
            output_validators: vec![],
            params: CompiledSamplingParams::default(),
            debug: PromptCompileDebugReport::default(),
        };

        let messages =
            adapt_prompt_compile_result_to_openai_messages(&mut result, "openai_compatible")
                .expect("adapter should succeed");

        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[0].content, "system-a\n\nsystem-b");
        assert_eq!(messages[1].role, "user");
        assert_eq!(messages[1].content, "user-old");
        assert_eq!(messages[2].role, "assistant");
        assert_eq!(messages[2].content, "assistant-old");
        assert_eq!(messages[3].role, "user");
        assert_eq!(messages[3].content, "current-user");
    }

    #[test]
    fn adapter_empty_system_produces_no_system_message() {
        let mut result = empty_result();

        let messages =
            adapt_prompt_compile_result_to_openai_messages(&mut result, "openai_compatible")
                .expect("adapter should succeed");

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "当前输入");
    }

    #[test]
    fn anthropic_silently_drops_penalties() {
        let mut result = empty_result();
        result.params.presence_penalty = Some(0.2);
        result.params.frequency_penalty = Some(0.3);
        let request = build_llm_chat_request(
            &mut result,
            "anthropic",
            "claude-sonnet-4-5",
            true,
            None,
            Some(128),
        )
        .expect("anthropic should silently drop unsupported penalties");
        assert_eq!(request.presence_penalty, None);
        assert_eq!(request.frequency_penalty, None);
    }

    #[test]
    fn anthropic_thinking_models_enable_default_thinking_budget() {
        let mut result = empty_result();
        result.params.max_output_tokens = Some(2048);

        let request = build_llm_chat_request(
            &mut result,
            "anthropic",
            "claude-opus-4-6-thinking",
            true,
            None,
            None,
        )
        .expect("thinking model should build");

        assert_eq!(
            request.thinking,
            Some(crate::llm::LlmThinkingConfig {
                enabled: true,
                budget_tokens: Some(2048),
            })
        );
    }

    #[test]
    fn anthropic_non_thinking_models_keep_thinking_disabled_by_default() {
        let mut result = empty_result();

        let request = build_llm_chat_request(
            &mut result,
            "anthropic",
            "claude-opus-4-6",
            true,
            None,
            None,
        )
        .expect("non-thinking model should build");

        assert_eq!(request.thinking, None);
    }

    #[test]
    fn anthropic_http_request_uses_messages_endpoint() {
        let request = LlmChatRequest {
            provider_kind: "anthropic".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            system: vec!["系统规则".to_string()],
            messages: vec![LlmMessage::text(LlmRole::User, "你好")],
            temperature: Some(0.4),
            max_output_tokens: Some(256),
            top_p: Some(0.9),
            top_k: None,
            presence_penalty: None,
            frequency_penalty: None,
            response_mode: Some("pseudo_xml".to_string()),
            stop_sequences: vec!["END".to_string()],
            stream: true,
            tools: vec![],
            tool_choice: None,
            thinking: None,
            beta_features: vec![],
            structured_output_schema: None,
            structured_output_display: None,
        };

        let http_request =
            build_provider_http_request(&request, "https://api.anthropic.com", "test-key")
                .expect("anthropic http request should build");

        assert!(http_request.url.ends_with("/v1/messages"));
        assert_eq!(http_request.stream, true);
        let system_array = http_request
            .body
            .get("system")
            .and_then(|value| value.as_array())
            .expect("system should be an array");
        assert_eq!(system_array.len(), 1);
        assert_eq!(
            system_array[0].get("type").and_then(|v| v.as_str()),
            Some("text")
        );
        assert_eq!(
            system_array[0].get("text").and_then(|v| v.as_str()),
            Some("系统规则")
        );
        assert_eq!(
            http_request
                .body
                .get("messages")
                .and_then(|value| value.as_array())
                .map(|items| items.len()),
            Some(1)
        );
    }

    #[test]
    fn openai_http_request_rejects_non_text_content() {
        let request = LlmChatRequest {
            provider_kind: "openai_compatible".to_string(),
            model: "gpt-test".to_string(),
            system: vec![],
            messages: vec![LlmMessage {
                role: LlmRole::User,
                parts: vec![LlmContentPart::Image {
                    media_type: "image/png".to_string(),
                    source: crate::llm::LlmBinarySource::Base64 {
                        media_type: "image/png".to_string(),
                        data_base64: "abc".to_string(),
                    },
                }],
            }],
            temperature: None,
            max_output_tokens: Some(32),
            top_p: None,
            top_k: None,
            presence_penalty: None,
            frequency_penalty: None,
            response_mode: None,
            stop_sequences: vec![],
            stream: false,
            tools: vec![],
            tool_choice: None,
            thinking: None,
            beta_features: vec![],
            structured_output_schema: None,
            structured_output_display: None,
        };

        let error = build_provider_http_request(&request, "https://api.openai.com", "key")
            .expect_err("non-text openai request should fail");
        assert!(error.contains("纯文本"));
    }

    #[test]
    fn anthropic_structured_json_request_sets_output_config() {
        let request = LlmChatRequest {
            provider_kind: "anthropic".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            system: vec!["系统规则".to_string()],
            messages: vec![LlmMessage::text(LlmRole::User, "你好")],
            temperature: None,
            max_output_tokens: Some(256),
            top_p: None,
            top_k: None,
            presence_penalty: None,
            frequency_penalty: None,
            response_mode: Some("structured_json".to_string()),
            stop_sequences: vec![],
            stream: false,
            tools: vec![],
            tool_choice: None,
            thinking: None,
            beta_features: vec![],
            structured_output_schema: Some(r#"{"type":"object","properties":{"thinking":{"type":"string","description":"模型的内部推理过程"},"text":{"type":"string","description":"叙事正文"},"choices":{"type":"object","description":"玩家可选的行动选项","additionalProperties":{"type":"string"}}},"required":["thinking","text"]}"#.to_string()),
            structured_output_display: None,
        };

        let http_request =
            build_provider_http_request(&request, "https://api.anthropic.com", "test-key")
                .expect("structured_json anthropic request should build");

        assert!(
            http_request.body.get("tools").is_none(),
            "tools should not be present with native structured outputs"
        );
        assert!(
            http_request.body.get("tool_choice").is_none(),
            "tool_choice should not be present with native structured outputs"
        );

        let output_config = http_request
            .body
            .get("output_config")
            .expect("output_config should exist");
        let format = output_config
            .get("format")
            .expect("output_config.format should exist");
        assert_eq!(
            format.get("type").and_then(|v| v.as_str()),
            Some("json_schema")
        );
        let schema = format
            .get("schema")
            .expect("format should have schema");
        assert_eq!(schema.get("type").and_then(|v| v.as_str()), Some("object"));
        assert!(schema.get("properties").and_then(|v| v.as_object()).is_some());
        assert!(schema
            .get("properties")
            .and_then(|v| v.get("choices"))
            .is_some());

        assert_eq!(
            schema.get("additionalProperties").and_then(|v| v.as_bool()),
            Some(false),
            "top-level schema should have additionalProperties: false auto-injected"
        );

        let choices = schema
            .get("properties")
            .and_then(|v| v.get("choices"))
            .expect("choices should exist");
        assert!(
            choices.get("additionalProperties").and_then(|v| v.as_object()).is_some(),
            "existing additionalProperties should not be overwritten"
        );

        let system_array = http_request
            .body
            .get("system")
            .and_then(|v| v.as_array())
            .expect("system should be an array");
        assert_eq!(system_array.len(), 1, "system should only contain the original system text, no tool_use instruction");
    }

    #[test]
    fn openai_structured_json_request_sets_json_schema_format() {
        let request = LlmChatRequest {
            provider_kind: "openai_compatible".to_string(),
            model: "gpt-4o".to_string(),
            system: vec![],
            messages: vec![LlmMessage::text(LlmRole::User, "你好")],
            temperature: None,
            max_output_tokens: Some(256),
            top_p: None,
            top_k: None,
            presence_penalty: None,
            frequency_penalty: None,
            response_mode: Some("structured_json".to_string()),
            stop_sequences: vec![],
            stream: false,
            tools: vec![],
            tool_choice: None,
            thinking: None,
            beta_features: vec![],
            structured_output_schema: Some(r#"{"type":"object","properties":{"thinking":{"type":"string","description":"模型的内部推理过程"},"text":{"type":"string","description":"回复正文"}},"required":["thinking","text"]}"#.to_string()),
            structured_output_display: None,
        };

        let http_request =
            build_provider_http_request(&request, "https://api.openai.com", "test-key")
                .expect("structured_json openai request should build");

        let response_format = http_request
            .body
            .get("response_format")
            .expect("response_format should exist");
        assert_eq!(
            response_format.get("type").and_then(|v| v.as_str()),
            Some("json_schema")
        );

        let json_schema = response_format
            .get("json_schema")
            .expect("json_schema should exist");
        assert_eq!(
            json_schema.get("name").and_then(|v| v.as_str()),
            Some("night_voyage_response")
        );
        assert_eq!(
            json_schema.get("strict").and_then(|v| v.as_bool()),
            Some(false)
        );

        let schema = json_schema
            .get("schema")
            .expect("schema should exist");
        assert_eq!(schema.get("type").and_then(|v| v.as_str()), Some("object"));
        assert!(schema.get("properties").and_then(|v| v.as_object()).is_some());
        assert!(schema.get("properties").and_then(|v| v.get("thinking")).is_some());
        assert!(schema.get("properties").and_then(|v| v.get("text")).is_some());
    }

    #[test]
    fn structured_json_rejected_for_unsupported_provider() {
        let mut result = empty_result();
        result.params.response_mode = Some("structured_json".to_string());

        let error = build_llm_chat_request(
            &mut result,
            "test_no_structured_json",
            "test-model",
            false,
            None,
            None,
        )
        .expect_err("structured_json should be rejected for unsupported provider");

        assert!(error.contains("structured_json"));
    }

    #[test]
    fn structured_json_without_schema_is_rejected_openai() {
        let request = LlmChatRequest {
            provider_kind: "openai_compatible".to_string(),
            model: "gpt-4o".to_string(),
            system: vec![],
            messages: vec![LlmMessage::text(LlmRole::User, "你好")],
            temperature: None,
            max_output_tokens: Some(256),
            top_p: None,
            top_k: None,
            presence_penalty: None,
            frequency_penalty: None,
            response_mode: Some("structured_json".to_string()),
            stop_sequences: vec![],
            stream: false,
            tools: vec![],
            tool_choice: None,
            thinking: None,
            beta_features: vec![],
            structured_output_schema: None,
            structured_output_display: None,
        };

        let error = build_provider_http_request(&request, "https://api.openai.com", "test-key")
            .expect_err("structured_json without schema should be rejected");
        assert!(error.contains("structured_output_schema"));
    }

    #[test]
    fn structured_json_with_empty_schema_is_rejected_anthropic() {
        let request = LlmChatRequest {
            provider_kind: "anthropic".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            system: vec![],
            messages: vec![LlmMessage::text(LlmRole::User, "你好")],
            temperature: None,
            max_output_tokens: Some(256),
            top_p: None,
            top_k: None,
            presence_penalty: None,
            frequency_penalty: None,
            response_mode: Some("structured_json".to_string()),
            stop_sequences: vec![],
            stream: false,
            tools: vec![],
            tool_choice: None,
            thinking: None,
            beta_features: vec![],
            structured_output_schema: Some("".to_string()),
            structured_output_display: None,
        };

        let error = build_provider_http_request(&request, "https://api.anthropic.com", "test-key")
            .expect_err("structured_json with empty schema should be rejected");
        assert!(error.contains("structured_output_schema"));
    }
}

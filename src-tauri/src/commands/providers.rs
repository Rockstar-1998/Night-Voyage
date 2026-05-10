use reqwest::{Client, RequestBuilder};
use serde::Serialize;
use sqlx::Row;
use std::time::{Duration, Instant};

use crate::{
    llm::{LlmChatRequest, LlmMessage, LlmRole, ProviderHttpRequest, ANTHROPIC_API_VERSION},
    models::{ApiProvider, ApiProviderSummary, RemoteModel},
    services::provider_adapter::build_provider_http_request,
    utils::now_ts,
    AppState,
};

const PROVIDER_KIND_OPENAI_COMPATIBLE: &str = "openai_compatible";
const PROVIDER_KIND_ANTHROPIC: &str = "anthropic";
const PROVIDER_HTTP_TIMEOUT_SECS: u64 = 30;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub status: u16,
    pub latency_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderClaudeNativeTestResult {
    pub ok: bool,
    pub status: u16,
    pub latency_ms: u128,
    pub attempt_count: u32,
    pub degraded: bool,
    pub degraded_threshold_ms: u64,
    pub model: String,
    pub response_preview: String,
}

#[tauri::command]
pub async fn providers_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ApiProviderSummary>, String> {
    let rows = sqlx::query(
        "SELECT id, name, provider_kind, base_url, api_key, model_name, created_at, updated_at \
         FROM api_providers ORDER BY updated_at DESC, id DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(rows.into_iter().map(row_to_provider_summary).collect())
}

#[tauri::command]
pub async fn providers_create(
    state: tauri::State<'_, AppState>,
    name: String,
    base_url: String,
    api_key: String,
    model_name: String,
    provider_kind: Option<String>,
) -> Result<ApiProviderSummary, String> {
    let name = normalize_required("name", &name)?;
    let provider_kind = normalize_provider_kind_for_create(provider_kind)?;
    let base_url = normalize_base_url(&base_url)?;
    let api_key = normalize_required("apiKey", &api_key)?;
    let model_name = normalize_model_name(&model_name);
    let now = now_ts();

    eprintln!(
        "[provider-debug] providers_create:start provider_kind={} base_url={} model_name={} has_api_key={}",
        provider_kind,
        base_url,
        display_model_name(&model_name),
        !api_key.is_empty()
    );

    let result = sqlx::query(
        "INSERT INTO api_providers (
            name, provider_kind, base_url, api_key, model_name,
            created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&name)
    .bind(&provider_kind)
    .bind(&base_url)
    .bind(&api_key)
    .bind(&model_name)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|err| {
        eprintln!(
            "[provider-debug] providers_create:error provider_kind={} base_url={} model_name={} error={}",
            provider_kind,
            base_url,
            display_model_name(&model_name),
            err
        );
        err.to_string()
    })?;

    eprintln!(
        "[provider-debug] providers_create:success provider_kind={} provider_id={} model_name={}",
        provider_kind,
        result.last_insert_rowid(),
        display_model_name(&model_name)
    );

    providers_get_summary(&state.db, result.last_insert_rowid()).await
}

#[tauri::command]
pub async fn providers_update(
    state: tauri::State<'_, AppState>,
    id: i64,
    name: String,
    base_url: String,
    model_name: String,
    api_key: Option<String>,
    provider_kind: Option<String>,
) -> Result<ApiProviderSummary, String> {
    let name = normalize_required("name", &name)?;
    let provider_kind = normalize_optional_provider_kind(provider_kind)?;
    let base_url = normalize_base_url(&base_url)?;
    let model_name = normalize_model_name(&model_name);
    let api_key = normalize_optional_secret(api_key)?;
    let now = now_ts();

    eprintln!(
        "[provider-debug] providers_update:start provider_id={} provider_kind={:?} base_url={} model_name={} has_api_key_update={}",
        id,
        provider_kind,
        base_url,
        display_model_name(&model_name),
        api_key.is_some()
    );

    sqlx::query(
        "UPDATE api_providers SET
            name = ?,
            provider_kind = COALESCE(?, provider_kind),
            base_url = ?,
            api_key = COALESCE(?, api_key),
            model_name = ?,
            updated_at = ?
         WHERE id = ?",
    )
    .bind(&name)
    .bind(&provider_kind)
    .bind(&base_url)
    .bind(api_key)
    .bind(&model_name)
    .bind(now)
    .bind(id)
    .execute(&state.db)
    .await
    .map_err(|err| {
        eprintln!(
            "[provider-debug] providers_update:error provider_id={} provider_kind={:?} base_url={} model_name={} error={}",
            id,
            provider_kind,
            base_url,
            display_model_name(&model_name),
            err
        );
        err.to_string()
    })?;

    eprintln!(
        "[provider-debug] providers_update:success provider_id={} provider_kind={:?} model_name={}",
        id,
        provider_kind,
        display_model_name(&model_name)
    );

    providers_get_summary(&state.db, id).await
}

#[tauri::command]
pub async fn providers_delete(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM api_providers WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn providers_test(
    base_url: String,
    api_key: String,
    model_name: String,
    provider_kind: Option<String>,
) -> Result<ProviderTestResult, String> {
    let provider_kind = normalize_provider_kind_for_create(provider_kind)?;
    let base_url = normalize_base_url(&base_url)?;
    let api_key = normalize_required("apiKey", &api_key)?;
    let model_name = normalize_required("modelName", &model_name)?;

    let request = LlmChatRequest {
        provider_kind: provider_kind.clone(),
        model: model_name.clone(),
        system: vec![],
        messages: vec![LlmMessage::text(LlmRole::User, "ping")],
        temperature: None,
        max_output_tokens: Some(1),
        top_p: None,
        top_k: None,
        presence_penalty: None,
        frequency_penalty: None,
        response_mode: Some("text".to_string()),
        stop_sequences: vec![],
        stream: false,
        tools: vec![],
        tool_choice: None,
        thinking: None,
        beta_features: vec![],
    };
    let http_request = build_provider_http_request(&request, &base_url, &api_key)?;
    let request_url = http_request.url.clone();

    eprintln!(
        "[provider-debug] providers_test:start provider_kind={} base_url={} url={} model={}",
        provider_kind, base_url, request_url, model_name
    );

    let start = Instant::now();
    let client = build_http_client()?;
    let response = match execute_provider_post_request(&client, http_request).await {
        Ok(response) => response,
        Err(error) => {
            eprintln!(
                "[provider-debug] providers_test:transport_error provider_kind={} base_url={} url={} model={} elapsed_ms={} error={}",
                provider_kind,
                base_url,
                request_url,
                model_name,
                start.elapsed().as_millis(),
                error
            );
            return Err(error);
        }
    };
    let status = response.status();
    let latency_ms = start.elapsed().as_millis();

    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        eprintln!(
            "[provider-debug] providers_test:http_error provider_kind={} base_url={} url={} model={} status={} elapsed_ms={} body_preview={}",
            provider_kind,
            base_url,
            request_url,
            model_name,
            status,
            latency_ms,
            log_text_preview(&text)
        );
        return Err(format!("测试失败: {} {}", status, text));
    }

    eprintln!(
        "[provider-debug] providers_test:success provider_kind={} base_url={} url={} model={} status={} elapsed_ms={}",
        provider_kind, base_url, request_url, model_name, status, latency_ms
    );

    Ok(ProviderTestResult {
        ok: true,
        status: status.as_u16(),
        latency_ms,
    })
}

#[tauri::command]
pub async fn providers_test_claude_native(
    state: tauri::State<'_, AppState>,
    provider_id: i64,
    test_model: String,
    test_prompt: Option<String>,
    timeout_seconds: Option<u64>,
    degraded_threshold_ms: Option<u64>,
    max_retries: Option<u32>,
) -> Result<ProviderClaudeNativeTestResult, String> {
    let provider = load_provider_secret(&state.db, provider_id).await?;
    if provider.provider_kind != PROVIDER_KIND_ANTHROPIC {
        return Err(format!(
            "providers_test_claude_native 仅支持 provider_kind='{}'，当前为 '{}'",
            PROVIDER_KIND_ANTHROPIC, provider.provider_kind
        ));
    }

    let test_model = normalize_required("testModel", &test_model)?;
    let test_prompt = normalize_optional_prompt(test_prompt, "Who are you?");
    let timeout_seconds = normalize_timeout_seconds(timeout_seconds);
    let degraded_threshold_ms = normalize_degraded_threshold_ms(degraded_threshold_ms);
    let max_retries = normalize_max_retries(max_retries);
    let total_attempts = max_retries.saturating_add(1);
    let client = build_http_client_with_timeout(timeout_seconds)?;
    let mut last_error = None;

    for attempt in 1..=total_attempts {
        let request = LlmChatRequest {
            provider_kind: PROVIDER_KIND_ANTHROPIC.to_string(),
            model: test_model.clone(),
            system: vec![],
            messages: vec![LlmMessage::text(LlmRole::User, test_prompt.clone())],
            temperature: None,
            max_output_tokens: Some(128),
            top_p: None,
            top_k: None,
            presence_penalty: None,
            frequency_penalty: None,
            response_mode: Some("text".to_string()),
            stop_sequences: vec![],
            stream: false,
            tools: vec![],
            tool_choice: None,
            thinking: None,
            beta_features: vec![],
        };
        let http_request =
            build_provider_http_request(&request, &provider.base_url, &provider.api_key)?;
        let request_url = http_request.url.clone();

        eprintln!(
            "[provider-debug] providers_test_claude_native:attempt_start provider_id={} attempt={}/{} base_url={} url={} model={} timeout_seconds={} prompt_preview={}",
            provider.id,
            attempt,
            total_attempts,
            provider.base_url,
            request_url,
            test_model,
            timeout_seconds,
            log_text_preview(&test_prompt)
        );

        let start = Instant::now();
        let response = match execute_provider_post_request(&client, http_request).await {
            Ok(response) => response,
            Err(error) => {
                let error_message = format!("Claude 原生测试传输失败: {}", error);
                eprintln!(
                    "[provider-debug] providers_test_claude_native:transport_error provider_id={} attempt={}/{} url={} elapsed_ms={} error={}",
                    provider.id,
                    attempt,
                    total_attempts,
                    request_url,
                    start.elapsed().as_millis(),
                    error
                );
                last_error = Some(error_message);
                continue;
            }
        };

        let status = response.status();
        let latency_ms = start.elapsed().as_millis();
        let response_text = match response.text().await {
            Ok(text) => text,
            Err(error) => {
                let error_message = format!("Claude 原生测试读取响应失败: {}", error);
                eprintln!(
                    "[provider-debug] providers_test_claude_native:read_error provider_id={} attempt={}/{} url={} elapsed_ms={} error={}",
                    provider.id,
                    attempt,
                    total_attempts,
                    request_url,
                    latency_ms,
                    error
                );
                last_error = Some(error_message);
                continue;
            }
        };

        if !status.is_success() {
            let error_message = format!("Claude 原生测试失败: {} {}", status, response_text);
            eprintln!(
                "[provider-debug] providers_test_claude_native:http_error provider_id={} attempt={}/{} url={} status={} elapsed_ms={} body_preview={}",
                provider.id,
                attempt,
                total_attempts,
                request_url,
                status,
                latency_ms,
                log_text_preview(&response_text)
            );
            last_error = Some(error_message);
            continue;
        }

        let response_preview = match extract_anthropic_text_preview(&response_text) {
            Ok(response_preview) => response_preview,
            Err(error) => {
                let error_message = format!("Claude 原生测试响应解析失败: {}", error);
                eprintln!(
                    "[provider-debug] providers_test_claude_native:parse_error provider_id={} attempt={}/{} url={} status={} elapsed_ms={} body_preview={}",
                    provider.id,
                    attempt,
                    total_attempts,
                    request_url,
                    status,
                    latency_ms,
                    log_text_preview(&response_text)
                );
                last_error = Some(error_message);
                continue;
            }
        };

        let degraded = latency_ms >= degraded_threshold_ms as u128;
        eprintln!(
            "[provider-debug] providers_test_claude_native:success provider_id={} attempt={}/{} url={} status={} latency_ms={} degraded={} response_preview={}",
            provider.id,
            attempt,
            total_attempts,
            request_url,
            status,
            latency_ms,
            degraded,
            log_text_preview(&response_preview)
        );

        return Ok(ProviderClaudeNativeTestResult {
            ok: true,
            status: status.as_u16(),
            latency_ms,
            attempt_count: attempt,
            degraded,
            degraded_threshold_ms,
            model: test_model,
            response_preview,
        });
    }

    Err(last_error.unwrap_or_else(|| "Claude 原生测试失败，未获得有效响应".to_string()))
}

#[tauri::command]
pub async fn providers_fetch_models(
    state: tauri::State<'_, AppState>,
    provider_id: i64,
) -> Result<Vec<RemoteModel>, String> {
    let provider = load_provider_secret(&state.db, provider_id).await?;
    let client = build_http_client()?;
    let models_url = build_models_url(&provider.base_url, &provider.provider_kind)?;
    eprintln!(
        "[provider-debug] providers_fetch_models:start provider_id={} provider_kind={} base_url={} url={} model={}",
        provider.id,
        provider.provider_kind,
        provider.base_url,
        models_url,
        provider.model_name
    );
    let start = Instant::now();
    let mut models = if provider.provider_kind == PROVIDER_KIND_ANTHROPIC {
        match try_fetch_models_from_api(&client, &provider, &models_url).await {
            Ok(fetched) => fetched,
            Err(_) => {
                eprintln!(
                    "[provider-debug] providers_fetch_models:anthropic_fallback provider_id={} url={}",
                    provider.id, models_url
                );
                hardcoded_anthropic_models()
            }
        }
    } else {
        try_fetch_models_from_api(&client, &provider, &models_url).await?
    };

    models.sort_by(|left, right| left.id.cmp(&right.id));

    let now = now_ts();
    let mut tx = state.db.begin().await.map_err(|err| err.to_string())?;
    sqlx::query("DELETE FROM api_provider_models WHERE provider_id = ?")
        .bind(provider_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

    for model in &models {
        sqlx::query(
            "INSERT INTO api_provider_models (provider_id, model_id, owned_by, fetched_at) VALUES (?, ?, ?, ?)",
        )
        .bind(provider_id)
        .bind(&model.id)
        .bind(&model.owned_by)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
    }

    sqlx::query("UPDATE api_providers SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(provider_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

    tx.commit().await.map_err(|err| err.to_string())?;

    eprintln!(
        "[provider-debug] providers_fetch_models:success provider_id={} provider_kind={} url={} model_count={} elapsed_ms={}",
        provider.id,
        provider.provider_kind,
        models_url,
        models.len(),
        start.elapsed().as_millis()
    );

    Ok(models)
}

async fn providers_get_summary(
    db: &sqlx::SqlitePool,
    id: i64,
) -> Result<ApiProviderSummary, String> {
    let row = sqlx::query(
        "SELECT id, name, provider_kind, base_url, api_key, model_name, created_at, updated_at \
         FROM api_providers WHERE id = ?",
    )
    .bind(id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(row_to_provider_summary(row))
}

#[tauri::command]
pub async fn providers_count_tokens(
    state: tauri::State<'_, AppState>,
    provider_id: i64,
    model: String,
    messages: Vec<serde_json::Value>,
    system: Option<Vec<String>>,
    tools: Option<Vec<serde_json::Value>>,
) -> Result<serde_json::Value, String> {
    let provider = load_provider_secret(&state.db, provider_id).await?;

    match provider.provider_kind.as_str() {
        PROVIDER_KIND_OPENAI_COMPATIBLE => {
            return Err(
                "token counting is not supported for OpenAI-compatible providers".to_string(),
            );
        }
        PROVIDER_KIND_ANTHROPIC => {}
        _ => {
            return Err("unsupported provider kind".to_string());
        }
    }

    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), serde_json::json!(model));
    body.insert("messages".to_string(), serde_json::json!(messages));
    body.insert("max_tokens".to_string(), serde_json::json!(1));

    if let Some(system_texts) = system {
        if !system_texts.is_empty() {
            body.insert(
                "system".to_string(),
                serde_json::Value::Array(
                    system_texts
                        .iter()
                        .map(|text| {
                            serde_json::json!({
                                "type": "text",
                                "text": text,
                            })
                        })
                        .collect(),
                ),
            );
        }
    }

    if let Some(tools) = tools {
        if !tools.is_empty() {
            body.insert("tools".to_string(), serde_json::json!(tools));
        }
    }

    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/v1/messages/count_tokens", base_url);

    let client = build_http_client()?;
    let response = client
        .post(&url)
        .header("x-api-key", &provider.api_key)
        .header("anthropic-version", ANTHROPIC_API_VERSION)
        .header("Content-Type", "application/json")
        .header("anthropic-beta", "token-counting-2024-11-01")
        .json(&body)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "token counting request failed: {} {}",
            status, text
        ));
    }

    let response_json: serde_json::Value = response.json().await.map_err(|err| err.to_string())?;
    let token_count = response_json
        .get("input_tokens")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "missing input_tokens in count_tokens response".to_string())?;

    Ok(serde_json::json!({ "tokenCount": token_count }))
}

async fn load_provider_secret(db: &sqlx::SqlitePool, id: i64) -> Result<ApiProvider, String> {
    let row = sqlx::query(
        "SELECT id, name, provider_kind, base_url, api_key, model_name, max_tokens, max_context_tokens, temperature \
         FROM api_providers WHERE id = ?",
    )
    .bind(id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(ApiProvider {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        provider_kind: row
            .try_get("provider_kind")
            .unwrap_or_else(|_| PROVIDER_KIND_OPENAI_COMPATIBLE.to_string()),
        base_url: row.try_get("base_url").unwrap_or_default(),
        api_key: row.try_get("api_key").unwrap_or_default(),
        model_name: row.try_get("model_name").unwrap_or_default(),
        max_tokens: row.try_get("max_tokens").ok(),
        max_context_tokens: row.try_get("max_context_tokens").ok(),
        temperature: row.try_get("temperature").ok(),
    })
}

fn row_to_provider_summary(row: sqlx::sqlite::SqliteRow) -> ApiProviderSummary {
    let api_key: String = row.try_get("api_key").unwrap_or_default();
    ApiProviderSummary {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        provider_kind: row
            .try_get("provider_kind")
            .unwrap_or_else(|_| PROVIDER_KIND_OPENAI_COMPATIBLE.to_string()),
        base_url: row.try_get("base_url").unwrap_or_default(),
        model_name: row.try_get("model_name").unwrap_or_default(),
        has_api_key: !api_key.is_empty(),
        api_key_preview: preview_api_key(&api_key),
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    }
}

fn normalize_required(field_name: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{} 不能为空", field_name));
    }
    Ok(trimmed.to_string())
}

fn normalize_model_name(value: &str) -> String {
    value.trim().to_string()
}

fn display_model_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "<empty>".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_provider_kind_for_create(value: Option<String>) -> Result<String, String> {
    match value {
        Some(provider_kind) => normalize_provider_kind_value("providerKind", &provider_kind),
        None => Ok(PROVIDER_KIND_OPENAI_COMPATIBLE.to_string()),
    }
}

fn normalize_optional_provider_kind(value: Option<String>) -> Result<Option<String>, String> {
    match value {
        Some(provider_kind) => Ok(Some(normalize_provider_kind_value(
            "providerKind",
            &provider_kind,
        )?)),
        None => Ok(None),
    }
}

fn normalize_provider_kind_value(field_name: &str, value: &str) -> Result<String, String> {
    let normalized = normalize_required(field_name, value)?;
    match normalized.as_str() {
        PROVIDER_KIND_OPENAI_COMPATIBLE | PROVIDER_KIND_ANTHROPIC => Ok(normalized),
        _ => Err(format!(
            "{} 只支持 {} 或 {}",
            field_name, PROVIDER_KIND_OPENAI_COMPATIBLE, PROVIDER_KIND_ANTHROPIC
        )),
    }
}

fn normalize_base_url(value: &str) -> Result<String, String> {
    let trimmed = normalize_required("baseUrl", value)?;
    Ok(trimmed.trim_end_matches('/').to_string())
}

fn normalize_optional_secret(value: Option<String>) -> Result<Option<String>, String> {
    match value {
        Some(secret) => {
            let trimmed = secret.trim();
            if trimmed.is_empty() {
                return Err("apiKey 为空字符串时必须显式报错，不能视为保留原值".to_string());
            }
            Ok(Some(trimmed.to_string()))
        }
        None => Ok(None),
    }
}

fn preview_api_key(secret: &str) -> Option<String> {
    if secret.is_empty() {
        return None;
    }

    let visible_tail = if secret.len() <= 4 {
        secret.to_string()
    } else {
        secret[secret.len() - 4..].to_string()
    };

    Some(format!("••••{}", visible_tail))
}

fn build_http_client() -> Result<Client, String> {
    build_http_client_with_timeout(PROVIDER_HTTP_TIMEOUT_SECS)
}

fn build_http_client_with_timeout(timeout_secs: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|err| err.to_string())
}

fn log_text_preview(text: &str) -> String {
    const MAX_PREVIEW_LEN: usize = 240;
    let normalized = text.replace(['\r', '\n'], " ");
    if normalized.len() <= MAX_PREVIEW_LEN {
        normalized
    } else {
        format!("{}...", &normalized[..MAX_PREVIEW_LEN])
    }
}

fn normalize_optional_prompt(value: Option<String>, default_prompt: &str) -> String {
    match value {
        Some(prompt) if !prompt.trim().is_empty() => prompt.trim().to_string(),
        _ => default_prompt.to_string(),
    }
}

fn normalize_timeout_seconds(value: Option<u64>) -> u64 {
    value.unwrap_or(45).clamp(5, 120)
}

fn normalize_degraded_threshold_ms(value: Option<u64>) -> u64 {
    value.unwrap_or(6000).max(1)
}

fn normalize_max_retries(value: Option<u32>) -> u32 {
    value.unwrap_or(2).min(5)
}

fn extract_anthropic_text_preview(response_text: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(response_text).map_err(|err| err.to_string())?;
    let content = value
        .get("content")
        .and_then(|content| content.as_array())
        .ok_or_else(|| "缺少 content 数组".to_string())?;

    let text = content
        .iter()
        .filter_map(|item| {
            let item_type = item.get("type").and_then(|item_type| item_type.as_str())?;
            if item_type != "text" {
                return None;
            }
            item.get("text")
                .and_then(|text| text.as_str())
                .map(|text| text.trim())
                .filter(|text| !text.is_empty())
                .map(|text| text.to_string())
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    if text.trim().is_empty() {
        return Err("响应中没有可用的 text content".to_string());
    }

    Ok(log_text_preview(&text))
}

async fn execute_provider_post_request(
    client: &Client,
    request: ProviderHttpRequest,
) -> Result<reqwest::Response, String> {
    let mut builder = client.post(&request.url);
    for header in request.headers {
        builder = builder.header(&header.name, &header.value);
    }
    builder
        .json(&request.body)
        .send()
        .await
        .map_err(|err| err.to_string())
}

fn build_provider_models_request(
    client: &Client,
    provider: &ApiProvider,
    url: &str,
) -> Result<RequestBuilder, String> {
    let builder = client.get(url).header("Accept", "application/json");
    apply_provider_auth_headers(builder, &provider.provider_kind, &provider.api_key)
}

fn apply_provider_auth_headers(
    builder: RequestBuilder,
    provider_kind: &str,
    api_key: &str,
) -> Result<RequestBuilder, String> {
    match provider_kind {
        PROVIDER_KIND_OPENAI_COMPATIBLE => Ok(builder.bearer_auth(api_key)),
        PROVIDER_KIND_ANTHROPIC => Ok(builder
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)),
        other => Err(format!("不支持 provider_kind='{}' 的认证头构造", other)),
    }
}

fn build_models_url(base_url: &str, provider_kind: &str) -> Result<String, String> {
    match provider_kind {
        PROVIDER_KIND_OPENAI_COMPATIBLE | PROVIDER_KIND_ANTHROPIC => {
            let trimmed = base_url.trim_end_matches('/');
            Ok(if trimmed.ends_with("/v1") {
                format!("{}/models", trimmed)
            } else {
                format!("{}/v1/models", trimmed)
            })
        }
        other => Err(format!("不支持 provider_kind='{}' 的模型列表端点", other)),
    }
}

async fn try_fetch_models_from_api(
    client: &Client,
    provider: &ApiProvider,
    models_url: &str,
) -> Result<Vec<RemoteModel>, String> {
    let request = build_provider_models_request(client, provider, models_url)?;

    let start = Instant::now();
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            eprintln!(
                "[provider-debug] providers_fetch_models:transport_error provider_id={} provider_kind={} url={} elapsed_ms={} error={}",
                provider.id,
                provider.provider_kind,
                models_url,
                start.elapsed().as_millis(),
                error
            );
            return Err(error.to_string());
        }
    };

    let status = response.status();
    let elapsed_ms = start.elapsed().as_millis();
    let response_text = response.text().await.map_err(|err| err.to_string())?;

    if !status.is_success() {
        eprintln!(
            "[provider-debug] providers_fetch_models:http_error provider_id={} provider_kind={} url={} status={} elapsed_ms={} body_preview={}",
            provider.id,
            provider.provider_kind,
            models_url,
            status,
            elapsed_ms,
            log_text_preview(&response_text)
        );
        return Err(format!("拉取模型列表失败: {} {}", status, response_text));
    }

    eprintln!(
        "[provider-debug] providers_fetch_models:response provider_id={} provider_kind={} url={} status={} elapsed_ms={} body_preview={}",
        provider.id,
        provider.provider_kind,
        models_url,
        status,
        elapsed_ms,
        log_text_preview(&response_text)
    );

    let value: serde_json::Value = serde_json::from_str(&response_text).map_err(|err| {
        eprintln!(
            "[provider-debug] providers_fetch_models:json_error provider_id={} provider_kind={} url={} error={} body_preview={}",
            provider.id,
            provider.provider_kind,
            models_url,
            err,
            log_text_preview(&response_text)
        );
        err.to_string()
    })?;
    let data = value
        .get("data")
        .and_then(|items| items.as_array())
        .ok_or_else(|| {
            eprintln!(
                "[provider-debug] providers_fetch_models:invalid_shape provider_id={} provider_kind={} url={} body_preview={}",
                provider.id,
                provider.provider_kind,
                models_url,
                log_text_preview(&response_text)
            );
            "模型列表响应格式错误".to_string()
        })?;

    Ok(data
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(|value| value.as_str())?;
            Some(RemoteModel {
                id: id.to_string(),
                owned_by: item
                    .get("owned_by")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
                    .or_else(|| {
                        item.get("display_name")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string())
                    }),
            })
        })
        .collect::<Vec<_>>())
}

fn hardcoded_anthropic_models() -> Vec<RemoteModel> {
    vec![
        RemoteModel {
            id: "claude-sonnet-4-20250514".to_string(),
            owned_by: Some("anthropic".to_string()),
        },
        RemoteModel {
            id: "claude-3-5-sonnet-20241022".to_string(),
            owned_by: Some("anthropic".to_string()),
        },
        RemoteModel {
            id: "claude-3-5-sonnet-latest".to_string(),
            owned_by: Some("anthropic".to_string()),
        },
        RemoteModel {
            id: "claude-3-5-haiku-20241022".to_string(),
            owned_by: Some("anthropic".to_string()),
        },
        RemoteModel {
            id: "claude-3-5-haiku-latest".to_string(),
            owned_by: Some("anthropic".to_string()),
        },
        RemoteModel {
            id: "claude-3-opus-20240229".to_string(),
            owned_by: Some("anthropic".to_string()),
        },
        RemoteModel {
            id: "claude-3-opus-latest".to_string(),
            owned_by: Some("anthropic".to_string()),
        },
        RemoteModel {
            id: "claude-3-haiku-20240307".to_string(),
            owned_by: Some("anthropic".to_string()),
        },
        RemoteModel {
            id: "claude-3-sonnet-20240229".to_string(),
            owned_by: Some("anthropic".to_string()),
        },
    ]
}

use serde::Serialize;
use sqlx::Row;

use crate::services::letta_sidecar;
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LettaServerInfo {
    pub url: String,
    pub running: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiProviderDetail {
    pub id: i64,
    pub name: String,
    pub provider_kind: String,
    pub base_url: String,
    pub api_key: String,
    pub model_name: String,
    pub max_tokens: Option<i64>,
    pub max_context_tokens: Option<i64>,
    pub temperature: Option<f64>,
}

#[tauri::command]
pub async fn letta_server_status(
    state: tauri::State<'_, AppState>,
) -> Result<LettaServerInfo, String> {
    let sidecar = state.letta_sidecar.lock().map_err(|e| e.to_string())?;
    let running = sidecar.child.lock().map_err(|e| e.to_string())?.is_some();
    let url = sidecar
        .url
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .unwrap_or_default();
    Ok(LettaServerInfo { url, running })
}

#[tauri::command]
pub async fn letta_server_start(
    state: tauri::State<'_, AppState>,
) -> Result<LettaServerInfo, String> {
    // 先检查是否已运行（短暂持锁）
    {
        let sidecar = state.letta_sidecar.lock().map_err(|e| e.to_string())?;
        let running = sidecar.child.lock().map_err(|e| e.to_string())?.is_some();
        if running {
            let url = sidecar
                .url
                .lock()
                .map_err(|e| e.to_string())?
                .clone()
                .unwrap_or_default();
            return Ok(LettaServerInfo { url, running: true });
        }
    }

    // 同步启动 sidecar（在 spawn_blocking 中执行，避免 reqwest::blocking 在 tokio runtime 内 panic）
    let cache_dir = letta_sidecar::resolve_cache_dir().map_err(|e| e.replace('\\', "/"))?;
    let (child, url) = tokio::task::spawn_blocking(move || {
        letta_sidecar::start_sidecar(&cache_dir, 8283)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.replace('\\', "/"))?;

    // 短暂持锁写入 child/url
    {
        let sidecar = state.letta_sidecar.lock().map_err(|e| e.to_string())?;
        *sidecar.child.lock().map_err(|e| e.to_string())? = Some(child);
        *sidecar.url.lock().map_err(|e| e.to_string())? = Some(url.clone());
    }

    // 异步执行健康检查（不阻塞命令返回，失败只打日志不回滚，因为进程已启动）
    let health_url = url.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = letta_sidecar::health_check(&health_url, 60).await {
            eprintln!("[letta] health check failed: {}", e);
        }
    });

    Ok(LettaServerInfo {
        url,
        running: true,
    })
}

#[tauri::command]
pub async fn letta_server_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let sidecar = state.letta_sidecar.lock().map_err(|e| e.to_string())?;
    let child_opt = sidecar.child.lock().map_err(|e| e.to_string())?.take();
    if let Some(mut child) = child_opt {
        child
            .kill()
            .map_err(|e| e.to_string().replace('\\', "/"))?;
        let _ = child.wait();
    }
    *sidecar.url.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub async fn letta_setup() -> Result<(), String> {
    let cache_dir = letta_sidecar::resolve_cache_dir().map_err(|e| e.replace('\\', "/"))?;
    // 在 spawn_blocking 中执行同步的 Python 环境安装，避免 reqwest::blocking 在 tokio runtime 内 panic
    tokio::task::spawn_blocking(move || {
        letta_sidecar::ensure_python_env(&cache_dir)?;
        letta_sidecar::ensure_run_letta_script(&cache_dir)?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.replace('\\', "/"))?;
    Ok(())
}

#[tauri::command]
pub async fn letta_get_provider_detail(
    state: tauri::State<'_, AppState>,
    provider_id: i64,
) -> Result<ApiProviderDetail, String> {
    let row = sqlx::query(
        "SELECT id, name, provider_kind, base_url, api_key, model_name, max_tokens, max_context_tokens, temperature \
         FROM api_providers WHERE id = ?",
    )
    .bind(provider_id)
    .fetch_one(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(ApiProviderDetail {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        provider_kind: row.try_get("provider_kind").unwrap_or_default(),
        base_url: row.try_get("base_url").unwrap_or_default(),
        api_key: row.try_get("api_key").unwrap_or_default(),
        model_name: row.try_get("model_name").unwrap_or_default(),
        max_tokens: row.try_get("max_tokens").ok(),
        max_context_tokens: row.try_get("max_context_tokens").ok(),
        temperature: row.try_get("temperature").ok(),
    })
}

#[tauri::command]
pub async fn letta_save_agent_id(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    agent_id: String,
) -> Result<(), String> {
    sqlx::query("UPDATE conversations SET letta_agent_id = ? WHERE id = ?")
        .bind(agent_id)
        .bind(conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn letta_get_agent_id(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
) -> Result<Option<String>, String> {
    let agent_id: Option<String> =
        sqlx::query_scalar("SELECT letta_agent_id FROM conversations WHERE id = ?")
            .bind(conversation_id)
            .fetch_one(&state.db)
            .await
            .map_err(|err| err.to_string())?;
    Ok(agent_id)
}

#[tauri::command]
pub async fn letta_set_engine_kind(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    engine_kind: String,
) -> Result<(), String> {
    sqlx::query("UPDATE conversations SET engine_kind = ? WHERE id = ?")
        .bind(engine_kind)
        .bind(conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

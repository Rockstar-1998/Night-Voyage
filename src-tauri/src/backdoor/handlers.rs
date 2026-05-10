use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use sqlx::Row;
use tauri::Emitter;

use super::BackdoorState;
use crate::utils::now_ts;

pub async fn gc_handler(State(state): State<BackdoorState>) -> Json<serde_json::Value> {
    let before = get_process_memory_info();
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&state.db)
        .await
        .ok();
    sqlx::query("PRAGMA optimize").execute(&state.db).await.ok();
    let after = get_process_memory_info();
    eprintln!(
        "[backdoor] gc: before={} after={} freed={}",
        before
            .get("workingSetBytes")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        after
            .get("workingSetBytes")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        before
            .get("workingSetBytes")
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
            .saturating_sub(
                after
                    .get("workingSetBytes")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
            ),
    );
    Json(serde_json::json!({
        "before": before,
        "after": after,
    }))
}

pub async fn health_handler(State(state): State<BackdoorState>) -> Json<serde_json::Value> {
    let uptime_ms = state.startup_time.elapsed().as_millis() as u64;
    let memory_info = get_process_memory_info();
    Json(serde_json::json!({
        "status": "ready",
        "uptimeMs": uptime_ms,
        "memory": memory_info
    }))
}

fn get_process_memory_info() -> serde_json::Value {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::ProcessStatus::{
            GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
        };
        use windows::Win32::System::Threading::GetCurrentProcess;

        let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
        counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;

        unsafe {
            if GetProcessMemoryInfo(
                GetCurrentProcess(),
                &mut counters,
                std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            )
            .is_ok()
            {
                return serde_json::json!({
                    "workingSetBytes": counters.WorkingSetSize,
                    "peakWorkingSetBytes": counters.PeakWorkingSetSize,
                    "pageFaultCount": counters.PageFaultCount,
                });
            }
        }

        serde_json::json!({ "error": "get_memory_info_failed" })
    }

    #[cfg(not(target_os = "windows"))]
    {
        serde_json::json!({ "error": "unsupported_platform" })
    }
}

pub async fn providers_handler(State(state): State<BackdoorState>) -> Json<serde_json::Value> {
    let rows = sqlx::query("SELECT id, name, provider_kind, model_name FROM api_providers")
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    let providers: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<i64, _>("id").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "providerKind": row.try_get::<String, _>("provider_kind").unwrap_or_default(),
                "modelName": row.try_get::<String, _>("model_name").unwrap_or_default(),
            })
        })
        .collect();

    Json(serde_json::json!({ "providers": providers }))
}

#[derive(Deserialize)]
pub struct ChatTestRequest {
    #[serde(rename = "providerId")]
    pub provider_id: Option<i64>,
    #[serde(rename = "testMessage")]
    pub test_message: Option<String>,
}

pub async fn chat_test_handler(
    State(state): State<BackdoorState>,
    Json(body): Json<ChatTestRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let start = std::time::Instant::now();

    let _ = state.app.emit(
        "backdoor-chat-test-started",
        serde_json::json!({
            "testMessage": body.test_message.clone().unwrap_or_else(|| "ping".to_string()),
            "providerId": body.provider_id,
        }),
    );

    let providers = sqlx::query("SELECT id, name, provider_kind, model_name FROM api_providers")
        .fetch_all(&state.db)
        .await
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"ok": false, "error": "db_error"})),
            )
        })?;

    if providers.is_empty() {
        let _ = state.app.emit(
            "backdoor-chat-test-failed",
            serde_json::json!({"error": "no_api_provider"}),
        );
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": "no_api_provider"})),
        ));
    }

    let provider_id = if let Some(pid) = body.provider_id {
        let found = providers
            .iter()
            .any(|r| r.try_get::<i64, _>("id").unwrap_or_default() == pid);
        if !found {
            let _ = state.app.emit(
                "backdoor-chat-test-failed",
                serde_json::json!({"error": "provider_not_found"}),
            );
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"ok": false, "error": "provider_not_found"})),
            ));
        }
        pid
    } else {
        let mut chosen = None;
        for row in &providers {
            let name = row
                .try_get::<String, _>("name")
                .unwrap_or_default()
                .to_lowercase();
            let kind = row
                .try_get::<String, _>("provider_kind")
                .unwrap_or_default();
            if name.contains("kimi") || name.contains("moonshot") {
                chosen = Some(row.try_get::<i64, _>("id").unwrap_or_default());
                break;
            }
        }
        if chosen.is_none() {
            for row in &providers {
                let kind = row
                    .try_get::<String, _>("provider_kind")
                    .unwrap_or_default();
                if kind == "openai_compatible" {
                    chosen = Some(row.try_get::<i64, _>("id").unwrap_or_default());
                    break;
                }
            }
        }
        chosen.unwrap_or_else(|| providers[0].try_get::<i64, _>("id").unwrap_or_default())
    };

    let test_char_id: Option<i64> =
        sqlx::query_scalar("SELECT id FROM character_cards WHERE name = 'BackdoorTest' LIMIT 1")
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

    let test_char_id = match test_char_id {
        Some(id) => id,
        None => {
            let now = now_ts();
            let result = sqlx::query(
                "INSERT INTO character_cards (name, card_type, created_at, updated_at) VALUES ('BackdoorTest', 'npc', ?, ?)",
            )
            .bind(now)
            .bind(now)
            .execute(&state.db)
            .await
            .map_err(|e| {
                let _ = state.app.emit("backdoor-chat-test-failed", serde_json::json!({"error": "create_char_failed"}));
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"ok": false, "error": format!("create_char_failed: {}", e)})),
                )
            })?;
            result.last_insert_rowid()
        }
    };

    let test_message = body.test_message.unwrap_or_else(|| "ping".to_string());
    let now = now_ts();

    let mut tx = state.db.begin().await.map_err(|_| {
        let _ = state.app.emit(
            "backdoor-chat-test-failed",
            serde_json::json!({"error": "tx_begin_failed"}),
        );
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": "tx_begin_failed"})),
        )
    })?;

    let conv_result = sqlx::query(
        "INSERT INTO conversations (conversation_type, title, host_character_id, provider_id, chat_mode, agent_provider_policy, created_at, updated_at) VALUES ('single', 'BackdoorTest', ?, ?, 'classic', 'shared_host_provider', ?, ?)",
    )
    .bind(test_char_id)
    .bind(provider_id)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": format!("create_conv_failed: {}", e)})),
        )
    })?;
    let conversation_id = conv_result.last_insert_rowid();

    let member_result = sqlx::query(
        "INSERT INTO conversation_members (conversation_id, member_role, display_name, join_order, is_active, created_at, updated_at) VALUES (?, 'host', 'BackdoorTest', 0, 1, ?, ?)",
    )
    .bind(conversation_id)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": "create_member_failed"})),
        )
    })?;
    let host_member_id = member_result.last_insert_rowid();

    let round_result = sqlx::query(
        "INSERT INTO message_rounds (conversation_id, round_index, status, created_at, updated_at) VALUES (?, 1, 'collecting', ?, ?)",
    )
    .bind(conversation_id)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": "create_round_failed"})),
        )
    })?;
    let round_id = round_result.last_insert_rowid();

    let user_msg_result = sqlx::query(
        "INSERT INTO messages (conversation_id, round_id, member_id, role, message_kind, content, is_hidden, is_swipe, swipe_index, created_at) VALUES (?, ?, ?, 'user', 'user_visible', ?, 0, 0, 0, ?)",
    )
    .bind(conversation_id)
    .bind(round_id)
    .bind(host_member_id)
    .bind(&test_message)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": "insert_user_msg_failed"})),
        )
    })?;
    let _user_message_id = user_msg_result.last_insert_rowid();

    sqlx::query(
        "INSERT INTO round_member_actions (round_id, member_id, action_type, content, created_at, updated_at) VALUES (?, ?, 'spoken', ?, ?, ?)",
    )
    .bind(round_id)
    .bind(host_member_id)
    .bind(&test_message)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": "insert_action_failed"})),
        )
    })?;

    let aggregated_user_content = test_message.clone();

    let aggregate_msg_result = sqlx::query(
        "INSERT INTO messages (conversation_id, round_id, member_id, role, message_kind, content, is_hidden, is_swipe, swipe_index, created_at) VALUES (?, ?, NULL, 'user', 'user_aggregate', ?, 1, 0, 0, ?)",
    )
    .bind(conversation_id)
    .bind(round_id)
    .bind(&aggregated_user_content)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": "insert_aggregate_failed"})),
        )
    })?;
    let aggregate_message_id = aggregate_msg_result.last_insert_rowid();

    let assistant_msg_result = sqlx::query(
        "INSERT INTO messages (conversation_id, round_id, member_id, role, message_kind, content, is_hidden, is_swipe, swipe_index, reply_to_id, created_at) VALUES (?, ?, NULL, 'assistant', 'assistant_visible', '', 0, 0, 0, ?, ?)",
    )
    .bind(conversation_id)
    .bind(round_id)
    .bind(aggregate_message_id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": "insert_assistant_msg_failed"})),
        )
    })?;
    let assistant_message_id = assistant_msg_result.last_insert_rowid();

    sqlx::query(
        "UPDATE message_rounds SET status = 'streaming', aggregated_user_content = ?, aggregate_message_id = ?, active_assistant_message_id = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&aggregated_user_content)
    .bind(aggregate_message_id)
    .bind(assistant_message_id)
    .bind(now)
    .bind(round_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": "update_round_streaming_failed"})),
        )
    })?;

    sqlx::query("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(conversation_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"ok": false, "error": "update_conv_ts_failed"})),
            )
        })?;

    tx.commit().await.map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": "tx_commit_failed"})),
        )
    })?;

    crate::services::stream_processor::spawn_stream_task(
        state.app.clone(),
        state.db.clone(),
        conversation_id,
        round_id,
        provider_id,
        assistant_message_id,
        vec![],
    );

    let timeout = std::time::Duration::from_secs(60);
    let poll_interval = std::time::Duration::from_millis(500);
    let mut round_status = "streaming".to_string();
    let mut poll_error: Option<String> = None;

    let deadline = start + timeout;
    loop {
        if std::time::Instant::now() >= deadline {
            poll_error = Some("timeout".to_string());
            break;
        }

        tokio::time::sleep(poll_interval).await;

        match crate::repositories::round_repository::RoundRepository::load_state(
            &state.db,
            conversation_id,
            Some(round_id),
        )
        .await
        {
            Ok(round_state) => {
                round_status = round_state.status.clone();
                if round_status == "completed" || round_status == "failed" {
                    break;
                }
            }
            Err(e) => {
                poll_error = Some(e);
                break;
            }
        }
    }

    let mut assistant_content: Option<String> = None;
    if round_status == "completed" {
        if let Ok(row) = sqlx::query("SELECT content FROM messages WHERE id = ?")
            .bind(assistant_message_id)
            .fetch_one(&state.db)
            .await
        {
            assistant_content = row.try_get("content").ok();
        }
    }

    let total_ms = start.elapsed().as_millis() as u64;

    let ok = round_status == "completed" && poll_error.is_none();
    let error = poll_error.or_else(|| {
        if round_status == "failed" {
            Some("round_failed".to_string())
        } else if round_status != "completed" {
            Some("unexpected_status".to_string())
        } else {
            None
        }
    });

    let result_payload = serde_json::json!({
        "ok": ok,
        "conversationId": conversation_id,
        "roundId": round_id,
        "assistantMessageId": assistant_message_id,
        "assistantContent": assistant_content.clone().unwrap_or_default(),
        "totalMs": total_ms,
        "roundStatus": round_status,
        "error": error
    });

    if ok {
        let _ = state
            .app
            .emit("backdoor-chat-test-completed", &result_payload);
    } else {
        let _ = state.app.emit("backdoor-chat-test-failed", &result_payload);
    }

    let cleanup_db = state.db.clone();
    let cleanup_conversation_id = conversation_id;
    tauri::async_runtime::spawn(async move {
        cleanup_test_conversation(&cleanup_db, cleanup_conversation_id).await;
    });

    Ok(Json(result_payload))
}

async fn cleanup_test_conversation(db: &sqlx::SqlitePool, conversation_id: i64) {
    let round_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM message_rounds WHERE conversation_id = ?")
            .bind(conversation_id)
            .fetch_all(db)
            .await
            .unwrap_or_default();

    for round_id in &round_ids {
        let message_ids: Vec<i64> =
            sqlx::query_scalar("SELECT id FROM messages WHERE round_id = ?")
                .bind(round_id)
                .fetch_all(db)
                .await
                .unwrap_or_default();

        for message_id in &message_ids {
            let _ = sqlx::query("DELETE FROM message_content_parts WHERE message_id = ?")
                .bind(message_id)
                .execute(db)
                .await;
            let _ = sqlx::query("DELETE FROM message_tool_calls WHERE message_id = ?")
                .bind(message_id)
                .execute(db)
                .await;
        }

        let _ = sqlx::query("DELETE FROM messages WHERE round_id = ?")
            .bind(round_id)
            .execute(db)
            .await;

        let _ = sqlx::query("DELETE FROM round_member_actions WHERE round_id = ?")
            .bind(round_id)
            .execute(db)
            .await;
    }

    let agent_run_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM agent_runs WHERE conversation_id = ?")
            .bind(conversation_id)
            .fetch_all(db)
            .await
            .unwrap_or_default();

    for agent_run_id in &agent_run_ids {
        let _ = sqlx::query("DELETE FROM agent_drafts WHERE run_id = ?")
            .bind(agent_run_id)
            .execute(db)
            .await;
    }

    let _ = sqlx::query("DELETE FROM agent_runs WHERE conversation_id = ?")
        .bind(conversation_id)
        .execute(db)
        .await;

    let _ = sqlx::query("DELETE FROM character_state_overlays WHERE conversation_id = ?")
        .bind(conversation_id)
        .execute(db)
        .await;

    let _ = sqlx::query("DELETE FROM plot_summaries WHERE conversation_id = ?")
        .bind(conversation_id)
        .execute(db)
        .await;

    let _ = sqlx::query("DELETE FROM message_rounds WHERE conversation_id = ?")
        .bind(conversation_id)
        .execute(db)
        .await;

    let _ = sqlx::query("DELETE FROM conversation_members WHERE conversation_id = ?")
        .bind(conversation_id)
        .execute(db)
        .await;

    let _ = sqlx::query("DELETE FROM conversations WHERE id = ?")
        .bind(conversation_id)
        .execute(db)
        .await;

    eprintln!(
        "[backdoor] cleaned up test conversation {}",
        conversation_id
    );
}

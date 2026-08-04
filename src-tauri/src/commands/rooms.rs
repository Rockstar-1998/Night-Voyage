use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::{
    models::{ConversationListItem, ConversationMember, RoundState, TokenUsageReport, UiMessage},
    network::{GuestCharacterCardPayload, RoomClient, RoomMessage, RoomServer},
    repositories::conversation_repository::ConversationRepository,
    utils::now_ts,
    AppState,
};
use crate::dbg_eprintln;

// ─── Tauri Commands ───

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomCreateResult {
    pub room_id: i64,
    pub host_address: String,
    pub port: u32,
    pub alternative_addresses: Vec<String>,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomOpenResult {
    pub room_id: i64,
    pub host_address: String,
    pub port: u32,
    pub alternative_addresses: Vec<String>,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomStatusResult {
    pub room_id: Option<i64>,
    pub is_open: bool,
    pub port: Option<u32>,
    pub current_player_count: i64,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomJoinResult {
    pub success: bool,
    pub message: String,
    pub room_id: Option<i64>,
    pub member_id: Option<i64>,
    pub conversation: Option<ConversationListItem>,
    pub members: Vec<ConversationMember>,
    #[serde(alias = "recentMessages")]
    pub full_messages: Vec<UiMessage>,
    pub round_state: Option<RoundState>,
    #[serde(alias = "schemaToggleState")]
    pub schema_toggle_state: Option<HashMap<String, bool>>,
    pub context_window_size: Option<i64>,
    pub token_usage_report: Option<TokenUsageReport>,
    pub host_base_sections: Option<String>,
    pub host_preset_name: Option<String>,
    pub host_world_book_name: Option<String>,
    pub host_provider_name: Option<String>,
    pub host_character_image_base64: Option<String>,
    pub host_character_name: Option<String>,
    pub host_character_description: Option<String>,
    pub plot_summaries: Option<Vec<crate::models::PlotSummaryRecord>>,
}

#[tauri::command]
pub async fn room_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    room_name: String,
    conversation_id: i64,
    port: u32,
    passphrase: Option<String>,
) -> Result<RoomCreateResult, String> {
    let db = &state.db;
    let now = now_ts();

    if port == 0 || port > 65535 {
        return Err(format!(
            "端口 {} 超出 TCP 有效范围 (1-65535)，当前仅支持标准 TCP 端口",
            port
        ));
    }

    // 先关闭可能仍在运行的旧 server（不管关联哪个会话），避免端口被旧实例占用
    {
        let mut host_server = state.host_server.lock().await;
        if let Some(old_server) = host_server.take() {
            let mut server = old_server.lock().await;
            server.shutdown().await;
        }
    }

    // 防御性校验：会话必须真实存在，否则 rooms.conversation_id 外键会触发 787。
    // 这是 C2 零回退要求——不让 DB 抛晦涩的 FK 错误，而是返回明确语义错误。
    let conversation_exists: Option<bool> = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM conversations WHERE id = ?)",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?;
    if conversation_exists != Some(true) {
        let msg = format!(
            "创建房间失败：会话 {} 不存在或已被删除，无法绑定到房间（外键约束）",
            conversation_id
        );
        dbg_eprintln!("[room-create] rejected: {}", msg);
        return Err(msg);
    }

    // `stored_port` 在创建时与 `host_port` 一致，是房主后续可改的权威持久化端口。
    let room_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO rooms (room_name, host_address, conversation_id, max_players, host_port, stored_port, status, current_player_count, passphrase, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(&room_name)
    .bind("0.0.0.0")
    .bind(conversation_id)
    .bind(4i64)
    .bind(port as i64)
    .bind(port as i64)
    .bind("waiting")
    .bind(1i64)
    .bind(passphrase)
    .bind(now)
    .fetch_one(db)
    .await
    .map_err(|e| e.to_string())?;

    // Start TCP server
    let server = match RoomServer::start(room_id, port, app.clone(), state.db.clone()).await {
        Ok(server) => server,
        Err(error) => {
            if let Err(cleanup_error) = sqlx::query("DELETE FROM rooms WHERE id = ?")
                .bind(room_id)
                .execute(db)
                .await
            {
                dbg_eprintln!(
                    "[room-create] failed to clean up room {} after server start failure: {}",
                    room_id, cleanup_error
                );
            }
            return Err(error);
        }
    };

    // Store server in app state
    {
        let mut host_server = state.host_server.lock().await;
        *host_server = Some(server);
    }

    let all_ips = get_all_local_ips();
    let host_address = all_ips
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let alternative_addresses: Vec<String> = all_ips.into_iter().skip(1).collect();

    Ok(RoomCreateResult {
        room_id,
        host_address,
        port,
        alternative_addresses,
    })
}

#[tauri::command]
pub async fn room_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
) -> Result<RoomOpenResult, String> {
    let db = &state.db;

    // 先关闭可能仍在运行的旧 server（不管关联哪个会话），避免端口被旧实例占用
    {
        let mut host_server = state.host_server.lock().await;
        if let Some(old_server) = host_server.take() {
            let mut server = old_server.lock().await;
            server.shutdown().await;
        }
    }

    // 读取持久化端口：优先 stored_port，缺失（旧房间）回退 host_port。
    let room: Option<(i64, i64, i64, String)> = sqlx::query_as(
        "SELECT id, COALESCE(stored_port, host_port) AS effective_port, host_port, status FROM rooms WHERE conversation_id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?;

    let (room_id, effective_port, _host_port, _status) = room.ok_or_else(|| "房间不存在".to_string())?;

    sqlx::query(
        "DELETE FROM conversation_members WHERE conversation_id = ? AND join_order > 0",
    )
    .bind(conversation_id)
    .execute(db)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE rooms SET current_player_count = 1 WHERE id = ?")
        .bind(room_id)
        .execute(db)
        .await
        .map_err(|e| e.to_string())?;

    let server = RoomServer::start(room_id, effective_port as u32, app.clone(), db.clone()).await?;

    sqlx::query("UPDATE rooms SET status = 'waiting' WHERE id = ?")
        .bind(room_id)
        .execute(db)
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut host_server = state.host_server.lock().await;
        *host_server = Some(server);
    }

    let all_ips = get_all_local_ips();
    let host_address = all_ips
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let alternative_addresses: Vec<String> = all_ips.into_iter().skip(1).collect();

    Ok(RoomOpenResult {
        room_id,
        host_address,
        port: effective_port as u32,
        alternative_addresses,
    })
}

/// Host-side command: change the room port after creation.
///
/// Stops the currently running room server (if any, regardless of which
/// conversation it served), persists the new port into both `host_port` and
/// `stored_port`, then restarts the server on the new port. Guests are
/// disconnected by the shutdown and must rejoin using the new port.
///
/// C2 零回退：端口非法、房间不存在、server 启动失败都显式报错，不静默回退。
#[tauri::command]
pub async fn room_update_port(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    port: u32,
) -> Result<RoomOpenResult, String> {
    let db = &state.db;

    if port == 0 || port > 65535 {
        return Err(format!(
            "端口 {} 超出 TCP 有效范围 (1-65535)，当前仅支持标准 TCP 端口",
            port
        ));
    }

    let room: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM rooms WHERE conversation_id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?;

    let (room_id,) = room.ok_or_else(|| "房间不存在，无法修改端口".to_string())?;

    // 关闭可能仍在运行的旧 server（房主换端口必然要重启监听）。
    {
        let mut host_server = state.host_server.lock().await;
        if let Some(old_server) = host_server.take() {
            let mut server = old_server.lock().await;
            server.shutdown().await;
        }
    }

    // 持久化新端口：host_port 为运行端口，stored_port 为权威设置值。
    sqlx::query("UPDATE rooms SET host_port = ?, stored_port = ? WHERE id = ?")
        .bind(port as i64)
        .bind(port as i64)
        .bind(room_id)
        .execute(db)
        .await
        .map_err(|e| e.to_string())?;

    let server = match RoomServer::start(room_id, port, app.clone(), db.clone()).await {
        Ok(server) => server,
        Err(error) => {
            dbg_eprintln!(
                "[room-update-port] failed to restart server on port {} for room {}: {}",
                port, room_id, error
            );
            return Err(error);
        }
    };

    sqlx::query("UPDATE rooms SET status = 'waiting' WHERE id = ?")
        .bind(room_id)
        .execute(db)
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut host_server = state.host_server.lock().await;
        *host_server = Some(server);
    }

    let all_ips = get_all_local_ips();
    let host_address = all_ips
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let alternative_addresses: Vec<String> = all_ips.into_iter().skip(1).collect();

    Ok(RoomOpenResult {
        room_id,
        host_address,
        port,
        alternative_addresses,
    })
}

#[tauri::command]
pub async fn room_join(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    host_address: String,
    port: u32,
    display_name: String,
    character: Option<GuestCharacterCardPayload>,
) -> Result<RoomJoinResult, String> {
    let mut client = RoomClient::new(host_address, port, display_name, character);

    match client.connect(app.clone()).await {
        Ok(session) => {
            // Store client in app state
            let mut room_client = state.room_client.lock().await;
            *room_client = Some(Arc::new(Mutex::new(client)));

            Ok(RoomJoinResult {
                success: true,
                message: "连接成功".to_string(),
                room_id: Some(session.room_id),
                member_id: Some(session.member_id),
                conversation: Some(*session.conversation),
                members: session.members,
                full_messages: session.full_messages,
                round_state: Some(session.round_state),
                schema_toggle_state: session.schema_toggle_state,
                context_window_size: session.context_window_size,
                token_usage_report: session.token_usage_report,
                host_base_sections: session.host_base_sections,
                host_preset_name: session.host_preset_name,
                host_world_book_name: session.host_world_book_name,
                host_provider_name: session.host_provider_name,
                host_character_image_base64: session.host_character_image_base64,
                host_character_name: session.host_character_name,
                host_character_description: session.host_character_description,
                plot_summaries: session.plot_summaries,
            })
        }
        Err(e) => Ok(RoomJoinResult {
            success: false,
            message: e,
            room_id: None,
            member_id: None,
            conversation: None,
            members: Vec::new(),
            full_messages: Vec::new(),
            round_state: None,
            schema_toggle_state: None,
            context_window_size: None,
            token_usage_report: None,
            host_base_sections: None,
            host_preset_name: None,
            host_world_book_name: None,
            host_provider_name: None,
            host_character_image_base64: None,
            host_character_name: None,
            host_character_description: None,
            plot_summaries: None,
        }),
    }
}

#[tauri::command]
pub async fn room_leave(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut room_client = state.room_client.lock().await;
    if let Some(client) = room_client.take() {
        let mut client = client.lock().await;
        client.disconnect().await;
    }
    Ok(())
}

async fn close_all_rooms(state: &AppState) -> Result<(), String> {
    {
        let mut host_server = state.host_server.lock().await;
        if let Some(server) = host_server.take() {
            let mut server = server.lock().await;
            server.shutdown().await;
        }
    }

    let db = &state.db;

    let rooms_to_close: Vec<(i64, i64)> = sqlx::query_as::<_, (i64, i64)>(
        "SELECT id, conversation_id FROM rooms WHERE status != 'closed'",
    )
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;

    for (room_id, conversation_id) in &rooms_to_close {
        if let Err(e) = sqlx::query(
            "DELETE FROM conversation_members WHERE conversation_id = ? AND join_order > 0",
        )
        .bind(conversation_id)
        .execute(db)
        .await
        {
            dbg_eprintln!(
                "[room-close] failed to clean members for room {}: {}",
                room_id, e
            );
        }

        if let Err(e) = sqlx::query(
            "UPDATE rooms SET status = 'closed', current_player_count = 1 WHERE id = ?",
        )
        .bind(room_id)
        .execute(db)
        .await
        {
            dbg_eprintln!(
                "[room-close] failed to close room {}: {}",
                room_id, e
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn room_close(state: tauri::State<'_, AppState>) -> Result<(), String> {
    close_all_rooms(&state).await
}

#[tauri::command]
pub async fn room_get_status(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
) -> Result<RoomStatusResult, String> {
    let db = &state.db;

    // 始终返回房间端口（stored_port 优先，回退 host_port），便于房主在房间设置里
    // 展示并可修改端口，即使房间当前未开启。
    let room: Option<(i64, i64, String, i64)> = sqlx::query_as(
        "SELECT id, COALESCE(stored_port, host_port) AS effective_port, status, current_player_count FROM rooms WHERE conversation_id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?;

    let Some((room_id, effective_port, _db_status, current_player_count)) = room else {
        return Ok(RoomStatusResult {
            room_id: None,
            is_open: false,
            port: None,
            current_player_count: 0,
        });
    };

    let is_open = {
        let host_server = state.host_server.lock().await;
        if let Some(server) = host_server.as_ref() {
            let server = server.lock().await;
            server.room_id == room_id
        } else {
            false
        }
    };

    Ok(RoomStatusResult {
        room_id: Some(room_id),
        is_open,
        port: Some(effective_port as u32),
        current_player_count: if is_open { current_player_count } else { 1 },
    })
}

#[tauri::command]
pub async fn room_send_message(
    state: tauri::State<'_, AppState>,
    content: String,
    action_type: String,
    display_name: String,
    member_id: i64,
) -> Result<(), String> {
    let room_client = state.room_client.lock().await;
    if let Some(client) = room_client.as_ref() {
        let mut client = client.lock().await;
        let msg = RoomMessage::PlayerMessage {
            member_id,
            display_name,
            content,
            action_type,
            conversation_id: None,
            round_id: None,
            message_id: None,
        };
        client.send_message(&msg).await
    } else {
        Err("未连接到房间".to_string())
    }
}

// Stream lifecycle broadcasts (stream_chunk / stream_end / stream_retry /
// message_reset) are now emitted solely by the backend (chat_service.rs +
// stream_processor.rs) via host_server.broadcast_message. The frontend no
// longer triggers room_broadcast_stream_* commands, so they have been removed.

#[tauri::command]
pub async fn room_broadcast_round_state(
    state: tauri::State<'_, AppState>,
    round_state: RoundState,
) -> Result<(), String> {
    let host_server = state.host_server.lock().await;
    if let Some(server) = host_server.as_ref() {
        let server = server.lock().await;
        let msg = RoomMessage::RoundStateUpdate { round_state };
        server.broadcast_message(&msg).await;
        Ok(())
    } else {
        Err("房主服务器未启动".to_string())
    }
}

/// Host-side command: persist the schema toggle state in the room server's
/// in-memory map and broadcast a `SchemaToggle` event to all connected
/// guests. Single-player mode never invokes this (no room server running).
///
/// IPC error strings use forward slashes to stay JSON-safe across Windows
/// paths, per the project Rust style rules.
#[tauri::command]
pub async fn room_broadcast_schema_toggle(
    state: tauri::State<'_, AppState>,
    toggle_key: String,
    expanded: bool,
) -> Result<(), String> {
    let host_server = state.host_server.lock().await;
    let Some(server_arc) = host_server.as_ref() else {
        return Err("房主服务器未启动".to_string());
    };
    let server = server_arc.lock().await;
    let room_id = server.room_id;
    let conversation_id: i64 = sqlx::query_scalar(
        "SELECT conversation_id FROM rooms WHERE id = ? LIMIT 1",
    )
    .bind(room_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string().replace('\\', "/"))?
    .ok_or_else(|| "房主房间不存在或已关闭".to_string())?;
    server
        .update_schema_toggle(conversation_id, toggle_key, expanded)
        .await;
    Ok(())
}

/// Host-side command: compile a fresh `TokenUsageReport` for the given
/// conversation and broadcast it to all connected room guests as a
/// `RoomMessage::TokenUsage`. Called by the host after a stream round
/// finishes so guests can refresh their token-usage island.
///
/// Single-player mode never has a room server running, so this command
/// returns `Err("房主服务器未启动")` there — it is only invoked from the
/// host-side stream-end path and has no single-player call site.
///
/// IPC error strings use forward slashes to stay JSON-safe across Windows
/// paths, per the project Rust style rules.
#[tauri::command]
pub async fn room_broadcast_token_usage(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
) -> Result<(), String> {
    let report = crate::services::prompt_compiler::compile_token_usage_report(
        &state.db,
        conversation_id,
    )
    .await
    .map_err(|err| err.to_string().replace('\\', "/"))?;

    let host_server = state.host_server.lock().await;
    let Some(server_arc) = host_server.as_ref() else {
        return Err("房主服务器未启动".to_string());
    };
    let server = server_arc.lock().await;
    let msg = RoomMessage::TokenUsage {
        conversation_id,
        report,
    };
    server.broadcast_message(&msg).await;
    Ok(())
}

/// Host-side command: load the current `PlotSummaryRecord` list for the
/// given conversation and broadcast it to all connected room guests as a
/// `RoomMessage::PlotSummaryUpdate`. Called by the host after plot summary
/// upsert/delete so guests can refresh their sidebar.
///
/// Single-player mode never has a room server running, so this command
/// returns `Err("房主服务器未启动")` there — it is only invoked from the
/// host-side plot summary mutation paths and has no single-player call site.
///
/// IPC error strings use forward slashes to stay JSON-safe across Windows
/// paths, per the project Rust style rules.
#[tauri::command]
pub async fn room_broadcast_plot_summary(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
) -> Result<(), String> {
    let summaries = crate::services::plot_summaries::list_plot_summaries(
        &state.db,
        conversation_id,
    )
    .await
    .map_err(|err| err.to_string().replace('\\', "/"))?;

    let host_server = state.host_server.lock().await;
    let Some(server_arc) = host_server.as_ref() else {
        return Err("房主服务器未启动".to_string());
    };
    let server = server_arc.lock().await;
    let msg = RoomMessage::PlotSummaryUpdate {
        conversation_id,
        summaries,
    };
    server.broadcast_message(&msg).await;
    Ok(())
}

/// Guest-side command: update the caller's own guest character card.
///
/// In guest mode (room_client connected), sends an `UpdateGuestCharacter`
/// message to the host's RoomServer over TCP. The host then persists the
/// update to its DB and broadcasts `GuestCharacterUpdated` to all clients.
///
/// In host mode (host_server running, used as fallback), persists directly
/// to the local DB and broadcasts `GuestCharacterUpdated` immediately.
///
/// Does NOT call `ensure_member_is_host` — guests update their own card.
///
/// IPC error strings use forward slashes to stay JSON-safe across Windows
/// paths, per the project Rust style rules.
#[tauri::command]
pub async fn room_update_guest_character(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    member_id: i64,
    character: GuestCharacterCardPayload,
) -> Result<(), String> {
    let json = serde_json::to_string(&character)
        .map_err(|err| err.to_string().replace('\\', "/"))?;

    if json.len() > 256 * 1024 {
        return Err("角色卡数据过大（超过 256KB），请精简后重试".to_string());
    }

    let room_client_guard = state.room_client.lock().await;
    if let Some(room_client) = room_client_guard.as_ref() {
        let mut client = room_client.lock().await;
        let msg = RoomMessage::UpdateGuestCharacter {
            member_id,
            character: character.clone(),
        };
        client.send_message(&msg).await?;
        return Ok(());
    }
    drop(room_client_guard);

    let host_server = state.host_server.lock().await;
    if let Some(server) = host_server.as_ref() {
        let server = server.lock().await;
        ConversationRepository::update_guest_character_json(&state.db, member_id, &json)
            .await
            .map_err(|err| err.to_string().replace('\\', "/"))?;
        let msg = RoomMessage::GuestCharacterUpdated {
            conversation_id,
            member_id,
            character: character.clone(),
        };
        server.broadcast_message(&msg).await;
        return Ok(());
    }

    Err("当前既非房客也非房主模式，无法更新角色卡".to_string())
}

/// Asks the host (when the local app is the guest) for a fresh
/// `ContextSnapshot` covering the full message history, member list, and
/// round state of the conversation we are connected to. Returns
/// `Err("未连接到房间".to_string())` when there is no active room client.
#[tauri::command]
pub async fn room_request_context(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let room_client = state.room_client.lock().await;
    let Some(client_arc) = room_client.as_ref() else {
        return Err("未连接到房间".to_string());
    };
    let mut client = client_arc.lock().await;

    let Some(room_id) = client.room_id else {
        return Err("未连接到房间".to_string());
    };

    let conversation_id: i64 = sqlx::query_scalar(
        "SELECT conversation_id FROM rooms WHERE id = ? LIMIT 1",
    )
    .bind(room_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?
    .ok_or_else(|| "加入失败：房间不存在或已关闭".to_string())?;

    let snapshot = crate::services::chat_service::build_context_snapshot(
        &state.db,
        conversation_id,
        &app,
        None,
    )
    .await?;

    client.send_message(&snapshot).await
}

/// Guest-side command: persist a room join record so the guest can rejoin
/// after a restart without re-typing the host IP + port.
///
/// Records are keyed by `conversationId` (the host room's conversation id,
/// carried by `RoomJoinResult.conversation.id`) and stored in the local
/// `settings` table under `room_guest_history:<conversationId>`. Only the
/// most recent `RoomGuestHistoryEntry` per conversation is kept; an optional
/// `displayName` is stored to pre-fill the join form.
///
/// C2 零回退：序列化失败显式报错，不静默丢弃。
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomGuestHistoryEntry {
    pub conversation_id: i64,
    pub host_address: String,
    pub port: u32,
    pub display_name: String,
    pub updated_at: i64,
}

#[tauri::command]
pub async fn room_save_guest_history(
    state: tauri::State<'_, AppState>,
    entry: RoomGuestHistoryEntry,
) -> Result<(), String> {
    let mut history = load_guest_history(&state).await;

    // 同一 conversation_id 只保留最新一条记录（覆盖更新）。
    history.retain(|item| item.conversation_id != entry.conversation_id);
    history.push(entry);

    let json = serde_json::to_string(&history)
        .map_err(|err| err.to_string().replace('\\', "/"))?;

    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("room_guest_history")
    .bind(json)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string().replace('\\', "/"))?;

    Ok(())
}

#[tauri::command]
pub async fn room_get_guest_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RoomGuestHistoryEntry>, String> {
    Ok(load_guest_history(&state).await)
}

async fn load_guest_history(state: &AppState) -> Vec<RoomGuestHistoryEntry> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT value FROM settings WHERE key = ? LIMIT 1",
    )
    .bind("room_guest_history")
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string().replace('\\', "/"))
    .unwrap_or(None);

    let Some((json,)) = row else {
        return Vec::new();
    };

    serde_json::from_str::<Vec<RoomGuestHistoryEntry>>(&json)
        .map_err(|err| err.to_string().replace('\\', "/"))
        .unwrap_or_default()
}

// ─── Helpers ───

fn try_udp_local_ip(target: &str) -> Option<String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect(target).ok()?;
    let local_addr = socket.local_addr().ok()?;
    Some(local_addr.ip().to_string())
}

fn is_rfc1918(ip_str: &str) -> bool {
    use std::net::IpAddr;
    let Ok(ip) = ip_str.parse::<IpAddr>() else {
        return false;
    };
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            octets[0] == 10
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168)
        }
        IpAddr::V6(_) => false,
    }
}

fn get_all_local_ips() -> Vec<String> {
    use std::collections::HashSet;
    let mut ips = Vec::new();
    let mut seen = HashSet::new();

    let targets = ["8.8.8.8:80", "1.1.1.1:80"];
    for target in &targets {
        if let Some(ip) = try_udp_local_ip(target) {
            if seen.insert(ip.clone()) {
                ips.push(ip);
            }
        }
    }

    let gateways = [
        "192.168.1.1:80",
        "192.168.0.1:80",
        "10.0.0.1:80",
        "172.16.0.1:80",
        "192.168.2.1:80",
        "10.1.1.1:80",
    ];
    for gateway in &gateways {
        if let Some(ip) = try_udp_local_ip(gateway) {
            if is_rfc1918(&ip) && seen.insert(ip.clone()) {
                ips.push(ip);
            }
        }
    }

    ips.sort_by(|a, b| {
        let a_private = is_rfc1918(a);
        let b_private = is_rfc1918(b);
        b_private.cmp(&a_private)
    });

    ips
}

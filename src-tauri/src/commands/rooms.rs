use std::sync::Arc;
use tokio::sync::Mutex;

use crate::{
    models::{ConversationListItem, ConversationMember, RoundState, UiMessage},
    network::{RoomClient, RoomMessage, RoomServer},
    utils::now_ts,
    AppState,
};

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
pub struct RoomJoinResult {
    pub success: bool,
    pub message: String,
    pub room_id: Option<i64>,
    pub member_id: Option<i64>,
    pub conversation: Option<ConversationListItem>,
    pub members: Vec<ConversationMember>,
    pub recent_messages: Vec<UiMessage>,
    pub round_state: Option<RoundState>,
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

    // Insert room record
    let room_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO rooms (room_name, host_address, conversation_id, max_players, host_port, status, current_player_count, passphrase, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(&room_name)
    .bind("0.0.0.0")
    .bind(conversation_id)
    .bind(4i64)
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
                eprintln!(
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
pub async fn room_join(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    host_address: String,
    port: u32,
    display_name: String,
) -> Result<RoomJoinResult, String> {
    let mut client = RoomClient::new(host_address, port, display_name);

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
                conversation: Some(session.conversation),
                members: session.members,
                recent_messages: session.recent_messages,
                round_state: Some(session.round_state),
            })
        }
        Err(e) => Ok(RoomJoinResult {
            success: false,
            message: e,
            room_id: None,
            member_id: None,
            conversation: None,
            members: Vec::new(),
            recent_messages: Vec::new(),
            round_state: None,
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

#[tauri::command]
pub async fn room_close(state: tauri::State<'_, AppState>) -> Result<(), String> {
    // Shutdown server
    {
        let mut host_server = state.host_server.lock().await;
        if let Some(server) = host_server.take() {
            let mut server = server.lock().await;
            server.shutdown().await;
        }
    }

    // Update room status in DB
    let db = &state.db;
    let _ = sqlx::query("UPDATE rooms SET status = 'closed' WHERE status != 'closed'")
        .execute(db)
        .await;

    Ok(())
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

#[tauri::command]
pub async fn room_broadcast_stream_chunk(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    round_id: i64,
    message_id: i64,
    delta: String,
    done: bool,
) -> Result<(), String> {
    let host_server = state.host_server.lock().await;
    if let Some(server) = host_server.as_ref() {
        let server = server.lock().await;
        let msg = RoomMessage::StreamChunk {
            conversation_id,
            round_id,
            message_id,
            delta,
            done,
        };
        server.broadcast_message(&msg).await;
        Ok(())
    } else {
        Err("房主服务器未启动".to_string())
    }
}

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

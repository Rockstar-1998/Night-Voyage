use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::{timeout, Duration};

use crate::models::{ConversationListItem, ConversationMember, RoundState, UiMessage};
use crate::repositories::round_repository::RoundRepository;
use crate::services::chat_service::ChatService;

// ─── Protocol ───

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type", content = "payload")]
pub enum RoomMessage {
    JoinRoom {
        display_name: String,
        passphrase: Option<String>,
    },
    JoinSuccess {
        room_id: i64,
        member_id: i64,
        conversation: ConversationListItem,
        members: Vec<ConversationMember>,
        recent_messages: Vec<UiMessage>,
        round_state: RoundState,
    },
    MemberJoined {
        member_id: i64,
        display_name: String,
    },
    MemberLeft {
        member_id: i64,
        display_name: String,
    },
    PlayerMessage {
        member_id: i64,
        display_name: String,
        content: String,
        action_type: String,
        conversation_id: Option<i64>,
        round_id: Option<i64>,
        message_id: Option<i64>,
    },
    RoundStateUpdate {
        round_state: crate::models::RoundState,
    },
    StreamChunk {
        conversation_id: i64,
        round_id: i64,
        message_id: i64,
        delta: String,
        done: bool,
    },
    StreamEnd {
        conversation_id: i64,
        round_id: i64,
        message_id: i64,
    },
    RoomClosed {
        reason: String,
    },
    Error {
        code: String,
        message: String,
    },
}

// ─── Flat Event Payloads for Tauri Emissions ───
// RoomMessage uses #[serde(tag = "type", content = "payload")] for the TCP wire protocol,
// but Tauri events need flat payloads so the frontend can deserialize them correctly.

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemberJoinedPayload {
    pub member_id: i64,
    pub display_name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemberLeftPayload {
    pub member_id: i64,
    pub display_name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayerMessagePayload {
    pub member_id: i64,
    pub display_name: String,
    pub content: String,
    pub action_type: String,
    pub conversation_id: Option<i64>,
    pub round_id: Option<i64>,
    pub message_id: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunkPayload {
    pub conversation_id: i64,
    pub round_id: i64,
    pub message_id: i64,
    pub delta: String,
    pub done: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamEndPayload {
    pub conversation_id: i64,
    pub round_id: i64,
    pub message_id: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomClosedPayload {
    pub reason: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoundStateUpdatePayload {
    pub round_state: crate::models::RoundState,
}

impl RoomMessage {
    /// Map this message to the Tauri event name used on the frontend.
    pub fn event_name(&self) -> &'static str {
        match self {
            RoomMessage::MemberJoined { .. } => "room:member_joined",
            RoomMessage::MemberLeft { .. } => "room:member_left",
            RoomMessage::PlayerMessage { .. } => "room:player_message",
            RoomMessage::RoundStateUpdate { .. } => "room:round_state_update",
            RoomMessage::StreamChunk { .. } => "room:stream_chunk",
            RoomMessage::StreamEnd { .. } => "room:stream_end",
            RoomMessage::RoomClosed { .. } => "room:room_closed",
            RoomMessage::Error { .. } => "room:error",
            _ => "room:message",
        }
    }

    /// Extract a flat event payload suitable for Tauri event emission.
    /// This avoids the tagged-enum wrapping ({type, payload}) that breaks frontend deserialization.
    pub fn event_payload(&self) -> Option<serde_json::Value> {
        match self {
            RoomMessage::MemberJoined {
                member_id,
                display_name,
            } => serde_json::to_value(MemberJoinedPayload {
                member_id: *member_id,
                display_name: display_name.clone(),
            })
            .ok(),
            RoomMessage::MemberLeft {
                member_id,
                display_name,
            } => serde_json::to_value(MemberLeftPayload {
                member_id: *member_id,
                display_name: display_name.clone(),
            })
            .ok(),
            RoomMessage::PlayerMessage {
                member_id,
                display_name,
                content,
                action_type,
                conversation_id,
                round_id,
                message_id,
            } => serde_json::to_value(PlayerMessagePayload {
                member_id: *member_id,
                display_name: display_name.clone(),
                content: content.clone(),
                action_type: action_type.clone(),
                conversation_id: *conversation_id,
                round_id: *round_id,
                message_id: *message_id,
            })
            .ok(),
            RoomMessage::StreamChunk {
                conversation_id,
                round_id,
                message_id,
                delta,
                done,
            } => serde_json::to_value(StreamChunkPayload {
                conversation_id: *conversation_id,
                round_id: *round_id,
                message_id: *message_id,
                delta: delta.clone(),
                done: *done,
            })
            .ok(),
            RoomMessage::StreamEnd {
                conversation_id,
                round_id,
                message_id,
            } => serde_json::to_value(StreamEndPayload {
                conversation_id: *conversation_id,
                round_id: *round_id,
                message_id: *message_id,
            })
            .ok(),
            RoomMessage::RoomClosed { reason } => serde_json::to_value(RoomClosedPayload {
                reason: reason.clone(),
            })
            .ok(),
            RoomMessage::Error { code, message } => serde_json::to_value(ErrorPayload {
                code: code.clone(),
                message: message.clone(),
            })
            .ok(),
            RoomMessage::RoundStateUpdate { round_state } => {
                serde_json::to_value(RoundStateUpdatePayload {
                    round_state: round_state.clone(),
                })
                .ok()
            }
            _ => None,
        }
    }
}

/// Frame protocol: 4-byte big-endian length prefix + JSON payload
pub async fn write_frame(stream: &mut TcpStream, msg: &RoomMessage) -> Result<(), String> {
    let json = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    let len = json.len() as u32;
    stream
        .write_all(&len.to_be_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stream.write_all(&json).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn write_frame_split(
    write_half: &mut tokio::net::tcp::OwnedWriteHalf,
    msg: &RoomMessage,
) -> Result<(), String> {
    let json = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    let len = json.len() as u32;
    write_half
        .write_all(&len.to_be_bytes())
        .await
        .map_err(|e| e.to_string())?;
    write_half
        .write_all(&json)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn read_frame_split(
    read_half: &mut tokio::net::tcp::OwnedReadHalf,
) -> Result<Option<RoomMessage>, String> {
    let mut len_bytes = [0u8; 4];
    match read_half.read_exact(&mut len_bytes).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.to_string()),
    }
    let len = u32::from_be_bytes(len_bytes) as usize;
    if len > 8 * 1024 * 1024 {
        return Err("Frame too large".to_string());
    }
    let mut buf = vec![0u8; len];
    read_half
        .read_exact(&mut buf)
        .await
        .map_err(|e| e.to_string())?;
    let msg: RoomMessage = serde_json::from_slice(&buf).map_err(|e| e.to_string())?;
    Ok(Some(msg))
}

async fn write_error_frame(stream: &mut TcpStream, code: &str, message: impl Into<String>) {
    let message = message.into();
    if let Err(error) = write_frame(
        stream,
        &RoomMessage::Error {
            code: code.to_string(),
            message: message.clone(),
        },
    )
    .await
    {
        eprintln!(
            "[room-server] failed to send error response code={} message={} write_error={}",
            code, message, error
        );
    }
}

async fn rollback_joined_member(
    db: &SqlitePool,
    room_id: i64,
    member_id: i64,
    decrement_room_count: bool,
) {
    if member_id > 0 {
        if let Err(error) = sqlx::query("DELETE FROM conversation_members WHERE id = ?")
            .bind(member_id)
            .execute(db)
            .await
        {
            eprintln!(
                "[room-server] failed to roll back member {} after join failure: {}",
                member_id, error
            );
        }
    }

    if decrement_room_count {
        if let Err(error) = sqlx::query(
            "UPDATE rooms SET current_player_count = current_player_count - 1 WHERE id = ? AND current_player_count > 0",
        )
        .bind(room_id)
        .execute(db)
        .await
        {
            eprintln!(
                "[room-server] failed to roll back room player count for room {}: {}",
                room_id, error
            );
        }
    }
}

#[derive(Clone, Debug)]
pub struct RoomJoinSession {
    pub room_id: i64,
    pub member_id: i64,
    pub conversation: ConversationListItem,
    pub members: Vec<ConversationMember>,
    pub recent_messages: Vec<UiMessage>,
    pub round_state: RoundState,
}

fn normalize_optional_positive_id(value: Option<i64>) -> Option<i64> {
    value.filter(|id| *id > 0)
}

async fn load_conversation_summary(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<ConversationListItem, String> {
    let row = sqlx::query(
        "SELECT id, conversation_type, title, host_character_id, world_book_id, preset_id, \
         provider_id, chat_mode, agent_provider_policy, plot_summary_mode, created_at, updated_at \
         FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    let member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ? AND is_active = 1",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    let pending_member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ? AND is_active = 0",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(ConversationListItem {
        id: row.try_get("id").unwrap_or(conversation_id),
        conversation_type: row
            .try_get("conversation_type")
            .unwrap_or_else(|_| "online".to_string()),
        title: row.try_get("title").ok(),
        host_character_id: row.try_get("host_character_id").ok(),
        world_book_id: row.try_get("world_book_id").ok(),
        preset_id: normalize_optional_positive_id(row.try_get("preset_id").ok()),
        provider_id: row.try_get("provider_id").ok(),
        chat_mode: row
            .try_get("chat_mode")
            .unwrap_or_else(|_| "classic".to_string()),
        agent_provider_policy: row
            .try_get("agent_provider_policy")
            .unwrap_or_else(|_| "shared_host_provider".to_string()),
        plot_summary_mode: row
            .try_get("plot_summary_mode")
            .unwrap_or_else(|_| "ai".to_string()),
        member_count,
        pending_member_count,
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    })
}

async fn load_active_conversation_members(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<Vec<ConversationMember>, String> {
    let rows = sqlx::query(
        "SELECT id, conversation_id, member_role, display_name, player_character_id, \
         join_order, is_active, created_at, updated_at \
         FROM conversation_members \
         WHERE conversation_id = ? AND is_active = 1 \
         ORDER BY join_order ASC",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| ConversationMember {
            id: row.try_get("id").unwrap_or_default(),
            conversation_id: row.try_get("conversation_id").unwrap_or(conversation_id),
            member_role: row
                .try_get("member_role")
                .unwrap_or_else(|_| "member".to_string()),
            display_name: row.try_get("display_name").unwrap_or_default(),
            player_character_id: row.try_get("player_character_id").ok(),
            join_order: row.try_get("join_order").unwrap_or_default(),
            is_active: row
                .try_get::<i64, _>("is_active")
                .map(|value| value != 0)
                .unwrap_or(true),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        })
        .collect())
}

pub async fn read_frame(stream: &mut TcpStream) -> Result<Option<RoomMessage>, String> {
    let mut len_bytes = [0u8; 4];
    match stream.read_exact(&mut len_bytes).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.to_string()),
    }
    let len = u32::from_be_bytes(len_bytes) as usize;
    if len > 8 * 1024 * 1024 {
        return Err("Frame too large".to_string());
    }
    let mut buf = vec![0u8; len];
    stream
        .read_exact(&mut buf)
        .await
        .map_err(|e| e.to_string())?;
    let msg: RoomMessage = serde_json::from_slice(&buf).map_err(|e| e.to_string())?;
    Ok(Some(msg))
}

// ─── RoomServer (Host) ───

#[derive(Clone)]
struct ClientHandle {
    tx: mpsc::UnboundedSender<RoomMessage>,
    display_name: String,
    db_member_id: i64,
}

pub struct RoomServer {
    pub room_id: i64,
    pub port: u32,
    clients: Arc<RwLock<HashMap<i64, ClientHandle>>>,
    next_client_id: Arc<Mutex<i64>>,
    shutdown_tx: Option<mpsc::Sender<()>>,
    db: SqlitePool,
}

impl RoomServer {
    pub async fn start(
        room_id: i64,
        port: u32,
        app_handle: tauri::AppHandle,
        db: SqlitePool,
    ) -> Result<Arc<Mutex<Self>>, String> {
        // Validate port fits in TCP range (1-65535); future custom protocols may extend this
        if port == 0 || port > 65535 {
            return Err(format!(
                "端口 {} 超出 TCP 有效范围 (1-65535)，当前仅支持标准 TCP 端口",
                port
            ));
        }
        let tcp_port = port as u16;
        let listener = TcpListener::bind(("0.0.0.0", tcp_port))
            .await
            .map_err(|e| format!("Failed to bind to port {}: {}", port, e))?;

        let clients: Arc<RwLock<HashMap<i64, ClientHandle>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let next_client_id = Arc::new(Mutex::new(1i64));
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

        let server = Arc::new(Mutex::new(RoomServer {
            room_id,
            port,
            clients: clients.clone(),
            next_client_id: next_client_id.clone(),
            shutdown_tx: Some(shutdown_tx),
            db: db.clone(),
        }));

        let db_for_accept_loop = db.clone();
        let room_id_for_accept_loop = room_id;
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    Ok((mut stream, addr)) = listener.accept() => {
                        let clients = clients.clone();
                        let next_client_id = next_client_id.clone();
                        let app_handle = app_handle.clone();

                        let db_inner = db_for_accept_loop.clone();
                        let room_id_inner = room_id_for_accept_loop;
                        tauri::async_runtime::spawn(async move {
                            eprintln!("[room-server] accepted client {} for room {}", addr, room_id_inner);
                            let client_id = {
                                let mut id = next_client_id.lock().await;
                                let v = *id;
                                *id += 1;
                                v
                            };

                            // Max 3 clients (host + 3 = 4 total)
                            {
                                let c = clients.read().await;
                                if c.len() >= 3 {
                                    write_error_frame(&mut stream, "ROOM_FULL", "房间已满").await;
                                    return;
                                }
                            }

                            // Handle first message (JoinRoom)
                            let display_name = match read_frame(&mut stream).await {
                                Ok(Some(RoomMessage::JoinRoom { display_name, .. })) => display_name,
                                Ok(Some(other)) => {
                                    eprintln!("[room-server] invalid first room message from {}: {:?}", addr, other);
                                    write_error_frame(&mut stream, "INVALID_JOIN", "加入失败：首个消息不是加入房间请求").await;
                                    return;
                                }
                                Ok(None) => {
                                    eprintln!("[room-server] client {} closed before join message", addr);
                                    return;
                                }
                                Err(error) => {
                                    eprintln!("[room-server] failed to read join message from {}: {}", addr, error);
                                    write_error_frame(&mut stream, "INVALID_JOIN", format!("加入失败：读取加入请求失败: {}", error)).await;
                                    return;
                                }
                            };

                            // Create conversation_member DB record for the joining client
                            let now = crate::utils::now_ts();
                            let conversation_id: i64 = match sqlx::query_scalar::<_, i64>(
                                "SELECT conversation_id FROM rooms WHERE id = ? LIMIT 1",
                            )
                            .bind(room_id_inner)
                            .fetch_optional(&db_inner)
                            .await
                            {
                                Ok(Some(conversation_id)) => conversation_id,
                                Ok(None) => {
                                    eprintln!("[room-server] room {} not found during join", room_id_inner);
                                    write_error_frame(&mut stream, "ROOM_NOT_FOUND", "加入失败：房间不存在或已关闭").await;
                                    return;
                                }
                                Err(error) => {
                                    eprintln!("[room-server] failed to load room {} during join: {}", room_id_inner, error);
                                    write_error_frame(&mut stream, "ROOM_DB_ERROR", format!("加入失败：读取房间信息失败: {}", error)).await;
                                    return;
                                }
                            };

                            let join_order: i64 = match sqlx::query_scalar::<_, i64>(
                                "SELECT COALESCE(MAX(join_order), -1) + 1 FROM conversation_members WHERE conversation_id = ?",
                            )
                            .bind(conversation_id)
                            .fetch_one(&db_inner)
                            .await
                            {
                                Ok(join_order) => join_order,
                                Err(error) => {
                                    eprintln!(
                                        "[room-server] failed to allocate join order for conversation {}: {}",
                                        conversation_id, error
                                    );
                                    write_error_frame(&mut stream, "ROOM_DB_ERROR", format!("加入失败：分配成员顺序失败: {}", error)).await;
                                    return;
                                }
                            };

                            let db_member_id: i64 = match sqlx::query_scalar::<_, i64>(
                                "INSERT INTO conversation_members \
                                 (conversation_id, member_role, display_name, player_character_id, join_order, is_active, created_at, updated_at) \
                                 VALUES (?, 'member', ?, NULL, ?, 1, ?, ?) RETURNING id",
                            )
                            .bind(conversation_id)
                            .bind(&display_name)
                            .bind(join_order)
                            .bind(now)
                            .bind(now)
                            .fetch_one(&db_inner)
                            .await
                            {
                                Ok(member_id) => member_id,
                                Err(error) => {
                                    eprintln!(
                                        "[room-server] failed to insert member for conversation {}: {}",
                                        conversation_id, error
                                    );
                                    write_error_frame(&mut stream, "ROOM_DB_ERROR", format!("加入失败：创建成员记录失败: {}", error)).await;
                                    return;
                                }
                            };

                            // Update current_player_count in rooms table
                            if let Err(error) = sqlx::query(
                                "UPDATE rooms SET current_player_count = current_player_count + 1 WHERE id = ?",
                            )
                            .bind(room_id_inner)
                            .execute(&db_inner)
                            .await
                            {
                                eprintln!(
                                    "[room-server] failed to update player count for room {}: {}",
                                    room_id_inner, error
                                );
                                rollback_joined_member(&db_inner, room_id_inner, db_member_id, false).await;
                                write_error_frame(&mut stream, "ROOM_DB_ERROR", format!("加入失败：更新房间人数失败: {}", error)).await;
                                return;
                            }

                            let conversation = match load_conversation_summary(&db_inner, conversation_id).await {
                                Ok(conversation) => conversation,
                                Err(error) => {
                                    eprintln!(
                                        "[room-server] failed to load conversation {} during join: {}",
                                        conversation_id, error
                                    );
                                    rollback_joined_member(&db_inner, room_id_inner, db_member_id, true).await;
                                    write_error_frame(&mut stream, "ROOM_DB_ERROR", format!("join failed: failed to load conversation: {}", error)).await;
                                    return;
                                }
                            };

                            let member_profiles = match load_active_conversation_members(&db_inner, conversation_id).await {
                                Ok(members) => members,
                                Err(error) => {
                                    eprintln!(
                                        "[room-server] failed to list member profiles for conversation {}: {}",
                                        conversation_id, error
                                    );
                                    rollback_joined_member(&db_inner, room_id_inner, db_member_id, true).await;
                                    write_error_frame(&mut stream, "ROOM_DB_ERROR", format!("join failed: failed to load room members: {}", error)).await;
                                    return;
                                }
                            };

                            let recent_messages = match ChatService::list_messages(&db_inner, conversation_id, Some(200)).await {
                                Ok(messages) => messages,
                                Err(error) => {
                                    eprintln!(
                                        "[room-server] failed to list messages for conversation {}: {}",
                                        conversation_id, error
                                    );
                                    rollback_joined_member(&db_inner, room_id_inner, db_member_id, true).await;
                                    write_error_frame(&mut stream, "ROOM_DB_ERROR", format!("join failed: failed to load room messages: {}", error)).await;
                                    return;
                                }
                            };

                            let round_state = match RoundRepository::load_state(&db_inner, conversation_id, None).await {
                                Ok(round_state) => round_state,
                                Err(error) => {
                                    eprintln!(
                                        "[room-server] failed to load round state for conversation {}: {}",
                                        conversation_id, error
                                    );
                                    rollback_joined_member(&db_inner, room_id_inner, db_member_id, true).await;
                                    write_error_frame(&mut stream, "ROOM_DB_ERROR", format!("join failed: failed to load round state: {}", error)).await;
                                    return;
                                }
                            };

                            let success_msg = RoomMessage::JoinSuccess {
                                room_id: room_id_inner,
                                member_id: db_member_id,
                                conversation,
                                members: member_profiles,
                                recent_messages,
                                round_state,
                            };
                            if let Err(error) = write_frame(&mut stream, &success_msg).await {
                                eprintln!(
                                    "[room-server] failed to send join success to {} for room {}: {}",
                                    addr, room_id_inner, error
                                );
                                rollback_joined_member(&db_inner, room_id_inner, db_member_id, true).await;
                                return;
                            }

                            let (tx, mut rx) = mpsc::unbounded_channel::<RoomMessage>();

                            {
                                let mut c = clients.write().await;
                                c.insert(client_id, ClientHandle { tx: tx.clone(), display_name: display_name.clone(), db_member_id });
                            }

                            // Notify existing TCP clients about new member (don't send to the new client again)
                            let join_msg = RoomMessage::MemberJoined {
                                member_id: db_member_id,
                                display_name: display_name.clone(),
                            };
                            {
                                let c = clients.read().await;
                                for (id, handle) in c.iter() {
                                    if *id != client_id {
                                        let _ = handle.tx.send(join_msg.clone());
                                    }
                                }
                            }

                            // Emit flat payload to frontend (avoid tagged-enum wrapping)
                            if let Some(payload) = join_msg.event_payload() {
                                let _ = app_handle.emit("room:member_joined", payload);
                            }

                            // Spawn writer task using split to avoid try_clone
                            let (mut read_half, mut write_half) = stream.into_split();
                            let writer = tauri::async_runtime::spawn(async move {
                                while let Some(msg) = rx.recv().await {
                                    if write_frame_split(&mut write_half, &msg).await.is_err() {
                                        break;
                                    }
                                }
                            });

                            // Read loop
                            loop {
                                match read_frame_split(&mut read_half).await {
                                    Ok(Some(msg)) => {
                                        match &msg {
                                            RoomMessage::PlayerMessage { content, .. } => {
                                                match ChatService::submit_input(
                                                    app_handle.clone(),
                                                    db_inner.clone(),
                                                    conversation_id,
                                                    db_member_id,
                                                    content.clone(),
                                                    None,
                                                    Vec::new(),
                                                )
                                                .await
                                                {
                                                    Ok(_) => {}
                                                    Err(error) => {
                                                        let error_msg = RoomMessage::Error {
                                                            code: "SUBMIT_INPUT_FAILED".to_string(),
                                                            message: error,
                                                        };
                                                        let _ = tx.send(error_msg.clone());
                                                        if let Some(payload) = error_msg.event_payload() {
                                                            let _ = app_handle.emit(error_msg.event_name(), payload);
                                                        }
                                                    }
                                                }
                                            }
                                            _ => {
                                                if let Some(payload) = msg.event_payload() {
                                                    let _ = app_handle.emit(msg.event_name(), payload);
                                                } else {
                                                    let _ = app_handle.emit("room:message", &msg);
                                                }
                                            }
                                        }
                                    }
                                    Ok(None) => break,
                                    Err(_) => break,
                                }
                            }

                            // Cleanup: remove DB member record and update player count
                            let _ = sqlx::query(
                                "DELETE FROM conversation_members WHERE id = ?",
                            )
                            .bind(db_member_id)
                            .execute(&db_inner)
                            .await;

                            let _ = sqlx::query(
                                "UPDATE rooms SET current_player_count = current_player_count - 1 WHERE id = ? AND current_player_count > 0",
                            )
                            .bind(room_id_inner)
                            .execute(&db_inner)
                            .await;

                            writer.abort();
                            {
                                let mut c = clients.write().await;
                                c.remove(&client_id);
                            }
                            let leave_msg = RoomMessage::MemberLeft {
                                member_id: db_member_id,
                                display_name: display_name.clone(),
                            };
                            Self::broadcast(&clients, &leave_msg).await;
                            // Emit flat payload to frontend
                            if let Some(payload) = leave_msg.event_payload() {
                                let _ = app_handle.emit("room:member_left", payload);
                            }
                        });
                    }
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                }
            }
        });

        Ok(server)
    }

    async fn broadcast(clients: &Arc<RwLock<HashMap<i64, ClientHandle>>>, msg: &RoomMessage) {
        let c = clients.read().await;
        for (_, handle) in c.iter() {
            let _ = handle.tx.send(msg.clone());
        }
    }

    pub async fn broadcast_message(&self, msg: &RoomMessage) {
        let c = self.clients.read().await;
        for (_, handle) in c.iter() {
            let _ = handle.tx.send(msg.clone());
        }
    }

    pub async fn shutdown(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }
        let mut c = self.clients.write().await;
        for (_, handle) in c.drain() {
            let _ = handle.tx.send(RoomMessage::RoomClosed {
                reason: "房主已关闭房间".to_string(),
            });
        }
    }

    pub async fn client_count(&self) -> usize {
        self.clients.read().await.len()
    }
}

// ─── RoomClient ───

pub struct RoomClient {
    pub room_id: Option<i64>,
    pub host_address: String,
    pub port: u32,
    pub display_name: String,
    stream: Option<tokio::net::tcp::OwnedWriteHalf>,
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl RoomClient {
    pub fn new(host_address: String, port: u32, display_name: String) -> Self {
        RoomClient {
            room_id: None,
            host_address,
            port,
            display_name,
            stream: None,
            shutdown_tx: None,
        }
    }

    pub async fn connect(
        &mut self,
        app_handle: tauri::AppHandle,
    ) -> Result<RoomJoinSession, String> {
        if self.port == 0 || self.port > 65535 {
            return Err(format!(
                "端口 {} 超出 TCP 有效范围 (1-65535)，当前仅支持标准 TCP 端口",
                self.port
            ));
        }
        let tcp_port = self.port as u16;
        let mut stream = TcpStream::connect((self.host_address.as_str(), tcp_port))
            .await
            .map_err(|e| format!("连接失败: {}", e))?;

        let join_msg = RoomMessage::JoinRoom {
            display_name: self.display_name.clone(),
            passphrase: None,
        };
        write_frame(&mut stream, &join_msg).await?;

        let handshake_result = timeout(Duration::from_secs(10), read_frame(&mut stream)).await;

        let join_session = match handshake_result {
            Ok(Ok(Some(RoomMessage::JoinSuccess {
                room_id,
                member_id,
                conversation,
                members,
                recent_messages,
                round_state,
            }))) => {
                self.room_id = Some(room_id);
                // Emit each existing member to the frontend
                for member in &members {
                    let _ = app_handle.emit(
                        "room:member_joined",
                        MemberJoinedPayload {
                            member_id: member.id,
                            display_name: member.display_name.clone(),
                        },
                    );
                }
                RoomJoinSession {
                    room_id,
                    member_id,
                    conversation,
                    members,
                    recent_messages,
                    round_state,
                }
            }
            Ok(Ok(Some(RoomMessage::Error { message, .. }))) => {
                return Err(message);
            }
            Ok(Ok(Some(_))) => {
                return Err("连接失败：收到意外的服务器响应".to_string());
            }
            Ok(Ok(None)) => {
                return Err("连接失败：服务器关闭了连接".to_string());
            }
            Ok(Err(e)) => {
                return Err(format!("连接失败：读取响应错误: {}", e));
            }
            Err(_) => {
                return Err("连接超时：服务器未响应".to_string());
            }
        };

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx);

        let (mut read_half, write_half) = stream.into_split();
        let app_handle_clone = app_handle.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    result = read_frame_split(&mut read_half) => {
                        match result {
                            Ok(Some(msg)) => {
                                if let Some(payload) = msg.event_payload() {
                                    let _ = app_handle_clone.emit(msg.event_name(), payload);
                                } else {
                                    let _ = app_handle_clone.emit("room:message", &msg);
                                }
                            }
                            Ok(None) => {
                                let _ = app_handle_clone.emit("room:disconnected", ());
                                break;
                            }
                            Err(e) => {
                                let _ = app_handle_clone.emit("room:error", serde_json::json!({
                                    "code": "READ_ERROR",
                                    "message": format!("读取错误: {}", e),
                                }));
                                break;
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                }
            }
        });

        self.stream = Some(write_half);

        Ok(join_session)
    }

    pub async fn send_message(&mut self, msg: &RoomMessage) -> Result<(), String> {
        if let Some(ref mut write_half) = self.stream {
            write_frame_split(write_half, msg).await
        } else {
            Err("未连接到房间".to_string())
        }
    }

    pub async fn disconnect(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }
        if let Some(mut write_half) = self.stream.take() {
            let _ = write_half.shutdown().await;
        }
    }
}

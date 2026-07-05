use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::{timeout, Duration};

use crate::models::{ConversationListItem, ConversationMember, RoundState, TokenUsageReport, UiMessage};
use crate::repositories::round_repository::RoundRepository;
use crate::services::chat_service::ChatService;

// ─── Protocol ───

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GuestCharacterBaseSection {
    pub section_key: String,
    pub title: Option<String>,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GuestCharacterCardPayload {
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub base_sections: Vec<GuestCharacterBaseSection>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type", content = "payload")]
pub enum RoomMessage {
    JoinRoom {
        display_name: String,
        passphrase: Option<String>,
        character: Option<GuestCharacterCardPayload>,
    },
    JoinSuccess {
        room_id: i64,
        member_id: i64,
        conversation: ConversationListItem,
        members: Vec<ConversationMember>,
        #[serde(alias = "recentMessages")]
        full_messages: Vec<UiMessage>,
        round_state: RoundState,
        host_character_image_base64: Option<String>,
        host_character_name: Option<String>,
        host_character_description: Option<String>,
        #[serde(default)]
        schema_toggle_state: Option<HashMap<String, bool>>,
        #[serde(default)]
        context_window_size: Option<i64>,
        #[serde(default)]
        token_usage_report: Option<TokenUsageReport>,
        #[serde(default)]
        host_base_sections: Option<String>,
        #[serde(default)]
        host_preset_name: Option<String>,
        #[serde(default)]
        host_world_book_name: Option<String>,
        #[serde(default)]
        host_provider_name: Option<String>,
        #[serde(default)]
        plot_summaries: Option<Vec<crate::models::PlotSummaryRecord>>,
    },
    ContextSnapshot {
        conversation_id: i64,
        messages: Vec<UiMessage>,
        members: Vec<ConversationMember>,
        round_state: RoundState,
        host_character_image_base64: Option<String>,
        host_character_name: Option<String>,
        host_character_description: Option<String>,
        #[serde(default)]
        schema_toggle_state: Option<HashMap<String, bool>>,
        #[serde(default)]
        context_window_size: Option<i64>,
        #[serde(default)]
        token_usage_report: Option<TokenUsageReport>,
        #[serde(default)]
        host_base_sections: Option<String>,
        #[serde(default)]
        host_preset_name: Option<String>,
        #[serde(default)]
        host_world_book_name: Option<String>,
        #[serde(default)]
        host_provider_name: Option<String>,
        #[serde(default)]
        plot_summaries: Option<Vec<crate::models::PlotSummaryRecord>>,
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
    StreamStructuredFieldDelta {
        conversation_id: i64,
        round_id: i64,
        message_id: i64,
        field_key: String,
        delta: String,
    },
    StreamObjectFieldComplete {
        conversation_id: i64,
        round_id: i64,
        message_id: i64,
        field_key: String,
        json: String,
    },
    StreamRetry {
        conversation_id: i64,
        round_id: i64,
        message_id: i64,
        error: String,
        attempt_count: i64,
    },
    MessageReset {
        conversation_id: i64,
        round_id: i64,
        message_id: i64,
    },
    RoomClosed {
        reason: String,
    },
    SchemaToggle {
        conversation_id: i64,
        toggle_key: String,
        expanded: bool,
    },
    TokenUsage {
        conversation_id: i64,
        report: TokenUsageReport,
    },
    PlotSummaryUpdate {
        conversation_id: i64,
        summaries: Vec<crate::models::PlotSummaryRecord>,
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
pub struct StreamStructuredFieldDeltaPayload {
    pub conversation_id: i64,
    pub round_id: i64,
    pub message_id: i64,
    pub field_key: String,
    pub delta: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamObjectFieldCompletePayload {
    pub conversation_id: i64,
    pub round_id: i64,
    pub message_id: i64,
    pub field_key: String,
    pub json: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomStreamRetryPayload {
    pub conversation_id: i64,
    pub round_id: i64,
    pub message_id: i64,
    pub error: String,
    pub attempt_count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomMessageResetPayload {
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

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshotPayload {
    pub conversation_id: i64,
    pub messages: Vec<UiMessage>,
    pub members: Vec<ConversationMember>,
    pub round_state: RoundState,
    pub host_character_image_base64: Option<String>,
    pub host_character_name: Option<String>,
    pub host_character_description: Option<String>,
    pub schema_toggle_state: Option<HashMap<String, bool>>,
    pub context_window_size: Option<i64>,
    pub token_usage_report: Option<TokenUsageReport>,
    pub host_base_sections: Option<String>,
    pub host_preset_name: Option<String>,
    pub host_world_book_name: Option<String>,
    pub host_provider_name: Option<String>,
    pub plot_summaries: Option<Vec<crate::models::PlotSummaryRecord>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomSchemaToggleEvent {
    pub conversation_id: i64,
    pub toggle_key: String,
    pub expanded: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomTokenUsageEvent {
    pub conversation_id: i64,
    pub report: TokenUsageReport,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoomPlotSummaryUpdateEvent {
    pub conversation_id: i64,
    pub summaries: Vec<crate::models::PlotSummaryRecord>,
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
            RoomMessage::StreamStructuredFieldDelta { .. } => "room:stream_structured_field_delta",
            RoomMessage::StreamObjectFieldComplete { .. } => "room:stream_object_field_complete",
            RoomMessage::StreamRetry { .. } => "room:stream_retry",
            RoomMessage::MessageReset { .. } => "room:message_reset",
            RoomMessage::RoomClosed { .. } => "room:room_closed",
            RoomMessage::Error { .. } => "room:error",
            RoomMessage::ContextSnapshot { .. } => "room:context_snapshot",
            RoomMessage::SchemaToggle { .. } => "room:schema_toggle",
            RoomMessage::TokenUsage { .. } => "room:token_usage",
            RoomMessage::PlotSummaryUpdate { .. } => "room:plot_summary_update",
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
            RoomMessage::StreamStructuredFieldDelta {
                conversation_id,
                round_id,
                message_id,
                field_key,
                delta,
            } => serde_json::to_value(StreamStructuredFieldDeltaPayload {
                conversation_id: *conversation_id,
                round_id: *round_id,
                message_id: *message_id,
                field_key: field_key.clone(),
                delta: delta.clone(),
            })
            .ok(),
            RoomMessage::StreamObjectFieldComplete {
                conversation_id,
                round_id,
                message_id,
                field_key,
                json,
            } => serde_json::to_value(StreamObjectFieldCompletePayload {
                conversation_id: *conversation_id,
                round_id: *round_id,
                message_id: *message_id,
                field_key: field_key.clone(),
                json: json.clone(),
            })
            .ok(),
            RoomMessage::StreamRetry {
                conversation_id,
                round_id,
                message_id,
                error,
                attempt_count,
            } => serde_json::to_value(RoomStreamRetryPayload {
                conversation_id: *conversation_id,
                round_id: *round_id,
                message_id: *message_id,
                error: error.clone(),
                attempt_count: *attempt_count,
            })
            .ok(),
            RoomMessage::MessageReset {
                conversation_id,
                round_id,
                message_id,
            } => serde_json::to_value(RoomMessageResetPayload {
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
            RoomMessage::ContextSnapshot {
                conversation_id,
                messages,
                members,
                round_state,
                host_character_image_base64,
                host_character_name,
                host_character_description,
                schema_toggle_state,
                context_window_size,
                token_usage_report,
                host_base_sections,
                host_preset_name,
                host_world_book_name,
                host_provider_name,
                plot_summaries,
            } => serde_json::to_value(ContextSnapshotPayload {
                conversation_id: *conversation_id,
                messages: messages.clone(),
                members: members.clone(),
                round_state: round_state.clone(),
                host_character_image_base64: host_character_image_base64.clone(),
                host_character_name: host_character_name.clone(),
                host_character_description: host_character_description.clone(),
                schema_toggle_state: schema_toggle_state.clone(),
                context_window_size: *context_window_size,
                token_usage_report: token_usage_report.clone(),
                host_base_sections: host_base_sections.clone(),
                host_preset_name: host_preset_name.clone(),
                host_world_book_name: host_world_book_name.clone(),
                host_provider_name: host_provider_name.clone(),
                plot_summaries: plot_summaries.clone(),
            })
            .ok(),
            RoomMessage::SchemaToggle {
                conversation_id,
                toggle_key,
                expanded,
            } => serde_json::to_value(RoomSchemaToggleEvent {
                conversation_id: *conversation_id,
                toggle_key: toggle_key.clone(),
                expanded: *expanded,
            })
            .ok(),
            RoomMessage::TokenUsage {
                conversation_id,
                report,
            } => serde_json::to_value(RoomTokenUsageEvent {
                conversation_id: *conversation_id,
                report: report.clone(),
            })
            .ok(),
            RoomMessage::PlotSummaryUpdate {
                conversation_id,
                summaries,
            } => serde_json::to_value(RoomPlotSummaryUpdateEvent {
                conversation_id: *conversation_id,
                summaries: summaries.clone(),
            })
            .ok(),
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
    pub full_messages: Vec<UiMessage>,
    pub round_state: RoundState,
    pub host_character_image_base64: Option<String>,
    pub host_character_name: Option<String>,
    pub host_character_description: Option<String>,
    pub schema_toggle_state: Option<HashMap<String, bool>>,
    pub context_window_size: Option<i64>,
    pub token_usage_report: Option<TokenUsageReport>,
    pub host_base_sections: Option<String>,
    pub host_preset_name: Option<String>,
    pub host_world_book_name: Option<String>,
    pub host_provider_name: Option<String>,
    pub plot_summaries: Option<Vec<crate::models::PlotSummaryRecord>>,
}

fn normalize_optional_positive_id(value: Option<i64>) -> Option<i64> {
    value.filter(|id| *id > 0)
}

async fn load_conversation_summary(
    db: &SqlitePool,
    conversation_id: i64,
    room_status: Option<String>,
) -> Result<ConversationListItem, String> {
    let row = sqlx::query(
        "SELECT id, conversation_type, title, host_character_id, world_book_id, preset_id, \
         provider_id, embedding_provider_id, chat_mode, agent_provider_policy, memory_mode, \
         mem0_snapshot_window, created_at, updated_at \
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
        embedding_provider_id: row.try_get("embedding_provider_id").ok(),
        chat_mode: row
            .try_get("chat_mode")
            .unwrap_or_else(|_| "classic".to_string()),
        agent_provider_policy: row
            .try_get("agent_provider_policy")
            .unwrap_or_else(|_| "shared_host_provider".to_string()),
        memory_mode: row
            .try_get("memory_mode")
            .unwrap_or_else(|_| "stateless".to_string()),
        mem0_snapshot_window: row
            .try_get("mem0_snapshot_window")
            .unwrap_or(20),
        member_count,
        pending_member_count,
        room_status,
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    })
}

pub async fn load_active_conversation_members(
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
    schema_toggle_state: Arc<Mutex<HashMap<String, bool>>>,
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
        let schema_toggle_state: Arc<Mutex<HashMap<String, bool>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

        let server = Arc::new(Mutex::new(RoomServer {
            room_id,
            port,
            clients: clients.clone(),
            next_client_id: next_client_id.clone(),
            shutdown_tx: Some(shutdown_tx),
            db: db.clone(),
            schema_toggle_state: schema_toggle_state.clone(),
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
                        let schema_toggle_state = schema_toggle_state.clone();

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
                            let (display_name, character) = match read_frame(&mut stream).await {
                                Ok(Some(RoomMessage::JoinRoom { display_name, character, .. })) => (display_name, character),
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

                            let guest_character_json: Option<String> = match &character {
                                Some(payload) => {
                                    let json = match serde_json::to_string(payload) {
                                        Ok(json) => json,
                                        Err(error) => {
                                            eprintln!(
                                                "[room-server] failed to serialize guest character for {}: {}",
                                                addr, error
                                            );
                                            write_error_frame(
                                                &mut stream,
                                                "CHARACTER_INVALID",
                                                format!("角色卡数据序列化失败: {}", error),
                                            )
                                            .await;
                                            return;
                                        }
                                    };
                                    if json.len() > 256 * 1024 {
                                        write_error_frame(
                                            &mut stream,
                                            "CHARACTER_TOO_LARGE",
                                            "角色卡数据过大（超过 256KB），请精简后重试",
                                        )
                                        .await;
                                        return;
                                    }
                                    Some(json)
                                }
                                None => None,
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
                                 (conversation_id, member_role, display_name, player_character_id, join_order, is_active, guest_character_json, created_at, updated_at) \
                                 VALUES (?, 'member', ?, NULL, ?, 1, ?, ?, ?) RETURNING id",
                            )
                            .bind(conversation_id)
                            .bind(&display_name)
                            .bind(join_order)
                            .bind(&guest_character_json)
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

                            let conversation = match load_conversation_summary(&db_inner, conversation_id, Some("open".to_string())).await {
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

                            let full_messages = match ChatService::list_messages(&db_inner, conversation_id, None).await {
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

                            // Load host character card so the guest can render the avatar/name/description
                            // alongside the join handshake. Image export errors are non-fatal: a missing or
                            // oversized image simply renders as `None` on the guest side.
                            let (host_character_image_base64, host_character_name, host_character_description) =
                                match conversation.host_character_id {
                                    Some(card_id) => {
                                        let state = app_handle.state::<crate::AppState>();
                                        let image = crate::commands::characters::character_card_export_image(
                                            state, card_id,
                                        )
                                        .await
                                        .ok()
                                        .flatten();
                                        let card = crate::commands::characters::character_card_get(
                                            &db_inner, card_id,
                                        )
                                        .await
                                        .ok();
                                        let name = card
                                            .as_ref()
                                            .map(|c| c.name.clone())
                                            .filter(|n| !n.is_empty());
                                        let description = card
                                            .as_ref()
                                            .map(|c| c.description.clone())
                                            .filter(|d| !d.is_empty());
                                        (image, name, description)
                                    }
                                    None => (None, None, None),
                                };

                            let schema_toggle_snapshot: Option<HashMap<String, bool>> = {
                                let map = schema_toggle_state.lock().await;
                                if map.is_empty() {
                                    None
                                } else {
                                    Some(map.clone())
                                }
                            };

                            let (context_window_size, token_usage_report) =
                                match crate::services::prompt_compiler::compile_token_usage_report(
                                    &db_inner,
                                    conversation_id,
                                )
                                .await
                                {
                                    Ok(report) => (
                                        report.context_window_size.map(|v| v as i64),
                                        Some(report),
                                    ),
                                    Err(error) => {
                                        eprintln!(
                                            "[room-server] failed to compile token usage report for conversation {} during join: {}",
                                            conversation_id, error
                                        );
                                        (None, None)
                                    }
                                };

                            let host_base_sections: Option<String> =
                                match conversation.host_character_id {
                                    Some(card_id) => {
                                        let card = crate::commands::characters::character_card_get(
                                            &db_inner, card_id,
                                        )
                                        .await
                                        .ok();
                                        card
                                            .as_ref()
                                            .map(|c| serde_json::to_string(&c.base_sections).unwrap_or_default())
                                            .filter(|s| !s.is_empty() && s != "[]")
                                    }
                                    None => None,
                                };

                            let host_preset_name: Option<String> = sqlx::query_scalar::<_, String>(
                                "SELECT p.name FROM conversations c LEFT JOIN presets p ON p.id = c.preset_id WHERE c.id = ? LIMIT 1",
                            )
                            .bind(conversation_id)
                            .fetch_optional(&db_inner)
                            .await
                            .ok()
                            .flatten()
                            .filter(|n| !n.is_empty());

                            let host_world_book_name: Option<String> = sqlx::query_scalar::<_, String>(
                                "SELECT wb.name FROM conversations c LEFT JOIN world_books wb ON wb.id = c.world_book_id WHERE c.id = ? LIMIT 1",
                            )
                            .bind(conversation_id)
                            .fetch_optional(&db_inner)
                            .await
                            .ok()
                            .flatten()
                            .filter(|n| !n.is_empty());

                            let host_provider_name: Option<String> = sqlx::query_scalar::<_, String>(
                                "SELECT ap.name FROM conversations c LEFT JOIN api_providers ap ON ap.id = c.provider_id WHERE c.id = ? LIMIT 1",
                            )
                            .bind(conversation_id)
                            .fetch_optional(&db_inner)
                            .await
                            .ok()
                            .flatten()
                            .filter(|n| !n.is_empty());

                            let plot_summaries: Option<Vec<crate::models::PlotSummaryRecord>> =
                                match crate::services::plot_summaries::list_plot_summaries(
                                    &db_inner,
                                    conversation_id,
                                )
                                .await
                                {
                                    Ok(records) => Some(records),
                                    Err(error) => {
                                        eprintln!(
                                            "[room-server] failed to load plot summaries for conversation {} during join: {}",
                                            conversation_id, error
                                        );
                                        None
                                    }
                                };

                            let success_msg = RoomMessage::JoinSuccess {
                                room_id: room_id_inner,
                                member_id: db_member_id,
                                conversation,
                                members: member_profiles,
                                full_messages,
                                round_state,
                                host_character_image_base64,
                                host_character_name,
                                host_character_description,
                                schema_toggle_state: schema_toggle_snapshot.clone(),
                                context_window_size,
                                token_usage_report: token_usage_report.clone(),
                                host_base_sections,
                                host_preset_name,
                                host_world_book_name,
                                host_provider_name,
                                plot_summaries,
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

                            // Build and unicast a full `ContextSnapshot` to the freshly joined client only.
                            // Snapshot failures are non-fatal: the client already has the (now full) message
                            // history from `JoinSuccess`, so a stale snapshot is preferable to aborting join.
                            match crate::services::chat_service::build_context_snapshot(
                                &db_inner,
                                conversation_id,
                                &app_handle,
                                schema_toggle_snapshot,
                            )
                            .await
                            {
                                Ok(snapshot) => {
                                    let _ = tx.send(snapshot);
                                }
                                Err(error) => {
                                    eprintln!(
                                        "[room-server] failed to build context snapshot for new client {} in room {}: {}",
                                        addr, room_id_inner, error
                                    );
                                }
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
        let count = c.len();
        let msg_type = msg.event_name();
        eprintln!("[room-server] broadcast_message: type={}, clients={}", msg_type, count);
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

    /// Update the host-side schema toggle map and broadcast a `SchemaToggle`
    /// message to all connected room clients. Called only on the host side
    /// (single-player mode has no room server and therefore no call path).
    pub async fn update_schema_toggle(
        &self,
        conversation_id: i64,
        toggle_key: String,
        expanded: bool,
    ) {
        {
            let mut map = self.schema_toggle_state.lock().await;
            map.insert(toggle_key.clone(), expanded);
        }
        let msg = RoomMessage::SchemaToggle {
            conversation_id,
            toggle_key,
            expanded,
        };
        self.broadcast_message(&msg).await;
    }
}

// ─── RoomClient ───

pub struct RoomClient {
    pub room_id: Option<i64>,
    pub host_address: String,
    pub port: u32,
    pub display_name: String,
    character: Option<GuestCharacterCardPayload>,
    stream: Option<tokio::net::tcp::OwnedWriteHalf>,
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl RoomClient {
    pub fn new(
        host_address: String,
        port: u32,
        display_name: String,
        character: Option<GuestCharacterCardPayload>,
    ) -> Self {
        RoomClient {
            room_id: None,
            host_address,
            port,
            display_name,
            character,
            stream: None,
            shutdown_tx: None,
        }
    }

    pub async fn connect(
        &mut self,
        app_handle: tauri::AppHandle,
    ) -> Result<RoomJoinSession, String> {
        eprintln!("[room-client] connecting to {}:{}", self.host_address, self.port);
        if self.port == 0 || self.port > 65535 {
            eprintln!("[room-client] connect error: port {} out of range", self.port);
            return Err(format!(
                "端口 {} 超出 TCP 有效范围 (1-65535)，当前仅支持标准 TCP 端口",
                self.port
            ));
        }
        let tcp_port = self.port as u16;
        let mut stream = TcpStream::connect((self.host_address.as_str(), tcp_port))
            .await
            .map_err(|e| {
                eprintln!("[room-client] connect error: {}", e);
                format!("连接失败: {}", e)
            })?;

        let join_msg = RoomMessage::JoinRoom {
            display_name: self.display_name.clone(),
            passphrase: None,
            character: self.character.clone(),
        };
        write_frame(&mut stream, &join_msg)
            .await
            .map_err(|e| {
                eprintln!("[room-client] connect error: {}", e);
                e
            })?;

        let handshake_result = timeout(Duration::from_secs(10), read_frame(&mut stream)).await;

        let join_session = match handshake_result {
            Ok(Ok(Some(RoomMessage::JoinSuccess {
                room_id,
                member_id,
                conversation,
                members,
                full_messages,
                round_state,
                host_character_image_base64,
                host_character_name,
                host_character_description,
                schema_toggle_state,
                context_window_size,
                token_usage_report,
                host_base_sections,
                host_preset_name,
                host_world_book_name,
                host_provider_name,
                plot_summaries,
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
                    full_messages,
                    round_state,
                    host_character_image_base64,
                    host_character_name,
                    host_character_description,
                    schema_toggle_state,
                    context_window_size,
                    token_usage_report,
                    host_base_sections,
                    host_preset_name,
                    host_world_book_name,
                    host_provider_name,
                    plot_summaries,
                }
            }
            Ok(Ok(Some(RoomMessage::Error { message, .. }))) => {
                eprintln!("[room-client] connect error: {}", message);
                return Err(message);
            }
            Ok(Ok(Some(_))) => {
                eprintln!("[room-client] connect error: unexpected server response");
                return Err("连接失败：收到意外的服务器响应".to_string());
            }
            Ok(Ok(None)) => {
                eprintln!("[room-client] connect error: server closed connection");
                return Err("连接失败：服务器关闭了连接".to_string());
            }
            Ok(Err(e)) => {
                eprintln!("[room-client] connect error: {}", e);
                return Err(format!("连接失败：读取响应错误: {}", e));
            }
            Err(_) => {
                eprintln!("[room-client] connect timeout");
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
                                eprintln!("[room-client] received message: type={}", msg.event_name());
                                if let Some(payload) = msg.event_payload() {
                                    let _ = app_handle_clone.emit(msg.event_name(), payload);
                                } else {
                                    let _ = app_handle_clone.emit("room:message", &msg);
                                }
                            }
                            Ok(None) => {
                                eprintln!("[room-client] peer closed connection");
                                let _ = app_handle_clone.emit("room:disconnected", ());
                                break;
                            }
                            Err(e) => {
                                eprintln!("[room-client] read error: {}", e);
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

        eprintln!(
            "[room-client] connected, room_id={:?}, member_id={:?}, messages={}, members={}",
            join_session.room_id,
            join_session.member_id,
            join_session.full_messages.len(),
            join_session.members.len()
        );
        Ok(join_session)
    }

    pub async fn send_message(&mut self, msg: &RoomMessage) -> Result<(), String> {
        eprintln!("[room-client] sending frame: type={}", msg.event_name());
        if let Some(ref mut write_half) = self.stream {
            match write_frame_split(write_half, msg).await {
                Ok(()) => {
                    eprintln!("[room-client] frame sent");
                    Ok(())
                }
                Err(e) => {
                    eprintln!("[room-client] send error: {}", e);
                    Err(e)
                }
            }
        } else {
            eprintln!("[room-client] send error: 未连接到房间");
            Err("未连接到房间".to_string())
        }
    }

    pub async fn disconnect(&mut self) {
        eprintln!("[room-client] disconnecting");
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }
        if let Some(mut write_half) = self.stream.take() {
            let _ = write_half.shutdown().await;
        }
        eprintln!("[room-client] disconnected");
    }
}

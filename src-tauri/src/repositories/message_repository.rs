use sqlx::{Row, SqlitePool, Transaction};

use crate::models::UiMessage;
use crate::utils::now_ts;

pub struct InsertMessageRecord<'a> {
    pub conversation_id: i64,
    pub round_id: Option<i64>,
    pub member_id: Option<i64>,
    pub role: &'a str,
    pub message_kind: &'a str,
    pub content: &'a str,
    pub is_hidden: bool,
    pub is_swipe: bool,
    pub swipe_index: i64,
    pub reply_to_id: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct PendingMessageContentPart {
    pub part_index: i64,
    pub part_type: String,
    pub text_value: Option<String>,
    pub json_value: Option<String>,
    pub asset_id: Option<i64>,
    pub mime_type: Option<String>,
    pub tool_use_id: Option<String>,
    pub tool_name: Option<String>,
    pub is_hidden: bool,
}

#[derive(Debug, Clone)]
pub struct PendingToolUseSkeleton {
    pub provider_part_index: i64,
    pub tool_use_id: String,
    pub tool_name: String,
    pub input_json: String,
}

pub struct MessageRepository;

impl MessageRepository {
    pub async fn insert_record(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        record: InsertMessageRecord<'_>,
    ) -> Result<i64, String> {
        let result = sqlx::query(
            "INSERT INTO messages (
                conversation_id, round_id, member_id, role, message_kind, content,
                is_hidden, is_swipe, swipe_index, reply_to_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(record.conversation_id)
        .bind(record.round_id)
        .bind(record.member_id)
        .bind(record.role)
        .bind(record.message_kind)
        .bind(record.content)
        .bind(if record.is_hidden { 1 } else { 0 })
        .bind(if record.is_swipe { 1 } else { 0 })
        .bind(record.swipe_index)
        .bind(record.reply_to_id)
        .bind(record.created_at)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        Ok(result.last_insert_rowid())
    }

    pub async fn list_by_conversation(
        db: &SqlitePool,
        conversation_id: i64,
        limit: i64,
    ) -> Result<Vec<UiMessage>, String> {
        let rows = sqlx::query(
            "SELECT m.id, m.conversation_id, m.round_id, m.member_id, m.role, m.message_kind, m.content, \
             cm.display_name AS display_name, m.is_swipe, m.swipe_index, m.reply_to_id, \
             CASE \
                WHEN m.role = 'assistant' AND m.round_id IS NOT NULL THEN \
                    CASE WHEN mr.active_assistant_message_id IS NOT NULL THEN \
                        CASE WHEN mr.active_assistant_message_id = m.id THEN 1 ELSE 0 END \
                    ELSE \
                        CASE WHEN m.id = (SELECT MAX(m2.id) FROM messages m2 WHERE m2.round_id = m.round_id AND m2.role = 'assistant' AND m2.is_hidden = 0) THEN 1 ELSE 0 END \
                    END \
                ELSE 1 \
            END AS is_active_in_round, \
            m.created_at \
            FROM messages m \
            LEFT JOIN conversation_members cm ON cm.id = m.member_id \
            LEFT JOIN message_rounds mr ON mr.id = m.round_id \
            WHERE m.conversation_id = ? AND m.is_hidden = 0 AND m.message_kind != 'user_aggregate' \
             ORDER BY m.id DESC LIMIT ?",
        )
        .bind(conversation_id)
        .bind(limit)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        Ok(rows.into_iter().map(Self::row_to_ui_message).collect())
    }

    pub async fn find_by_id(db: &SqlitePool, id: i64) -> Result<UiMessage, String> {
        let row = sqlx::query(
            "SELECT m.id, m.conversation_id, m.round_id, m.member_id, m.role, m.message_kind, m.content, \
             cm.display_name AS display_name, m.is_swipe, m.swipe_index, m.reply_to_id, \
             CASE \
                 WHEN m.role = 'assistant' AND m.round_id IS NOT NULL THEN \
                     CASE WHEN mr.active_assistant_message_id IS NOT NULL THEN \
                         CASE WHEN mr.active_assistant_message_id = m.id THEN 1 ELSE 0 END \
                     ELSE \
                         CASE WHEN m.id = (SELECT MAX(m2.id) FROM messages m2 WHERE m2.round_id = m.round_id AND m2.role = 'assistant' AND m2.is_hidden = 0) THEN 1 ELSE 0 END \
                     END \
                 ELSE 1 \
             END AS is_active_in_round, \
             m.created_at \
             FROM messages m \
             LEFT JOIN conversation_members cm ON cm.id = m.member_id \
             LEFT JOIN message_rounds mr ON mr.id = m.round_id \
             WHERE m.id = ?",
        )
        .bind(id)
        .fetch_one(db)
        .await
        .map_err(|err| err.to_string())?;

        Ok(Self::row_to_ui_message(row))
    }

    pub async fn update_content(db: &SqlitePool, id: i64, content: &str) -> Result<(), String> {
        sqlx::query("UPDATE messages SET content = ? WHERE id = ?")
            .bind(content)
            .bind(id)
            .execute(db)
            .await
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn update_content_parts_text(
        db: &SqlitePool,
        message_id: i64,
        content: &str,
    ) -> Result<(), String> {
        sqlx::query("UPDATE message_content_parts SET text_content = ? WHERE message_id = ? AND content_type = 'text'")
            .bind(content)
            .bind(message_id)
            .execute(db)
            .await
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn replace_content_parts(
        db: &SqlitePool,
        message_id: i64,
        visible_text: &str,
        hidden_parts: &[PendingMessageContentPart],
    ) -> Result<(), String> {
        let now = now_ts();
        let mut tx = db.begin().await.map_err(|err| err.to_string())?;

        sqlx::query("DELETE FROM message_content_parts WHERE message_id = ?")
            .bind(message_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;

        let mut ordered_hidden_parts = hidden_parts.to_vec();
        ordered_hidden_parts.sort_by_key(|part| part.part_index);

        let mut next_part_index = 0_i64;
        for part in ordered_hidden_parts {
            let has_payload = part
                .text_value
                .as_ref()
                .map(|value| !value.is_empty())
                .unwrap_or(false)
                || part.json_value.is_some()
                || part.asset_id.is_some()
                || part.tool_use_id.is_some()
                || part.tool_name.is_some();
            if !has_payload {
                continue;
            }

            sqlx::query(
                "INSERT INTO message_content_parts (
                    message_id, part_index, part_type, text_value, json_value,
                    asset_id, mime_type, tool_use_id, tool_name, is_hidden, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(message_id)
            .bind(next_part_index)
            .bind(&part.part_type)
            .bind(&part.text_value)
            .bind(&part.json_value)
            .bind(part.asset_id)
            .bind(&part.mime_type)
            .bind(&part.tool_use_id)
            .bind(&part.tool_name)
            .bind(if part.is_hidden { 1 } else { 0 })
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;

            next_part_index += 1;
        }

        if !visible_text.is_empty() {
            sqlx::query(
                "INSERT INTO message_content_parts (
                    message_id, part_index, part_type, text_value, json_value,
                    asset_id, mime_type, tool_use_id, tool_name, is_hidden, created_at
                 ) VALUES (?, ?, 'text', ?, NULL, NULL, NULL, NULL, NULL, 0, ?)",
            )
            .bind(message_id)
            .bind(next_part_index)
            .bind(visible_text)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        tx.commit().await.map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn insert_tool_result_content_part(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        message_id: i64,
        content: &str,
        tool_use_id: &str,
        now: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO message_content_parts (
                message_id, part_index, part_type, text_value, json_value,
                asset_id, mime_type, tool_use_id, tool_name, is_hidden, created_at
             ) VALUES (?, ?, 'tool_result', ?, NULL, NULL, NULL, ?, NULL, 0, ?)",
        )
        .bind(message_id)
        .bind(0i64)
        .bind(content)
        .bind(tool_use_id)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn update_tool_call_status(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        result_message_id: i64,
        now: i64,
        tool_use_id: &str,
    ) -> Result<(), String> {
        sqlx::query(
            "UPDATE message_tool_calls SET status = 'result_available', result_message_id = ?, updated_at = ? WHERE tool_use_id = ?",
        )
        .bind(result_message_id)
        .bind(now)
        .bind(tool_use_id)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn find_tool_call_by_use_id(
        db: &SqlitePool,
        tool_use_id: &str,
    ) -> Result<Option<sqlx::sqlite::SqliteRow>, String> {
        sqlx::query(
            "SELECT id, message_id, tool_name, input_json, status FROM message_tool_calls WHERE tool_use_id = ? LIMIT 1",
        )
        .bind(tool_use_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())
    }

    pub async fn persist_image_content_parts(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        message_id: i64,
        attachments: &[crate::models::ChatAttachment],
    ) -> Result<(), String> {
        let now = now_ts();
        for (index, attachment) in attachments.iter().enumerate() {
            let json_value = serde_json::json!({
                "data_base64": attachment.base64_data,
            })
            .to_string();
            sqlx::query(
                "INSERT INTO message_content_parts (
                    message_id, part_index, part_type, text_value, json_value,
                    asset_id, mime_type, tool_use_id, tool_name, is_hidden, created_at
                 ) VALUES (?, ?, 'image', NULL, ?, NULL, ?, NULL, NULL, 0, ?)",
            )
            .bind(message_id)
            .bind(index as i64)
            .bind(&json_value)
            .bind(&attachment.mime_type)
            .bind(now)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        }
        Ok(())
    }

    pub async fn find_round_id_by_message(
        db: &SqlitePool,
        conversation_id: i64,
        message_id: i64,
    ) -> Result<Option<i64>, String> {
        let direct_round_id: Option<i64> = sqlx::query_scalar(
            "SELECT round_id FROM messages WHERE conversation_id = ? AND id = ? LIMIT 1",
        )
        .bind(conversation_id)
        .bind(message_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?
        .flatten();

        if let Some(round_id) = direct_round_id {
            return Ok(Some(round_id));
        }

        let assistant_round_id: Option<i64> = sqlx::query_scalar(
            "SELECT round_id FROM messages WHERE conversation_id = ? AND reply_to_id = ? ORDER BY swipe_index DESC LIMIT 1",
        )
        .bind(conversation_id)
        .bind(message_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?
        .flatten();

        Ok(assistant_round_id)
    }

    pub async fn max_swipe_index_for_round(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
    ) -> Result<Option<i64>, String> {
        sqlx::query_scalar(
            "SELECT MAX(swipe_index) FROM messages WHERE round_id = ? AND message_kind = 'assistant_visible'",
        )
        .bind(round_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|err| err.to_string())
    }

    pub async fn has_prior_assistant_in_round(
        db: &SqlitePool,
        round_id: i64,
        assistant_message_id: i64,
    ) -> Result<bool, String> {
        let prior_assistant_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM messages \
             WHERE round_id = ? AND message_kind = 'assistant_visible' AND id != ? \
             ORDER BY id ASC LIMIT 1",
        )
        .bind(round_id)
        .bind(assistant_message_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?;

        Ok(prior_assistant_id.is_some())
    }

    fn row_to_ui_message(row: sqlx::sqlite::SqliteRow) -> UiMessage {
        UiMessage {
            id: row.try_get("id").unwrap_or_default(),
            conversation_id: row.try_get("conversation_id").unwrap_or_default(),
            round_id: row.try_get("round_id").ok(),
            member_id: row.try_get("member_id").ok(),
            role: row.try_get("role").unwrap_or_default(),
            message_kind: row.try_get("message_kind").unwrap_or_default(),
            content: row.try_get("content").unwrap_or_default(),
            display_name: row.try_get("display_name").ok(),
            is_swipe: row
                .try_get::<i64, _>("is_swipe")
                .map(|value| value != 0)
                .unwrap_or(false),
            swipe_index: row.try_get("swipe_index").unwrap_or_default(),
            reply_to_id: row.try_get("reply_to_id").ok(),
            summary_batch_index: row.try_get("summary_batch_index").ok(),
            summary_entry_id: row.try_get("summary_entry_id").ok(),
            is_active_in_round: row
                .try_get::<i64, _>("is_active_in_round")
                .map(|value| value != 0)
                .unwrap_or(true),
            created_at: row.try_get("created_at").unwrap_or_default(),
        }
    }
}

pub fn normalize_tool_use_input_json(input_json: &str) -> String {
    let trimmed = input_json.trim();
    if trimmed.is_empty() {
        "{}".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn ensure_hidden_message_part(
    hidden_parts: &mut Vec<PendingMessageContentPart>,
    hidden_part_lookup: &mut std::collections::HashMap<i64, usize>,
    provider_part_index: i64,
    part_type: &str,
) -> usize {
    if let Some(index) = hidden_part_lookup.get(&provider_part_index) {
        return *index;
    }

    let index = hidden_parts.len();
    hidden_parts.push(PendingMessageContentPart {
        part_index: provider_part_index,
        part_type: part_type.to_string(),
        text_value: None,
        json_value: None,
        asset_id: None,
        mime_type: None,
        tool_use_id: None,
        tool_name: None,
        is_hidden: true,
    });
    hidden_part_lookup.insert(provider_part_index, index);
    index
}

pub fn append_hidden_part_text(part: &mut PendingMessageContentPart, delta: &str) {
    let text = part.text_value.get_or_insert_with(String::new);
    text.push_str(delta);
}

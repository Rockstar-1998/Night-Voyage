use sqlx::{Row, SqlitePool, Transaction};

use crate::models::RoundState;
use crate::utils::now_ts;

pub struct RoundRepository;

impl RoundRepository {
    pub async fn ensure_collecting(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        conversation_id: i64,
        now: i64,
    ) -> Result<(i64, i64), String> {
        let latest_round = sqlx::query(
            "SELECT id, round_index, status FROM message_rounds WHERE conversation_id = ? ORDER BY round_index DESC LIMIT 1",
        )
        .bind(conversation_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        if let Some(row) = latest_round {
            let round_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
            let round_index: i64 = row.try_get("round_index").map_err(|err| err.to_string())?;
            let status: String = row.try_get("status").map_err(|err| err.to_string())?;

            if status == "collecting" {
                return Ok((round_id, round_index));
            }

            if status == "queued" || status == "streaming" {
                return Err("当前已有未完成轮次，请等待上一轮完成".to_string());
            }

            let next_round_index = round_index + 1;
            let result = sqlx::query(
                "INSERT INTO message_rounds (conversation_id, round_index, status, created_at, updated_at) \
                 VALUES (?, ?, 'collecting', ?, ?)",
            )
            .bind(conversation_id)
            .bind(next_round_index)
            .bind(now)
            .bind(now)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;

            return Ok((result.last_insert_rowid(), next_round_index));
        }

        let result = sqlx::query(
            "INSERT INTO message_rounds (conversation_id, round_index, status, created_at, updated_at) \
             VALUES (?, 1, 'collecting', ?, ?)",
        )
        .bind(conversation_id)
        .bind(now)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        Ok((result.last_insert_rowid(), 1))
    }

    pub async fn create_next(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        conversation_id: i64,
        now: i64,
    ) -> Result<i64, String> {
        let new_round_index: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(round_index), 0) + 1 FROM message_rounds WHERE conversation_id = ?",
        )
        .bind(conversation_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        let result = sqlx::query(
            "INSERT INTO message_rounds (conversation_id, round_index, status, aggregated_user_content, created_at, updated_at) \
             VALUES (?, ?, 'collecting', NULL, ?, ?)",
        )
        .bind(conversation_id)
        .bind(new_round_index)
        .bind(now)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        Ok(result.last_insert_rowid())
    }

    pub async fn set_streaming(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
        aggregated_user_content: &str,
        aggregate_message_id: i64,
        active_assistant_message_id: i64,
        now: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "UPDATE message_rounds \
             SET status = 'streaming', aggregated_user_content = ?, aggregate_message_id = ?, \
                 active_assistant_message_id = ?, updated_at = ?, completed_at = NULL \
             WHERE id = ?",
        )
        .bind(aggregated_user_content)
        .bind(aggregate_message_id)
        .bind(active_assistant_message_id)
        .bind(now)
        .bind(round_id)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn set_streaming_regenerate(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
        active_assistant_message_id: i64,
        now: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "UPDATE message_rounds \
             SET status = 'streaming', active_assistant_message_id = ?, updated_at = ?, completed_at = NULL \
             WHERE id = ?",
        )
        .bind(active_assistant_message_id)
        .bind(now)
        .bind(round_id)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn set_streaming_tool_result(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
        aggregated_user_content: &str,
        aggregate_message_id: i64,
        active_assistant_message_id: i64,
        now: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "UPDATE message_rounds \
             SET status = 'streaming', aggregated_user_content = ?, aggregate_message_id = ?, \
                 active_assistant_message_id = ?, updated_at = ? \
             WHERE id = ?",
        )
        .bind(aggregated_user_content)
        .bind(aggregate_message_id)
        .bind(active_assistant_message_id)
        .bind(now)
        .bind(round_id)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn mark_completed(
        db: &SqlitePool,
        round_id: i64,
        assistant_message_id: i64,
    ) -> Result<(), String> {
        let now = now_ts();
        sqlx::query(
            "UPDATE message_rounds \
             SET status = 'completed', active_assistant_message_id = ?, updated_at = ?, completed_at = ? \
             WHERE id = ?",
        )
        .bind(assistant_message_id)
        .bind(now)
        .bind(now)
        .bind(round_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn mark_failed(db: &SqlitePool, round_id: i64) -> Result<(), String> {
        let now = now_ts();
        sqlx::query(
            "UPDATE message_rounds SET status = 'failed', updated_at = ?, completed_at = NULL WHERE id = ?",
        )
        .bind(now)
        .bind(round_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn update_timestamp(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
        now: i64,
    ) -> Result<(), String> {
        sqlx::query("UPDATE message_rounds SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(round_id)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn set_active_assistant_message(
        db: &SqlitePool,
        round_id: i64,
        target_message_id: i64,
    ) -> Result<(), String> {
        sqlx::query("UPDATE message_rounds SET active_assistant_message_id = ? WHERE id = ?")
            .bind(target_message_id)
            .bind(round_id)
            .execute(db)
            .await
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn find_aggregate_message_id(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
        conversation_id: i64,
    ) -> Result<i64, String> {
        let round_row = sqlx::query(
            "SELECT aggregate_message_id FROM message_rounds WHERE id = ? AND conversation_id = ?",
        )
        .bind(round_id)
        .bind(conversation_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "指定轮次不存在".to_string())?;

        let aggregate_message_id: Option<i64> = round_row.try_get("aggregate_message_id").ok();
        aggregate_message_id.ok_or_else(|| "该轮次尚未形成聚合请求体".to_string())
    }

    pub async fn load_state(
        db: &SqlitePool,
        conversation_id: i64,
        round_id: Option<i64>,
    ) -> Result<RoundState, String> {
        let round_row = match round_id {
            Some(target_round_id) => sqlx::query(
                "SELECT id, conversation_id, round_index, status, aggregated_user_content, active_assistant_message_id, updated_at \
                 FROM message_rounds WHERE id = ? AND conversation_id = ? LIMIT 1",
            )
            .bind(target_round_id)
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?,
            None => sqlx::query(
                "SELECT id, conversation_id, round_index, status, aggregated_user_content, active_assistant_message_id, updated_at \
                 FROM message_rounds WHERE conversation_id = ? ORDER BY round_index DESC LIMIT 1",
            )
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?,
        };

        if let Some(row) = round_row {
            let current_round_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
            let required_member_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ? AND is_active = 1",
            )
            .bind(conversation_id)
            .fetch_one(db)
            .await
            .map_err(|err| err.to_string())?;
            let decided_member_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM round_member_actions WHERE round_id = ?")
                    .bind(current_round_id)
                    .fetch_one(db)
                    .await
                    .map_err(|err| err.to_string())?;

            let waiting_rows = sqlx::query(
                "SELECT m.id \
                 FROM conversation_members m \
                 WHERE m.conversation_id = ? AND m.is_active = 1 \
                   AND NOT EXISTS (
                        SELECT 1 FROM round_member_actions a
                        WHERE a.round_id = ? AND a.member_id = m.id
                   ) \
                 ORDER BY m.join_order ASC",
            )
            .bind(conversation_id)
            .bind(current_round_id)
            .fetch_all(db)
            .await
            .map_err(|err| err.to_string())?;
            let waiting_member_ids = waiting_rows
                .into_iter()
                .map(|row| row.try_get("id").unwrap_or_default())
                .collect();

            return Ok(RoundState {
                round_id: current_round_id,
                conversation_id: row
                    .try_get("conversation_id")
                    .map_err(|err| err.to_string())?,
                round_index: row.try_get("round_index").map_err(|err| err.to_string())?,
                status: row.try_get("status").map_err(|err| err.to_string())?,
                required_member_count,
                decided_member_count,
                waiting_member_ids,
                aggregated_user_content: row.try_get("aggregated_user_content").ok(),
                active_assistant_message_id: row.try_get("active_assistant_message_id").ok(),
                updated_at: row.try_get("updated_at").map_err(|err| err.to_string())?,
            });
        }

        let waiting_rows = sqlx::query(
            "SELECT id FROM conversation_members WHERE conversation_id = ? AND is_active = 1 ORDER BY join_order ASC",
        )
        .bind(conversation_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;
        let waiting_member_ids = waiting_rows
            .into_iter()
            .map(|row| row.try_get("id").unwrap_or_default())
            .collect::<Vec<i64>>();

        Ok(RoundState {
            round_id: 0,
            conversation_id,
            round_index: 0,
            status: "collecting".to_string(),
            required_member_count: waiting_member_ids.len() as i64,
            decided_member_count: 0,
            waiting_member_ids,
            aggregated_user_content: None,
            active_assistant_message_id: None,
            updated_at: now_ts(),
        })
    }

    pub async fn count_active_members(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        conversation_id: i64,
    ) -> Result<i64, String> {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ? AND is_active = 1",
        )
        .bind(conversation_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|err| err.to_string())
    }

    pub async fn count_decided_members(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
    ) -> Result<i64, String> {
        sqlx::query_scalar("SELECT COUNT(*) FROM round_member_actions WHERE round_id = ?")
            .bind(round_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|err| err.to_string())
    }

    pub async fn member_already_decided(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
        member_id: i64,
    ) -> Result<bool, String> {
        let already_decided: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM round_member_actions WHERE round_id = ? AND member_id = ? LIMIT 1",
        )
        .bind(round_id)
        .bind(member_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        Ok(already_decided.is_some())
    }

    pub async fn insert_member_action(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
        member_id: i64,
        action_type: &str,
        content: &str,
        now: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO round_member_actions (round_id, member_id, action_type, content, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(round_id)
        .bind(member_id)
        .bind(action_type)
        .bind(content)
        .bind(now)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn build_aggregated_user_content(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        round_id: i64,
        conversation_type: &str,
    ) -> Result<String, String> {
        let rows = sqlx::query(
            "SELECT a.action_type, a.content, m.display_name \
             FROM round_member_actions a \
             JOIN conversation_members m ON m.id = a.member_id \
             WHERE a.round_id = ? \
             ORDER BY a.created_at ASC, a.id ASC",
        )
        .bind(round_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        if conversation_type == "online" {
            let count = rows.len();
            let player_names: Vec<String> = rows
                .iter()
                .map(|row| {
                    row.try_get("display_name")
                        .unwrap_or_else(|_| "成员".to_string())
                })
                .collect();

            let header = format!("【本轮 · {}名玩家参与】{}", count, player_names.join(" "));

            let mut lines = Vec::with_capacity(rows.len() + 2);
            lines.push(header);
            lines.push("---".to_string());

            for row in &rows {
                let action_type: String =
                    row.try_get("action_type").map_err(|err| err.to_string())?;
                let content: String = row.try_get("content").unwrap_or_default();
                let display_name: String = row
                    .try_get("display_name")
                    .unwrap_or_else(|_| "成员".to_string());

                if action_type == "skipped" {
                    lines.push(format!("{}: （本轮放弃发言）", display_name));
                } else if content.trim().is_empty() {
                    lines.push(format!("{}: ", display_name));
                } else {
                    lines.push(format!("{}: {}", display_name, content));
                }
            }

            Ok(lines.join("\n"))
        } else {
            let mut lines = Vec::with_capacity(rows.len());
            for row in rows {
                let action_type: String =
                    row.try_get("action_type").map_err(|err| err.to_string())?;
                let content: String = row.try_get("content").unwrap_or_default();
                if action_type == "skipped" {
                    lines.push("本轮放弃发言".to_string());
                } else if !content.trim().is_empty() {
                    lines.push(content);
                }
            }

            Ok(lines.join("\n"))
        }
    }

    pub async fn persist_tool_use_agent_skeleton(
        db: &SqlitePool,
        conversation_id: i64,
        round_id: i64,
        assistant_message_id: i64,
        full_content: &str,
        hidden_parts: &[crate::repositories::message_repository::PendingMessageContentPart],
        pending_tool_use: &crate::repositories::message_repository::PendingToolUseSkeleton,
    ) -> Result<(), String> {
        if !full_content.is_empty() {
            crate::repositories::message_repository::MessageRepository::update_content(
                db,
                assistant_message_id,
                full_content,
            )
            .await?;
        }
        crate::repositories::message_repository::MessageRepository::replace_content_parts(
            db,
            assistant_message_id,
            full_content,
            hidden_parts,
        )
        .await?;

        let now = now_ts();
        let chat_mode =
            crate::repositories::conversation_repository::ConversationRepository::load_chat_mode(
                db,
                conversation_id,
            )
            .await?;
        let orchestration_mode = if chat_mode == "director_agents" {
            "director_agents_tool_use_pending_result"
        } else {
            "classic_tool_use_pending_result"
        };
        let provider_decision = format!(
            "provider_kind=anthropic;tool_use_id={};tool_name={}",
            pending_tool_use.tool_use_id, pending_tool_use.tool_name
        );

        let mut tx = db.begin().await.map_err(|err| err.to_string())?;
        let agent_run_id = sqlx::query(
            "INSERT INTO agent_runs (
                round_id, conversation_id, orchestration_mode, provider_decision, status, started_at, finished_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL)",
        )
        .bind(round_id)
        .bind(conversation_id)
        .bind(orchestration_mode)
        .bind(&provider_decision)
        .bind("pending_tool_result")
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?
        .last_insert_rowid();

        sqlx::query(
            "INSERT INTO agent_drafts (
                run_id, agent_key, character_id, draft_content, draft_intent, status, created_at
             ) VALUES (?, ?, NULL, ?, ?, ?, ?)",
        )
        .bind(agent_run_id)
        .bind(format!("tool:{}", pending_tool_use.tool_name))
        .bind(normalize_tool_use_input_json(&pending_tool_use.input_json))
        .bind(Some(pending_tool_use.tool_name.clone()))
        .bind("pending_tool_result")
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "INSERT OR REPLACE INTO message_tool_calls (
                message_id, tool_use_id, tool_name, input_json, status, result_message_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
        )
        .bind(assistant_message_id)
        .bind(&pending_tool_use.tool_use_id)
        .bind(&pending_tool_use.tool_name)
        .bind(normalize_tool_use_input_json(&pending_tool_use.input_json))
        .bind("pending")
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

        tx.commit().await.map_err(|err| err.to_string())?;
        Ok(())
    }
}

fn normalize_tool_use_input_json(input_json: &str) -> String {
    let trimmed = input_json.trim();
    if trimmed.is_empty() {
        "{}".to_string()
    } else {
        trimmed.to_string()
    }
}

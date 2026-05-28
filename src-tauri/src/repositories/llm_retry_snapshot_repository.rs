use sqlx::{Row, SqlitePool};

use crate::llm::ProviderHttpRequest;
use crate::services::prompt_compiler::{
    validate_output_text_with_retry_snapshot, RetryOutputValidatorSnapshot,
};
use crate::utils::now_ts;

const STATUS_PREPARED: &str = "prepared";
const STATUS_RUNNING: &str = "running";
const STATUS_FAILED: &str = "failed";
const STATUS_SUCCEEDED: &str = "succeeded";
const STATUS_ABORTED: &str = "aborted";

#[derive(Debug, Clone)]
pub struct RetrySnapshotRecord {
    pub round_id: i64,
    pub conversation_id: i64,
    pub assistant_message_id: i64,
    pub provider_id: i64,
    pub provider_kind: String,
    pub model_name: String,
    pub response_mode: Option<String>,
    pub request: ProviderHttpRequest,
    pub validation_rules: Vec<RetryOutputValidatorSnapshot>,
    pub status: String,
    pub attempt_count: i64,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_started_at: Option<i64>,
    pub last_succeeded_at: Option<i64>,
    pub last_aborted_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct RetrySnapshotSeed {
    pub round_id: i64,
    pub conversation_id: i64,
    pub assistant_message_id: i64,
    pub provider_id: i64,
    pub provider_kind: String,
    pub model_name: String,
    pub response_mode: Option<String>,
    pub request: ProviderHttpRequest,
    pub validation_rules: Vec<RetryOutputValidatorSnapshot>,
}

pub struct RetrySnapshotRepository;

impl RetrySnapshotRepository {
    pub async fn ensure_prepared(
        db: &SqlitePool,
        seed: RetrySnapshotSeed,
    ) -> Result<(), String> {
        let now = now_ts();
        let request_snapshot_json = serde_json::to_string(&seed.request).map_err(|err| err.to_string())?;
        let validation_snapshot_json = serde_json::to_string(&seed.validation_rules).map_err(|err| err.to_string())?;

        sqlx::query(
            "INSERT OR IGNORE INTO llm_retry_snapshots (
                round_id, conversation_id, assistant_message_id, provider_id, provider_kind,
                model_name, response_mode, request_snapshot_json, validation_snapshot_json,
                status, attempt_count, last_error, created_at, updated_at,
                last_started_at, last_succeeded_at, last_aborted_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL, NULL, NULL)",
        )
        .bind(seed.round_id)
        .bind(seed.conversation_id)
        .bind(seed.assistant_message_id)
        .bind(seed.provider_id)
        .bind(&seed.provider_kind)
        .bind(&seed.model_name)
        .bind(&seed.response_mode)
        .bind(request_snapshot_json)
        .bind(validation_snapshot_json)
        .bind(STATUS_PREPARED)
        .bind(now)
        .bind(now)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub async fn load_by_round(
        db: &SqlitePool,
        round_id: i64,
    ) -> Result<Option<RetrySnapshotRecord>, String> {
        let row = sqlx::query(
            "SELECT round_id, conversation_id, assistant_message_id, provider_id, provider_kind,
                    model_name, response_mode, request_snapshot_json, validation_snapshot_json,
                    status, attempt_count, last_error, created_at, updated_at,
                    last_started_at, last_succeeded_at, last_aborted_at
             FROM llm_retry_snapshots
             WHERE round_id = ?
             LIMIT 1",
        )
        .bind(round_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?;

        match row {
            None => Ok(None),
            Some(row) => Ok(Some(Self::row_to_record(row)?)),
        }
    }

    pub async fn mark_attempt_started(
        db: &SqlitePool,
        round_id: i64,
    ) -> Result<RetrySnapshotRecord, String> {
        let now = now_ts();
        sqlx::query(
            "UPDATE llm_retry_snapshots
             SET status = ?, attempt_count = attempt_count + 1, last_error = NULL,
                 updated_at = ?, last_started_at = ?
             WHERE round_id = ?",
        )
        .bind(STATUS_RUNNING)
        .bind(now)
        .bind(now)
        .bind(round_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;

        Self::load_by_round(db, round_id)
            .await?
            .ok_or_else(|| "retry snapshot not found".to_string())
    }

    pub async fn mark_failed(
        db: &SqlitePool,
        round_id: i64,
        error: &str,
    ) -> Result<(), String> {
        let now = now_ts();
        sqlx::query(
            "UPDATE llm_retry_snapshots
             SET status = ?, last_error = ?, updated_at = ?
             WHERE round_id = ?",
        )
        .bind(STATUS_FAILED)
        .bind(error)
        .bind(now)
        .bind(round_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn mark_succeeded(
        db: &SqlitePool,
        round_id: i64,
    ) -> Result<(), String> {
        let now = now_ts();
        sqlx::query(
            "UPDATE llm_retry_snapshots
             SET status = ?, last_error = NULL, updated_at = ?, last_succeeded_at = ?
             WHERE round_id = ?",
        )
        .bind(STATUS_SUCCEEDED)
        .bind(now)
        .bind(now)
        .bind(round_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn mark_aborted(
        db: &SqlitePool,
        round_id: i64,
    ) -> Result<(), String> {
        let now = now_ts();
        sqlx::query(
            "UPDATE llm_retry_snapshots
             SET status = ?, last_error = NULL, updated_at = ?, last_aborted_at = ?
             WHERE round_id = ?",
        )
        .bind(STATUS_ABORTED)
        .bind(now)
        .bind(now)
        .bind(round_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn recover_running_snapshots(db: &SqlitePool) -> Result<(), String> {
        let rows = sqlx::query(
            "SELECT round_id, conversation_id, assistant_message_id
             FROM llm_retry_snapshots
             WHERE status = ?",
        )
        .bind(STATUS_RUNNING)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        if rows.is_empty() {
            return Ok(());
        }

        let now = now_ts();
        for row in rows {
            let round_id: i64 = row.try_get("round_id").map_err(|err| err.to_string())?;
            let assistant_message_id: i64 = row.try_get("assistant_message_id").map_err(|err| err.to_string())?;
            sqlx::query(
                "UPDATE llm_retry_snapshots
                 SET status = ?, last_error = ?, updated_at = ?
                 WHERE round_id = ?",
            )
            .bind(STATUS_FAILED)
            .bind("应用重启后自动重试已中断")
            .bind(now)
            .bind(round_id)
            .execute(db)
            .await
            .map_err(|err| err.to_string())?;

            let maybe_round: Option<(String, Option<i64>)> = sqlx::query_as(
                "SELECT status, active_assistant_message_id FROM message_rounds WHERE id = ? LIMIT 1",
            )
            .bind(round_id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?;

            if let Some((status, active_assistant_message_id)) = maybe_round {
                if status == "streaming" && active_assistant_message_id == Some(assistant_message_id) {
                    sqlx::query(
                        "UPDATE message_rounds
                         SET status = 'failed', updated_at = ?, completed_at = NULL
                         WHERE id = ?",
                    )
                    .bind(now)
                    .bind(round_id)
                    .execute(db)
                    .await
                    .map_err(|err| err.to_string())?;
                }
            }
        }

        Ok(())
    }

    pub fn validate_snapshot_rules(
        content: &str,
        rules: &[RetryOutputValidatorSnapshot],
    ) -> Result<(), String> {
        validate_output_text_with_retry_snapshot(content, rules)
    }

    fn row_to_record(row: sqlx::sqlite::SqliteRow) -> Result<RetrySnapshotRecord, String> {
        let request_snapshot_json: String = row.try_get("request_snapshot_json").map_err(|err| err.to_string())?;
        let validation_snapshot_json: String = row.try_get("validation_snapshot_json").map_err(|err| err.to_string())?;
        let request: ProviderHttpRequest = serde_json::from_str(&request_snapshot_json)
            .map_err(|err| format!("failed to decode retry request snapshot: {err}"))?;
        let validation_rules: Vec<RetryOutputValidatorSnapshot> = serde_json::from_str(&validation_snapshot_json)
            .map_err(|err| format!("failed to decode retry validation snapshot: {err}"))?;

        Ok(RetrySnapshotRecord {
            round_id: row.try_get("round_id").map_err(|err| err.to_string())?,
            conversation_id: row.try_get("conversation_id").map_err(|err| err.to_string())?,
            assistant_message_id: row.try_get("assistant_message_id").map_err(|err| err.to_string())?,
            provider_id: row.try_get("provider_id").map_err(|err| err.to_string())?,
            provider_kind: row.try_get("provider_kind").map_err(|err| err.to_string())?,
            model_name: row.try_get("model_name").map_err(|err| err.to_string())?,
            response_mode: row.try_get("response_mode").ok(),
            request,
            validation_rules,
            status: row.try_get("status").map_err(|err| err.to_string())?,
            attempt_count: row.try_get("attempt_count").map_err(|err| err.to_string())?,
            last_error: row.try_get("last_error").ok(),
            created_at: row.try_get("created_at").map_err(|err| err.to_string())?,
            updated_at: row.try_get("updated_at").map_err(|err| err.to_string())?,
            last_started_at: row.try_get("last_started_at").ok(),
            last_succeeded_at: row.try_get("last_succeeded_at").ok(),
            last_aborted_at: row.try_get("last_aborted_at").ok(),
        })
    }
}

use sqlx::{Row, SqlitePool, Transaction};

use crate::models::ApiProvider;

pub struct ConversationRepository;

impl ConversationRepository {
    pub async fn find_host_member_id(db: &SqlitePool, conversation_id: i64) -> Result<i64, String> {
        sqlx::query_scalar(
            "SELECT id FROM conversation_members \
             WHERE conversation_id = ? AND member_role = 'host' AND is_active = 1 \
             ORDER BY join_order ASC LIMIT 1",
        )
        .bind(conversation_id)
        .fetch_one(db)
        .await
        .map_err(|err| err.to_string())
    }

    pub async fn ensure_member_is_host(
        db: &SqlitePool,
        conversation_id: i64,
        member_id: i64,
    ) -> Result<(), String> {
        let member_role: Option<String> = sqlx::query_scalar(
            "SELECT member_role FROM conversation_members WHERE id = ? AND conversation_id = ? AND is_active = 1 LIMIT 1",
        )
        .bind(member_id)
        .bind(conversation_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?;

        match member_role.as_deref() {
            Some("host") => Ok(()),
            _ => Err("权限不足：只有房主可以执行此操作".to_string()),
        }
    }

    pub async fn ensure_member_active(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        conversation_id: i64,
        member_id: i64,
    ) -> Result<(), String> {
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM conversation_members WHERE id = ? AND conversation_id = ? AND is_active = 1 LIMIT 1",
        )
        .bind(member_id)
        .bind(conversation_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        if exists.is_none() {
            return Err("指定成员不存在或未激活".to_string());
        }

        Ok(())
    }

    pub async fn resolve_provider_id(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        conversation_id: i64,
        provider_id_override: Option<i64>,
    ) -> Result<i64, String> {
        let current_provider_id: Option<i64> =
            sqlx::query_scalar("SELECT provider_id FROM conversations WHERE id = ? LIMIT 1")
                .bind(conversation_id)
                .fetch_one(&mut **tx)
                .await
                .map_err(|err| err.to_string())?;

        match (current_provider_id, provider_id_override) {
            (Some(provider_id), _) => Ok(provider_id),
            (None, Some(provider_id)) => {
                sqlx::query("UPDATE conversations SET provider_id = ? WHERE id = ?")
                    .bind(provider_id)
                    .bind(conversation_id)
                    .execute(&mut **tx)
                    .await
                    .map_err(|err| err.to_string())?;
                Ok(provider_id)
            }
            (None, None) => Err("会话尚未绑定 API 档案".to_string()),
        }
    }

    pub async fn load_provider_id(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        conversation_id: i64,
    ) -> Result<Option<i64>, String> {
        sqlx::query_scalar("SELECT provider_id FROM conversations WHERE id = ? LIMIT 1")
            .bind(conversation_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|err| err.to_string())
    }

    pub async fn load_conversation_type(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        conversation_id: i64,
    ) -> Result<String, String> {
        sqlx::query_scalar("SELECT conversation_type FROM conversations WHERE id = ?")
            .bind(conversation_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|err| err.to_string())
    }

    pub async fn update_timestamp(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        conversation_id: i64,
        now: i64,
    ) -> Result<(), String> {
        sqlx::query("UPDATE conversations SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(conversation_id)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn load_chat_mode(db: &SqlitePool, conversation_id: i64) -> Result<String, String> {
        let chat_mode: Option<String> =
            sqlx::query_scalar("SELECT chat_mode FROM conversations WHERE id = ? LIMIT 1")
                .bind(conversation_id)
                .fetch_optional(db)
                .await
                .map_err(|err| err.to_string())?
                .flatten();

        Ok(chat_mode.unwrap_or_else(|| "classic".to_string()))
    }

    pub async fn load_provider(db: &SqlitePool, id: i64) -> Result<ApiProvider, String> {
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
                .unwrap_or_else(|_| "openai_compatible".to_string()),
            base_url: row.try_get("base_url").unwrap_or_default(),
            api_key: row.try_get("api_key").unwrap_or_default(),
            model_name: row.try_get("model_name").unwrap_or_default(),
            max_tokens: row.try_get("max_tokens").ok(),
            max_context_tokens: row.try_get("max_context_tokens").ok(),
            temperature: row.try_get("temperature").ok(),
        })
    }
}

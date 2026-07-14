use sqlx::{Row, SqlitePool};
use serde_json;

/// 一条会话级 Gate 选择记录。`selected_keys` 在数据库中以 JSON 数组字符串存储，
/// 读出时反序列化为 `Vec<String>`。MutexGate 通常单元素，GroupGate 可多元素。
#[derive(Debug, Clone)]
pub struct ConversationGateSelection {
    pub conversation_id: i64,
    pub gate_id: String,
    pub selected_keys: Vec<String>,
}

/// 会话 Gate 选择状态仓库。所有方法均为异步且使用运行时绑定（`sqlx::query`），
/// 不依赖编译期 `query!` 宏校验——迁移刚加入时数据库可能尚未应用。
pub struct ConversationGateRepository;

impl ConversationGateRepository {
    /// Upsert 一条 Gate 选择。当 `selected_keys` 为空时改为 DELETE，
    /// 避免在表中遗留 `[]` 垃圾行（空选择即无选择，应回到未配置状态）。
    pub async fn upsert(
        db: &SqlitePool,
        conversation_id: i64,
        gate_id: &str,
        selected_keys: &[String],
    ) -> Result<(), String> {
        if selected_keys.is_empty() {
            return Self::delete(db, conversation_id, gate_id).await;
        }

        let payload = serde_json::to_string(selected_keys).map_err(|err| err.to_string())?;

        sqlx::query(
            "INSERT INTO conversation_gate_selections \
             (conversation_id, gate_id, selected_keys) \
             VALUES (?, ?, ?) \
             ON CONFLICT(conversation_id, gate_id) DO UPDATE SET selected_keys = excluded.selected_keys",
        )
        .bind(conversation_id)
        .bind(gate_id)
        .bind(payload)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    /// 加载一个会话下的全部 Gate 选择，按 gate_id 升序返回。
    pub async fn load_by_conversation(
        db: &SqlitePool,
        conversation_id: i64,
    ) -> Result<Vec<ConversationGateSelection>, String> {
        let rows = sqlx::query(
            "SELECT conversation_id, gate_id, selected_keys \
             FROM conversation_gate_selections \
             WHERE conversation_id = ? \
             ORDER BY gate_id ASC",
        )
        .bind(conversation_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        rows.into_iter().map(Self::row_to_selection).collect()
    }

    /// 按 (conversation_id, gate_id) 加载单条选择记录，不存在时返回 `None`。
    pub async fn load_one(
        db: &SqlitePool,
        conversation_id: i64,
        gate_id: &str,
    ) -> Result<Option<ConversationGateSelection>, String> {
        let row = sqlx::query(
            "SELECT conversation_id, gate_id, selected_keys \
             FROM conversation_gate_selections \
             WHERE conversation_id = ? AND gate_id = ? \
             LIMIT 1",
        )
        .bind(conversation_id)
        .bind(gate_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?;

        row.map(Self::row_to_selection).transpose()
    }

    /// 删除单条 Gate 选择（用户清除某 Gate 的选择时调用）。
    /// 不存在对应行时视为成功（幂等）。
    pub async fn delete(
        db: &SqlitePool,
        conversation_id: i64,
        gate_id: &str,
    ) -> Result<(), String> {
        sqlx::query(
            "DELETE FROM conversation_gate_selections \
             WHERE conversation_id = ? AND gate_id = ?",
        )
        .bind(conversation_id)
        .bind(gate_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    /// 删除一个会话下的全部 Gate 选择（会话删除清理时调用）。
    /// 表上已建 `ON DELETE CASCADE` 外键，此方法用于显式清理或无外键级联的场景。
    pub async fn delete_by_conversation(
        db: &SqlitePool,
        conversation_id: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "DELETE FROM conversation_gate_selections WHERE conversation_id = ?",
        )
        .bind(conversation_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    /// 将数据库行解析为 `ConversationGateSelection`，反序列化 `selected_keys` JSON。
    fn row_to_selection(row: sqlx::sqlite::SqliteRow) -> Result<ConversationGateSelection, String> {
        let conversation_id: i64 = row.try_get("conversation_id").map_err(|err| err.to_string())?;
        let gate_id: String = row.try_get("gate_id").map_err(|err| err.to_string())?;
        let raw: String = row.try_get("selected_keys").map_err(|err| err.to_string())?;
        let selected_keys: Vec<String> =
            serde_json::from_str(&raw).map_err(|err| err.to_string())?;
        Ok(ConversationGateSelection {
            conversation_id,
            gate_id,
            selected_keys,
        })
    }
}

//! 每轮状态快照仓储（工单 04）：`RoundSnapshot` 事务基线。
//!
//! 每轮 Agent 执行开始前，把会话当前 `game_state`（`session_states.state_json`
//! 的 `DataContainer`）完整捕获为该轮的快照基线。此后无论该轮的工具调用如何
//! 扣款/增减背包，`Regenerate` / `Delete` / `Rewind` 都能把状态原子还原到
//! 基线，杜绝重复扣款与数据膨胀（spec §5）。
//!
//! 捕获语义：**首次捕获为准**（`INSERT OR IGNORE`）——同轮的自动重试、失败
//! 重试与重新生成都会再次进入执行入口，若覆盖基线，基线会被已突变的状态
//! 污染，回滚将失去意义。

use sqlx::{Row, SqlitePool};

use crate::models::game_state::DataContainer;
use crate::services::agent_runtime::{load_session_state, save_session_state};

/// 一轮执行前的状态快照基线。
#[derive(Debug, Clone, PartialEq)]
pub struct RoundSnapshot {
    pub conversation_id: i64,
    pub round_id: i64,
    pub round_index: i64,
    pub state: DataContainer,
    pub captured_at: i64,
}

pub struct RoundSnapshotRepository;

impl RoundSnapshotRepository {
    /// 捕获某轮的执行前基线快照。
    ///
    /// 读取目标轮次的 `round_index` 与会话当前持久化状态（直读 DB：回合内
    /// 暂存缓存不属于基线），以 `INSERT OR IGNORE` 写入。返回 `true` 表示
    /// 本次写入了新基线，`false` 表示基线已存在（保持首次捕获）。
    pub async fn capture_baseline(
        db: &SqlitePool,
        conversation_id: i64,
        round_id: i64,
    ) -> Result<bool, String> {
        let round_index: i64 = sqlx::query_scalar(
            "SELECT round_index FROM message_rounds WHERE id = ? AND conversation_id = ?",
        )
        .bind(round_id)
        .bind(conversation_id)
        .fetch_optional(db)
        .await
        .map_err(|e| format!("查询轮次索引失败: {}", e).replace('\\', "/"))?
        .ok_or_else(|| {
            format!(
                "捕获快照失败：轮次不存在 round_id={}, conversation_id={}",
                round_id, conversation_id
            )
        })?;

        let state = load_session_state(db, conversation_id).await?;
        let state_json = serde_json::to_string(&state)
            .map_err(|e| format!("序列化快照状态失败: {}", e).replace('\\', "/"))?;
        let now = crate::utils::now_ts();

        let result = sqlx::query(
            "INSERT OR IGNORE INTO round_snapshots \
             (conversation_id, round_id, round_index, state_json, captured_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(conversation_id)
        .bind(round_id)
        .bind(round_index)
        .bind(state_json)
        .bind(now)
        .execute(db)
        .await
        .map_err(|e| format!("写入轮次快照失败: {}", e).replace('\\', "/"))?;

        Ok(result.rows_affected() > 0)
    }

    /// 读取某轮的快照基线（不存在返回 `None`）。
    pub async fn load(
        db: &SqlitePool,
        conversation_id: i64,
        round_id: i64,
    ) -> Result<Option<RoundSnapshot>, String> {
        let row_opt = sqlx::query(
            "SELECT round_index, state_json, captured_at FROM round_snapshots \
             WHERE conversation_id = ? AND round_id = ?",
        )
        .bind(conversation_id)
        .bind(round_id)
        .fetch_optional(db)
        .await
        .map_err(|e| format!("查询轮次快照失败: {}", e).replace('\\', "/"))?;

        match row_opt {
            None => Ok(None),
            Some(row) => {
                let state_json: String = row
                    .try_get("state_json")
                    .map_err(|e| format!("读取快照 state_json 失败: {}", e).replace('\\', "/"))?;
                let state: DataContainer = serde_json::from_str(&state_json)
                    .map_err(|e| format!("解析快照状态失败: {}", e).replace('\\', "/"))?;
                Ok(Some(RoundSnapshot {
                    conversation_id,
                    round_id,
                    round_index: row
                        .try_get("round_index")
                        .map_err(|e| format!("读取快照 round_index 失败: {}", e).replace('\\', "/"))?,
                    state,
                    captured_at: row
                        .try_get("captured_at")
                        .map_err(|e| format!("读取快照 captured_at 失败: {}", e).replace('\\', "/"))?,
                }))
            }
        }
    }

    /// 把会话状态原子还原到某轮的快照基线。
    ///
    /// 返回 `true` 表示已还原；`false` 表示该轮没有基线（本功能上线前产生
    /// 的历史轮次），调用方按「无基线可回滚」继续，不视为错误。
    pub async fn restore(
        db: &SqlitePool,
        conversation_id: i64,
        round_id: i64,
    ) -> Result<bool, String> {
        match Self::load(db, conversation_id, round_id).await? {
            None => Ok(false),
            Some(snapshot) => {
                save_session_state(db, conversation_id, &snapshot.state).await?;
                Ok(true)
            }
        }
    }

    /// 删除某轮的快照基线（该轮被彻底删除时调用）。
    pub async fn delete_for_round(
        db: &SqlitePool,
        conversation_id: i64,
        round_id: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "DELETE FROM round_snapshots WHERE conversation_id = ? AND round_id = ?",
        )
        .bind(conversation_id)
        .bind(round_id)
        .execute(db)
        .await
        .map_err(|e| format!("删除轮次快照失败: {}", e).replace('\\', "/"))?;
        Ok(())
    }

    /// 把源轮次的快照基线克隆到目标会话的目标轮次（Fork 分支用）。
    ///
    /// 「读源基线 → 写目标轮次」的完整复制逻辑收在本仓储内：调用方只给
    /// 源/目标的 `(conversation_id, round_id)`，不需要知道 `state_json`
    /// 的序列化形状、`round_index` 的取值来源或冲突策略（Locality）。
    /// 目标轮的 `round_index` 以目标会话内该轮的实际序号为准写入，使
    /// 克隆出的基线在新分支里同样服从 `delete_after_round_index` 的
    /// 序号级联语义。目标轮不存在时显式报错（C2）；目标轮已有基线时
    /// 同样显式报错——Fork 目标轮是刚新建的轮次，已有基线意味着调用方
    /// 给错了目标，静默覆盖会污染新分支的回滚基线。
    ///
    /// 返回 `true` 表示已克隆；`false` 表示源轮没有基线（本功能上线前
    /// 产生的历史轮次），此时为**显式 no-op**：不写入任何行、不报错，
    /// Fork 流程按「该轮无基线可克隆」继续（与 `restore` 无基线返回
    /// `false` 的既定语义一致），由测试锁定此行为。
    pub async fn clone_snapshot(
        db: &SqlitePool,
        source_conversation_id: i64,
        source_round_id: i64,
        target_conversation_id: i64,
        target_round_id: i64,
    ) -> Result<bool, String> {
        let source = match Self::load(db, source_conversation_id, source_round_id).await? {
            None => return Ok(false),
            Some(snapshot) => snapshot,
        };

        let target_round_index: i64 = sqlx::query_scalar(
            "SELECT round_index FROM message_rounds WHERE id = ? AND conversation_id = ?",
        )
        .bind(target_round_id)
        .bind(target_conversation_id)
        .fetch_optional(db)
        .await
        .map_err(|e| format!("查询克隆目标轮次索引失败: {}", e).replace('\\', "/"))?
        .ok_or_else(|| {
            format!(
                "克隆快照失败：目标轮次不存在 round_id={}, conversation_id={}",
                target_round_id, target_conversation_id
            )
        })?;

        let state_json = serde_json::to_string(&source.state)
            .map_err(|e| format!("序列化克隆快照状态失败: {}", e).replace('\\', "/"))?;
        let now = crate::utils::now_ts();

        sqlx::query(
            "INSERT INTO round_snapshots \
             (conversation_id, round_id, round_index, state_json, captured_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(target_conversation_id)
        .bind(target_round_id)
        .bind(target_round_index)
        .bind(state_json)
        .bind(now)
        .execute(db)
        .await
        .map_err(|e| format!("写入克隆快照失败: {}", e).replace('\\', "/"))?;

        Ok(true)
    }

    /// 删除中间轮时的快照级联失效：删掉被删轮自身的基线，并让其后
    /// 全部轮次（`round_index` 严格大于被删轮）的基线一并失效。
    ///
    /// 语义依据：后续轮次的基线是在「被删轮的突变已经发生」的历史链上
    /// 捕获的，内含被删轮的状态效果。被删轮消失后这些基线即成为陈旧
    /// 基线——若保留，日后对后续轮执行 Regenerate / Delete 还原会把
    /// 已删轮的效果静默复活（C2 意义上的错误数据）。级联失效后，后续
    /// 轮的 `restore` 显式走「无基线」路径（返回 `false`），不再给出
    /// 错误的回滚结果。本方法**不动**会话当前状态：当前状态同时含被删
    /// 轮与后续轮的突变，不存在一个既有快照能表达「去掉被删轮、保留
    /// 后续轮」的状态，强行回退到任一基线都会丢掉后续轮的合法突变。
    ///
    /// 返回被级联失效的后续轮基线条数（不含被删轮自身），供调用方经
    /// 事件向前端明示级联范围。
    pub async fn cascade_invalidate_for_deleted_round(
        db: &SqlitePool,
        conversation_id: i64,
        round_id: i64,
        round_index: i64,
    ) -> Result<u64, String> {
        let later = Self::delete_after_round_index(db, conversation_id, round_index).await?;
        Self::delete_for_round(db, conversation_id, round_id).await?;
        Ok(later)
    }

    /// 级联清理：删除轮次序号严格大于 `round_index` 的全部快照基线
    /// （Rewind 删掉后续轮次时调用；目标轮自身的基线保留）。返回删除行数。
    pub async fn delete_after_round_index(
        db: &SqlitePool,
        conversation_id: i64,
        round_index: i64,
    ) -> Result<u64, String> {
        let result = sqlx::query(
            "DELETE FROM round_snapshots WHERE conversation_id = ? AND round_index > ?",
        )
        .bind(conversation_id)
        .bind(round_index)
        .execute(db)
        .await
        .map_err(|e| format!("级联删除轮次快照失败: {}", e).replace('\\', "/"))?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite::memory:");
        sqlx::migrate!().run(&pool).await.expect("run migrations");
        sqlx::query(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (1, 'test', 0, 0)",
        )
        .execute(&pool)
        .await
        .expect("insert conversation");
        pool
    }

    async fn insert_round(pool: &SqlitePool, round_id: i64, round_index: i64) {
        sqlx::query(
            "INSERT INTO message_rounds (id, conversation_id, round_index, status, created_at, updated_at) \
             VALUES (?, 1, ?, 'completed', 0, 0)",
        )
        .bind(round_id)
        .bind(round_index)
        .execute(pool)
        .await
        .expect("insert round");
    }

    async fn set_gold(pool: &SqlitePool, gold: f64) {
        let mut state = load_session_state(pool, 1).await.expect("load state");
        state.set_stat("gold", gold);
        save_session_state(pool, 1, &state).await.expect("save state");
    }

    async fn gold(pool: &SqlitePool) -> f64 {
        load_session_state(pool, 1)
            .await
            .expect("load state")
            .get_stat("gold")
    }

    /// 工单 04 核心断言：扣款工具执行后 Regenerate，金币准确回滚到基线，
    /// 且回滚后的状态可支撑新一轮正常生成（再次扣款得到正确结果）。
    #[tokio::test]
    async fn test_regenerate_rolls_back_deducted_gold() {
        let pool = setup_test_db().await;
        insert_round(&pool, 10, 1).await;
        set_gold(&pool, 100.0).await;

        // 轮次执行前捕获基线
        assert!(RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("capture"));

        // 模拟本轮工具扣款 60 金币并落盘
        set_gold(&pool, 40.0).await;
        assert_eq!(gold(&pool).await, 40.0);

        // Regenerate 前的原子回滚
        assert!(RoundSnapshotRepository::restore(&pool, 1, 10)
            .await
            .expect("restore"));
        assert_eq!(gold(&pool).await, 100.0, "扣款必须被快照基线完整回滚");

        // 新一轮正常生成：再次扣款从回滚后的基线计算，不重复扣款
        set_gold(&pool, 70.0).await;
        assert_eq!(gold(&pool).await, 70.0);
    }

    /// 首次捕获为准：同轮重试再次捕获不得覆盖原始基线。
    #[tokio::test]
    async fn test_capture_is_first_write_wins() {
        let pool = setup_test_db().await;
        insert_round(&pool, 10, 1).await;
        set_gold(&pool, 100.0).await;
        assert!(RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("first capture"));

        // 状态已突变后再次捕获（如自动重试重新进入执行入口）
        set_gold(&pool, 25.0).await;
        assert!(!RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("second capture ignored"));

        assert!(RoundSnapshotRepository::restore(&pool, 1, 10)
            .await
            .expect("restore"));
        assert_eq!(gold(&pool).await, 100.0, "基线必须保持首次捕获的执行前状态");
    }

    /// 无基线的历史轮次：restore 返回 false 且不动现状态。
    #[tokio::test]
    async fn test_restore_without_snapshot_is_noop() {
        let pool = setup_test_db().await;
        insert_round(&pool, 10, 1).await;
        set_gold(&pool, 55.0).await;
        assert!(!RoundSnapshotRepository::restore(&pool, 1, 10)
            .await
            .expect("restore without snapshot"));
        assert_eq!(gold(&pool).await, 55.0);
    }

    /// Rewind 级联：还原目标轮基线 + 清理其后全部轮次的基线，目标轮基线保留。
    #[tokio::test]
    async fn test_rewind_cascade_restores_target_and_prunes_later() {
        let pool = setup_test_db().await;
        insert_round(&pool, 10, 1).await;
        insert_round(&pool, 11, 2).await;
        insert_round(&pool, 12, 3).await;

        set_gold(&pool, 100.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("capture r1");
        set_gold(&pool, 80.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 11)
            .await
            .expect("capture r2");
        set_gold(&pool, 30.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 12)
            .await
            .expect("capture r3");
        set_gold(&pool, 5.0).await;

        // 回溯到第 2 轮：状态回到第 2 轮基线（80），第 3 轮基线被级联清理
        assert!(RoundSnapshotRepository::restore(&pool, 1, 11)
            .await
            .expect("restore r2"));
        assert_eq!(gold(&pool).await, 80.0);
        let pruned = RoundSnapshotRepository::delete_after_round_index(&pool, 1, 2)
            .await
            .expect("prune later");
        assert_eq!(pruned, 1);
        assert!(RoundSnapshotRepository::load(&pool, 1, 12)
            .await
            .expect("load r3")
            .is_none());
        assert!(RoundSnapshotRepository::load(&pool, 1, 11)
            .await
            .expect("load r2")
            .is_some());
    }

    /// 快照完整往返背包与标志位，不只是数值字典。
    #[tokio::test]
    async fn test_snapshot_roundtrips_inventory_and_flags() {
        let pool = setup_test_db().await;
        insert_round(&pool, 10, 1).await;

        let mut state = DataContainer::new();
        state.set_stat("gold", 12.0);
        state.inventory.push(crate::models::game_state::InventoryItem {
            id: "torch".to_string(),
            name: "火把".to_string(),
            count: 2,
            unit_weight: 0.5,
            unit_price: 3.0,
            icon: None,
            properties: Default::default(),
        });
        state.flags.insert("met_npc".to_string(), "true".to_string());
        save_session_state(&pool, 1, &state).await.expect("save");

        RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("capture");

        // 本轮把背包清空、标志位置反
        let mut mutated = load_session_state(&pool, 1).await.expect("load");
        mutated.inventory.clear();
        mutated.flags.insert("met_npc".to_string(), "false".to_string());
        save_session_state(&pool, 1, &mutated).await.expect("save mutated");

        assert!(RoundSnapshotRepository::restore(&pool, 1, 10)
            .await
            .expect("restore"));
        let restored = load_session_state(&pool, 1).await.expect("load restored");
        assert_eq!(restored.inventory.len(), 1);
        assert_eq!(restored.inventory[0].count, 2);
        assert_eq!(restored.flags.get("met_npc").map(String::as_str), Some("true"));
    }

    async fn insert_conversation(pool: &SqlitePool, conversation_id: i64) {
        sqlx::query(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, 'fork-target', 0, 0)",
        )
        .bind(conversation_id)
        .execute(pool)
        .await
        .expect("insert conversation");
    }

    async fn insert_round_in(
        pool: &SqlitePool,
        conversation_id: i64,
        round_id: i64,
        round_index: i64,
    ) {
        sqlx::query(
            "INSERT INTO message_rounds (id, conversation_id, round_index, status, created_at, updated_at) \
             VALUES (?, ?, ?, 'completed', 0, 0)",
        )
        .bind(round_id)
        .bind(conversation_id)
        .bind(round_index)
        .execute(pool)
        .await
        .expect("insert round in conversation");
    }

    async fn set_gold_in(pool: &SqlitePool, conversation_id: i64, gold: f64) {
        let mut state = load_session_state(pool, conversation_id)
            .await
            .expect("load state");
        state.set_stat("gold", gold);
        save_session_state(pool, conversation_id, &state)
            .await
            .expect("save state");
    }

    async fn gold_in(pool: &SqlitePool, conversation_id: i64) -> f64 {
        load_session_state(pool, conversation_id)
            .await
            .expect("load state")
            .get_stat("gold")
    }

    /// Fork 克隆（阶段 1a）：源轮基线克隆到新分支对应轮后，新分支对该轮
    /// restore 必须得到源轮基线值（而非新分支当时的现状态）。
    #[tokio::test]
    async fn test_clone_snapshot_lets_fork_restore_source_baseline() {
        let pool = setup_test_db().await;
        insert_conversation(&pool, 2).await;
        insert_round(&pool, 10, 1).await;
        insert_round_in(&pool, 2, 20, 1).await;

        set_gold(&pool, 100.0).await;
        assert!(RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("capture source"));
        // 源会话在本轮内扣款到 40；新分支的现状态先置为无关值 7
        set_gold(&pool, 40.0).await;
        set_gold_in(&pool, 2, 7.0).await;

        assert!(RoundSnapshotRepository::clone_snapshot(&pool, 1, 10, 2, 20)
            .await
            .expect("clone snapshot"));

        let cloned = RoundSnapshotRepository::load(&pool, 2, 20)
            .await
            .expect("load cloned")
            .expect("cloned snapshot must exist");
        assert_eq!(cloned.state.get_stat("gold"), 100.0);
        assert_eq!(cloned.round_index, 1);

        assert!(RoundSnapshotRepository::restore(&pool, 2, 20)
            .await
            .expect("restore in fork"));
        assert_eq!(gold_in(&pool, 2).await, 100.0, "新分支 restore 必须得到源轮基线值");
    }

    /// Fork 克隆后两边互不影响：删掉源侧基线不连带新分支；新分支 restore
    /// 不改变源会话的现状态。
    #[tokio::test]
    async fn test_clone_snapshot_branches_are_independent() {
        let pool = setup_test_db().await;
        insert_conversation(&pool, 2).await;
        insert_round(&pool, 10, 1).await;
        insert_round_in(&pool, 2, 20, 1).await;

        set_gold(&pool, 100.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("capture source");
        set_gold(&pool, 40.0).await;
        assert!(RoundSnapshotRepository::clone_snapshot(&pool, 1, 10, 2, 20)
            .await
            .expect("clone snapshot"));

        // 源侧删除基线，新分支基线必须还在
        RoundSnapshotRepository::delete_for_round(&pool, 1, 10)
            .await
            .expect("delete source snapshot");
        assert!(RoundSnapshotRepository::load(&pool, 1, 10)
            .await
            .expect("load source")
            .is_none());
        assert!(RoundSnapshotRepository::load(&pool, 2, 20)
            .await
            .expect("load fork")
            .is_some());

        // 新分支 restore 只动新分支自己的会话状态
        set_gold_in(&pool, 2, 3.0).await;
        assert!(RoundSnapshotRepository::restore(&pool, 2, 20)
            .await
            .expect("restore fork"));
        assert_eq!(gold_in(&pool, 2).await, 100.0);
        assert_eq!(gold(&pool).await, 40.0, "源会话现状态不得被新分支 restore 串改");
    }

    /// 源轮无快照时 clone 为显式 no-op（返回 false、不写行、不报错），
    /// 与 Fork 面对历史轮次（无基线）的既定语义一致。
    #[tokio::test]
    async fn test_clone_snapshot_without_source_baseline_is_explicit_noop() {
        let pool = setup_test_db().await;
        insert_conversation(&pool, 2).await;
        insert_round(&pool, 10, 1).await;
        insert_round_in(&pool, 2, 20, 1).await;

        assert!(!RoundSnapshotRepository::clone_snapshot(&pool, 1, 10, 2, 20)
            .await
            .expect("clone without source baseline must not error"));
        assert!(RoundSnapshotRepository::load(&pool, 2, 20)
            .await
            .expect("load target")
            .is_none());
    }

    /// 克隆目标轮不存在时显式报错（C2），不得静默成功。
    #[tokio::test]
    async fn test_clone_snapshot_missing_target_round_is_error() {
        let pool = setup_test_db().await;
        insert_conversation(&pool, 2).await;
        insert_round(&pool, 10, 1).await;
        set_gold(&pool, 100.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("capture source");

        let err = RoundSnapshotRepository::clone_snapshot(&pool, 1, 10, 2, 999)
            .await
            .expect_err("cloning into a missing target round must fail");
        assert!(err.contains("目标轮次不存在"), "error must name the cause: {err}");
    }

    /// Delete 中间轮级联（阶段 1c）：删中间轮（index=2）后——其自身与
    /// 后续轮（index=3）的基线失效、更早轮（index=1）基线保留、会话现
    /// 状态不动；后续轮此后 restore 显式走无基线路径，不再复活已删轮
    /// 的状态效果（陈旧基线内含已删轮突变）。
    #[tokio::test]
    async fn test_delete_middle_round_cascades_snapshot_invalidation() {
        let pool = setup_test_db().await;
        insert_round(&pool, 10, 1).await;
        insert_round(&pool, 11, 2).await;
        insert_round(&pool, 12, 3).await;

        set_gold(&pool, 100.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("capture r1");
        set_gold(&pool, 80.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 11)
            .await
            .expect("capture r2");
        set_gold(&pool, 30.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 12)
            .await
            .expect("capture r3");
        set_gold(&pool, 5.0).await;

        let invalidated =
            RoundSnapshotRepository::cascade_invalidate_for_deleted_round(&pool, 1, 11, 2)
                .await
                .expect("cascade invalidate");
        assert_eq!(invalidated, 1, "恰好后续一轮（r3）的基线被级联失效");

        assert!(RoundSnapshotRepository::load(&pool, 1, 11)
            .await
            .expect("load deleted round")
            .is_none(), "被删轮自身基线必须删除");
        assert!(RoundSnapshotRepository::load(&pool, 1, 12)
            .await
            .expect("load later round")
            .is_none(), "后续轮基线必须级联失效");
        assert!(RoundSnapshotRepository::load(&pool, 1, 10)
            .await
            .expect("load earlier round")
            .is_some(), "更早轮基线不含被删轮之后的链外依赖，必须保留");

        // 现状态不回退：不存在能表达「去掉 r2、保留 r3」的既有快照
        assert_eq!(gold(&pool).await, 5.0, "删中间轮不得强行回退会话现状态");

        // 后续轮 restore 走无基线路径，不得把含已删轮效果的陈旧基线复活
        assert!(!RoundSnapshotRepository::restore(&pool, 1, 12)
            .await
            .expect("restore later round"));
        assert_eq!(gold(&pool).await, 5.0);
    }

    /// 级联失效的边界：删最后一轮时没有后续轮可失效，返回 0，
    /// 且更早轮基线保留（最后一轮的回滚仍由 restore + delete_for_round
    /// 的既有路径承担，不在本方法内）。
    #[tokio::test]
    async fn test_cascade_invalidate_on_latest_round_touches_no_later_snapshots() {
        let pool = setup_test_db().await;
        insert_round(&pool, 10, 1).await;
        insert_round(&pool, 11, 2).await;

        set_gold(&pool, 100.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 10)
            .await
            .expect("capture r1");
        set_gold(&pool, 80.0).await;
        RoundSnapshotRepository::capture_baseline(&pool, 1, 11)
            .await
            .expect("capture r2");

        let invalidated =
            RoundSnapshotRepository::cascade_invalidate_for_deleted_round(&pool, 1, 11, 2)
                .await
                .expect("cascade invalidate latest");
        assert_eq!(invalidated, 0);
        assert!(RoundSnapshotRepository::load(&pool, 1, 11)
            .await
            .expect("load deleted")
            .is_none());
        assert!(RoundSnapshotRepository::load(&pool, 1, 10)
            .await
            .expect("load earlier")
            .is_some());
    }
}

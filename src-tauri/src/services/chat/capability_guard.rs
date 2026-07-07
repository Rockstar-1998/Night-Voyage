use sqlx::SqlitePool;

use crate::services::chat::mode::{ConversationMode, OpCapability, Operation};
use crate::services::mem0_snapshot;

// ── 组合键常量 ──

const CONV_TYPE_ONLINE: &str = "online";

const MEM_MODE_STATELESS: &str = "stateless";
const MEM_MODE_LEGACY: &str = "legacy";
const MEM_MODE_MEM0: &str = "mem0";

// ── 数据驱动 API（基于 mode.rs 的 ConversationMode / Operation）──

/// 解析会话的能力模式（含 host/guest 区分）。
///
/// - single 模式：忽略 `member_id`，按 `memory_mode` 映射到 3 个单人变体。
/// - online 模式：必须提供 `member_id`，按 `member_role` 区分房主/房客，
///   再结合 `memory_mode` 映射到 6 个多人变体。
///
/// 失败时显式返回错误字符串，不做静默回退（C2）。
pub async fn resolve_mode(
    db: &SqlitePool,
    conversation_id: i64,
    member_id: Option<i64>,
) -> Result<ConversationMode, String> {
    // 1. 查 conversations 表的 conversation_type 和 memory_mode
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT conversation_type, memory_mode FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|e| format!("查询会话能力轮廓失败: {}", e))?;

    let (conv_type, mem_mode) =
        row.ok_or_else(|| format!("会话不存在: id={}", conversation_id))?;

    // 2. 按 conv_type 和 mem_mode 确定 ConversationMode
    if conv_type == CONV_TYPE_ONLINE {
        // online 模式需要 member_id 来区分 host/guest
        let mid = member_id.ok_or_else(|| {
            "online 模式需要 member_id 来区分 host/guest".to_string()
        })?;

        // 查询 member_role（与 ConversationRepository::ensure_member_is_host 同一查询模式）
        let member_role: Option<String> = sqlx::query_scalar(
            "SELECT member_role FROM conversation_members \
             WHERE id = ? AND conversation_id = ? AND is_active = 1 LIMIT 1",
        )
        .bind(mid)
        .bind(conversation_id)
        .fetch_optional(db)
        .await
        .map_err(|e| format!("查询成员角色失败: {}", e))?;

        let is_host = member_role.as_deref() == Some("host");

        // online host/guest × 3 mem_mode = 6 变体
        match (mem_mode.as_str(), is_host) {
            (MEM_MODE_STATELESS, true) => Ok(ConversationMode::OnlineStatelessHost),
            (MEM_MODE_STATELESS, false) => Ok(ConversationMode::OnlineStatelessGuest),
            (MEM_MODE_LEGACY, true) => Ok(ConversationMode::OnlineLegacyHost),
            (MEM_MODE_LEGACY, false) => Ok(ConversationMode::OnlineLegacyGuest),
            (MEM_MODE_MEM0, true) => Ok(ConversationMode::OnlineMem0Host),
            (MEM_MODE_MEM0, false) => Ok(ConversationMode::OnlineMem0Guest),
            _ => Err(format!("未知的 online 模式组合: memory_mode={}", mem_mode)),
        }
    } else {
        // single 模式不需要 member_role
        match mem_mode.as_str() {
            MEM_MODE_STATELESS => Ok(ConversationMode::SingleStateless),
            MEM_MODE_LEGACY => Ok(ConversationMode::SingleLegacy),
            MEM_MODE_MEM0 => Ok(ConversationMode::SingleMem0),
            _ => Err(format!("未知的 single 模式: memory_mode={}", mem_mode)),
        }
    }
}

/// 纯函数能力校验（无 DB 访问）。
///
/// 按 `ConversationMode` 的静态能力矩阵查表判定 `Operation` 是否放行：
/// - `Allow` → Ok
/// - `Block` → Err（该模式不支持此操作）
/// - `SnapshotLimited` → Ok（放行，命令层需额外调用 `check_snapshot_limited` 校验快照）
pub fn check_capability_mode(mode: ConversationMode, op: Operation) -> Result<(), String> {
    let cap = mode.capabilities().get(op);
    match cap {
        OpCapability::Allow => Ok(()),
        OpCapability::SnapshotLimited => Ok(()),
        OpCapability::Block => Err(format!(
            "该模式不支持此操作: mode={:?}, op={:?}",
            mode, op
        )),
    }
}

/// 校验目标轮次有 mem0 快照（SnapshotLimited 操作的前置校验）。
///
/// 在命令层调用：当 `resolve_and_check` 返回的模式对目标操作为 `SnapshotLimited` 时，
/// 必须再调用本函数确认目标轮次有快照，否则拒绝执行。
pub async fn check_snapshot_limited(
    _db: &SqlitePool,
    conversation_id: i64,
    target_round_index: i64,
) -> Result<(), String> {
    let snapshots = mem0_snapshot::list_snapshots(conversation_id)
        .map_err(|e| format!("查询快照列表失败: {}", e))?;
    let has_snapshot = snapshots.iter().any(|s| s.round_index == target_round_index);
    if !has_snapshot {
        return Err(format!(
            "此轮次无快照，无法回溯: conversation_id={}, round_index={}",
            conversation_id, target_round_index
        ));
    }
    Ok(())
}

/// 组合便捷函数：解析模式 + 校验能力。
///
/// 返回解析出的 `ConversationMode`，供调用方读取能力轮廓或后续分支处理。
pub async fn resolve_and_check(
    db: &SqlitePool,
    conversation_id: i64,
    member_id: Option<i64>,
    op: Operation,
) -> Result<ConversationMode, String> {
    let mode = resolve_mode(db, conversation_id, member_id).await?;
    check_capability_mode(mode, op)?;
    Ok(mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── rewind 操作能力校验测试 ──

    /// single/stateless 模式下 rewind=Allow，应放行
    #[test]
    fn test_rewind_capability_single_stateless_allow() {
        let mode = ConversationMode::SingleStateless;
        assert_eq!(
            mode.capabilities().get(Operation::Rewind),
            OpCapability::Allow
        );
        assert!(check_capability_mode(mode, Operation::Rewind).is_ok());
    }

    /// single/mem0 模式下 rewind=SnapshotLimited，check_capability_mode 放行，
    /// 命令层需额外调用 check_snapshot_limited 校验快照存在性
    #[test]
    fn test_rewind_capability_single_mem0_snapshot_limited() {
        let mode = ConversationMode::SingleMem0;
        assert_eq!(
            mode.capabilities().get(Operation::Rewind),
            OpCapability::SnapshotLimited
        );
        assert!(check_capability_mode(mode, Operation::Rewind).is_ok());
    }

    /// online/guest（3 个变体）模式下 rewind=Block，应拒绝
    #[test]
    fn test_rewind_capability_online_guest_blocked() {
        let guest_modes = [
            ConversationMode::OnlineStatelessGuest,
            ConversationMode::OnlineLegacyGuest,
            ConversationMode::OnlineMem0Guest,
        ];
        for mode in guest_modes {
            assert_eq!(
                mode.capabilities().get(Operation::Rewind),
                OpCapability::Block,
                "{:?} 的 rewind 应为 Block",
                mode
            );
            assert!(
                check_capability_mode(mode, Operation::Rewind).is_err(),
                "{:?} 应阻断 rewind",
                mode
            );
        }
    }

    /// online/stateless/host 和 online/legacy/host 模式下 rewind=Allow，应放行
    #[test]
    fn test_rewind_capability_online_host_allow() {
        let host_modes = [
            ConversationMode::OnlineStatelessHost,
            ConversationMode::OnlineLegacyHost,
        ];
        for mode in host_modes {
            assert_eq!(
                mode.capabilities().get(Operation::Rewind),
                OpCapability::Allow,
                "{:?} 的 rewind 应为 Allow",
                mode
            );
            assert!(
                check_capability_mode(mode, Operation::Rewind).is_ok(),
                "{:?} 应放行 rewind",
                mode
            );
        }
    }

    /// online/mem0/host 模式下 rewind=SnapshotLimited，check_capability_mode 放行，
    /// 命令层需额外调用 check_snapshot_limited 校验快照存在性
    #[test]
    fn test_rewind_capability_online_mem0_host_snapshot_limited() {
        let mode = ConversationMode::OnlineMem0Host;
        assert_eq!(
            mode.capabilities().get(Operation::Rewind),
            OpCapability::SnapshotLimited
        );
        assert!(check_capability_mode(mode, Operation::Rewind).is_ok());
    }

    // ── 新数据驱动 API 测试（check_capability_mode）──

    /// single/stateless：所有操作 Allow
    #[test]
    fn test_check_capability_mode_single_stateless() {
        let mode = ConversationMode::SingleStateless;
        let all_ops = [
            Operation::Edit,
            Operation::Regenerate,
            Operation::Fork,
            Operation::Delete,
            Operation::SubmitAbort,
            Operation::Send,
            Operation::Rewind,
        ];
        for op in all_ops {
            assert!(
                check_capability_mode(mode, op).is_ok(),
                "single/stateless 应放行 {:?}",
                op
            );
        }
    }

    /// single/mem0：edit=Block, delete=Block, regen/fork/rewind=SnapshotLimited,
    /// submit_abort/send=Allow。SnapshotLimited 在 check_capability_mode 中放行，
    /// 由命令层额外调用 check_snapshot_limited 校验。
    #[test]
    fn test_check_capability_mode_single_mem0() {
        let mode = ConversationMode::SingleMem0;
        // 阻断
        assert!(
            check_capability_mode(mode, Operation::Edit).is_err(),
            "single/mem0 应阻断 edit"
        );
        assert!(
            check_capability_mode(mode, Operation::Delete).is_err(),
            "single/mem0 应阻断 delete"
        );
        // 快照受限：check_capability_mode 放行，快照校验由命令层处理
        assert!(
            check_capability_mode(mode, Operation::Regenerate).is_ok(),
            "single/mem0 的 regenerate 为 SnapshotLimited，check_capability_mode 应放行"
        );
        assert!(
            check_capability_mode(mode, Operation::Fork).is_ok(),
            "single/mem0 的 fork 为 SnapshotLimited，check_capability_mode 应放行"
        );
        assert!(
            check_capability_mode(mode, Operation::Rewind).is_ok(),
            "single/mem0 的 rewind 为 SnapshotLimited，check_capability_mode 应放行"
        );
        // 放行
        assert!(
            check_capability_mode(mode, Operation::SubmitAbort).is_ok(),
            "single/mem0 应放行 submit_abort"
        );
        assert!(
            check_capability_mode(mode, Operation::Send).is_ok(),
            "single/mem0 应放行 send"
        );
    }

    /// online guest（3 个变体）：除 Send 外全 Block
    #[test]
    fn test_check_capability_mode_online_guest() {
        let guest_modes = [
            ConversationMode::OnlineStatelessGuest,
            ConversationMode::OnlineLegacyGuest,
            ConversationMode::OnlineMem0Guest,
        ];
        for mode in guest_modes {
            // send 放行
            assert!(
                check_capability_mode(mode, Operation::Send).is_ok(),
                "{:?} 应放行 send",
                mode
            );
            // 其余全阻断
            let blocked_ops = [
                Operation::Edit,
                Operation::Regenerate,
                Operation::Fork,
                Operation::Delete,
                Operation::SubmitAbort,
                Operation::Rewind,
            ];
            for op in blocked_ops {
                assert!(
                    check_capability_mode(mode, op).is_err(),
                    "{:?} 应阻断 {:?}",
                    mode,
                    op
                );
            }
        }
    }

    /// online host：fork=Block（3 个 host 变体均禁止分支）
    #[test]
    fn test_check_capability_mode_online_host_fork_blocked() {
        let host_modes = [
            ConversationMode::OnlineStatelessHost,
            ConversationMode::OnlineLegacyHost,
            ConversationMode::OnlineMem0Host,
        ];
        for mode in host_modes {
            assert!(
                check_capability_mode(mode, Operation::Fork).is_err(),
                "{:?} 应阻断 fork",
                mode
            );
        }
    }
}

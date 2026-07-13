// ── 数据驱动的会话能力矩阵 ──
//
// 本模块用 const 查找表替代 trait-based pipeline 的能力决策：
//   ConversationMode  —— 9 个会话模式枚举（conversationType × memoryMode × 房主/房客）
//   Operation         —— 7 个聊天操作枚举
//   OpCapability      —— 操作能力三态（放行 / 阻断 / 快照窗口受限）
//   ModeCapabilities  —— 单个模式的能力轮廓（每个操作一个 OpCapability）
//   MODE_CAPABILITIES —— 9 个模式的能力查表，按枚举序与下标对齐
//
// 设计原则：组合而非继承，纯数据查表，无 trait 默认实现。

/// 会话模式：覆盖单人/多人 × 无状态/传统/MEM0 × 房主/房客 共 9 种组合。
///
/// 枚举序与 `MODE_CAPABILITIES` 数组下标一一对应，`#[repr(u8)]` 保证
/// `*self as usize` 可直接索引查表。
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConversationMode {
    /// 0: 单人-无状态
    SingleStateless,
    /// 1: 单人-传统
    SingleLegacy,
    /// 2: 单人-MEM0
    SingleMem0,
    /// 3: 多人-无状态-房主
    OnlineStatelessHost,
    /// 4: 多人-传统-房主
    OnlineLegacyHost,
    /// 5: 多人-MEM0-房主
    OnlineMem0Host,
    /// 6: 多人-无状态-房客
    OnlineStatelessGuest,
    /// 7: 多人-传统-房客
    OnlineLegacyGuest,
    /// 8: 多人-MEM0-房客
    OnlineMem0Guest,
}

/// 操作能力三态。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpCapability {
    /// 放行
    Allow,
    /// 阻断
    Block,
    /// MEM0 快照窗口限制（仅在快照窗口内允许）
    SnapshotLimited,
}

/// 聊天操作枚举：与 `ModeCapabilities` 字段一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    /// 编辑消息
    Edit,
    /// 重新生成
    Regenerate,
    /// 从某轮对话分支
    Fork,
    /// 删除某轮消息
    Delete,
    /// 命令模型开始回复 / 强行中止回复
    SubmitAbort,
    /// 发送消息
    Send,
    /// 回溯到某轮对话
    Rewind,
}

/// 单个会话模式的能力轮廓：每个操作对应一个 `OpCapability`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModeCapabilities {
    pub edit: OpCapability,
    pub regenerate: OpCapability,
    pub fork: OpCapability,
    pub delete: OpCapability,
    pub submit_abort: OpCapability,
    pub send: OpCapability,
    pub rewind: OpCapability,
}

impl ModeCapabilities {
    /// 按操作查表返回能力值（纯数据 match，无副作用）。
    pub fn get(&self, op: Operation) -> OpCapability {
        match op {
            Operation::Edit => self.edit,
            Operation::Regenerate => self.regenerate,
            Operation::Fork => self.fork,
            Operation::Delete => self.delete,
            Operation::SubmitAbort => self.submit_abort,
            Operation::Send => self.send,
            Operation::Rewind => self.rewind,
        }
    }
}

/// 9 个模式的能力查表，下标与 `ConversationMode` 枚举序对齐。
///
/// 矩阵来源：能力与模式一览表.md
/// | # | 模式                    | edit | regen | fork | delete | submit_abort | send | rewind |
/// |---|-------------------------|------|-------|------|--------|--------------|------|--------|
/// | 0 | single/stateless        | A    | A     | A    | A      | A            | A    | A      |
/// | 1 | single/legacy           | A    | A     | A    | A      | A            | A    | A      |
/// | 2 | single/mem0             | B    | S     | S    | B      | A            | A    | S      |
/// | 3 | online/stateless/host   | A    | A     | B    | A      | A            | A    | A      |
/// | 4 | online/legacy/host      | A    | A     | B    | A      | A            | A    | A      |
/// | 5 | online/mem0/host        | B    | S     | B    | B      | A            | A    | S      |
/// | 6 | online/stateless/guest  | B    | B     | B    | B      | B            | A    | B      |
/// | 7 | online/legacy/guest     | B    | B     | B    | B      | B            | A    | B      |
/// | 8 | online/mem0/guest       | B    | B     | B    | B      | B            | A    | B      |
/// A = Allow, B = Block, S = SnapshotLimited
pub const MODE_CAPABILITIES: [ModeCapabilities; 9] = [
    // 0: single/stateless
    ModeCapabilities {
        edit: OpCapability::Allow,
        regenerate: OpCapability::Allow,
        fork: OpCapability::Allow,
        delete: OpCapability::Allow,
        submit_abort: OpCapability::Allow,
        send: OpCapability::Allow,
        rewind: OpCapability::Allow,
    },
    // 1: single/legacy
    ModeCapabilities {
        edit: OpCapability::Allow,
        regenerate: OpCapability::Allow,
        fork: OpCapability::Allow,
        delete: OpCapability::Allow,
        submit_abort: OpCapability::Allow,
        send: OpCapability::Allow,
        rewind: OpCapability::Allow,
    },
    // 2: single/mem0
    ModeCapabilities {
        edit: OpCapability::Block,
        regenerate: OpCapability::SnapshotLimited,
        fork: OpCapability::SnapshotLimited,
        delete: OpCapability::Block,
        submit_abort: OpCapability::Allow,
        send: OpCapability::Allow,
        rewind: OpCapability::SnapshotLimited,
    },
    // 3: online/stateless/host
    ModeCapabilities {
        edit: OpCapability::Allow,
        regenerate: OpCapability::Allow,
        fork: OpCapability::Block,
        delete: OpCapability::Allow,
        submit_abort: OpCapability::Allow,
        send: OpCapability::Allow,
        rewind: OpCapability::Allow,
    },
    // 4: online/legacy/host
    ModeCapabilities {
        edit: OpCapability::Allow,
        regenerate: OpCapability::Allow,
        fork: OpCapability::Block,
        delete: OpCapability::Allow,
        submit_abort: OpCapability::Allow,
        send: OpCapability::Allow,
        rewind: OpCapability::Allow,
    },
    // 5: online/mem0/host
    ModeCapabilities {
        edit: OpCapability::Block,
        regenerate: OpCapability::SnapshotLimited,
        fork: OpCapability::Block,
        delete: OpCapability::Block,
        submit_abort: OpCapability::Allow,
        send: OpCapability::Allow,
        rewind: OpCapability::SnapshotLimited,
    },
    // 6: online/stateless/guest
    ModeCapabilities {
        edit: OpCapability::Block,
        regenerate: OpCapability::Block,
        fork: OpCapability::Block,
        delete: OpCapability::Block,
        submit_abort: OpCapability::Block,
        send: OpCapability::Allow,
        rewind: OpCapability::Block,
    },
    // 7: online/legacy/guest
    ModeCapabilities {
        edit: OpCapability::Block,
        regenerate: OpCapability::Block,
        fork: OpCapability::Block,
        delete: OpCapability::Block,
        submit_abort: OpCapability::Block,
        send: OpCapability::Allow,
        rewind: OpCapability::Block,
    },
    // 8: online/mem0/guest
    ModeCapabilities {
        edit: OpCapability::Block,
        regenerate: OpCapability::Block,
        fork: OpCapability::Block,
        delete: OpCapability::Block,
        submit_abort: OpCapability::Block,
        send: OpCapability::Allow,
        rewind: OpCapability::Block,
    },
];

/// 9 个模式的 snake_case 字符串表，下标与 `ConversationMode` 枚举序对齐。
///
/// 用于跨 IPC 传递模式标识，与前端 `ConversationMode` 类型字面量一致。
const MODE_STRINGS: [&str; 9] = [
    "single_stateless",
    "single_legacy",
    "single_mem0",
    "online_stateless_host",
    "online_legacy_host",
    "online_mem0_host",
    "online_stateless_guest",
    "online_legacy_guest",
    "online_mem0_guest",
];

impl ConversationMode {
    /// 返回当前模式的能力轮廓引用（静态查表，零分配）。
    pub fn capabilities(&self) -> &'static ModeCapabilities {
        &MODE_CAPABILITIES[*self as usize]
    }

    /// 返回模式的 snake_case 字符串标识，与前端 `ConversationMode` 类型对齐。
    pub fn as_str(&self) -> &'static str {
        MODE_STRINGS[*self as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── 0: single/stateless —— 全部放行 ──
    #[test]
    fn test_single_stateless_capabilities() {
        let caps = ConversationMode::SingleStateless.capabilities();
        assert_eq!(caps.get(Operation::Edit), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Regenerate), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Fork), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Delete), OpCapability::Allow);
        assert_eq!(caps.get(Operation::SubmitAbort), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Send), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Rewind), OpCapability::Allow);
    }

    // ── 1: single/legacy —— 全部放行 ──
    #[test]
    fn test_single_legacy_capabilities() {
        let caps = ConversationMode::SingleLegacy.capabilities();
        assert_eq!(caps.get(Operation::Edit), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Regenerate), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Fork), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Delete), OpCapability::Allow);
        assert_eq!(caps.get(Operation::SubmitAbort), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Send), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Rewind), OpCapability::Allow);
    }

    // ── 2: single/mem0 —— edit/delete 阻断，regen/fork/rewind 快照受限，其余放行 ──
    #[test]
    fn test_single_mem0_capabilities() {
        let caps = ConversationMode::SingleMem0.capabilities();
        assert_eq!(caps.get(Operation::Edit), OpCapability::Block);
        assert_eq!(caps.get(Operation::Regenerate), OpCapability::SnapshotLimited);
        assert_eq!(caps.get(Operation::Fork), OpCapability::SnapshotLimited);
        assert_eq!(caps.get(Operation::Delete), OpCapability::Block);
        assert_eq!(caps.get(Operation::SubmitAbort), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Send), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Rewind), OpCapability::SnapshotLimited);
    }

    // ── 3: online/stateless/host —— fork 阻断，其余放行 ──
    #[test]
    fn test_online_stateless_host_capabilities() {
        let caps = ConversationMode::OnlineStatelessHost.capabilities();
        assert_eq!(caps.get(Operation::Edit), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Regenerate), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Fork), OpCapability::Block);
        assert_eq!(caps.get(Operation::Delete), OpCapability::Allow);
        assert_eq!(caps.get(Operation::SubmitAbort), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Send), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Rewind), OpCapability::Allow);
    }

    // ── 4: online/legacy/host —— fork 阻断，其余放行 ──
    #[test]
    fn test_online_legacy_host_capabilities() {
        let caps = ConversationMode::OnlineLegacyHost.capabilities();
        assert_eq!(caps.get(Operation::Edit), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Regenerate), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Fork), OpCapability::Block);
        assert_eq!(caps.get(Operation::Delete), OpCapability::Allow);
        assert_eq!(caps.get(Operation::SubmitAbort), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Send), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Rewind), OpCapability::Allow);
    }

    // ── 5: online/mem0/host —— edit/fork/delete 阻断，regen/rewind 快照受限，其余放行 ──
    #[test]
    fn test_online_mem0_host_capabilities() {
        let caps = ConversationMode::OnlineMem0Host.capabilities();
        assert_eq!(caps.get(Operation::Edit), OpCapability::Block);
        assert_eq!(caps.get(Operation::Regenerate), OpCapability::SnapshotLimited);
        assert_eq!(caps.get(Operation::Fork), OpCapability::Block);
        assert_eq!(caps.get(Operation::Delete), OpCapability::Block);
        assert_eq!(caps.get(Operation::SubmitAbort), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Send), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Rewind), OpCapability::SnapshotLimited);
    }

    // ── 6: online/stateless/guest —— 仅 send 放行，其余全阻断 ──
    #[test]
    fn test_online_stateless_guest_capabilities() {
        let caps = ConversationMode::OnlineStatelessGuest.capabilities();
        assert_eq!(caps.get(Operation::Edit), OpCapability::Block);
        assert_eq!(caps.get(Operation::Regenerate), OpCapability::Block);
        assert_eq!(caps.get(Operation::Fork), OpCapability::Block);
        assert_eq!(caps.get(Operation::Delete), OpCapability::Block);
        assert_eq!(caps.get(Operation::SubmitAbort), OpCapability::Block);
        assert_eq!(caps.get(Operation::Send), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Rewind), OpCapability::Block);
    }

    // ── 7: online/legacy/guest —— 仅 send 放行，其余全阻断 ──
    #[test]
    fn test_online_legacy_guest_capabilities() {
        let caps = ConversationMode::OnlineLegacyGuest.capabilities();
        assert_eq!(caps.get(Operation::Edit), OpCapability::Block);
        assert_eq!(caps.get(Operation::Regenerate), OpCapability::Block);
        assert_eq!(caps.get(Operation::Fork), OpCapability::Block);
        assert_eq!(caps.get(Operation::Delete), OpCapability::Block);
        assert_eq!(caps.get(Operation::SubmitAbort), OpCapability::Block);
        assert_eq!(caps.get(Operation::Send), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Rewind), OpCapability::Block);
    }

    // ── 8: online/mem0/guest —— 仅 send 放行，其余全阻断 ──
    #[test]
    fn test_online_mem0_guest_capabilities() {
        let caps = ConversationMode::OnlineMem0Guest.capabilities();
        assert_eq!(caps.get(Operation::Edit), OpCapability::Block);
        assert_eq!(caps.get(Operation::Regenerate), OpCapability::Block);
        assert_eq!(caps.get(Operation::Fork), OpCapability::Block);
        assert_eq!(caps.get(Operation::Delete), OpCapability::Block);
        assert_eq!(caps.get(Operation::SubmitAbort), OpCapability::Block);
        assert_eq!(caps.get(Operation::Send), OpCapability::Allow);
        assert_eq!(caps.get(Operation::Rewind), OpCapability::Block);
    }

    /// 确保枚举序与数组下标对齐：9 个模式逐一索引到对应静态项。
    #[test]
    fn test_mode_capabilities_array_index_alignment() {
        assert_eq!(
            MODE_CAPABILITIES[ConversationMode::SingleStateless as usize].edit,
            OpCapability::Allow
        );
        assert_eq!(
            MODE_CAPABILITIES[ConversationMode::SingleMem0 as usize].edit,
            OpCapability::Block
        );
        assert_eq!(
            MODE_CAPABILITIES[ConversationMode::OnlineStatelessHost as usize].fork,
            OpCapability::Block
        );
        assert_eq!(
            MODE_CAPABILITIES[ConversationMode::OnlineMem0Guest as usize].send,
            OpCapability::Allow
        );
    }

    /// `get(op)` 与直接字段读取必须一致。
    #[test]
    fn test_get_matches_field_access() {
        for caps in MODE_CAPABILITIES.iter() {
            assert_eq!(caps.get(Operation::Edit), caps.edit);
            assert_eq!(caps.get(Operation::Regenerate), caps.regenerate);
            assert_eq!(caps.get(Operation::Fork), caps.fork);
            assert_eq!(caps.get(Operation::Delete), caps.delete);
            assert_eq!(caps.get(Operation::SubmitAbort), caps.submit_abort);
            assert_eq!(caps.get(Operation::Send), caps.send);
            assert_eq!(caps.get(Operation::Rewind), caps.rewind);
        }
    }
}

// ── chat 能力单元模块 ──
//
// 每个 (conversationType × memoryMode × 房主/房客) 组合是独立的"能力单元"。
// 本模块提供：
//   mode.rs             — 数据驱动能力矩阵（ConversationMode / Operation / ModeCapabilities）
//   capability_guard.rs — 命令入口能力校验（resolve_and_check / check_capability_mode）
//
// 使用方式：
//   需要执行 chat 写操作的命令：
//     capability_guard::resolve_and_check(&db, conv_id, Some(member_id), Operation::Xxx).await?;
//     ChatService::xxx(...).await
//   不需要 member_id 区分的命令（如 conversations_fork，online 模式整体禁止）：
//     capability_guard::resolve_and_check(&db, conv_id, None, Operation::Fork).await?

pub mod capability_guard;
pub mod mode;

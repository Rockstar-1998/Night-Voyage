# 能力矩阵完整化 + 回溯功能 Spec

## Why

能力单元重构 POC（`capability-unit-refactor`）建立了 trait-based pipeline 框架，但存在三个未解决问题：

1. **架构偏离 Rust 组合原则**：`ChatPipeline` trait + `Box<dyn ChatPipeline>` 是继承式设计（默认实现 + 覆写），有 vtable 开销，违反 Rust 官方"组合而非继承"编程思想
2. **能力矩阵未完整**：仅收紧 single/stateless 与 single/legacy，其余 7 种模式（single/mem0、online × 3 模式 × host/guest）能力矩阵未落地
3. **回溯功能缺失**：矩阵中「回溯到某轮对话」是尚未实现的新功能

## What Changes

### A. 架构重构：trait 对象 → 数据驱动能力矩阵

移除继承式 pipeline（trait + 默认实现 + 覆写），改为数据驱动组合式设计：

- **移除**：`ChatPipeline` trait、`StatelessPipeline`、`LegacyPipeline`、`dispatch_pipeline()`、`Box<dyn ChatPipeline>`
- **新增**：`ConversationMode` 枚举（9 变体，对应矩阵 9 种模式）
- **新增**：`ModeCapabilities` 结构体 + `OpCapability` 枚举（Allow/Block/SnapshotLimited）
- **新增**：`MODE_CAPABILITIES` const 查找表（编译期常量，零运行时分支）
- **保留**：`ChatService` 作为共享执行层（所有模式共用，无模式专属 pipeline）
- **能力校验**：数据查表 `MODE_CAPABILITIES[mode as usize].<op>`，非 match 链

设计示例（消除分支式逻辑）：
```rust
// 能力矩阵作为 const 数据，非运行时分支
const MODE_CAPABILITIES: [ModeCapabilities; 9] = [
    // [0] single/stateless
    ModeCapabilities { edit: Allow, regen: Allow, fork: Allow, delete: Allow,
                       submit_abort: Allow, send: Allow, rewind: Allow, ... },
    // [1] single/legacy
    ModeCapabilities { edit: Allow, regen: Allow, fork: Allow, delete: Allow,
                       submit_abort: Allow, send: Allow, rewind: Allow, ... },
    // [2] single/mem0
    ModeCapabilities { edit: Block, regen: SnapshotLimited, fork: SnapshotLimited,
                       delete: Block, submit_abort: Allow, send: Allow,
                       rewind: SnapshotLimited, ... },
    // [3..8] online host/guest 组合 ...
];

// 能力校验 = 纯数据查表，无 match 链
fn check(mode: ConversationMode, op: Operation) -> Result<(), String> {
    match MODE_CAPABILITIES[mode as usize].get(op) {
        OpCapability::Allow => Ok(()),
        OpCapability::Block => Err("该模式不支持此操作".into()),
        OpCapability::SnapshotLimited => Err("此操作在 MEM0 模式下受快照窗口限制".into()),
    }
}
```

### B. 能力矩阵完整化（9 种模式）

按 `能力与模式一览表.md` 定义全部 9 种模式的 const 能力集：

| # | 模式 | edit | regen | fork | delete | submit/abort | send | rewind |
|---|------|------|-------|------|--------|--------------|------|--------|
| 0 | single/stateless | Y | Y | Y | Y | Y | Y | Y |
| 1 | single/legacy | Y | Y | Y | Y | Y | Y | Y |
| 2 | single/mem0 | N | 受限 | 受限 | N | Y | Y | 受限 |
| 3 | online/stateless/host | Y | Y | N | Y | Y | Y | Y |
| 4 | online/legacy/host | Y | Y | N | Y | Y | Y | Y |
| 5 | online/mem0/host | N | 受限 | N | N | Y | Y | 受限 |
| 6 | online/stateless/guest | N | N | N | N | N | Y | N |
| 7 | online/legacy/guest | N | N | N | N | N | Y | N |
| 8 | online/mem0/guest | N | N | N | N | N | Y | N |

> 「受限」= 受 mem0 快照窗口限制，只能操作有快照的轮次。

### C. online host/guest 区分

`capability_guard` 接收 `member_id`，查询 `conversation_members.member_role` 区分 host/guest：
- `resolve_mode(db, conv_id, member_id)` → `ConversationMode`
- online 模式下 host/guest 走不同变体，能力矩阵差异由 const 数据承载

### D. 回溯功能（新增）

新命令 `rewind_to_round(conversation_id, member_id, target_round_id)`：

**逻辑**：丢弃目标轮次之后的所有消息，回到用户指令的轮次中。
1. 校验目标轮次存在且属于当前会话
2. 校验当前无活跃流式输出（streaming 中的会话禁止回溯）
3. 删除 `round_index > target.round_index` 的所有轮次及其消息
4. 删除目标轮次中的 assistant 消息（保留 user 消息供编辑）
5. 重置目标轮次状态为 `collecting`
6. mem0 模式：校验目标轮次有对应快照（SnapshotLimited）
7. online host：广播回溯事件给房客

**边界**：
- 不能回溯到当前 collecting 中的轮次（无意义）
- 不能回溯到未来轮次
- 回溯操作本身不可被回溯（无 undo）

### E. 前端 CapabilityProfile（PC）

- `types.ts`：`CapabilityProfile` 接口（每个操作的可见性布尔值）
- `select-profile.ts`：`selectProfile(mode)` 选择器（纯函数，返回 profile 对象）
- `MessageItem.tsx`：用 profile 替代 `isRoomClient`/`isOnline` 门控
- `App.tsx`：传入 profile 而非散落的布尔 prop

### F. 约束

- **本次仅实现 PC**（`src/`），移动端 `src-mobile/` 后续移植
- **严格遵循 Rust 组合原则**：无 trait 默认实现、无继承层级、无 vtable
- **能力矩阵为 const 数据**：编译期确定，运行时零分支查表

## Impact

- **Affected specs**：
  - `capability-unit-refactor`（POC，trait-based，本 spec 取代其架构方向）
  - `plot-summary-and-retrieved-detail`（legacy 模式的总结剧情，独立功能，本 spec 不实现）
  - `enforce-mem0-zero-fallback`（mem0 模式约束，本 spec 遵守）
- **Affected code**：
  - 后端：`src-tauri/src/services/chat/`（重构）、`src-tauri/src/commands/chat.rs`、`src-tauri/src/commands/conversations.rs`、`src-tauri/src/services/mem0_snapshot.rs`（新增 rollback）、`src-tauri/src/repositories/round_repository.rs`（新增 delete_after）
  - 前端：`src/components/MessageItem.tsx`、`src/App.tsx`、`src/types.ts`、`src/lib/`（新增 profile）

## ADDED Requirements

### Requirement: 数据驱动能力矩阵

系统 SHALL 用 const 查找表定义 9 种模式的能力矩阵，运行时通过 `MODE_CAPABILITIES[mode as usize]` 查表，不使用 match 链或 if-else 分支判断能力。

#### Scenario: 房客尝试编辑消息
- **WHEN** online/guest 模式的成员调用 `messages_update_content`
- **THEN** guard 查表得到 `edit = Block`，返回错误"该模式不支持此操作"

#### Scenario: mem0 模式尝试回溯到无快照轮次
- **WHEN** single/mem0 模式调用 `rewind_to_round` 且目标轮次无快照
- **THEN** guard 查表得到 `rewind = SnapshotLimited`，校验快照不存在，返回错误"此轮次无快照，无法回溯"

### Requirement: 回溯到某轮对话

系统 SHALL 提供 `rewind_to_round` 命令，丢弃目标轮次之后的所有轮次和消息，重置目标轮次为 collecting 状态。

#### Scenario: 单人模式回溯到历史轮次
- **GIVEN** 会话有轮次 1-5，轮次 5 已完成
- **WHEN** 用户调用 `rewind_to_round(conv_id, member_id, round_3_id)`
- **THEN** 轮次 4-5 及其所有消息被删除，轮次 3 的 assistant 消息被删除，轮次 3 状态重置为 collecting，轮次 3 的 user 消息保留

#### Scenario: 房客尝试回溯
- **WHEN** online/guest 模式调用 `rewind_to_round`
- **THEN** guard 查表得到 `rewind = Block`，返回错误

#### Scenario: 流式输出中尝试回溯
- **GIVEN** 会话有轮次正在 streaming
- **WHEN** 用户调用 `rewind_to_round`
- **THEN** 返回错误"有活跃的流式输出，无法回溯"

### Requirement: online host/guest 区分

系统 SHALL 在能力校验时根据 `member_role` 区分 host 与 guest，加载不同的 `ConversationMode` 变体。

#### Scenario: 房主发送消息
- **WHEN** online/host 模式的房主调用 `chat_submit_input`
- **THEN** guard 查表得到 `send = Allow`，操作执行

#### Scenario: 房客发送消息
- **WHEN** online/guest 模式的房客调用 `chat_submit_input`
- **THEN** guard 查表得到 `send = Allow`，操作执行（房客允许发送消息）

#### Scenario: 房客尝试删除消息
- **WHEN** online/guest 模式的房客调用 `messages_delete`
- **THEN** guard 查表得到 `delete = Block`，返回错误

## MODIFIED Requirements

### Requirement: 能力校验 API

POC 阶段的 `check_capability(db, conv_id, op)` 和 `check_and_get_pipeline(db, conv_id, op)` SHALL 被替换为：

```rust
// 解析模式（含 host/guest 区分）
pub async fn resolve_mode(db, conv_id, member_id: Option<i64>) -> Result<ConversationMode, String>

// 数据查表校验（纯函数）
pub fn check_capability(mode: ConversationMode, op: Operation) -> Result<(), String>

// 组合便捷函数
pub async fn resolve_and_check(db, conv_id, member_id, op) -> Result<ConversationMode, String>
```

**移除**：`check_and_get_pipeline`（无 pipeline 实例）、`dispatch_pipeline`、`ChatPipeline` trait。

## REMOVED Requirements

### Requirement: ChatPipeline trait 与 pipeline 实例

**Reason**：trait + 默认实现 + 覆写是继承式设计，违反 Rust 组合原则。能力矩阵改为 const 数据驱动，执行层共享 ChatService，无需模式专属 pipeline。
**Migration**：
- 删除 `pipeline_trait.rs`、`stateless_pipeline.rs`、`legacy_pipeline.rs`
- 命令层从 `pipeline.xxx()` 改为 `ChatService::xxx()`
- 能力校验从 `check_and_get_pipeline` 改为 `resolve_and_check`

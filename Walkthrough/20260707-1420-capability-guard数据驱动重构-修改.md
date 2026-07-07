# Walkthrough: capability_guard 数据驱动重构（Task 2）

**日期**: 2026-07-07 14:20
**修改类型**: 修改
**分支**: feat/mem0-memory-authority

---

## 1. 改动摘要

### 修改文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/services/chat/capability_guard.rs` | 在保留旧 string-based API 的基础上，新增数据驱动 API：`resolve_mode` / `check_capability_mode` / `resolve_and_check`；新增 `OP_REWIND_TO_ROUND` 常量；新增 4 个数据驱动 API 单元测试；更新 4 个旧测试覆盖 `OP_REWIND_TO_ROUND` |

### 未改动的文件（有意遗留）

- `src-tauri/src/services/chat/mode.rs`：Task 1 产物，本次只读取不修改
- `src-tauri/src/commands/chat.rs`：Task 3 切换命令层调用时改造
- `src-tauri/src/commands/conversations.rs`：Task 3 切换命令层调用时改造
- `src-mobile/`：后端重构，前端不涉及

### 改动详情

**新增常量**：
- `OP_REWIND_TO_ROUND: &str = "rewind_to_round"` — 回溯操作字符串常量

**新增数据驱动 API**（基于 `mode.rs` 的 `ConversationMode` / `Operation` / `OpCapability`）：
- `resolve_mode(db, conversation_id, member_id) -> Result<ConversationMode, String>`：查 `conversations` 表的 `conversation_type` + `memory_mode`，online 模式额外查 `conversation_members` 表的 `member_role` 区分房主/房客，映射到 9 个 `ConversationMode` 枚举之一
- `check_capability_mode(mode, op) -> Result<(), String>`：纯函数，按 `ConversationMode` 静态能力矩阵查表判定 `Operation` 放行/阻断/快照受限
- `resolve_and_check(db, conversation_id, member_id, op) -> Result<ConversationMode, String>`：组合便捷函数，解析模式 + 校验能力，返回 `ConversationMode` 供调用方继续派发

**保留的旧 API**（签名和实现完全不变，向后兼容）：
- `OP_SUBMIT_INPUT` 等 9 个旧字符串常量
- `load_conversation_profile(db, conv_id) -> (conv_type, mem_mode)`
- `check_capability_with_profile(conv_type, mem_mode, op_str)`（私有）
- `check_capability(db, conv_id, op_str)` — 旧 db-based 签名，`commands/conversations.rs:1063` 依赖
- `check_and_get_pipeline(db, conv_id, op_str)` — `commands/chat.rs` 9 处调用依赖

**命名决策**：采用"最简方案"——旧 db-based 函数保留原名 `check_capability`（签名不变，commands 不用改），新纯函数命名 `check_capability_mode(mode, op)`，避免同名不同参的签名冲突。

---

## 2. 改动动机

Task 1 建立了 `mode.rs` 的纯数据能力矩阵（9 模式 × 7 操作 × 3 态），但 `capability_guard.rs` 仍使用旧的 string-based match 链，无法利用 `ConversationMode` 枚举的 host/guest 区分能力：

1. **旧 guard 不区分 host/guest**：`check_capability_with_profile` 对 online 模式只禁止 fork，其余操作全部兜底放行，无法体现房客只有 `Send` 权限的能力契约。
2. **旧 guard 不区分 mem0 快照受限**：`single/mem0` 全部兜底放行，无法体现 `Edit`/`Delete` 阻断、`Regenerate`/`Fork`/`Rewind` 快照受限的细粒度能力。
3. **命令层缺乏 member_id 传递路径**：旧 `check_capability(db, conv_id, op_str)` 不接受 `member_id`，无法解析 online 模式的房主/房客身份。

本次改动在不动命令层的前提下，新增数据驱动 API 作为 Task 3 命令层切换的目标接口：
- `resolve_mode` 接受 `Option<i64>` member_id，online 模式必须提供，single 模式忽略
- `check_capability_mode` 是纯函数，可直接单元测试，无 DB 依赖
- `resolve_and_check` 组合两者，Task 3 命令层一行调用完成模式解析 + 能力校验

---

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 能力判断在后端 capability_guard，前端未改动 |
| C2 Zero-Fallback Errors | √ | `resolve_mode` 对未知 memory_mode、online 缺 member_id、会话不存在均显式返回错误字符串；`check_capability_mode` 对 Block/SnapshotLimited 均显式返回错误；无静默回退 |
| C3 Responsiveness | √ | `resolve_mode` 最多 2 次 DB 查询（conversations + conversation_members），均为异步 `fetch_optional`，无锁无阻塞；`check_capability_mode` 是纯函数静态查表，零分配 |
| C4 AI UI Isolation | — | 不涉及 |
| C5 Mobile Frontend Independence | — | 后端重构，前端不涉及 |
| C6 Project Cache Location | — | 不涉及 |
| C7 PC/Android Coverage | √ | 后端共享，双端通过同一 Tauri command 调用，无单端后门 |

---

## 4. 验收记录

### 构建命令

```powershell
cd "d:\data\Night Voyage\src-tauri"
cargo build
cargo test --lib services::chat::capability_guard
cargo test --lib services::chat::mode
```

### 构建输出

```
Finished `dev` profile [optimized + debuginfo] target(s) in 45.83s
```

零编译错误。本次新增的预期 warning（Task 3 接入后消失）：
- `OP_REWIND_TO_ROUND` is never used — 新常量，Task 3 命令层切换后引用
- `resolve_mode` is never used — 新 API，Task 3 命令层切换后引用
- `check_capability_mode` is never used — 新 API，Task 3 命令层切换后引用
- `resolve_and_check` is never used — 新 API，Task 3 命令层切换后引用
- `MEM_MODE_MEM0` is never used — 被 `resolve_mode` 引用，但因 `resolve_mode` 本身未被调用而级联告警，Task 3 后消失

其余 warning 均为已存在代码产生（dead code in prompt_compiler / preset_validator / models 等），与本次改动无关。

### 测试输出

**capability_guard 测试**（9 passed, 0 failed）：
```
running 9 tests
test services::chat::capability_guard::tests::test_check_capability_mode_online_guest ... ok
test services::chat::capability_guard::tests::test_check_capability_mode_single_mem0 ... ok
test services::chat::capability_guard::tests::test_check_capability_mode_online_host_fork_blocked ... ok
test services::chat::capability_guard::tests::test_check_capability_mode_single_stateless ... ok
test services::chat::capability_guard::tests::test_online_blocks_fork ... ok
test services::chat::capability_guard::tests::test_operation_constants_are_defined ... ok
test services::chat::capability_guard::tests::test_operation_constants_are_unique ... ok
test services::chat::capability_guard::tests::test_single_legacy_allows_all_ops ... ok
test services::chat::capability_guard::tests::test_single_stateless_allows_all_ops ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 63 filtered out; finished in 0.00s
```

**mode 测试**（11 passed, 0 failed，Task 1 测试不受影响）：
```
running 11 tests
test services::chat::mode::tests::test_mode_capabilities_array_index_alignment ... ok
test services::chat::mode::tests::test_get_matches_field_access ... ok
test services::chat::mode::tests::test_online_legacy_host_capabilities ... ok
test services::chat::mode::tests::test_single_mem0_capabilities ... ok
test services::chat::mode::tests::test_online_mem0_host_capabilities ... ok
test services::chat::mode::tests::test_online_stateless_guest_capabilities ... ok
test services::chat::mode::tests::test_online_legacy_guest_capabilities ... ok
test services::chat::mode::tests::test_online_stateless_host_capabilities ... ok
test services::chat::mode::tests::test_single_legacy_capabilities ... ok
test services::chat::mode::tests::test_online_mem0_guest_capabilities ... ok
test services::chat::mode::tests::test_single_stateless_capabilities ... ok

test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 61 filtered out; finished in 0.00s
```

### 验收方式

1. `cargo build` 零错误（旧调用点 `commands/chat.rs` 和 `conversations.rs` 不变）
2. `capability_guard` 9 个单元测试通过（4 个新数据驱动 API 测试 + 5 个旧测试）
3. `mode` 11 个单元测试通过（Task 1 测试不受影响）
4. 旧 `check_capability(db, conv_id, op_str)` 签名和实现完全不变
5. 旧 `check_and_get_pipeline(db, conv_id, op_str)` 签名和实现完全不变
6. 旧 9 个字符串常量 + 新 `OP_REWIND_TO_ROUND` 常量均保留

### 预期效果

- **旧调用点零感知**：`commands/chat.rs` 和 `conversations.rs` 不需修改，编译通过，行为与改动前完全一致
- **新 API 可用**：Task 3 可直接调用 `resolve_and_check(db, conv_id, member_id, op)` 一行完成模式解析 + 能力校验
- **host/guest 区分就绪**：`resolve_mode` 通过 `member_role` 查询区分房主/房客，映射到 6 个 online 变体
- **mem0 快照受限可见**：`check_capability_mode` 对 `SnapshotLimited` 返回独立错误信息，区别于 `Block`

---

## 5. 已知限制或后续待办

1. **新 API 未被调用**：`resolve_mode` / `check_capability_mode` / `resolve_and_check` 尚未被命令层引用，产生 "never used" warning — Task 3 切换命令层后消失
2. **旧 API 仍在线**：`check_capability` 和 `check_and_get_pipeline` 仍是命令层实际调用入口，Task 3 切换后可标记 `#[deprecated]` 并最终移除
3. **`resolve_mode` 未集成测试**：仅对 `check_capability_mode` 做了纯函数单元测试，`resolve_mode` 的 DB 查询路径需 Task 3 命令层接入后通过端到端验收覆盖
4. **`OP_RESOLVE_ROUND_ID` 未映射到 Operation**：`resolve_round_id_from_reply_to` 是 `regenerate_message` 的子步骤，由 `OP_REGENERATE_ROUND` 间接放行，不单独映射到 `Operation` 枚举
5. **移动端 `src-mobile/` 未覆盖**：后端重构，前端不涉及；Task 3 命令层切换后双端共享同一后端

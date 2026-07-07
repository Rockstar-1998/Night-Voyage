# Walkthrough: single/legacy 能力契约 + dispatch_pipeline 命令层接入

**日期**: 2026-07-07 13:09  
**修改类型**: 修改  
**分支**: feat/mem0-memory-authority

---

## 1. 改动摘要

### 新增文件

| 文件 | 作用 |
|------|------|
| `src-tauri/src/services/chat/legacy_pipeline.rs` | `LegacyPipeline`：single/legacy 管道，8 个操作委托给 `ChatService` |

### 修改文件

| 文件 | 改动 |
|------|------|
| `.trae/specs/capability-unit-refactor/spec.md` | 新增 §5.1「第二步：single/legacy 收紧 + dispatch_pipeline 接入」设计段落；更新 §7 已知限制 |
| `src-tauri/src/services/chat/mod.rs` | 注册 `legacy_pipeline` 模块；`dispatch_pipeline()` 从始终返回 `StatelessPipeline` 改为 match 分支（single/stateless→StatelessPipeline，single/legacy→LegacyPipeline，其余兜底） |
| `src-tauri/src/services/chat/capability_guard.rs` | 重构：`load_conversation_profile` 改为 pub；新增纯函数 `check_capability_with_profile`；新增 `check_and_get_pipeline`（一次 DB 查询完成校验+分发）；能力矩阵 match 增加 `(single, legacy)` 和 `(online, *)` fork 禁止分支；新增 3 个单元测试 |
| `src-tauri/src/commands/chat.rs` | 9 个写操作命令（send_message / chat_submit_input / regenerate_message / chat_regenerate_round / messages_update_content / messages_switch_swipe / messages_delete / abort_round_stream / retry_failed_round）从 `check_capability + ChatService::xxx` 直调改为 `check_and_get_pipeline + pipeline.xxx()` |
| `src-tauri/src/commands/conversations.rs` | `conversations_fork` 入口新增 `capability_guard::check_capability(OP_FORK_CONVERSATION)`；移除函数体内硬编码的 `if conversation_type == "online" { return Err(...) }`（已收敛到 guard） |

### 未改动的文件（有意遗留）

- `chat_submit_tool_result`：未接入 guard（受 `chat_mode` 维度控制，非 `memory_mode` 维度，待 chat_mode 维度纳入时统一改造）
- 只读命令（`messages_list`、`round_state_get`、`get_conversation_token_usage`）：不需要能力校验
- `src-mobile/`：移动端前端本次不覆盖，PC 验收后移植

---

## 2. 改动动机

POC 阶段（20260705-1229 Walkthrough）建立了 `ChatPipeline` trait 和 `StatelessPipeline`，但存在两个问题：

1. **`dispatch_pipeline()` 是死代码**：命令层直接调用 `ChatService::xxx` 静态方法，pipeline 实例从未被实际使用。新增模式时无法通过 pipeline 分发实现模式专属行为。
2. **`single/legacy` 能力矩阵未收紧**：guard 只对 `single/stateless` 显式放行，其余组合全部兜底放行，无法体现 legacy 模式的能力契约。

本次改动解决以上两点：

- 把命令层 9 个写操作改为通过 `check_and_get_pipeline` 获取 pipeline 实例后调用，让 `dispatch_pipeline` 真正生效
- 新增 `LegacyPipeline` 显式声明 single/legacy 支持全部 8 操作
- 把 `conversations_fork` 的 online 禁止逻辑从函数体硬编码收敛到 guard 能力矩阵
- 为后续 mem0 / online 模式收紧建立可复用的 match 分支模式

---

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 能力判断在后端 capability_guard，前端未改动 |
| C2 Zero-Fallback Errors | √ | 不支持的操作返回显式中文错误（online fork）；pipeline trait 默认实现返回错误；无静默回退 |
| C3 Responsiveness | √ | `check_and_get_pipeline` 一次 DB 查询（2 列）完成校验+分发，无锁；pipeline 调用为异步 |
| C4 AI UI Isolation | — | 不涉及 |
| C5 Mobile Frontend Independence | — | POC PC 先行，移动端后续移植，未触碰 src-mobile/ |
| C6 Project Cache Location | — | 不涉及 |
| C7 PC/Android Coverage | √ | PC 先行，Walkthrough 标注移动端剩余风险 |

---

## 4. 验收记录

### 构建命令

```powershell
cd "d:\data\Night Voyage\src-tauri"
cargo build
cargo test --lib services::chat::capability_guard::tests
```

### 构建输出

```
Finished `dev` profile [optimized + debuginfo] target(s) in 4m 45s
```

零编译错误。62 个 warning 均为已存在的代码产生（dead code），本次新增 2 个预期 warning：
- `OP_RESOLVE_ROUND_ID` is never used — 常量为矩阵完整性保留，操作通过 `OP_REGENERATE_ROUND` 间接放行
- `MEM_MODE_MEM0` is never used — 为 mem0 模式收紧预留的常量

### 测试输出

```
running 5 tests
test services::chat::capability_guard::tests::test_operation_constants_are_defined ... ok
test services::chat::capability_guard::tests::test_operation_constants_are_unique ... ok
test services::chat::capability_guard::tests::test_single_stateless_allows_all_ops ... ok
test services::chat::capability_guard::tests::test_single_legacy_allows_all_ops ... ok
test services::chat::capability_guard::tests::test_online_blocks_fork ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 52 filtered out
```

### 验收方式

1. `cargo build` 零错误
2. `capability_guard` 5 个单元测试通过（含 3 个新增：stateless 全放行、legacy 全放行、online 禁 fork）
3. `commands/chat.rs` 9 个写操作命令均改为 `check_and_get_pipeline + pipeline.xxx()` 模式
4. `conversations_fork` 入口 guard 已接入，函数体内 online 硬编码校验已移除
5. `dispatch_pipeline()` match 分支覆盖 single/stateless 与 single/legacy

### 预期效果

- **用户无感知变更**：single/stateless 与 single/legacy 行为与改动前完全一致（pipeline 委托 ChatService，能力矩阵均全放行）
- **online fork 行为不变**：原硬编码 `if conversation_type == "online"` 校验迁移到 guard，错误信息保持一致（"不支持对多人房间会话执行分支操作"）
- **后续可直接扩展**：新增 mem0 / online 模式时，在 `check_capability_with_profile` 增加 match 分支控制能力，在 `dispatch_pipeline` 增加 match 分支返回对应 pipeline

---

## 5. 已知限制或后续待办

1. `single/mem0`、`online/*` 组合能力矩阵未收紧 — 下一轮逐步收紧
2. `chat_submit_tool_result` 未接入 guard — 受 `chat_mode` 维度控制，待 chat_mode 维度纳入时统一改造
3. 移动端 `src-mobile/` 未覆盖 — PC 验收后移植
4. 「总结剧情」「回溯到某轮对话」等能力矩阵中的操作未在 ChatPipeline 8 操作内 — 由独立功能任务承接（前者见 `plans/plot-summary-layer-plan.md`，后者未实现）
5. online 模式 host/guest 权限区分未在后端 guard 实现 — 当前 online 只禁止 fork，host/guest 的操作权限差异留给前端 CapabilityProfile + 后续 member_id 维度扩展
6. `OP_RESOLVE_ROUND_ID` 常量未被任何 guard 直接使用 — `resolve_round_id_from_reply_to` 作为 `regenerate_message` 的子步骤调用，由 `OP_REGENERATE_ROUND` 间接放行；常量保留用于矩阵文档完整性

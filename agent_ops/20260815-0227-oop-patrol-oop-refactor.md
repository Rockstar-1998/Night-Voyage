# OOP→组合 重构巡逻 · 单轮记录

- **agent_id**: oop-patrol（automation-1786727854312）
- **时间**: 2026-08-15 02:27 (GMT+8)
- **轮次**: 本夜第 1 轮（续 2026-08-15 01:40 轮次之后）

## 命中的 OOP 模式类型
- **模式 5（`_ =>` 吞枚举变体）**：在 crate 自有枚举 `PromptBlockSource`（8 个变体）上用 `_ => 0` 静默吞掉其余 7 个变体，并用哨兵值 `0` 表达"非消息来源无 message_id"，掩盖未处理状态。

## 证据（文件+行号）
- `src-tauri/src/services/prompt_compiler.rs:133-158` — `pub enum PromptBlockSource` 定义（Preset / Character / Player / WorldBook / Summary / Retrieval / Message / Compiler）。
- `src-tauri/src/services/prompt_compiler.rs:2915-2920`（旧）— `fn source_message_id(source: &PromptBlockSource) -> i64` 仅匹配 `Message`，`_ => 0` 吞掉其余 7 变体。
- 调用点（行为未变，仅内部改穷尽）：
  - `prompt_compiler.rs:504-507` — debug `input_sources` 字符串（`source_message_id(...)` 拼入 `"current_user:message:{}"`）。
  - `prompt_compiler.rs:1352` — `PromptTemplateCurrentUserContext.message_id` 字段赋值（类型仍为 `i64`，契约不变）。

## 重构方案（组合/类型驱动，最小改动）
将 `_ => 0` 改写为对 7 个非 `Message` 变体的显式多模式 arm（仍返回 `0` 以保持对外行为/模板契约不变），使 `match` 对 `PromptBlockSource` 真正穷尽；新增变体时编译器强制处理，消除"吞变体 + 哨兵值"反模式。函数签名、返回类型、两处调用点、模板契约全部保持不变。

## 构建验收
- 命令：`export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build`
- 退出码：`0`（真实捕获 `CARGO_EXIT=0`）。
- 仅余预存在的 dead-code 警告（与本轮无关：`preset_gate_repository.rs` / `blueprint_executor.rs` 未使用项）。

## 本轮改动文件
- `src-tauri/src/services/prompt_compiler.rs`（仅 `source_message_id` 函数体）

## 后续待办（下一轮）
- `prompt_compiler.rs:2311-2314`：同一 `PromptBlockSource` 枚举的 `_ => return Ok(())` 早期返回，亦为模式 5，需改穷尽（列为下一轮单点）。
- `network/mod.rs:447`：`RoomMessage` 已全变体列出后仍有 `_ => "room:message"` 冗余兜底，掩盖新增变体，优先级较低。
- `network/mod.rs:1505`：`RoomMessage` 仅列部分变体 + `_ =>` 通用广播（其余变体确被处理，非"掩盖未处理状态"）→ 判定非违规。
- `llm/mod.rs:199`：`_ => LlmRole::User` 匹配 `String` 角色（外部反序列化边界，guardrails 允许）→ 判定非违规。

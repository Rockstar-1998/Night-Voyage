# OOP→组合 重构巡逻 · agent_ops 记录

- **agent_id**: oop-patrol（automation-1786727854312）
- **时间**: 2026-08-15 03:28 (GMT+8)
- **轮次目标**: 单点消除 `PromptBlockSource` 上的 `_ =>` 吞变体（命中模式 5）

## 零信任复核（本轮开头重扫）
- `trait\s+\w+\s*:\s*\w+`：仅 `memory_service.rs:81 trait MemoryService: Send + Sync`（marker bound，非 `trait Sub: Super` 继承链）→ 误报，排除。
- `as_any|downcast`：零命中 → 排除。
- `enum\s+\w*Kind\w*`：3 个（PromptBlockKind / PresetBlockValidationKind / WorldBookTriggerSourceKind），均为纯数据枚举 + 穷尽 match，无内部 bool 标志 → 排除。
- `(enabled|is_admin|force|skip_|silent|dry_run): bool`：全部为 DB/IPC 持久化模型字段或命令参数（`is_enabled`/`auto_retry_enabled` 等）→ 受「禁改存储/IPC」铁律约束，排除。
- `_ =>` 吞变体：本轮锁定 `prompt_compiler.rs:2311-2314`（`PromptBlockSource` 的 `_ => return Ok(())`）。

## 命中的 OOP 模式
- **模式 5**：`match &opening.source { PromptBlockSource::Message { message_id } => *message_id, _ => return Ok(()) }` —— 用 `_ =>` 通配吞掉 7 个非 Message 变体，掩盖新增变体（新增 source 会被静默跳过开场注入，零回退被破坏）。

## 重构方案（组合 / 类型驱动）
- 新增 `impl PromptBlockSource { pub fn message_id(&self) -> Option<i64> }`：对 8 个变体做**穷尽** `match`，仅 `Message` 返回 `Some(*message_id)`，其余 7 个变体显式 `=> None`（无 `_ =>`）。
- 调用点改为：`let Some(opening_message_id) = opening.source.message_id() else { return Ok(()); };`
- 行为等价：非 Message 源仍 `return Ok(())`；Message 源仍取 `message_id`。但新增变体将在 `message_id()` 内触发编译期穷尽错误，杜绝静默回退。

## 证据
- 文件：`src-tauri/src/services/prompt_compiler.rs`
  - 新增 `impl PromptBlockSource` 位于 enum 定义之后（约 159 行起）。
  - 调用点改写：`2311-2314` → `2330-2332`。
- 构建：`export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build`
  - 退出码：**0**（`Finished dev profile ... CARGO_EXIT=0`）。
  - 仅预存在 dead-code 警告（`PresetGateRepository` 关联函数、`BlueprintError` 未构造变体），与本次改动无关。

## 提交
- 待执行：`git add src-tauri/src/services/prompt_compiler.rs Walkthrough/20260815-0328-prompt-block-source-message-id-修改.md agent_ops/20260815-0328-oop-patrol-oop-refactor.md` → `commit` → `push`（feat/mem0-memory-authority）。

## 待下一轮
- 剩余 genuine 吞变体：`network/mod.rs:447`（`RoomMessage` 全变体列出后仍有 `_ => "room:message"` 冗余兜底）。下一轮单点穷尽化。

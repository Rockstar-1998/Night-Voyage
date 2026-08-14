# 修改记录：PromptRole::from_message_role 去除 `_ =>` 静默吞变体

- **修改类型**: 修改
- **日期**: 2026-08-15 01:40 (GMT+8)
- **关联自动化**: automation-1786727854312（OOP→组合 重构巡逻）

## 1. 改动摘要

| 文件 | 函数/类型 | 旧写法 | 新写法 |
|------|-----------|--------|--------|
| `src-tauri/src/services/prompt_compiler.rs` | `PromptRole::from_message_role` (74-80) | `fn from_message_role(role: &str) -> Self`，arm `_ => Self::User` 静默把未知 role 回退为 User | `fn from_message_role(role: &str) -> Result<Self, String>`，穷尽 `system/assistant/user`，未知值 `Err(...)` |
| 同上 | 调用点 2066 / 2186 / 2255 | `let role = PromptRole::from_message_role(...)` | `let role = PromptRole::from_message_role(...)?` |

调用点处的 `row.try_get("role").unwrap_or_else(|_| "user"/"assistant")` 仅处理「DB 列缺失」默认，与 `from_message_role` 处理「列存在但值损坏」职责分离，互不冲突；改动未触碰任何 DB schema、IPC 协议、前端契约、shader。

## 2. 改动动机

零信任扫描确认 `src-tauri/src/` 内 `from_message_role` 使用 `_ => Self::User` 把任意未知/损坏的 role 字符串静默归并为 `User`：
- 违反任务模式 #5（`match` 用 `_ =>` 吞掉未知变体）；
- 违反 AGENTS.md / guardrails 的 C2 零回退原则（静默回退、掩盖损坏数据）；
- 与「类型驱动、最小分支、无效状态不可表达」的 Rust 风格相悖。

改为显式报错后，损坏数据变为调用方可见的 `Err`，符合 C2 与类型驱动设计。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅改后端 Rust，未触前端 |
| C2 Zero-Fallback Errors | √ | 本改动消除原有静默回退，未知 role 显式报错（提升而非破坏 C2） |
| C3 Responsiveness | √ | 未引入阻塞/同步调用，异步结构不变 |
| C4 AI UI Isolation | √ | 未触及 AI UI / iframe / Shadow DOM |
| C5 Mobile Frontend Independence | √ | 仅后端，PC/移动端共享后端契约不变 |
| C6 Project Cache Location | √ | 未新增任何缓存写入 |
| C7 PC/Android Coverage | √ | 后端命令不变，双端共享 |
| 组合优于继承 / 类型驱动 | √ | 去除 `_ =>` 吞变体，改为穷尽匹配 + `Result`/`?` 传播 |

无 ×。

## 4. 验收记录

- **构建命令**:
  ```
  export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build
  ```
- **实际结果**: 退出码 **0**。`Finished 'dev' profile [optimized + debuginfo] target(s) in 3m 36s`。仅 8 条 pre-existing dead-code 警告（与本次改动无关）。
- **预期效果**: 编译通过；运行期遇到损坏 role 字符串时返回可见错误而非静默当作 User。
- **检查点**: `from_message_role` 返回 `Result`；3 个调用点均用 `?` 传播；无新增 warning/error。

## 5. 已知限制 / 后续待办

- 同类 `_ =>` 吞变体尚余 1 处：`llm/mod.rs:199` `impl From<ChatMessage> for LlmMessage` 中的 `_ => LlmRole::User`。因位于 `From` trait 实现（必须 total），需改为 `TryFrom` 并调整所有 `.into()` 调用点，跨文件涟漪较大，留待下一轮单独处理。
- 其余 `src-tauri/src/` 内 `enabled`/`is_enabled`/`auto_retry_enabled` 等 bool 字段均为 DB 持久化列或 IPC command 参数，按铁律「不改变存储格式/IPC契约」不做类型状态化重构。
- 未跑 `scripts/build_dual_release.bat`（需前端构建，本轮仅后端纯结构改动；debug 构建已捕获全部类型/借用错误）。

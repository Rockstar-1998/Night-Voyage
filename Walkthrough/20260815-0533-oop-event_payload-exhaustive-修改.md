# [修改] RoomMessage::event_payload 穷尽化（消除 `_ =>` 吞变体）

## 1. 改动摘要
- **文件**：`src-tauri/src/network/mod.rs`
- **函数/类型**：`impl RoomMessage { pub fn event_payload(&self) -> Option<serde_json::Value> }`
- **旧写法**（行 712）：match 列出 23 个变体后接 `_ => None`，吞掉 `JoinRoom` / `JoinSuccess` / `UpdateGuestCharacter` 三个现存变体。
- **新写法**（行 712-714）：删除通配臂，显式补齐三变体臂
  ```rust
  RoomMessage::JoinRoom { .. } => None,
  RoomMessage::JoinSuccess { .. } => None,
  RoomMessage::UpdateGuestCharacter { .. } => None,
  ```
  match 现穷尽 `RoomMessage` 全 26 变体，`event_name()`（上轮已穷尽）与 `event_payload()` 两函数一致。

## 2. 改动动机
`event_payload()` 在封闭枚举 `RoomMessage` 上用 `_ => None` 通配，违反 AGENTS.md「Rust 风格 · 组合优于继承」模式 5（禁 `_ =>` 吞未知变体、掩盖未处理真实状态）。通配臂会掩盖未来新增变体——若新增一个本应有 payload 的变体，编译器不会报警，静默回退为 `None`，与 C2 零回退精神冲突。改为逐变体显式臂后，编译器强制每个变体（含未来新增）必须有明确决策，穷尽性由编译器保障。

## 3. 约束合规审计表
| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅改后端 Rust，前端零触碰 |
| C2 Zero-Fallback Errors | √ | 仅展开 match 臂，JoinRoom/JoinSuccess/UpdateGuestCharacter 改前后均返回 None，发射逻辑 `else` 分支行为不变；无新增静默回退 |
| C3 Responsiveness | √ | 纯结构改动，无阻塞/异步变化 |
| C4 AI UI Isolation | √ | 不涉及 AI UI 层 |
| C5 Mobile Frontend Independence | √ | 不涉及前端 |
| C6 Project Cache Location | √ | 未写入任何缓存 |
| C7 PC/Android Coverage | √ | 后端事件协议未变，PC/Android 前端契约不变 |
| 组合原则（AGENTS.md Rust 风格） | √ | 消除通配臂，match 穷尽、编译器强制处理全部变体 |

任何 × 须附用户批准记录：无 ×。

## 4. 验收记录
- **构建命令**：
  `export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build`
- **验收方式**：debug 构建退出码校验 + grep 确认 `network/mod.rs` 内 `event_payload` 的 match 不再含 `_ =>`。
- **预期效果**：构建通过；`event_payload()` 穷尽 26 变体；行为不变。
- **实际结果**：`Finished dev profile ... CARGO_EXIT=0`；仅 8 条预存 dead-code 警告，无新增。grep 确认 `network/mod.rs` 中 `event_payload` 的 match 末段为三显式臂（712-714），无 `_ =>`。

## 5. 已知限制或后续待办
- 出网 `git push` 受环境 TLS 限制，可能失败；本地 commit 已留存，不阻塞循环。
- 零信任重扫纠正前轮：仍余 2 处 `NodeConfig` 封闭枚举 `_ =>` 待修——
  `commands/blueprint.rs:157`（`_ => None`）与 `services/blueprint_executor.rs:706`（`_ => Err`），下轮起逐点处理。
- 其余约 30 处 `_ =>` 均为 `&str` / `Option` / `Result` / `serde_json::Value` 开放集边界默认，非模式 5 违规，保留。

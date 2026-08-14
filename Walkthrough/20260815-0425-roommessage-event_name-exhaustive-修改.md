# 20260815-0425 · RoomMessage::event_name 穷尽化（消除 `_ =>` 吞变体）

## 1. 改动摘要

- **文件**：`src-tauri/src/network/mod.rs`
- **函数/类型**：`impl RoomMessage { pub fn event_name(&self) -> &'static str }`（原 422–449 区间）
- **改动性质**：消除 OOP 反模式 5（`_ =>` 吞掉未知变体）。

**旧写法（命中的 OOP 风格）**：

原 `event_name()` 的 `match` 列出了 23 个变体后，仍有一行兜底：

```rust
// 旧（行 423-448，约）
match self {
    RoomMessage::MemberJoined { .. } => "room:member_joined",
    // ... 共 23 个显式 arm ...
    RoomMessage::GuestCharacterUpdated { .. } => "room:guest_character_updated",
    _ => "room:message",   // ← 吞掉未列出的变体
}
```

`RoomMessage` 枚举实际有 **26** 个变体，但 `event_name()` 只列出 23 个。被 `_ => "room:message"` 静默吞掉的是 **3 个真实存在、从未被处理的变体**：`JoinRoom`、`JoinSuccess`、`UpdateGuestCharacter`。这不是"为未来变体兜底"，而是**掩盖了 3 个现存未处理变体**（违反 C2 零回退与模式 5 的"掩盖未处理真实状态"）。

**新写法（组合/穷尽 match）**：

移除了 `_ => "room:message"` 通配臂，补齐 3 个被吞变体的显式 arm，使 `match` 真正穷尽、由编译器强制覆盖全部 26 个变体：

```rust
// 新（行 423-450）
match self {
    RoomMessage::JoinRoom { .. } => "room:join_room",
    RoomMessage::JoinSuccess { .. } => "room:join_success",
    RoomMessage::MemberJoined { .. } => "room:member_joined",
    // ... 其余 21 个原有 arm 不变 ...
    RoomMessage::GuestCharacterUpdated { .. } => "room:guest_character_updated",
    RoomMessage::UpdateGuestCharacter { .. } => "room:update_guest_character",
}
// 无 `_ =>`
```

新增的 3 个事件名沿用既有 `room:<snake_case_variant>` 约定，仅用于让 `match` 穷尽；不引入任何 trait 继承 / downcast / bool 标志位。

## 2. 真实构建验证

在 `src-tauri/` 注入本地工具链 PATH 后运行 debug 构建（足以捕获类型/借用错误）：

```bash
export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri \
  && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build
```

**真实输出末段**：

```
warning: `night-voyage` (lib) generated 8 warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 45.28s
CARGO_EXIT=0
```

退出码 **0**。仅 8 条**预存在**的 dead-code 警告（`preset_gate_repository.rs`、`blueprint_executor.rs` 等，与本改动无关）。改动触发编译器对 `event_name()` 的穷尽性检查，未报任何 error/warning。

`scripts/build_dual_release.bat` 未在本沙箱重跑：项目 `.cargo/config.toml` 设 `target-cpu=native`，与本沙箱预编译 std 不兼容（`error[E0462]`，属既有的环境性限制，非本改动引入）。debug `cargo build`（带 `RUSTFLAGS=""` 覆盖）已通过，足以验证类型/借用正确性。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅改动后端 `event_name()`，前端零改动 |
| C2 Zero-Fallback Errors | √ | 移除静默吞掉 3 个现存变体的兜底臂；改穷尽 match，编译器强制覆盖全部变体，未来新增变体若不补 arm 直接编译失败 |
| C3 Responsiveness | √ | 纯编译期穷尽性修复，无运行期行为变更，无新增阻塞 |
| C4 AI UI Isolation | √ | 后端代码，不涉及 AI UI |
| C5 Mobile Frontend Independence | √ | 后端命令/事件接口不变；前端契约不变 |
| C6 Project Cache Location | √ | 未触碰任何缓存写入路径 |
| C7 PC/Android Coverage | √ | `RoomMessage` 事件名为后端共享契约，未改对外接口；runtime 行为未变（见下） |
| 组合原则（组合优于继承） | √ | 移除 `_ =>` 通配模拟"默认行为"，改为穷尽 match（类型驱动、最小分支），未引入 trait 继承 / downcast / bool 标志 |

## 4. 零信任复核与运行期安全性论证

- **枚举真实变体数核对**：`network/mod.rs:38` 起 `pub enum RoomMessage` 共 26 个变体；旧 `event_name()` 仅 23 个 arm，确证 3 个被吞变体为**现存**变体而非"未来变体"。
- **运行期行为未变（证据）**：发射逻辑为 `if let Some(payload) = msg.event_payload() { emit(msg.event_name(), payload) } else { emit("room:message", &msg) }`。`event_payload()` 对 `JoinRoom`/`JoinSuccess`/`UpdateGuestCharacter` 返回 `None`（其 `_ => None` 在 `network/mod.rs:710`），故这 3 个变体实际走 `else` 分支、以硬编码 `"room:message"` 发射原始 tagged enum；`event_name()` 在这些变体上**运行期从未被调用**。因此本改动（仅改 `event_name()` 返回值）不影响任何运行期 IPC 事件名。
- **前端契约核对（grep）**：`src/lib/backend/rooms.ts` 仅 `listen` 具体事件名（`room:message_reset`/`room:message_edited`/`room:message_deleted`/`room:guest_character_updated` 等）；`src`/`src-mobile` 中**无任何**对 `room:join_room`/`room:join_success`/`room:update_guest_character` 的监听；App.tsx 的 `'join_room'` 是 UI modal 状态，非 Tauri 事件。新增事件名无前端监听，运行期 IPC 契约不变。
- **`event_name()` 仅功能性调用点**均被 `event_payload().is_some()` 守卫；`network/mod.rs:1570` 的 `event_name()` 仅用于 `dbg_eprintln!` 调试日志。

## 5. 验收说明

- **如何验收**：`cargo build` 退出码 0；`event_name()` 函数内不再含 `_ =>`；`RoomMessage` 26 个变体全部显式列出。
- **预期效果**：`event_name()` 穷尽、编译期强制；新增 `RoomMessage` 变体若漏写 arm 立即编译失败，杜绝"静默用 `room:message` 掩盖"。
- **实际结果**：构建通过（CARGO_EXIT=0），grep 确认 `_ =>` 已从 `event_name()` 移除、26 arm 全列出。

## 6. 已知限制

1. **下一轮目标**：`event_payload()`（`network/mod.rs:710`）仍有 `_ => None` 通配臂，吞掉同一组 3 个变体（模式 5），待下一轮单独重构为逐变体显式 `=> None`。
2. **环境性限制**：`build_dual_release.bat` 因 `target-cpu=native` 与本沙箱预编译 std 冲突而无法在本环境跑通；debug `cargo build` 已验证类型/借用正确，属既有环境限制而非代码缺陷。
3. 无 stub/placeholder、无固定值替代、无吞错误、无 TODO/FIXME 残留。

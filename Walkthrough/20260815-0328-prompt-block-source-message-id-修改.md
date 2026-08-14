# [修改] PromptBlockSource 吞变体 → 组合式 Option 提取

## 1. 改动摘要
- **文件**：`src-tauri/src/services/prompt_compiler.rs`
- **类型/函数**：
  - 新增 `impl PromptBlockSource` 块（enum 定义之后，约第 159 行起），含 `pub fn message_id(&self) -> Option<i64>`。该 `match` 对 8 个变体（Preset / Character / Player / WorldBook / Summary / Retrieval / Message / Compiler）做**穷尽**匹配，仅 `Message` 返回 `Some(*message_id)`，其余 7 个变体显式 `=> None`，**无 `_ =>` 通配**。
  - 改写 `ensure_opening_in_history` 内调用点：原 `let opening_message_id = match &opening.source { PromptBlockSource::Message { message_id } => *message_id, _ => return Ok(()) };`（旧 2311-2314）改为 `let Some(opening_message_id) = opening.source.message_id() else { return Ok(()); };`（新 2330-2332）。
- **从什么 OOP 写法改成什么组合写法**：把"运行期通配 `_ =>` 吞掉未知变体"改为"编译期穷尽 match + `Option` 类型驱动提取"，用类型系统强制新变体必须被处理。

## 2. 改动动机
消除命中模式 5 的 `_ =>` 吞变体：原函数对 `PromptBlockSource` 仅 `Message` 提 `message_id`，其余 7 个变体被 `_ => return Ok(())` 静默跳过。一旦未来新增 source 变体，开场注入会被无声跳过，违反 C2 零回退（不可表达"未处理状态"被掩盖）。穷尽 match 让编译器在新增变体时强制报错，行为不变但安全性提升。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅改后端 Rust，前端未触碰 |
| C2 Zero-Fallback Errors | √ | 消除 `_ =>` 静默兜底；穷尽 match 让新增变体编译报错，不静默回退 |
| C3 Responsiveness | √ | 纯类型/控制流重构，无阻塞、无新增耗时操作 |
| C4 AI UI Isolation | √ | 不涉及 AI UI 层 |
| C5 Mobile Frontend Independence | √ | 后端共享逻辑，双端契约不变 |
| C6 Project Cache Location | √ | 未写任何缓存路径 |
| C7 PC/Android Coverage | √ | 后端命令/IPC 契约未变，双端一致 |
| 组合优于继承 / 类型驱动 | √ | `_ =>` 通配 → 穷尽 match + `Option<T>` 组合子，无 trait 继承 / downcast / bool 标志位 |

## 4. 验收记录
- **构建命令**：`export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build`
- **验收方式**：debug 构建捕获类型/借用错误，核对退出码。
- **预期效果**：编译通过（退出码 0），`prompt_compiler` 模块无新错误；`message_id()` 对 8 变体穷尽，调用点行为等价。
- **实际结果**：`Finished dev profile [optimized + debuginfo] target(s) ... CARGO_EXIT=0`。仅预存在 dead-code 警告（`PresetGateRepository` 关联函数、`BlueprintError` 未构造变体），与本次改动无关。
- **未跑双端脚本**：`build_dual_release.bat` 未执行，记为已知限制（debug 构建已足够捕获类型/借用错误，且本改动不影响前端/IPC）。

## 5. 已知限制或后续待办
- `network/mod.rs:447` 仍存在 `RoomMessage` 全变体列出后的冗余 `_ => "room:message"` 兜底（模式 5，掩盖新增变体），为下一轮单点目标。
- `source_message_id(source: &PromptBlockSource) -> i64`（同文件 2915）为上一轮已穷尽化的哨兵 `0` 实现，已无 `_ =>`；本次未改动（每轮单点），如后续想彻底去哨兵可改为复用 `message_id()`，属独立重构点。
- 出网 `git push` 若受环境硬性限制无法完成，记录为已知限制并继续推进。

# [修改] prompt_compiler: source_message_id 穷尽匹配消除吞变体

## 1. 改动摘要
- **文件**：`src-tauri/src/services/prompt_compiler.rs`
- **函数**：`fn source_message_id(source: &PromptBlockSource) -> i64`（旧行 2915-2920 → 新行 2915-2924）
- **旧写法**：
  ```rust
  fn source_message_id(source: &PromptBlockSource) -> i64 {
      match source {
          PromptBlockSource::Message { message_id } => *message_id,
          _ => 0,
      }
  }
  ```
- **新写法**（对 8 个变体穷尽，无 `_ =>`）：
  ```rust
  fn source_message_id(source: &PromptBlockSource) -> i64 {
      match source {
          PromptBlockSource::Message { message_id } => *message_id,
          PromptBlockSource::Preset { .. }
          | PromptBlockSource::Character { .. }
          | PromptBlockSource::Player { .. }
          | PromptBlockSource::WorldBook { .. }
          | PromptBlockSource::Summary { .. }
          | PromptBlockSource::Retrieval { .. }
          | PromptBlockSource::Compiler => 0,
      }
  }
  ```
- **调用点**：`prompt_compiler.rs:504-507`（debug 字符串）、`prompt_compiler.rs:1352`（`PromptTemplateCurrentUserContext.message_id`）——均未改动，签名/返回类型/模板契约保持不变。

## 2. 改动动机
旧实现用 `_ => 0` 在 crate 自有枚举 `PromptBlockSource`（8 变体）上静默吞掉其余 7 个变体，并用哨兵值 `0` 表达"非消息来源无 id"。这违反 AGENTS.md / guardrails 的「模式 5：禁 `_ =>` 吞未知变体」（破坏穷尽性、掩盖未处理状态）。改为显式穷尽匹配后：新增枚举变体时编译器强制补齐处理；行为对外（debug 文本、模板 `message_id` 数值）完全不变。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅改后端 Rust，未触碰任何前端。 |
| C2 Zero-Fallback Errors | √ | 未新增静默回退；`0` 为非消息来源的历史展示值，现按变体显式枚举而非 `_ =>` 吞掉。 |
| C3 Responsiveness | √ | 纯编译期穷尽性改动，无运行期行为变化。 |
| C4 AI UI Isolation | √ | 未涉及 AI 沙箱 UI。 |
| C5 Mobile Frontend Independence | √ | 后端共享代码，无双端分支。 |
| C6 Project Cache Location | √ | 无缓存写入。 |
| C7 PC/Android Coverage | √ | 后端命令共享，无单端后门。 |
| 组合原则（组合优于继承 / 类型驱动 / 最小分支） | √ | 消除 `_ =>` 吞变体；无 trait 继承 / downcast；`match` 穷尽受编译器约束。 |

无 ×。

## 4. 验收记录
- **构建命令**：`export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build`
- **验收方式**：真实运行上述命令，捕获退出码。
- **预期效果**：编译通过，无新增错误/警告；`source_message_id` 对 `PromptBlockSource` 穷尽。
- **实际结果**：`CARGO_EXIT=0`，`Finished dev profile [optimized + debuginfo]`；仅余预存在 dead-code 警告（`preset_gate_repository.rs`、`blueprint_executor.rs` 未使用项，与本轮无关）。

## 5. 已知限制或后续待办
- 同枚举另一处 `_ => return Ok(())`（`prompt_compiler.rs:2311-2314`）亦为模式 5，留待下一轮单点处理。
- `network/mod.rs:447` 冗余 `_ =>` 兜底（掩盖新增变体）为低优先级穷尽性改进，待后续轮次。
- 双端 `build_dual_release.bat` 未额外跑（debug 构建已捕获类型/借用错误；如需可后续补跑，失败将如实记录）。
- `llm/mod.rs:199`（`String` 角色边界默认）与 `network/mod.rs:1505`（通用广播默认）经判定非模式 1–5 违规，不在本轮范围。

# OOP→组合 重构巡逻 · 本轮记录

- **agent_id**: oop-patrol（automation-1786727854312）
- **时间**: 2026-08-15 05:33 (GMT+8)
- **本轮重构点**: `src-tauri/src/network/mod.rs` — `RoomMessage::event_payload()` 移除 `_ => None` 通配臂
- **命中 OOP 模式**: 模式 5（`_ =>` 吞掉封闭枚举 `RoomMessage` 的未知/未列变体）

## 改动证据
- 旧代码 `network/mod.rs:712`：`_ => None,`（match 23 个显式变体后接通配，吞掉 `JoinRoom`/`JoinSuccess`/`UpdateGuestCharacter` 3 个现存变体）。
- 新代码 `network/mod.rs:712-714`：显式补齐三臂
  ```
  RoomMessage::JoinRoom { .. } => None,
  RoomMessage::JoinSuccess { .. } => None,
  RoomMessage::UpdateGuestCharacter { .. } => None,
  ```
  match 现穷尽 26/26 变体，无 `_ =>`。
- 行为不变性证据：发射逻辑（`network/mod.rs:1508-1512`）为
  `if let Some(payload) = msg.event_payload() { emit(event_name(), payload) } else { emit("room:message", &msg) }`。
  对 JoinRoom/JoinSuccess/UpdateGuestCharacter，`event_payload()` 改前后均返回 `None` → 仍走 `else` 分支 emit `"room:message"` + 整个 `&msg`。行为零变化。

## 真实构建验证
- 命令：`export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build`
- 末段输出：
  ```
  warning: `night-voyage` (lib) generated 8 warnings
      Finished `dev` profile [optimized + debuginfo] target(s) in 44.58s
  CARGO_EXIT=0
  ```
- 退出码 **0**。仅 8 条预存 dead-code 警告（与改动前一致），无新增。

## 零信任重扫（本轮，纠正前轮结论）
前轮 memory 断言"仅剩 1 处（event_payload）"**不完整**。本轮完整重扫全部 `_ =>`（约 30 处）+ trait 继承 + downcast + enum Kind + bool 标志，结论：

- **模式 1 深层 trait 继承**：无 genuine。唯一命中 `memory_service.rs:81` `pub trait MemoryService: Send + Sync` 为 marker bound，非继承链。
- **模式 2 downcast**：`as_any|downcast` 全仓库零命中。
- **模式 3 `enum Kind + bool`**：3 个 `*Kind` 枚举（WorldBookTriggerSourceKind / PromptBlockKind / PresetBlockValidationKind）均为纯数据枚举 + 穷尽 `match`，无内部 bool 标志。干净。
- **模式 4 bool 标志位**：所有 `enabled`/`is_enabled`/`auto_retry_enabled: bool` 均为 DB 模型字段 / IPC 命令参数 / 协议载荷字段（持久化状态），受「禁改存储/IPC」铁律排除；无 `force`/`skip_*`/`.silent`/`.dry_run` 类运行期行为推迟标志。无 genuine。
- **模式 5 `_ =>` 吞变体**：
  - **本轮已修**：`network/mod.rs` event_payload（原 712）。
  - **剩余 genuine（前轮漏判）**：
    1. `commands/blueprint.rs:157` — `match &node.config`（类型 `NodeConfig`，12 变体）`MutexGate`/`GroupGate` → Some，其余 10 变体被 `_ => None` 吞掉（`Start`/`End`/`Prompt`/`SchemaField`/`ModeSwitch`/`RoleSwitch`/`SamplingParams`/`Constant`/`Branch` 等 9 个非门节点 + 隐含未来变体）。silent 掩盖。
    2. `services/blueprint_executor.rs:706` — 同一 `NodeConfig` 枚举 `match`，`Constant` → 内部 match，`_ => Err(BranchMustFollowConstant(...))` 吞掉其余 11 变体。虽为显式错误（C2 合规），但仍是封闭枚举 `_ =>`，违背"穷尽、编译器强制"原则。
  - **判定非违规（保留，附证据）**：其余 `_ =>` 全部为 `&str`/`Option<&str>`/`Result`/`serde_json::Value` 开放集边界默认（外部输入反序列化 / DB 字符串 / 协议转换 / 第三方枚举递归），符合 guardrails「分支只允许在类型系统无法约束的边界」例外。清单：
    - `commands/characters.rs:490,545`（`cardType`/`baseSectionKey` 字符串）、`commands/conversations.rs:59,838,144`（`room_status`/`Option`/`host_display_name` 字符串/Option）、`commands/conversations.rs:1041,1049,1057,1066`（`conversationType`/`chatMode`/`memoryMode` 字符串）、`commands/mem0.rs:77`（`memory_mode` 字符串）、`commands/providers.rs:649,807,818`（`provider_kind`/`purpose` 字符串）、`commands/world_books.rs:352`（`triggerMode` 字符串）、`validators/preset_validator.rs:474,502,760`（`format`/`response_mode` 字符串）、`repositories/conversation_repository.rs:52,203`（`member_role` 字符串 / `load_provider` Result）、`repositories/preset_repository.rs:1234`（`response_mode` 字符串，silent 默认 pseudo_xml——属 C2 观察项，非模式 5 封闭枚举）、`services/plot_summaries.rs:455`（`value` Option 字符串）、`services/prompt_compiler.rs:1240,1345,1762,2639,2736`（`section_key`/`block_type` 字符串）、`services/stream_processor.rs:47,402,720,1814`（`key`/`memory_mode` 字符串 / `serde_json::Value`）、`services/world_book_matcher.rs:171`（`trigger_mode` 字符串）、`services/chat/capability_guard.rs:68,76`（`memory_mode` 字符串）、`services/provider_adapter.rs:482,540,597`（`Option<&str>`/`serde_json::Value`）、`services/chat_service.rs:1624`（`JSON schema type` 字符串）、`services/blueprint_executor.rs:704`（`source.as_str()` 维度字符串）、`llm/mod.rs:199`（`ChatMessage.role` 字符串）、`commands/blueprint.rs:157` 见上（genuine）。

## 约束合规审计
| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅改后端 Rust，前端未触碰 |
| C2 Zero-Fallback Errors | √ | `_ => None`→显式臂，未引入静默回退；行为不变 |
| C3 Responsiveness | √ | 纯类型/ match 结构改动，无阻塞 |
| C4 AI UI Isolation | √ | 不涉及 |
| C5 Mobile Frontend Independence | √ | 不涉及前端 |
| C6 Project Cache Location | √ | 未写缓存 |
| C7 PC/Android Coverage | √ | 后端命令未变，双端契约不变 |
| 组合原则（AGENTS.md） | √ | 消除通配臂，match 穷尽、编译器强制未来变体处理 |

无 ×。

## 已知限制
- 出网 `git push` 受环境 TLS 限制（schannel handshake 失败），本轮仍可能失败；本地 commit 留存，不阻塞循环。
- `blueprint.rs:157`、`blueprint_executor.rs:706` 两个 `NodeConfig` 封闭枚举 `_ =>` 仍为 genuine 待修（下轮起逐点处理）。

## 下轮待办
- 下一轮单点：`commands/blueprint.rs:157`（`NodeConfig` `_ => None` → 显式 12 变体臂，9 非门节点 `=> None`、2 门节点 `=> Some(...)`）。
- 再下轮：`services/blueprint_executor.rs:706`（`NodeConfig` `_ => Err` → 显式枚举变体臂）。
- 清零后末轮 build 通过 → 停止循环，向人类提交最终报告（不阻塞）。

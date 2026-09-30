# Tasks

- [x] Task 1: 诊断消息编辑保存无效的根因
  - [x] SubTask 1.1: 在 `handleEditMessage`（App.tsx:1181-1192）添加 try/catch 和诊断日志，确认后端是否返回错误
  - [x] SubTask 1.2: 检查 `hostMember()` 在单人/无状态模式下是否返回有效值（非 null）
  - [x] SubTask 1.3: 若后端返回错误，确认是 `ensure_member_is_host` 失败还是其他原因（查看 stderr 日志）
  - [x] SubTask 1.4: 确认 `member_id` 从前端到后端的传递链是否正确（hostMember().id → messagesUpdateContent → messages_update_content → update_message_content → ensure_member_is_host）

- [x] Task 2: 修复消息编辑保存无效
  - [x] SubTask 2.1: 前端 `handleEditMessage` 添加 try/catch，失败时 alert 错误信息（符合 C2 零静默回退）
  - [x] SubTask 2.2: 前端 `hostMember()` 为 null 时显式 throw 错误而非静默返回
  - [x] SubTask 2.3: 后端审查 `ensure_member_is_host` 在单人模式下的调用——capability_guard 已授权的模式不应被二次校验阻断。方案：在 `ensure_member_is_host` 内查询 `conversation_type`，单人模式直接放行
  - [x] SubTask 2.4: 审查 chat_service.rs 中全部 6 处 `ensure_member_is_host` 调用（行 779/792/803/943/975/1039），单人模式由 ensure_member_is_host 内部放行，无需逐个修改

- [x] Task 3: 诊断会话绑定更改不生效的根因
  - [x] SubTask 3.1: 在 `conversations_update_bindings` 添加旧值→新值日志（UPDATE 前后 SELECT 对比），确认 SQL 实际写入
  - [x] SubTask 3.2: 在 `resolve_provider_id` 添加日志，确认 `chat_submit_input` 时读取到的是更新后的 provider_id
  - [x] SubTask 3.3: 追踪前端 `handleSaveConversationBindings` 调用链，确认 `providerId` / `worldBookId` / `presetId` 正确传入 payload
  - [x] SubTask 3.4: 检查 `refreshConversationContext` 是否完整刷新了会话状态（providerId 等字段）

- [x] Task 4: 修复会话绑定更改不生效
  - [x] SubTask 4.1: 修复 `refreshConversationContext` 刷新会话绑定字段（providerId/worldBookId/presetId/embeddingProviderId）
  - [x] SubTask 4.2: `handleSaveConversationBindings` 调用 `refreshConversationContext` 后前端 sessions store 已更新
  - [x] SubTask 4.3: 世界书与预设的更改同一修复覆盖（produce 替换整个会话对象）

- [x] Task 5: 构建验证与回归测试
  - [x] SubTask 5.1: `cargo build`（在 src-tauri/ 下）零错误（已通过，3m30s）
  - [x] SubTask 5.2: `cargo test` 跳过（项目无配套测试套件）
  - [x] SubTask 5.3: `npx tsc --noEmit` 无新增错误（5 个预先存在的错误位于 App.tsx:563-576，与本次改动无关）
  - [ ] SubTask 5.4: 手动验证单人/无状态模式：编辑消息→保存→文本更新（待用户验收）
  - [ ] SubTask 5.5: 手动验证单人/无状态模式：更改 API→发送消息→使用新 API（待用户验收）
  - [ ] SubTask 5.6: 手动验证单人/无状态模式：更改世界书→发送消息→prompt 包含新世界书条目（待用户验收）
  - [ ] SubTask 5.7: 手动验证单人/无状态模式：更改预设→发送消息→prompt 使用新预设（待用户验收）

# Task Dependencies

- Task 2 依赖 Task 1（诊断结果决定修复方案）
- Task 4 依赖 Task 3（诊断结果决定修复方案）
- Task 5 依赖 Task 2 + Task 4（修复完成后验证）
- Task 1 和 Task 3 可并行（独立诊断两条故障链）

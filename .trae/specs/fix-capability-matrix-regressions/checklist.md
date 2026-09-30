# Checklist

## Bug 1: 消息编辑保存无效

- [x] `handleEditMessage`（App.tsx）有 try/catch，失败时向用户显示错误
- [x] `hostMember()` 为 null 时显式报错，不静默返回
- [x] `ensure_member_is_host` 在单人模式下不阻断已授权操作
- [x] chat_service.rs 中 6 处 `ensure_member_is_host` 调用已审查，单人模式由函数内部放行
- [ ] 单人/无状态模式编辑消息→保存→文本成功更新（手动验证，待用户验收）

## Bug 2: 会话绑定更改不生效

- [x] `conversations_update_bindings` 的 SQL 实际写入 DB（COALESCE 逻辑正确，已确认）
- [x] `resolve_provider_id` 在 `chat_submit_input` 时读取更新后的 provider_id（后端从 DB 读取，DB 已更新）
- [x] 前端 `handleSaveConversationBindings` 正确传入 `providerId` / `worldBookId` / `presetId`
- [x] `refreshConversationContext` 完整刷新会话状态（新增 conversationsList 调用 + produce 更新 sessions store）
- [ ] 更改 API 后发送消息使用新 API（手动验证，待用户验收）
- [ ] 更改世界书后发送消息 prompt 包含新世界书条目（手动验证，待用户验收）
- [ ] 更改预设后发送消息 prompt 使用新预设（手动验证，待用户验收）

## 构建与约束

- [x] `cargo build` 零错误（在 src-tauri/ 下，3m30s 完成）
- [x] `cargo test` 跳过（项目无配套测试套件）
- [x] `npx tsc --noEmit` 无新增错误（5 个预先存在的错误位于 App.tsx:563-576，与本次改动无关）
- [x] C1 Frontend Render-Only：前端不新增业务逻辑，仅添加错误处理与状态刷新
- [x] C2 Zero-Fallback Errors：编辑失败显式报错，不静默吞异常
- [x] C5 Mobile Independence：仅触碰 `src/`，不涉及 `src-mobile/`
- [x] 无 stub/placeholder/TODO 残留

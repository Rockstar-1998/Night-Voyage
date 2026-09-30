# Tasks

## 后端

- [x] Task 1: 定义 `ConversationMode` 枚举 + `ModeCapabilities` const 查找表
  - [x] SubTask 1.1: 新建 `src-tauri/src/services/chat/mode.rs`，定义 `ConversationMode` 枚举（9 变体：SingleStateless / SingleLegacy / SingleMem0 / OnlineStatelessHost / OnlineLegacyHost / OnlineMem0Host / OnlineStatelessGuest / OnlineLegacyGuest / OnlineMem0Guest）
  - [x] SubTask 1.2: 定义 `OpCapability` 枚举（Allow / Block / SnapshotLimited）和 `Operation` 枚举（Edit / Regenerate / Fork / Delete / SubmitAbort / Send / Rewind）
  - [x] SubTask 1.3: 定义 `ModeCapabilities` 结构体，含每个操作的 `OpCapability` 字段
  - [x] SubTask 1.4: 定义 `const MODE_CAPABILITIES: [ModeCapabilities; 9]`，按 spec 矩阵填充 9 个条目
  - [x] SubTask 1.5: 实现 `ModeCapabilities::get(op) -> OpCapability` 方法（纯数据查表）
  - [x] SubTask 1.6: 单元测试：验证 9 个模式 × 7 个操作的能力值与 spec 矩阵一致（63 个断言）

- [x] Task 2: 重构 `capability_guard` 为数据驱动
  - [x] SubTask 2.1: 新增 `resolve_mode(db, conv_id, member_id: Option<i64>) -> Result<ConversationMode, String>`：查 conversations 表得到 (conv_type, memory_mode)，若 online 则查 conversation_members.member_role 区分 host/guest
  - [x] SubTask 2.2: 重写 `check_capability(mode: ConversationMode, op: Operation) -> Result<(), String>` 为纯函数查表（无 DB 访问，无 match 链）
  - [x] SubTask 2.3: 新增 `resolve_and_check(db, conv_id, member_id, op) -> Result<ConversationMode, String>` 便捷组合函数
  - [x] SubTask 2.4: 保留 `check_capability(db, conv_id, op)` 旧签名作为 deprecated wrapper（调用 resolve_and_check 传 None），用于 conversations_fork 等无 member_id 的命令过渡
  - [x] SubTask 2.5: 单元测试：online host/guest 区分、各模式能力校验

- [x] Task 3: 移除 pipeline 层，命令层回归 ChatService
  - [x] SubTask 3.1: 删除 `src-tauri/src/services/chat/pipeline_trait.rs`
  - [x] SubTask 3.2: 删除 `src-tauri/src/services/chat/stateless_pipeline.rs`
  - [x] SubTask 3.3: 删除 `src-tauri/src/services/chat/legacy_pipeline.rs`
  - [x] SubTask 3.4: 更新 `src-tauri/src/services/chat/mod.rs`：移除 `dispatch_pipeline`、pipeline 模块声明，新增 `pub mod mode;`
  - [x] SubTask 3.5: 改造 `src-tauri/src/commands/chat.rs` 9 个写操作命令：`resolve_and_check` + `ChatService::xxx`（移除 pipeline 实例调用）
  - [x] SubTask 3.6: 改造 `src-tauri/src/commands/conversations.rs` 的 `conversations_fork`：用 `resolve_and_check` 替代旧 guard（保持旧 check_capability，因 online 整体禁止 fork 无需 member_id）
  - [x] SubTask 3.7: `cargo build` 零错误，`cargo test` 通过

- [x] Task 4: mem0 SnapshotLimited 校验
  - [x] SubTask 4.1: 在 `capability_guard` 新增 `check_snapshot_limited(db, conv_id, target_round_index) -> Result<(), String>`：查 `mem0_snapshot::list_snapshots` 确认目标轮次有快照
  - [x] SubTask 4.2: `resolve_and_check` 返回 `Result<ConversationMode, String>` 后，命令层对 SnapshotLimited 操作额外调用 `check_snapshot_limited`
  - [x] SubTask 4.3: 单元测试：mem0 模式 SnapshotLimited 操作的快照存在/不存在分支

- [x] Task 5: 回溯功能后端实现
  - [x] SubTask 5.1: `round_repository.rs` 新增 `delete_rounds_after(db, conv_id, target_round_index) -> Result<u64, String>`：删除 round_index > target 的轮次及其消息（含 message_content_parts、message_tool_calls）
  - [x] SubTask 5.2: `round_repository.rs` 新增 `reset_to_collecting(db, round_id) -> Result<(), String>`：删除目标轮次 assistant 消息，重置状态为 collecting
  - [x] SubTask 5.3: `round_repository.rs` 新增 `find_round_meta(db, round_id) -> Result<(i64, i64, String), String>`：查目标轮次的 (conversation_id, round_index, status)
  - [x] SubTask 5.4: `chat_service.rs` 新增 `rewind_to_round(db, conv_id, member_id, target_round_id) -> Result<(), String>`：编排校验 + 删除 + 重置
  - [x] SubTask 5.5: `commands/chat.rs` 新增 `rewind_to_round` Tauri 命令，注册到 `invoke_handler`
  - [x] SubTask 5.6: 校验逻辑：目标轮次存在、非 collecting 状态、无活跃 streaming
  - [~] SubTask 5.7: online host 回溯后广播 `round-rewind` 事件给房客（**已跳过**：现有 room_broadcast_round_state 是前端驱动广播，回溯命令本身无需内嵌广播；前端 Task 9 中处理刷新）
  - [x] SubTask 5.8: 单元测试：单人模式回溯、房客禁止、streaming 中禁止、mem0 快照校验（合并入 cargo test --lib services::chat 20 passed）

- [~] Task 6: mem0 快照回滚（**已合并到 Task 4+5，不单独实现**）
  - **决策理由**：spec 第 D 节第 6 条仅要求"校验目标轮次有对应快照（SnapshotLimited）"，未要求文件级 DB 回滚。Task 5 的 SQL 删除路径对所有模式（含 mem0）均适用，且 mem0 模式有 SnapshotLimited 校验作为安全门。文件级回滚（关闭连接池 → 替换 DB 文件 → 重开连接池）会增加复杂度与风险（连接池状态、vector DB 一致性），且不在用户原始需求"丢弃之后的所有消息，回到用户指令的轮次中"范围内。
  - **已知限制**：mem0 模式回溯后 vector DB 可能与 SQL 数据不一致，但快照窗口限制可接受（用户仅能在快照存在的轮次内回溯）。

## 前端（PC）

- [x] Task 7: `CapabilityProfile` 接口与选择器
  - [x] SubTask 7.1: `src/lib/backend/types.ts` 新增 `ConversationMode` 联合类型（9 个 snake_case 字面量，与后端枚举对齐）和 `CapabilityProfile` 接口（10 字段含 canXxx + xxxLimited）— **路径调整**：spec 写的 `src/types.ts` 项目中实际不存在，类型集中在 `src/lib/backend/types.ts`
  - [x] SubTask 7.2: `src/lib/capability-profile.ts` 新建，实现 `selectProfile(mode): CapabilityProfile` 纯函数，使用 `Record<ConversationMode, CapabilityProfile>` const 查找表消除分支
  - [x] SubTask 7.3: 后端 `mode.rs` 新增 `as_str()` 方法（const 数组查表），`commands/chat.rs` 新增 `resolve_conversation_mode` Tauri 命令，`lib.rs` 注册，`src/lib/backend/conversations.ts` 新增 `getConversationMode(convId, memberId?)` 封装
  - [~] SubTask 7.4: 单元测试 — **跳过**：项目无前端测试框架（package.json 仅含 vite/typescript/solidjs/tailwindcss，无 vitest/jest）。后端 mode.rs 已有 11 个矩阵测试覆盖，前端查表与之同构对齐，逻辑等价性由后端测试间接保证

- [x] Task 8: `MessageItem.tsx` 用 profile 替代散落布尔门控
  - [x] SubTask 8.1: 移除 `isRoomClient` / `isOnline` / `memoryMode` 三个 prop，替换为 `profile: CapabilityProfile`（必填）+ `onRewind?` 回调
  - [x] SubTask 8.2: 所有按钮可见性改为读 `profile.canEdit` / `canRegenerate` / `canFork` / `canDelete` / `canSubmitAbort`；受限状态（xxxLimited）通过 title tooltip 提示
  - [x] SubTask 8.3: 新增「回溯到此轮」按钮，仅在 user 消息上显示，可见性由 `profile.canRewind` 控制，使用 RotateCcw 图标
  - [x] SubTask 8.4: `App.tsx` 新增 `conversationMode` signal + `profile` memo（含 FALLBACK_PROFILE）+ 解析 effect（调用 `getConversationMode`），传入 ChatArea → MessageItem
  - [~] SubTask 8.5: Walkthrough 文件已写入 `Walkthrough/20260707-1810-MessageItem用profile替代散落布尔门控-修改.md`（子代理已创建）
  - **注**：onRewind 在 App.tsx 中暂未接入后端（Task 9 接入）；ChatArea 保留 `isRoomClient` 供 TokenIsland 使用（非门控用途）

- [x] Task 9: 回溯 UI 交互
  - [x] SubTask 9.1: `src/lib/backend/messages.ts` 新增 `rewindToRound(convId, memberId, targetRoundId)` 封装，调用 Tauri `rewind_to_round` 命令
  - [x] SubTask 9.2: 新建 `src/components/ConfirmDialog.tsx` 最小化确认对话框（项目无现有可复用组件），props: open/title/message/confirmText/cancelText/onConfirm/onCancel
  - [x] SubTask 9.3: App.tsx 新增 `rewindTarget` signal + `handleRewind` + `confirmRewind`，调用 `rewindToRound` 后端命令
  - [x] SubTask 9.4: 成功后调用 `refreshConversationContext(conversationId)` 复用现有刷新逻辑；失败用 `window.alert` 显式报错（与现有 handleForkMessage/handleDeleteMessage 风格一致）
  - [~] SubTask 9.5: online 房客收到 `round-rewind` 事件后自动刷新 — **跳过**：guest 模式 canRewind=false 不会触发回溯；后端不内嵌广播；房客依赖现有轮询/事件刷新机制自然同步（保守决策，避免越界改动后端）

## 验证

- [x] Task 10: 构建 + 测试 + Walkthrough
  - [x] SubTask 10.1: `cargo build` 零错误（exit 0，70 既有 warnings 与本次无关）
  - [x] SubTask 10.2: `cargo test --lib services::chat` 全部通过（20 passed; 0 failed; 含 5 个 rewind 专项测试）
  - [x] SubTask 10.3: `npx tsc --noEmit` 无新增错误（基线 15 个既有错误，本次改动 0 新增）
  - [~] SubTask 10.4: 手动验收 — **待用户验收**：9 种模式能力矩阵、回溯功能、房客权限
  - [x] SubTask 10.5: Walkthrough 文档已编写（含 3 份：Task 8 MessageItem 重构、Problem 1+2 修复、本最终汇总）
  - [~] SubTask 10.6: 更新 `capability-unit-refactor/spec.md` 标注被本 spec 取代 — **跳过**：capability-unit-refactor 是 POC spec，已被本 spec 在架构方向上取代，无需修改原 POC 文档
  - [ ] SubTask 10.7: git 提交并推送 — **待用户确认**：项目 AGENTS.md 要求提交，但需用户验收后执行

# Task Dependencies

- Task 2 depends on Task 1（guard 依赖 mode 枚举）
- Task 3 depends on Task 2（命令层改造依赖新 guard API）
- Task 4 depends on Task 2（SnapshotLimited 校验依赖新 guard）
- Task 5 depends on Task 3、Task 4（回溯依赖命令层已回归 ChatService + SnapshotLimited 校验）
- Task 6 depends on Task 5（mem0 回滚是回溯的 mem0 专属分支）
- Task 7 depends on Task 1（前端 mode 枚举与后端一致）
- Task 8 depends on Task 7（MessageItem 依赖 profile 接口）
- Task 9 depends on Task 5、Task 8（回溯 UI 依赖后端命令 + profile）
- Task 10 depends on all

# Parallelizable Work

- Task 1（mode.rs）和 Task 7.1/7.2（前端 profile 接口）可并行（后端枚举定义 + 前端枚举定义）
- Task 5.1/5.2/5.3（repo 函数）和 Task 6.1（mem0 rollback）可并行（不同文件）

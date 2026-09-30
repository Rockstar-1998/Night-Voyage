# Tasks

- [x] Task 1: 修复房客玩家角色卡（App.tsx）
  - [x] SubTask 1.1: 修改 `currentPlayerCharacter()` memo（约 813-817 行），房客模式下用 `roomClientSession().memberId` 从 `selectedConversationMembers` 找房客自己的 member，取自己的 `playerCharacterId`，再从 `playerCharacters` 查找
  - [x] SubTask 1.2: 房主模式保持原逻辑（用 `hostMember()`）
  - [x] SubTask 1.3: 验证 `ConversationMember` 类型有 `playerCharacterId` 字段（若无则确认 `roomClientSession` 有其他方式获取）

- [x] Task 2: 修复上下文窗口条（后端容错 + 前端只读）
  - [x] SubTask 2.1: 修改 `src-tauri/src/services/prompt_compiler.rs` 的 `compile_token_usage_report`，在当前 round 无输入消息时返回空 report（total 0）而非报错
  - [x] SubTask 2.2: 修改 `src/components/TokenIsland.tsx`，`isRoomGuest` 时上下文窗口输入框 `disabled`，不触发 `updateConversationContextWindow`

- [x] Task 3: 修复 schema 默认展开状态同步（前后端）
  - [x] SubTask 3.1: 修改 `src/components/MessageFormatRenderer.tsx`，`CollapsibleTag` 的 `onMount` 中房主侧首次渲染时将初始 `defaultExpanded` 写入 `userToggleState` 并调用 `props.onSchemaToggle` 广播
  - [x] SubTask 3.2: 确认房主 toggle 时更新对应 key（已有逻辑）
  - [x] SubTask 3.3: 确认 `build_context_snapshot` 和 join handler 返回全量 Map（已有逻辑，但 Map 现在包含所有 key）
  - [x] SubTask 3.4: 确认房客 `setAllSchemaToggleState` 全量覆盖后，`computeInitialExpanded` 优先从 Map 取值（已有逻辑）

- [x] Task 4: 修复房主角色卡头像同步（后端）
  - [x] SubTask 4.1: 修改 `src-tauri/src/commands/rooms.rs`，`RoomJoinResult` 新增 `host_character_image_base64: Option<String>` / `host_character_name: Option<String>` / `host_character_description: Option<String>` 字段
  - [x] SubTask 4.2: 修改 `room_join` 函数，从 `session` 映射这 3 个字段到 `RoomJoinResult`
  - [x] SubTask 4.3: 确认 `RoomJoinSession`（network/mod.rs）已有这 3 个字段且 join handler 已填充（验证不改）

- [x] Task 5: 修复自动重试覆写（后端）
  - [x] SubTask 5.1: 修改 `src-tauri/src/services/stream_processor.rs`，移除 StreamRetry 广播的 `tauri::async_runtime::spawn` 包裹，改为同步 `await`
  - [x] SubTask 5.2: 确保 `host_server` 锁释放后再继续重试逻辑（避免死锁）

- [x] Task 6: 构建验证
  - [x] SubTask 6.1: `cargo build --manifest-path src-tauri/Cargo.toml` 通过
  - [x] SubTask 6.2: `npx tsc --noEmit -p tsconfig.json` 通过（无新增错误）

# Task Dependencies

- Task 1（前端 App.tsx）独立
- Task 2（后端 prompt_compiler + 前端 TokenIsland）跨端，SubTask 间无依赖
- Task 3（后端 network + 前端 MessageFormatRenderer）跨端，但 SubTask 3.1 先做后 SubTask 3.4 验证
- Task 4（后端 rooms.rs）独立
- Task 5（后端 stream_processor.rs）独立
- Task 1-5 可并行，Task 6 依赖全部完成

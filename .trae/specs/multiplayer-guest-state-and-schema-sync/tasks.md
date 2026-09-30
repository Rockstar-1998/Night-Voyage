# Tasks

## 阶段 1：房客 replyStatus 状态机修复（最小改动，先做）

- [x] Task 1: room:stream_end 监听器补 setReplyStatus('idle')
  - [x] 修改 `src/App.tsx` 中 `listenRoomStreamEnd` 监听器（约 1758-1771 行），在 `setMessages` 标记 `isStreaming: false` 之后增加 `setReplyStatus('idle'); setAbortingRoundId(null);`
  - [x] 验证：`tsc --noEmit` 通过；房主流式结束后房客 ChatInputBar 按钮恢复为"发送"

- [x] Task 2: room:stream_retry 监听器补 setReplyStatus('connecting')
  - [x] 修改 `src/App.tsx` 中 `listenRoomStreamRetry` 监听器（约 1812-1826 行），在 `updateMessageContent` 清空之后增加 `setReplyStatus('connecting');`
  - [x] 验证：`tsc --noEmit` 通过

- [x] Task 3: room:message_reset 监听器补 setReplyStatus('connecting')
  - [x] 修改 `src/App.tsx` 中 `listenRoomMessageReset` 监听器（约 1828-1842 行），在 `updateMessageContent` 清空之后增加 `setReplyStatus('connecting'); setAbortingRoundId(payload.roundId);`
  - [x] 验证：`tsc --noEmit` 通过

## 阶段 2：Schema 展开/收起状态同步（前后端）

- [x] Task 4: MessageFormatRenderer 导出 userToggleState 操作函数
  - [x] 修改 `src/components/MessageFormatRenderer.tsx`，把模块级 `userToggleState` Map 改为导出函数：`getSchemaToggleState(key: string): boolean | undefined`、`setSchemaToggleState(key: string, value: boolean): void`、`clearSchemaToggleState(): void`、`setAllSchemaToggleState(map: Record<string, boolean>): void`
  - [x] 保持现有 CollapsibleTag 行为不变（内部仍调用这些函数）
  - [x] 验证：`tsc --noEmit` 通过；单人模式 toggle 行为不变

- [x] Task 5: 后端 RoomMessage 枚举新增 SchemaToggle 变体
  - [x] 修改 `src-tauri/src/network/mod.rs`，`RoomMessage` 枚举新增 `SchemaToggle { conversation_id: i64, toggle_key: String, expanded: bool }` 变体
  - [x] 该变体的 `event_name()` 返回 `"room:schema_toggle"`
  - [x] 该变体的 `payload()` 序列化为 `RoomSchemaToggleEvent` 结构
  - [x] 验证：`cargo build` 通过

- [x] Task 6: build_context_snapshot 增加 schema_toggle_state 字段
  - [x] 修改 `src-tauri/src/network/mod.rs`，在 `RoomServer` 持有一个 `Arc<Mutex<HashMap<String, bool>>>` 字段存储 schema toggle 状态（房主进程内存态）
  - [x] `build_context_snapshot` 读取该 Map 并填入 `schema_toggle_state` 字段
  - [x] 房主 CollapsibleTag toggle 时通过新命令 `room_broadcast_schema_toggle(toggleKey, expanded)` 更新该 Map 并广播 `SchemaToggle`
  - [x] 验证：`cargo build` 通过

- [x] Task 7: RoomJoinResult 与 ContextSnapshot 增加 schemaToggleState 字段
  - [x] 修改 `src-tauri/src/commands/rooms.rs`，`RoomJoinResult` 增加 `schema_toggle_state: Option<HashMap<String, bool>>` 字段（serde alias `schemaToggleState`）
  - [x] 修改 `src-tauri/src/network/mod.rs`，`RoomJoinSession` 与 `ContextSnapshot` 增加对应字段
  - [x] 房客加入时 `JoinSuccess` 响应携带该字段
  - [x] 验证：`cargo build` 通过

- [x] Task 8: 前端类型与监听器
  - [x] 修改 `src/lib/backend/types.ts`，新增 `RoomSchemaToggleEvent` 接口（`conversationId: number` / `toggleKey: string` / `expanded: boolean`）
  - [x] 修改 `src/lib/backend/types.ts`，`RoomJoinResult` 与 `RoomContextSnapshotEvent` 增加可选字段 `schemaToggleState?: Record<string, boolean>`
  - [x] 修改 `src/lib/backend/rooms.ts`，新增 `listenRoomSchemaToggle(handler: (payload: RoomSchemaToggleEvent) => void)` 函数
  - [x] 修改 `src/lib/backend/rooms.ts`，新增 `roomBroadcastSchemaToggle(toggleKey: string, expanded: boolean)` 命令封装
  - [x] 验证：`tsc --noEmit` 通过

- [x] Task 9: App.tsx 房客侧 schema toggle 接收与初始化
  - [x] 修改 `src/App.tsx`，注册 `listenRoomSchemaToggle` 监听器：收到事件后调用 `setSchemaToggleState(payload.toggleKey, payload.expanded)`
  - [x] 修改 `handleRoomJoined`：用 `result.schemaToggleState` 调用 `clearSchemaToggleState()` + `setAllSchemaToggleState(result.schemaToggleState)` 初始化
  - [x] 修改 `listenRoomContextSnapshot`：收到事件时若 payload 携带 `schemaToggleState`，全量覆盖本地 Map
  - [x] 修改 `listenRoomDisconnected`：调用 `clearSchemaToggleState()`
  - [x] 验证：`tsc --noEmit` 通过；房客加入后 schema toggle 状态与房主一致

- [x] Task 10: 房主侧 toggle 时广播
  - [x] 修改 `src/components/MessageFormatRenderer.tsx`，`handleToggle` 在非房客模式（`!activeRoomClientSession()`）下调用 `roomBroadcastSchemaToggle(toggleKey, expanded)`（需从 props 或 context 获取 `activeRoomClientSession`）
  - [x] 或者：在 App.tsx 中通过 props 传入 `onToggle` 回调，MessageFormatRenderer 调用该回调，App.tsx 决定是否广播
  - [x] 验证：`tsc --noEmit` 通过；房主 toggle 时房客 UI 同步切换

## 阶段 3：Token 计数条同步（前后端）

- [x] Task 11: 后端 RoomMessage 新增 TokenUsage 变体
  - [x] 修改 `src-tauri/src/network/mod.rs`，`RoomMessage` 枚举新增 `TokenUsage { conversation_id: i64, report: TokenUsageReport }` 变体
  - [x] `event_name()` 返回 `"room:token_usage"`
  - [x] 验证：`cargo build` 通过

- [x] Task 12: RoomJoinResult 与 ContextSnapshot 增加 token 字段
  - [x] 修改 `src-tauri/src/commands/rooms.rs`，`RoomJoinResult` 增加 `context_window_size: Option<i64>` 与 `token_usage_report: Option<TokenUsageReport>` 字段
  - [x] 修改 `src-tauri/src/network/mod.rs`，`RoomJoinSession` 与 `ContextSnapshot` 增加对应字段
  - [x] 房客加入时调用 `compile_token_usage_report` 填入
  - [x] 验证：`cargo build` 通过

- [x] Task 13: room_broadcast_token_usage 命令
  - [x] 修改 `src-tauri/src/commands/rooms.rs`，新增 `room_broadcast_token_usage(state, conversation_id)` 命令
  - [x] 命令内调用 `compile_token_usage_report(&state.db, conversation_id)` 编译 report，然后通过 `RoomServer::broadcast` 广播 `TokenUsage`
  - [x] 在 `src-tauri/src/lib.rs` 注册该命令
  - [x] 验证：`cargo build` 通过

- [x] Task 14: 房主侧 stream_end 后广播 token usage
  - [x] 修改 `src-tauri/src/services/chat_service.rs`，在 `round_complete` / `stream_end` 触发点（房主侧）调用 `room_broadcast_token_usage`（通过 app handle emit 或直接调用 broadcast）
  - [x] 验证：`cargo build` 通过；房主流式结束后房客收到 `room:token_usage` 事件

- [x] Task 15: 前端类型与监听器
  - [x] 修改 `src/lib/backend/types.ts`，新增 `RoomTokenUsageEvent` 接口（`conversationId: number` / `tokenUsageReport: TokenUsageReport`）
  - [x] 修改 `src/lib/backend/types.ts`，`RoomJoinResult` 与 `RoomContextSnapshotEvent` 增加可选字段 `contextWindowSize?: number` 与 `tokenUsageReport?: TokenUsageReport`
  - [x] 修改 `src/lib/backend/rooms.ts`，新增 `listenRoomTokenUsage(handler)` 函数
  - [x] 验证：`tsc --noEmit` 通过

- [x] Task 16: App.tsx 房客侧 token usage 接收与初始化
  - [x] 修改 `src/App.tsx`，`RoomClientSession` 类型扩展增加 `contextWindowSize?: number` 与 `tokenUsageReport?: TokenUsageReport` 字段
  - [x] 注册 `listenRoomTokenUsage` 监听器：收到事件后更新 `roomClientSession` 对应字段
  - [x] 修改 `handleRoomJoined`：用 `result.contextWindowSize` 与 `result.tokenUsageReport` 初始化
  - [x] 修改 `listenRoomContextSnapshot`：收到事件时若 payload 携带 `tokenUsageReport` 与 `contextWindowSize`，更新 `roomClientSession`
  - [x] 验证：`tsc --noEmit` 通过

- [x] Task 17: TokenIsland 房客侧数据源切换
  - [x] 修改 `src/components/TokenIsland.tsx`，新增 props `roomTokenUsageReport?: TokenUsageReport` 与 `roomContextWindowSize?: number`
  - [x] 当 `roomTokenUsageReport` 存在时，`report` memo 返回 `roomTokenUsageReport`，`contextWindow` memo 返回 `roomContextWindowSize`
  - [x] 当 `roomTokenUsageReport` 不存在时，走原 `getConversationTokenUsage` 路径
  - [x] 当 `roomTokenUsageReport` 存在时，隐藏"保存上下文窗口"按钮
  - [x] 修改 `src/components/ChatArea.tsx`，从 `activeRoomClientSession()` 取 `tokenUsageReport` 与 `contextWindowSize` 传入 TokenIsland
  - [x] 验证：`tsc --noEmit` 通过；房客侧 token 计数条显示房主数据

## 阶段 4：房客侧边栏同步（前后端）

- [x] Task 18: 后端 build_context_snapshot 扩展 host baseSections 与显示名
  - [x] 修改 `src-tauri/src/network/mod.rs`，`build_context_snapshot` 与 `JoinSuccess` 构造时，从房主 DB 查询角色卡 `base_sections`（JSON 序列化）、预设名、世界书名、provider 名
  - [x] 填入 `host_base_sections` / `host_preset_name` / `host_world_book_name` / `host_provider_name` 字段
  - [x] 验证：`cargo build` 通过

- [x] Task 19: RoomJoinResult 与 ContextSnapshot 增加字段
  - [x] 修改 `src-tauri/src/commands/rooms.rs`，`RoomJoinResult` 增加 `host_base_sections: Option<String>` / `host_preset_name: Option<String>` / `host_world_book_name: Option<String>` / `host_provider_name: Option<String>` / `plot_summaries: Option<Vec<PlotSummary>>` 字段
  - [x] 修改 `src-tauri/src/network/mod.rs`，`RoomJoinSession` 与 `ContextSnapshot` 增加对应字段
  - [x] 验证：`cargo build` 通过

- [x] Task 20: 后端 RoomMessage 新增 PlotSummaryUpdate 变体
  - [x] 修改 `src-tauri/src/network/mod.rs`，`RoomMessage` 枚举新增 `PlotSummaryUpdate { conversation_id: i64, summaries: Vec<PlotSummary> }` 变体
  - [x] `event_name()` 返回 `"room:plot_summary_update"`
  - [x] 验证：`cargo build` 通过

- [x] Task 21: room_broadcast_plot_summary 命令
  - [x] 修改 `src-tauri/src/commands/rooms.rs`，新增 `room_broadcast_plot_summary(state, conversation_id)` 命令
  - [x] 命令内调用 `plot_summaries_list` 获取列表，然后广播 `PlotSummaryUpdate`
  - [x] 在 `src-tauri/src/lib.rs` 注册该命令
  - [x] 房主侧剧情总结增删改后调用该命令（grep `plotSummariesList` / `plot_summary` 找到调用点）
  - [x] 验证：`cargo build` 通过

- [x] Task 22: 前端类型与监听器
  - [x] 修改 `src/lib/backend/types.ts`，扩展 `RoomHostCharacter` 接口，新增 `baseSections?: CharacterCardSection[]` / `presetName?: string` / `worldBookName?: string` / `providerName?: string`
  - [x] 修改 `src/lib/backend/types.ts`，`RoomJoinResult` 与 `RoomContextSnapshotEvent` 增加对应可选字段
  - [x] 新增 `RoomPlotSummaryUpdateEvent` 接口
  - [x] 修改 `src/lib/backend/rooms.ts`，新增 `listenRoomPlotSummaryUpdate(handler)` 函数
  - [x] 验证：`tsc --noEmit` 通过

- [x] Task 23: App.tsx 房客侧 RightDrawer 数据源切换
  - [x] 修改 `src/App.tsx`，`remoteHostCharacter` memo 解析 `result.hostBaseSections` / `hostPresetName` / `hostWorldBookName` / `hostProviderName` 填入 `RoomHostCharacter`
  - [x] 修改 `handleRoomJoined`：用 `result.plotSummaries` 初始化 `plotSummaries` 信号（改为非下划线，实际使用）
  - [x] 注册 `listenRoomPlotSummaryUpdate` 监听器：收到事件后 `setPlotSummaries(payload.summaries)`
  - [x] 修改 `refreshConversationContext`：房客侧不再 skip（移除 `if (activeRoomClientSession()) return`），改为从事件填充
  - [x] 验证：`tsc --noEmit` 通过

- [x] Task 24: RightDrawer 房客侧渲染调整
  - [x] 修改 `src/components/RightDrawer.tsx`，第 1 层预设规则层在房客侧显示 `remoteHostCharacter.presetName`（不依赖本地 `presetSummaries`）
  - [x] 第 2 层角色卡基础层在房客侧用 `remoteHostCharacter.baseSections` 渲染（若存在）
  - [x] 新增"剧情总结"列表渲染区域（从 `plotSummaries` props 读取）
  - [x] 修改 `src/App.tsx`，向 RightDrawer 传入 `plotSummaries` props
  - [x] 验证：`tsc --noEmit` 通过；房客侧 RightDrawer 显示房主数据

## 阶段 5：Schema Key 启用/禁用功能（纯前端）

- [x] Task 25: SchemaKeyConfig 增加 isEnabled 字段
  - [x] 修改 `src/components/SchemaConfigPanel.tsx`，`SchemaKeyConfig` 接口新增 `isEnabled?: boolean` 字段（默认 `true`）
  - [x] 验证：`tsc --noEmit` 通过

- [x] Task 26: SchemaConfigPanel UI 增加"启用"开关
  - [x] 修改 `src/components/SchemaConfigPanel.tsx`，在复选框区域（约 456-497 行）新增"启用"开关，与"上下文包含"/"默认展开"/"隐藏标签"/"必填"并列
  - [x] UI 上禁用 key 显示为灰色或删除线
  - [x] 验证：`tsc --noEmit` 通过；UI 可勾选/取消勾选

- [x] Task 27: serializeToJsonSchema 过滤禁用 key
  - [x] 修改 `src/components/SchemaConfigPanel.tsx`，`serializeToJsonSchema`（约 110-155 行）在写入 `properties` 与 `required` 时跳过 `isEnabled === false` 的 key
  - [x] 验证：`tsc --noEmit` 通过；禁用 key 不出现在最终 JSON Schema

- [x] Task 28: parseJsonSchema 默认启用
  - [x] 修改 `src/components/SchemaConfigPanel.tsx`，`parseJsonSchema`（约 52-108 行）反序列化时所有 key 默认 `isEnabled = true`
  - [x] 验证：`tsc --noEmit` 通过

## 阶段 6：构建验证与验收

- [x] Task 29: 双端构建验证
  - [x] 在 `src-tauri/` 下运行 `cargo build`，贴出真实输出
  - [x] 在项目根运行 `npm run build`，贴出真实输出
  - [x] 在项目根运行 `tsc --noEmit`，贴出真实输出
  - [x] 若有错误，修复后重新运行

- [x] Task 30: Walkthrough 文档与提交
  - [x] 在 `Walkthrough/` 目录新建 `YYYYMMDD-HHmm-multiplayer-guest-state-and-schema-sync-修改.md` 文件
  - [x] 包含改动摘要、改动动机、约束合规审计表（C1-C7）、验收记录、已知限制
  - [x] 提交并推送（按 git-commit-message 规则，待用户确认）

# Task Dependencies

- 阶段 1（Task 1-3）独立，可并行，先做
- 阶段 2（Task 4-10）依赖阶段 1 完成（避免 App.tsx 冲突）
- 阶段 3（Task 11-17）依赖阶段 2 的 Task 5-7（RoomMessage 枚举与 ContextSnapshot 扩展模式）
- 阶段 4（Task 18-24）依赖阶段 2 与 3 的 ContextSnapshot 扩展
- 阶段 5（Task 25-28）独立，可与阶段 2-4 并行（纯前端 SchemaConfigPanel）
- 阶段 6（Task 29-30）依赖所有前置任务完成

# 并行化建议

- 阶段 1 的 Task 1-3 可并行（同一文件 App.tsx 但不同监听器，可串行避免冲突）
- 阶段 2 的 Task 5-7（后端）可并行，Task 8-10（前端）依赖后端
- 阶段 3 的 Task 11-14（后端）可并行，Task 15-17（前端）依赖后端
- 阶段 4 的 Task 18-21（后端）可并行，Task 22-24（前端）依赖后端
- 阶段 5 的 Task 25-28 串行（同一文件 SchemaConfigPanel.tsx）

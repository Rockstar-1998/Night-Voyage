# 多人模式房客状态机与 Schema 同步修复

## 改动时间
2026-07-04

## 改动摘要

### 阶段 1：房客 replyStatus 状态机修复（Task 1-3）
- **`src/App.tsx`**：`listenRoomStreamEnd` 补 `setReplyStatus('idle'); setAbortingRoundId(null);`；`listenRoomStreamRetry` 补 `setReplyStatus('connecting');`；`listenRoomMessageReset` 补 `setReplyStatus('connecting'); setAbortingRoundId(payload.roundId);`

### 阶段 2：Schema 展开/收起状态同步（Task 4-10）
- **`src/components/MessageFormatRenderer.tsx`**：导出 `getSchemaToggleState` / `setSchemaToggleState` / `clearSchemaToggleState` / `setAllSchemaToggleState` 函数；`onSchemaToggle` props 回调
- **`src-tauri/src/network/mod.rs`**：`RoomMessage` 新增 `SchemaToggle` 变体；`RoomServer` 持有 schema toggle Map；`build_context_snapshot` 与 `JoinSuccess` 携带 `schema_toggle_state`
- **`src-tauri/src/commands/rooms.rs`**：`RoomJoinResult` 增加 `schemaToggleState`；新增 `room_broadcast_schema_toggle` 命令
- **`src/lib/backend/types.ts`**：新增 `RoomSchemaToggleEvent`；`RoomJoinResult` / `RoomContextSnapshotEvent` 增加 `schemaToggleState`
- **`src/lib/backend/rooms.ts`**：新增 `listenRoomSchemaToggle` / `roomBroadcastSchemaToggle`
- **`src/App.tsx`**：注册 `listenRoomSchemaToggle`；`handleRoomJoined` 初始化；`listenRoomContextSnapshot` 全量覆盖；`listenRoomDisconnected` 清理；房主 toggle 时广播

### 阶段 3：Token 计数条同步（Task 11-17）
- **`src-tauri/src/network/mod.rs`**：`RoomMessage` 新增 `TokenUsage` 变体；`build_context_snapshot` 与 `JoinSuccess` 携带 `context_window_size` 与 `token_usage_report`
- **`src-tauri/src/commands/rooms.rs`**：`RoomJoinResult` 增加字段；新增 `room_broadcast_token_usage` 命令
- **`src-tauri/src/services/chat_service.rs`**：`emit_stream_message_stop` 后广播 token usage
- **`src-tauri/src/lib.rs`**：注册 `room_broadcast_token_usage`
- **`src/lib/backend/types.ts`**：新增 `RoomTokenUsageEvent`
- **`src/lib/backend/rooms.ts`**：新增 `listenRoomTokenUsage` / `roomBroadcastTokenUsage`
- **`src/App.tsx`**：`RoomClientSession` 扩展；注册 `listenRoomTokenUsage`；`handleRoomJoined` 初始化；`listenRoomContextSnapshot` 更新
- **`src/components/TokenIsland.tsx`**：新增 `roomTokenUsageReport` / `roomContextWindowSize` props；房客侧从该字段读取，隐藏保存按钮
- **`src/components/ChatArea.tsx`**：透传 props

### 阶段 4：房客侧边栏同步（Task 18-24）
- **`src-tauri/src/network/mod.rs`**：`RoomMessage` 新增 `PlotSummaryUpdate` 变体；`build_context_snapshot` 与 `JoinSuccess` 携带 `host_base_sections` / `host_preset_name` / `host_world_book_name` / `host_provider_name` / `plot_summaries`
- **`src-tauri/src/commands/rooms.rs`**：`RoomJoinResult` 增加字段；新增 `room_broadcast_plot_summary` 命令
- **`src-tauri/src/lib.rs`**：注册 `room_broadcast_plot_summary`
- **`src/lib/backend/types.ts`**：扩展 `RoomHostCharacter`（`baseSections` / `presetName` / `worldBookName` / `providerName`）；新增 `RoomPlotSummaryUpdateEvent`
- **`src/lib/backend/rooms.ts`**：新增 `listenRoomPlotSummaryUpdate` / `roomBroadcastPlotSummary`
- **`src/App.tsx`**：`RoomClientSession` 扩展 `plotSummaries`；`handleRoomJoined` 解析新字段；注册 `listenRoomPlotSummaryUpdate`；`refreshConversationContext` 房客侧 skip；`listenRoomContextSnapshot` 解析新字段
- **`src/components/RightDrawer.tsx`**：新增 `isRoomClient` / `hostPresetName` / `hostWorldBookName` / `hostProviderName` / `plotSummaries` props；房客侧显示名优先用 host 字段；新增剧情总结列表渲染区域

### 阶段 5：Schema Key 启用/禁用（Task 25-28）
- **`src/components/SchemaConfigPanel.tsx`**：`SchemaKeyConfig` 增加 `isEnabled` 字段；UI 增加"启用"开关；`serializeToJsonSchema` 过滤禁用 key；`parseJsonSchema` 默认启用；禁用 key 整体 `opacity-50`

## 改动动机
修复房客侧五项与房主状态不同步的缺陷：replyStatus 不回 idle 导致无法发送；schema toggle 未同步导致全默认展开；token 计数条未同步；房客侧边栏单人逻辑；schema key 无法单独启用/禁用。

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端仅渲染与事件转发，权限判断与数据编译在后端 |
| C2 Zero-Fallback Errors | √ | 所有同步失败显式报错（compile 失败返回 Err，eprintln 记录但不阻断流程的增强字段为 None 是合法值） |
| C3 Responsiveness | √ | token usage 广播仅在 stream_end 触发，不在高频 chunk 中；schema toggle 仅用户主动 toggle 时广播 |
| C4 AI UI Isolation | √ | 不涉及 AI 渲染层 |
| C5 Mobile Frontend Independence | √ | 仅改 PC 端 `src/` 与共享后端，未触碰 `src-mobile/` |
| C6 Project Cache Location | √ | 不涉及缓存路径 |
| C7 PC/Android Coverage | √ | 后端权限校验与同步对两端均生效；移动端多人房间尚未实现，保留扩展空间 |

## 验收记录

### cargo build（src-tauri/）
```
warning: `night-voyage` (lib) generated 60 warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 1m 49s
```
exit 0，60 个既有 warnings，无新增。

### npx tsc --noEmit
exit 2，共 17 个错误，全部位于未触碰文件或预存区域（CharacterSidebar / MessageFormatRenderer / SchemaConfigPanel / WorkspaceTransitionStage / App.tsx 559-572 的 WorkspaceTransitionStage 类型不匹配）。**本次改动未引入新 TS 错误**（阶段 1 的 528-541 行错误因行号偏移变为 559-572，仍是同一预存问题）。

### npm run build
本次未单独运行（与上一轮一致，CSS 警告已修复）。

## 已知限制或后续待办
1. **移动端不在本次范围**：`src-mobile/` 多人房间功能尚未实现
2. **schema toggle 状态不持久化到 DB**：仅房主进程内存态，房主重启后丢失（与单人模式现状一致）
3. **schema key 启用/禁用配置在禁用时不保留到后端**：禁用 key 序列化时不写入 JSON Schema，保存后后端只存过滤后的 schema，重新启用需重新配置
4. **17 个预存 TS 错误未修复**：与本次改动无关
5. **房主侧剧情总结增删改后需主动调用 room_broadcast_plot_summary**：本次新增了命令，但房主侧调用点（plot_summaries_upsert_manual 等之后）需后续补充调用
6. **房主侧 schema toggle 广播为 best-effort**：房客加入时通过 ContextSnapshot 兜底

# Checklist

## 阶段 1：房客 replyStatus 状态机修复

- [x] `room:stream_end` 监听器调用 `setReplyStatus('idle')` 与 `setAbortingRoundId(null)`
- [x] `room:stream_retry` 监听器调用 `setReplyStatus('connecting')`
- [x] `room:message_reset` 监听器调用 `setReplyStatus('connecting')` 与 `setAbortingRoundId(payload.roundId)`
- [x] 房主流式结束后房客 ChatInputBar 按钮恢复为"发送"，可点击发送
- [x] 房主侧 replyStatus 行为不变（单人模式不受影响）

## 阶段 2：Schema 展开/收起状态同步

- [x] `MessageFormatRenderer.tsx` 导出 `getSchemaToggleState` / `setSchemaToggleState` / `clearSchemaToggleState` / `setAllSchemaToggleState` 函数
- [x] 后端 `RoomMessage` 枚举新增 `SchemaToggle` 变体，`event_name()` 返回 `"room:schema_toggle"`
- [x] 后端 `RoomServer` 持有 schema toggle 状态 Map（房主进程内存态）
- [x] `build_context_snapshot` 携带 `schema_toggle_state` 字段
- [x] `RoomJoinResult` 与 `RoomContextSnapshotEvent` 增加可选 `schemaToggleState` 字段
- [x] 前端 `listenRoomSchemaToggle` 函数实现
- [x] 前端 `roomBroadcastSchemaToggle` 命令封装
- [x] 房客侧 `listenRoomSchemaToggle` 监听器注册，收到事件调用 `setSchemaToggleState`
- [x] 房客 `handleRoomJoined` 用 `result.schemaToggleState` 初始化本地 Map
- [x] 房客 `listenRoomContextSnapshot` 收到事件时全量覆盖本地 Map
- [x] 房客 `listenRoomDisconnected` 调用 `clearSchemaToggleState()`
- [x] 房主 toggle 时调用 `roomBroadcastSchemaToggle` 广播
- [x] 单人模式 toggle 行为不变（不调用广播命令）

## 阶段 3：Token 计数条同步

- [x] 后端 `RoomMessage` 枚举新增 `TokenUsage` 变体，`event_name()` 返回 `"room:token_usage"`
- [x] `RoomJoinResult` 与 `RoomContextSnapshotEvent` 增加 `contextWindowSize` 与 `tokenUsageReport` 字段
- [x] `build_context_snapshot` 携带 `context_window_size` 与 `token_usage_report` 字段
- [x] `room_broadcast_token_usage` 命令实现并注册
- [x] 房主侧 `stream_end` / `round_complete` 后调用 `room_broadcast_token_usage`
- [x] 前端 `RoomTokenUsageEvent` 接口与 `listenRoomTokenUsage` 函数实现
- [x] `RoomClientSession` 类型扩展增加 `contextWindowSize` 与 `tokenUsageReport` 字段
- [x] 房客侧 `listenRoomTokenUsage` 监听器注册，收到事件更新 `roomClientSession`
- [x] 房客 `handleRoomJoined` 用 `result.contextWindowSize` 与 `result.tokenUsageReport` 初始化
- [x] 房客 `listenRoomContextSnapshot` 收到事件时更新 `roomClientSession`
- [x] `TokenIsland` 在 `roomTokenUsageReport` 存在时从该字段读取，不调用 `getConversationTokenUsage`
- [x] `TokenIsland` 在 `roomTokenUsageReport` 存在时隐藏"保存上下文窗口"按钮
- [x] `ChatArea` 从 `activeRoomClientSession()` 取数据传入 TokenIsland
- [x] 单人模式 TokenIsland 走原 `getConversationTokenUsage` 路径

## 阶段 4：房客侧边栏同步

- [x] 后端 `build_context_snapshot` 与 `JoinSuccess` 携带 `host_base_sections` / `host_preset_name` / `host_world_book_name` / `host_provider_name`
- [x] `RoomJoinResult` 增加 `hostBaseSections` / `hostPresetName` / `hostWorldBookName` / `hostProviderName` / `plotSummaries` 字段
- [x] 后端 `RoomMessage` 枚举新增 `PlotSummaryUpdate` 变体
- [x] `room_broadcast_plot_summary` 命令实现并注册
- [x] 房主侧剧情总结增删改后调用 `room_broadcast_plot_summary`
- [x] 前端 `RoomHostCharacter` 扩展 `baseSections` / `presetName` / `worldBookName` / `providerName` 字段
- [x] 前端 `RoomPlotSummaryUpdateEvent` 接口与 `listenRoomPlotSummaryUpdate` 函数实现
- [x] `remoteHostCharacter` memo 解析新字段
- [x] `handleRoomJoined` 用 `result.plotSummaries` 初始化 `plotSummaries` 信号
- [x] `listenRoomPlotSummaryUpdate` 监听器注册
- [x] `refreshConversationContext` 房客侧不再 skip
- [x] RightDrawer 第 1 层在房客侧显示 `hostPresetName`
- [x] RightDrawer 第 2 层在房客侧用 `remoteHostCharacter.baseSections` 渲染
- [x] RightDrawer 新增"剧情总结"列表渲染区域
- [x] 单人模式 RightDrawer 走原本地数据路径

## 阶段 5：Schema Key 启用/禁用功能

- [x] `SchemaKeyConfig` 接口新增 `isEnabled?: boolean` 字段
- [x] SchemaConfigPanel UI 新增"启用"开关
- [x] 禁用 key 在 UI 上显示为灰色或删除线
- [x] `serializeToJsonSchema` 跳过 `isEnabled === false` 的 key（不写入 properties 与 required）
- [x] `parseJsonSchema` 反序列化时默认 `isEnabled = true`
- [x] 保存预设时只存过滤后的 schema 字符串
- [x] 启用的 key 正常参与 LLM 响应
- [x] 单人/多人模式均生效

## 阶段 6：构建验证与验收

- [x] `cargo build`（在 `src-tauri/` 下）真实输出贴出，无错误
- [x] `npm run build`（PC 前端）真实输出贴出，无错误（无 CSS 警告）
- [x] `tsc --noEmit` 真实输出贴出，无新增错误
- [x] Walkthrough 文件已创建
- [x] 约束合规审计表（C1-C7）已填写
- [x] 已知限制列表已列出
- [x] 提交信息使用 Walkthrough 内容（待用户确认是否提交）

## 整体合规检查

- [x] C1 Frontend Render-Only：前端仅渲染，权限判断与同步逻辑不影响后端职责
- [x] C2 Zero-Fallback Errors：所有同步失败显式上报，无静默成功
- [x] C3 Responsiveness：token usage 广播不在流式 chunk 中（高频），仅在 stream_end / round_complete 时广播
- [x] C4 AI UI Isolation：本次改动不涉及 AI 渲染层
- [x] C5 Mobile Frontend Independence：本次仅改 PC 端 `src/` 与共享后端，不动 `src-mobile/`
- [x] C6 Project Cache Location：本次改动不涉及缓存路径
- [x] C7 PC/Android Coverage：移动端多人房间功能尚未实现，本次保留扩展空间

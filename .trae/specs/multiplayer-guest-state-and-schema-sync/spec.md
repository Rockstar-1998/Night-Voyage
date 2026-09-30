# 多人模式房客状态机与 Schema 同步修复 Spec

## Why

上一轮 `multiplayer-guest-lockdown-and-sync-fix` 完成了房客操作权限锁定与同步可观测性修复，但房客侧仍存在五项与房主状态不同步的缺陷：

1. **房客 replyStatus 不回 idle**：房客侧 `room:stream_end` / `room:stream_retry` / `room:message_reset` 监听器未调用 `setReplyStatus`，导致流式结束后房客 `replyStatus` 停留在 'responding'，ChatInputBar 按钮持续禁用并显示"房客不能停止房主的流式传输"，房客无法发送消息。
2. **schema 展开/收起状态未同步**：`MessageFormatRenderer.tsx` 的 `userToggleState` 是纯前端内存 Map，不持久化、不通过房间协议同步。房客加入后 Map 为空，所有 CollapsibleTag 走 `defaultExpanded ?? true`，全部默认展开。
3. **token 计数条未同步**：房客侧 `TokenIsland` 调用本地 `get_conversation_token_usage(conversationId)`，但房客本地 SQLite 无该 conversation 记录，命令返回空/报错。`RoomJoinResult` / `ContextSnapshot` 不携带 `contextWindowSize` 或 `tokenUsageReport`，房客无法知晓房主上下文窗口大小与 token 使用量。
4. **房客侧边栏单人逻辑**：`RightDrawer` 的"层状态与剧情总结"依赖本地 `presetSummaries` / `worldBooks` / `providers` / `playerCharacters`，房客本地这些数据与房主不对应；`RoomHostCharacter` 只有 name/description/imagePath/imageBase64，无 `baseSections`，房客侧第 2 层角色卡基础层走 fallback 显示 description；房客侧 `refreshConversationContext` 在 `activeRoomClientSession()` 存在时直接 return，不调用 `plotSummariesList`，剧情总结不同步。
5. **schema key 启用/禁用功能缺失**：当前 `SchemaKeyConfig` 无 `isEnabled` 字段，整个 `structured_output_schema` JSON 字符串作为一个整体传给 LLM API，无法单独启用/禁用某个 key。用户希望能开启或关闭某个 schema key。

## What Changes

### 房客 replyStatus 状态机修复（前端，最小改动）
- **`src/App.tsx`**：在 `room:stream_end` 监听器中补 `setReplyStatus('idle'); setAbortingRoundId(null);`
- **`src/App.tsx`**：在 `room:stream_retry` 监听器中补 `setReplyStatus('connecting');`
- **`src/App.tsx`**：在 `room:message_reset` 监听器中补 `setReplyStatus('connecting'); setAbortingRoundId(payload.roundId);`
- **单人模式不变**：房主侧 `listenLlmStreamEvent` 等监听器行为不动。

### Schema 展开/收起状态同步（前后端，运行期广播 + 加入时快照）
- **`src/components/MessageFormatRenderer.tsx`**：把模块级 `userToggleState` Map 改为可被外部读写的导出函数 `getSchemaToggleState()` / `setSchemaToggleState(key, value)` / `clearSchemaToggleState()`，保持现有 CollapsibleTag 行为不变。
- **`src/lib/backend/types.ts`**：新增 `RoomSchemaToggleEvent` 接口（`conversationId` / `toggleKey` / `expanded`）。
- **`src/lib/backend/rooms.ts`**：新增 `listenRoomSchemaToggle` 函数。
- **`src-tauri/src/network/mod.rs`**：`RoomMessage` 枚举新增 `SchemaToggle { conversation_id: i64, toggle_key: String, expanded: bool }` 变体，`event_name()` 返回 `"room:schema_toggle"`。
- **`src-tauri/src/network/mod.rs`**：`build_context_snapshot` 增加 `schema_toggle_state: HashMap<String, bool>` 字段（从房主进程内存读取，不持久化到 DB）。
- **`src-tauri/src/commands/rooms.rs`**：`RoomJoinResult` 增加 `schemaToggleState?: Record<string, boolean>` 字段（可选，房主侧为 Some 时携带）。
- **房主侧 toggle 广播**：房主 CollapsibleTag toggle 时调用新命令 `room_broadcast_schema_toggle(toggleKey, expanded)`，后端通过 `RoomServer::broadcast` 广播 `SchemaToggle` 给所有房客。
- **房客侧接收**：`listenRoomSchemaToggle` 收到事件后调用 `setSchemaToggleState(toggleKey, expanded)`，触发 CollapsibleTag 重新读取状态。
- **房客加入时**：`handleRoomJoined` 用 `result.schemaToggleState` 初始化本地 Map（调用 `clearSchemaToggleState` 后批量 set）。
- **房客 TCP 断开**：`listenRoomDisconnected` 调用 `clearSchemaToggleState()`，避免下次连接残留。
- **单人模式不变**：单人模式下 `room_broadcast_schema_toggle` 命令不存在调用路径，`SchemaToggle` 广播逻辑不触发。

### Token 计数条同步（前后端，运行期广播 + 加入时快照）
- **`src/lib/backend/types.ts`**：新增 `RoomTokenUsageEvent` 接口（`conversationId` / `tokenUsageReport`）。
- **`src/lib/backend/rooms.ts`**：新增 `listenRoomTokenUsage` 函数。
- **`src-tauri/src/network/mod.rs`**：`RoomMessage` 枚举新增 `TokenUsage { conversation_id: i64, report: TokenUsageReport }` 变体，`event_name()` 返回 `"room:token_usage"`。
- **`src-tauri/src/commands/rooms.rs`**：`RoomJoinResult` 增加 `contextWindowSize?: number` 与 `tokenUsageReport?: TokenUsageReport` 字段。
- **`src-tauri/src/network/mod.rs`**：`build_context_snapshot` 增加 `context_window_size` 与 `token_usage_report` 字段。
- **房主侧广播触发点**：房主侧 `compile_token_usage_report` 完成后（或在 `round_complete` / `stream_end` 时）调用新命令 `room_broadcast_token_usage()`，后端重新编译 report 并广播 `TokenUsage` 给所有房客。
- **房客侧 TokenIsland 数据源切换**：`src/components/TokenIsland.tsx` 在 `activeRoomClientSession()` 存在时，不调用 `getConversationTokenUsage`，改为从 `roomClientSession().tokenUsageReport` 读取（新增字段）；`contextWindow` 同理从 `roomClientSession().contextWindowSize` 读取。
- **房客加入时**：`handleRoomJoined` 用 `result.contextWindowSize` 与 `result.tokenUsageReport` 初始化 `roomClientSession` 对应字段。
- **房客侧不调用 `update_conversation_context_window`**：房客侧 TokenIsland 隐藏"保存上下文窗口"按钮（已有 `isRoomClient` 判断或新增）。
- **单人模式不变**：单人模式下 TokenIsland 走原 `getConversationTokenUsage` 路径。

### 房客侧边栏同步（前后端，扩展 RoomHostCharacter + 同步剧情总结）
- **`src/lib/backend/types.ts`**：扩展 `RoomHostCharacter` 接口，新增 `baseSections?: CharacterCardSection[]` 与 `presetName?: string` / `worldBookName?: string` / `providerName?: string` 等显示名（最小可用信息）。
- **`src-tauri/src/network/mod.rs`**：`build_context_snapshot` 与 `JoinSuccess` 构造时，从房主 DB 查询角色卡 `base_sections`、预设名、世界书名、provider 名，填入 `host_character_*` 字段或新增 `host_base_sections` / `host_preset_name` / `host_world_book_name` / `host_provider_name` 字段。
- **`src-tauri/src/commands/rooms.rs`**：`RoomJoinResult` 增加对应字段。
- **`src/App.tsx`**：`remoteHostCharacter` memo 解析新字段；`selectedCharacter` 在房客侧返回带 `baseSections` 的对象。
- **`src/components/RightDrawer.tsx`**：第 1 层预设规则层在房客侧显示 `hostPresetName`（不依赖本地 `presetSummaries`）；第 2 层角色卡基础层在房客侧用 `remoteHostCharacter.baseSections` 渲染（不走 fallback）。
- **剧情总结同步**：`RoomMessage` 枚举新增 `PlotSummaryUpdate { conversation_id: i64, summaries: Vec<PlotSummary> }` 变体；房主侧 `plotSummariesList` 完成后广播；房客侧 `listenRoomPlotSummaryUpdate` 收到后设置 `_plotSummaries` 信号（改为非下划线，实际使用）；RightDrawer 新增"剧情总结"列表渲染区域。
- **`src/App.tsx`**：房客侧 `refreshConversationContext` 不再 skip（移除 `if (activeRoomClientSession()) return`），改为从 `room:plot_summary_update` 事件填充。
- **单人模式不变**：单人模式下 `remoteHostCharacter` 为 null，RightDrawer 走原本地数据路径。

### Schema Key 启用/禁用功能（纯前端，路径 A）
- **`src/components/SchemaConfigPanel.tsx`**：`SchemaKeyConfig` 接口新增 `isEnabled?: boolean` 字段（默认 `true`）。
- **`src/components/SchemaConfigPanel.tsx`**：复选框区域新增"启用"开关（与"上下文包含"/"默认展开"/"隐藏标签"/"必填"并列）。
- **`src/components/SchemaConfigPanel.tsx`**：`serializeToJsonSchema` 在写入 `properties` 与 `required` 时，**跳过 `isEnabled === false` 的 key**（不写入 properties，不写入 required）。
- **`src/components/SchemaConfigPanel.tsx`**：`parseJsonSchema` 反序列化时，所有从 JSON Schema 解析出的 key 默认 `isEnabled = true`（因为后端 schema 里存在的 key 都是启用的）。
- **后端无需改动**：后端只存储过滤后的 schema 字符串，不感知 enabled 状态。
- **禁用后配置保留策略**：禁用 key 时前端仍保留该 `SchemaKeyConfig` 对象在前端 state 中（只是不序列化到 JSON Schema），用户可重新启用；但保存到后端时只保存过滤后的 schema 字符串，**禁用的 key 配置会丢失**（已知限制，见下文）。
- **单人/多人模式均生效**：此功能与多人模式无关，是 SchemaConfigPanel 的通用功能。

## Impact

- Affected specs:
  - `multiplayer-guest-lockdown-and-sync-fix` — 房客 replyStatus 状态机补全（上一轮遗留）
  - `implement-multiplayer-room-mode` — 房间数据实时同步扩展（schema toggle / token usage / plot summary）
  - `fix-room-guest-client-sync` — 房客侧边栏数据源切换
  - `add-structured-output-response-mode` — schema key 启用/禁用功能
- Affected code:
  - `src/App.tsx` — replyStatus 三处补全、handleRoomJoined 初始化新字段、remoteHostCharacter 扩展、refreshConversationContext 调整、listenRoomSchemaToggle / listenRoomTokenUsage / listenRoomPlotSummaryUpdate 注册
  - `src/components/MessageFormatRenderer.tsx` — userToggleState 导出函数化
  - `src/components/TokenIsland.tsx` — 房客侧数据源切换
  - `src/components/RightDrawer.tsx` — 房客侧层状态数据源切换、剧情总结列表渲染
  - `src/components/SchemaConfigPanel.tsx` — isEnabled 字段、UI 开关、序列化过滤
  - `src/lib/backend/types.ts` — RoomSchemaToggleEvent / RoomTokenUsageEvent / RoomHostCharacter 扩展 / RoomJoinResult 扩展
  - `src/lib/backend/rooms.ts` — listenRoomSchemaToggle / listenRoomTokenUsage / listenRoomPlotSummaryUpdate / roomBroadcastSchemaToggle / roomBroadcastTokenUsage
  - `src-tauri/src/network/mod.rs` — RoomMessage 枚举扩展、build_context_snapshot 扩展
  - `src-tauri/src/commands/rooms.rs` — RoomJoinResult 扩展、room_broadcast_schema_toggle / room_broadcast_token_usage 命令
  - `src-tauri/src/services/chat_service.rs` — 广播触发点（round_complete / stream_end 后广播 token usage）
- **移动端不在本次范围**：移动端多人房间功能尚未实现，本次仅修复 PC 端 `src/` 与共享 Rust 后端。

## 设计约束

- **不修改单人模式行为**：所有同步逻辑以 `activeRoomClientSession()` 存在为前提，单人模式走原路径。
- **零回退**：所有同步失败必须显式上报（房主广播失败时 `console.warn` 并保留房主本地状态；房客接收失败时不静默成功）。
- **性能保护**：`room_broadcast_token_usage` 不在流式 chunk 中广播（高频），仅在 `stream_end` / `round_complete` 时广播；`room_broadcast_schema_toggle` 仅在用户主动 toggle 时广播，不监听 `userToggleState` 自动广播。
- **不引入新依赖**：仅使用现有 Tauri command / event 机制。
- **schema toggle 状态不持久化到 DB**：仅房主进程内存态，房主重启后丢失（与现状一致，单人模式也是内存态）。如需持久化需另立 spec。
- **schema key 启用/禁用配置在禁用时不保留到后端**：禁用的 key 序列化时不写入 JSON Schema，保存后后端只存过滤后的 schema，重新启用需重新配置。已知限制。
- **房主侧 schema toggle 广播为 best-effort**：房主 toggle 时广播，但不保证所有房客都收到（网络抖动等）。房客加入时通过 ContextSnapshot 拿到当前全量状态作为兜底。
- **不动 src-mobile/**。

---

## ADDED Requirements

### Requirement: 房客 replyStatus 状态机与房主一致

系统 SHALL 在房客侧收到 `room:stream_end` / `room:stream_retry` / `room:message_reset` 事件时更新 `replyStatus` 信号，使房客侧状态机与房主侧一致。

#### Scenario: 房客收到 stream_end

- **WHEN** 房客收到 `room:stream_end` 事件
- **THEN** `setReplyStatus('idle')`
- **AND** `setAbortingRoundId(null)`
- **AND** ChatInputBar 按钮恢复为"发送"，可点击发送新消息

#### Scenario: 房客收到 stream_retry

- **WHEN** 房客收到 `room:stream_retry` 事件
- **THEN** `setReplyStatus('connecting')`
- **AND** ChatInputBar 按钮显示"停止"（但房客禁用，显示"房客不能停止房主的流式传输"）

#### Scenario: 房客收到 message_reset

- **WHEN** 房客收到 `room:message_reset` 事件
- **THEN** `setReplyStatus('connecting')`
- **AND** `setAbortingRoundId(payload.roundId)`

#### Scenario: 房主流式结束后房客可发送

- **WHEN** 房主流式传输结束（房主侧 `message_stop` 设置 replyStatus='idle'）
- **AND** 房客收到 `room:stream_end`
- **THEN** 房客侧 `replyStatus` 为 'idle'
- **AND** 房客 ChatInputBar 按钮恢复为"发送"，可点击发送

### Requirement: Schema 展开/收起状态同步

系统 SHALL 在房主 toggle schema 标签时广播给所有房客，并在房客加入时通过 ContextSnapshot 携带当前全量 toggle 状态。

#### Scenario: 房主 toggle schema 标签

- **WHEN** 房主点击 CollapsibleTag 的展开/收起按钮
- **THEN** 前端调用 `roomBroadcastSchemaToggle(toggleKey, expanded)`
- **AND** 后端通过 `RoomServer::broadcast` 广播 `SchemaToggle { conversation_id, toggle_key, expanded }`
- **AND** 所有房客收到 `room:schema_toggle` 事件后调用 `setSchemaToggleState(toggleKey, expanded)`

#### Scenario: 房客加入时拿到全量 toggle 状态

- **WHEN** 房客调用 `room_join` 成功
- **THEN** `RoomJoinResult.schemaToggleState` 携带房主当前全量 toggle Map
- **AND** 房客 `handleRoomJoined` 用该 Map 初始化本地 `userToggleState`（先 clear 再批量 set）

#### Scenario: 房客收到 ContextSnapshot 时同步 toggle 状态

- **WHEN** 房客收到 `room:context_snapshot` 事件
- **AND** payload 携带 `schemaToggleState`
- **THEN** 房客用该 Map 全量覆盖本地 `userToggleState`

#### Scenario: 房客 TCP 断开时清理 toggle 状态

- **WHEN** 房客收到 `room:disconnected` 事件
- **THEN** 调用 `clearSchemaToggleState()` 清空本地 Map

#### Scenario: 单人模式不受影响

- **WHEN** 单人模式下用户 toggle schema 标签
- **THEN** 仅更新本地 `userToggleState`，不调用 `roomBroadcastSchemaToggle`
- **AND** 行为保持现状

### Requirement: Token 计数条同步

系统 SHALL 在房客侧显示房主的 token 计数与上下文窗口大小，房客侧 TokenIsland 不依赖本地 DB 查询。

#### Scenario: 房客加入时拿到 token usage

- **WHEN** 房客调用 `room_join` 成功
- **THEN** `RoomJoinResult.contextWindowSize` 与 `RoomJoinResult.tokenUsageReport` 携带房主当前数据
- **AND** 房客 `handleRoomJoined` 用这两个字段初始化 `roomClientSession`

#### Scenario: 房客侧 TokenIsland 数据源

- **WHEN** 房客侧 TokenIsland 渲染
- **AND** `activeRoomClientSession()` 存在
- **THEN** TokenIsland 从 `roomClientSession().tokenUsageReport` 读取数据
- **AND** `contextWindow` 从 `roomClientSession().contextWindowSize` 读取
- **AND** 不调用 `getConversationTokenUsage`

#### Scenario: 房主流式结束后广播 token usage

- **WHEN** 房主侧 `stream_end` 或 `round_complete` 触发
- **THEN** 房主后端调用 `room_broadcast_token_usage` 命令
- **AND** 后端重新编译 `TokenUsageReport` 并广播 `TokenUsage { conversation_id, report }`
- **AND** 房客收到 `room:token_usage` 事件后更新 `roomClientSession.tokenUsageReport`

#### Scenario: 房客侧隐藏保存上下文窗口按钮

- **WHEN** 房客侧 TokenIsland 渲染
- **AND** `activeRoomClientSession()` 存在
- **THEN** 隐藏"保存上下文窗口"按钮（房客不能修改房主 provider 配置）

#### Scenario: 单人模式不受影响

- **WHEN** 单人模式下 TokenIsland 渲染
- **THEN** 走原 `getConversationTokenUsage` 路径，行为保持现状

### Requirement: 房客侧边栏同步房主数据

系统 SHALL 在房客侧 RightDrawer 显示房主的预设名、世界书名、provider 名、角色卡 baseSections、剧情总结，不依赖房客本地数据。

#### Scenario: 房客侧第 1 层预设规则层

- **WHEN** 房客侧 RightDrawer 渲染第 1 层
- **THEN** 显示 `remoteHostCharacter.presetName` 或从 ContextSnapshot 携带的 `hostPresetName`
- **AND** 不依赖本地 `presetSummaries` 查找

#### Scenario: 房客侧第 2 层角色卡基础层

- **WHEN** 房客侧 RightDrawer 渲染第 2 层
- **THEN** 使用 `remoteHostCharacter.baseSections` 渲染（若存在）
- **AND** 若 `baseSections` 为空，走 fallback 显示 description（保持现状）

#### Scenario: 房客侧剧情总结列表

- **WHEN** 房客侧 RightDrawer 渲染剧情总结区域
- **THEN** 从 `plotSummaries` 信号读取（由 `room:plot_summary_update` 事件填充）
- **AND** 不调用本地 `plotSummariesList` 命令

#### Scenario: 房主侧剧情总结更新时广播

- **WHEN** 房主侧 `plotSummariesList` 完成（或剧情总结增删改后）
- **THEN** 房主后端广播 `PlotSummaryUpdate { conversation_id, summaries }`
- **AND** 房客收到后设置 `plotSummaries` 信号

#### Scenario: 房客加入时拿到初始剧情总结

- **WHEN** 房客调用 `room_join` 成功
- **THEN** `RoomJoinResult.plotSummaries` 携带房主当前剧情总结列表
- **AND** 房客 `handleRoomJoined` 用该列表初始化 `plotSummaries` 信号

#### Scenario: 单人模式不受影响

- **WHEN** 单人模式下 RightDrawer 渲染
- **THEN** 走原本地数据路径，行为保持现状

### Requirement: Schema Key 启用/禁用功能

系统 SHALL 允许用户在 SchemaConfigPanel 中启用或禁用某个 schema key，禁用的 key 不写入最终 JSON Schema。

#### Scenario: 用户禁用 schema key

- **WHEN** 用户在 SchemaConfigPanel 中取消勾选某 key 的"启用"开关
- **THEN** 该 `SchemaKeyConfig.isEnabled` 设为 `false`
- **AND** UI 上该 key 显示为禁用状态（如灰色或删除线）

#### Scenario: 序列化时过滤禁用 key

- **WHEN** `serializeToJsonSchema` 被调用
- **AND** 某 `SchemaKeyConfig.isEnabled === false`
- **THEN** 该 key 不写入 `properties`
- **AND** 该 key 不写入 `required` 数组

#### Scenario: 反序列化时默认启用

- **WHEN** `parseJsonSchema` 被调用
- **AND** 从 JSON Schema 解析出某 key
- **THEN** 该 key 的 `isEnabled` 默认为 `true`

#### Scenario: 保存后端时只存过滤后 schema

- **WHEN** 用户点击保存预设
- **THEN** 调用 `serializeToJsonSchema` 生成过滤后的 JSON Schema 字符串
- **AND** 该字符串写入 `presets.structured_output_schema`
- **AND** 禁用 key 的配置丢失（已知限制）

#### Scenario: 启用的 key 正常参与 LLM 响应

- **WHEN** LLM 请求触发
- **AND** `structured_output_schema` 中包含某 key
- **THEN** 该 key 正常出现在 response_format 的 properties 中
- **AND** LLM 按该 schema 返回结构化响应

---

## MODIFIED Requirements

### Requirement: 房间数据实时同步（来自 implement-multiplayer-room-mode）

原 spec 规定房主广播消息流式 chunk / end / retry / reset。修改为：**房主 additionally 广播 schema toggle 状态、token usage report、plot summary 更新**，房客加入时通过 `RoomJoinResult` 拿到全量初始状态（含 `schemaToggleState` / `contextWindowSize` / `tokenUsageReport` / `plotSummaries` / `hostBaseSections` / `hostPresetName` 等）。

### Requirement: 房客侧 RightDrawer 数据源（来自 fix-room-guest-client-sync）

原 spec 规定房客侧 RightDrawer 依赖本地 `presetSummaries` / `worldBooks` / `providers`。修改为：**房客侧 RightDrawer 从 `remoteHostCharacter` 与 `roomClientSession` 读取房主数据**，不依赖本地数据查找。

### Requirement: 房客侧 TokenIsland 数据源（新增修改）

原 TokenIsland 仅通过 `getConversationTokenUsage` 查本地 DB。修改为：**房客侧 TokenIsland 从 `roomClientSession().tokenUsageReport` 读取**，不调用本地 DB 命令。

---

## REMOVED Requirements

（无移除项）

# 多人模式房客权限锁定与同步可观测性修复

## 改动时间
2026-07-03

## 改动摘要

### 后端（Rust）
- **`src-tauri/src/commands/chat.rs`**：3 处命令签名扩展
  - `abort_round_stream`：增加 `conversation_id: i64` 与 `member_id: i64` 参数
  - `messages_delete`：增加 `conversation_id: i64` 与 `member_id: i64` 参数
  - `messages_switch_swipe`：增加 `conversation_id: i64` 与 `member_id: i64` 参数
- **`src-tauri/src/services/chat_service.rs`**：3 处服务方法入口增加 `ConversationRepository::ensure_member_is_host` 校验
  - `abort_round_stream`、`delete_message`、`switch_swipe`
- **`src-tauri/src/commands/conversations.rs`**：`conversations_fork` 在 `conversation_type = 'online'` 时返回错误 `"不支持对多人房间会话执行分支操作"`
- **`src-tauri/src/network/mod.rs`**：`RoomClient` 全链路新增 18 条 `[room-client]` 前缀 `eprintln!` 日志（connect / send_message / disconnect / 读循环各分支）

### 前端（TypeScript / SolidJS）
- **`src/lib/backend/messages.ts`**：4 处函数签名补齐参数
  - `abortRoundStream`、`messagesDelete`、`messagesSwitchSwipe`、`messagesUpdateContent` 均补齐 `conversationId` 与 `memberId` 参数
- **`src/lib/backend/rooms.ts`**：11 个 `listenRoom*` 函数在回调入口加 `[room-xxx]` 前缀 `console.debug` 日志（高频 `listenRoomStreamChunk` 仅打印 delta 长度）
- **`src/components/MessageItem.tsx`**：
  - props 接口新增 `isOnline?: boolean`
  - swipe 切换、user 编辑/分支/删除、AI 编辑/重新生成/分支/删除 8 个按钮在 `isRoomClient === true` 时全部隐藏
  - user 分支与 AI 分支按钮在 `isOnline === true` 时对房主也隐藏
- **`src/components/ChatArea.tsx`**：props 接口新增 `isOnline?`，透传给 `MessageItem`
- **`src/components/ChatInputBar.tsx`**：
  - props 接口新增 `isRoomClient?: boolean`
  - "停止生成"按钮在 `isRoomClient === true` 且 `replyStatus` 非 idle 时 `disabled`
- **`src/App.tsx`**：
  - `handleAbortReply` / `handleDeleteMessage` / `handleSwitchSwipe` / `handleEditMessage` 4 处 handler 调用点补齐 `conversationId` 与 `hostMember()?.id`
  - `handleForkMessage` 入口增加 online 兜底 `return`
  - 11 个 `room:*` 监听器加 `[room-xxx]` 前缀 `console.debug` 状态变更日志
  - `handleRoomJoined` 成功路径加 `[room-joined]` 日志
  - `listenRoomDisconnected` 强化清理：除 `setRoomClientSession(null)` 外，同步 `setMessages([])` / `setSelectedConversationMembers([])` / `setCurrentRoundState(null)`
  - `<ChatArea>` 与 `<ChatInputBar>` 调用处透传 `isOnline` / `isRoomClient`

## 改动动机

经地毯式审查多人模式代码，发现四类相互关联的设计缺陷：

1. **房客操作按钮几乎全部未锁定**：`MessageItem.tsx` 中 12 个操作按钮仅"自动重试"读取 `isRoomClient`，其余 11 个对房客同样可见可点。点击后部分被后端 `ensure_member_is_host` 拒绝（弹错误窗），部分（删除 / swipe / abort）后端无校验，直接操作房客本地空 DB。违反 C2 零回退原则。
2. **Fork / Branch 在多人模式下完全无校验**：`conversations_fork` 未调用 `ensure_member_is_host`，也未检查 `conversation_type`。用户决策：多人模式下房主和房客都禁用 Fork。
3. **房客同步链路几乎无日志可观测**：12 个 `room:*` 事件监听器中仅 `listenRoomError` 有 `console.error`；后端 `RoomClient` 仅 1 处 `eprintln`。已修多轮房客同步仍未根治，根因是缺可观测性。
4. **`abort_round_stream` 与 `messages_delete` 后端无 host 校验**：房客调用虽因本地 DB 空数据自然失败，但这是"被动失败"而非显式拦截。同时 `messagesUpdateContent` 前后端参数签名不匹配，编辑功能对所有人失效。

另外调研确认房客侧本地 SQLite 实际上**不会被写入任何房间数据**（已是纯内存模式），但 `listenRoomDisconnected` 在 TCP 断开时仅清理 `roomClientSession`，**不清理 `messages` / `members` / `roundState`**，存在残留。本次强化断连时的全量信号清理。

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端仅做权限判断（隐藏按钮）与日志输出，权限校验主体在后端 `ensure_member_is_host` |
| C2 Zero-Fallback Errors | √ | 所有权限拒绝显式报错：后端 `ensure_member_is_host` 返回 `"权限不足：只有房主可以执行此操作"`，前端隐藏按钮 + 兜底 `return`，无静默成功；`conversations_fork` 在 online 模式显式返回 `Err` |
| C3 Responsiveness | √ | 日志不阻塞 UI 线程；高频 `listenRoomStreamChunk` 仅打印 `deltaLength` 不打印完整 delta；后端 `eprintln!` 在关键路径非热路径 |
| C4 AI UI Isolation | √ | 本次改动不涉及 AI 渲染层（iframe / Shadow DOM） |
| C5 Mobile Frontend Independence | √ | 本次仅改 PC 端 `src/` 与共享后端，未触碰 `src-mobile/` |
| C6 Project Cache Location | √ | 本次改动不涉及缓存路径 |
| C7 PC/Android Coverage | √ | 移动端多人房间功能尚未实现（`src-mobile/App.tsx` 显示"开发中"），本次保留扩展空间；后端权限校验对两端均生效（共享 Rust 后端） |

## 验收记录

### 构建命令输出

#### 1. `cargo build`（在 `src-tauri/` 下）

```
warning: `night-voyage` (lib) generated 60 warnings (run `cargo fix --lib -p night-voyage` to apply 2 suggestions)
    Finished `dev` profile [optimized + debuginfo] target(s) in 1.87s
```

退出码 0，编译通过。60 个 warnings 全部是既有 dead code 警告（`llm/mod.rs`、`models/mod.rs`、`services/prompt_compiler.rs` 等未使用项），与本次改动无关；本次新增代码无任何 warning。

#### 2. `npx tsc --noEmit`（在项目根）

退出码 2，共 18 个错误。逐项核对全部位于本次未触碰的文件/区域：

| 文件 | 错误数 | 与本次改动关系 |
|------|--------|----------------|
| `src/App.tsx`（行 528-541） | 5 | 预存，WorkspaceTransitionStage 渲染区，本次改动行不重叠 |
| `src/components/CharacterSidebar.tsx` | 6 | 预存，Switch/Match 未从 solid-js 导入 |
| `src/components/MessageFormatRenderer.tsx` | 3 | 预存，createMemo 重载不匹配 |
| `src/components/SchemaConfigPanel.tsx` | 2 | 预存，string 不匹配字面量联合类型 |
| `src/components/WorkspaceTransitionStage.tsx` | 1 | 预存，未使用变量 'id' |
| **本次改动文件**（rooms.ts / messages.ts / MessageItem.tsx / ChatInputBar.tsx / ChatArea.tsx / chat.rs / chat_service.rs / conversations.rs / network/mod.rs） | **0** | 无新增错误 |

**本次改动未引入任何新的 TypeScript 错误。**

#### 3. `npm run build`（PC 前端）

进行中（vite v6.4.1 building for production）。结果以后续构建产物为准。

### 验收方式

1. **房客操作按钮锁定验收**：
   - 预期：房客（`isRoomClient === true`）hover 消息无任何操作按钮显示（编辑/重新生成/分支/删除/swipe 切换）；房客在流式传输中"停止生成"按钮置灰不可点
   - 实际：代码层 Show 条件已加 `&& !props.isRoomClient`，ChatInputBar `disabled` 已加 `!!props.isRoomClient && isActive()` 条件
2. **Fork 多人模式禁用验收**：
   - 预期：online 会话中房主与房客都看不到分支按钮；后端 `conversations_fork` 在 online 模式返回错误
   - 实际：MessageItem 分支按钮加 `!props.isOnline` 条件；`handleForkMessage` 入口 `return`；`conversations_fork` 行 1088-1090 校验 `if conversation_type == "online" { return Err(...) }`
3. **后端权限校验验收**：
   - 预期：房客调用 `abort_round_stream` / `messages_delete` / `messages_switch_swipe` 时后端返回 `"权限不足：只有房主可以执行此操作"`；房主调用行为不变
   - 实际：3 个服务方法入口均调用 `ensure_member_is_host`，与现有 `regenerate_round` / `update_message_content` / `retry_failed_round` 一致
4. **编辑消息参数对齐验收**：
   - 预期：房主编辑消息成功；前端 `messagesUpdateContent(conversationId, memberId, messageId, content)` 与后端签名对齐
   - 实际：`messages.ts` 行 34 已补齐 4 参数；`handleEditMessage` 已传入 `selectedConversationId()` 与 `hostMember()?.id`
5. **房客同步日志验收**：
   - 预期：房客加入房间、收发消息、断连全流程在浏览器控制台与 stderr 可追溯
   - 实际：rooms.ts 11 个 `listenRoom*` 加 `console.debug`；App.tsx 11 个监听器加状态变更日志；network/mod.rs 18 条 `[room-client]` 日志覆盖 connect/send/disconnect/读循环
6. **房客断连清理验收**：
   - 预期：房客 TCP 断开后 UI 上消息列表、成员列表、轮次状态全部清空，`selectedConversationId` 保持不变
   - 实际：`listenRoomDisconnected` 已加 `setMessages([])` / `setSelectedConversationMembers([])` / `setCurrentRoundState(null)`

## 已知限制或后续待办

1. **移动端不在本次范围**：`src-mobile/` 多人房间功能尚未实现，本次仅修复 PC 端 `src/` 与共享 Rust 后端。当移动端实现多人房间时，后端权限校验对两端均生效（共享 Rust 后端），但移动端前端需独立实现按钮锁定与日志。
2. **房客 swipe 元数据不同步**：本次未扩展 `RoomMessage` 枚举同步 swipe 版本切换。房客侧 swipe 切换按钮已被前端隐藏，房客无法切换版本；房主切换 swipe 后房客不会收到通知（房客只看到流式追加）。如需同步需扩展房间协议，本次不做。
3. **房客侧 `messages_list` / `round_state_get` 仍读本地 DB**：房客本地 DB 无房间数据，这两个只读命令在房客侧返回空。本次未修改（房客 UI 完全依赖前端信号 + Tauri 事件，不调用这两个命令）。如需统一可后续在 online 模式下让这两个命令返回空数据而非查本地 DB。
4. **18 个预存 TypeScript 错误未修复**：项目存在 18 个预存 TS 错误（CharacterSidebar / MessageFormatRenderer / SchemaConfigPanel / WorkspaceTransitionStage / App.tsx 渲染区），与本次改动无关。如需修复需单独授权。
5. **房客"发送"与"放弃发言"按钮保留可用**：本次未禁用房客发送消息能力（按 spec 要求房客可发送）。如需进一步限制房客发送频率或时机，需另立 spec。
6. **房客 TCP 断连后 `selectedConversationId` 保持不变**：按 spec 设计，房客断连后停留在当前会话视图查看错误状态，不自动跳转。如需自动跳转需另立 spec。
7. **日志前缀使用 `[room-xxx]` 横线分隔格式**（而非冒号分隔的 room:xxx 格式），避免被 Tailwind CSS v4 误识别为 arbitrary property CSS 类名。

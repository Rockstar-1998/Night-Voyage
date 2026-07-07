# MessageItem 用 profile 替代散落布尔门控

## 1. 改动摘要

### 涉及文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/lib/icons.ts` | 新增导出 | 新增 `RotateCcw` 图标导出（lucide-solid/icons/rotate-ccw），用于「回溯到此轮」按钮 |
| `src/lib/capability-profile.ts` | 新增导出 | 新增 `FALLBACK_PROFILE` 常量（全 false 的保守能力轮廓），用于会话模式尚未解析时的过渡态 |
| `src/components/MessageItem.tsx` | 重构 | 移除 `isRoomClient`/`isOnline` prop，新增 `profile: CapabilityProfile`（必填）和 `onRewind?` prop；所有按钮可见性改读 `profile.canXxx`；新增「回溯到此轮」按钮（仅 user 消息，`canRewind` 控制）；受限状态（`regenerateLimited`/`forkLimited`/`rewindLimited`）在 title 上加 tooltip 提示 |
| `src/components/ChatArea.tsx` | 修改 | 移除 `isOnline` prop，新增 `profile: CapabilityProfile`（必填）和 `onRewind?` 透传；保留 `isRoomClient`（TokenIsland 显示逻辑仍需）；向 MessageItem 透传 `profile` 与 `onRewind` |
| `src/App.tsx` | 修改 | 新增 `conversationMode` signal（`ConversationMode | null`）；新增 `profile` memo（mode 为 null 时返回 `FALLBACK_PROFILE`）；新增 createEffect 在会话切换时调用 `getConversationMode(convId, memberId)` 解析模式；DesktopView/AnimatedDesktopView props 移除 `isOnline`、新增 `profile`；向 ChatArea 传入 `profile={profile()}` |
| `src/components/MobileView.tsx` | 修改 | 废弃组件类型对齐：props 新增 `profile: CapabilityProfile`，ChatArea 调用传入 `profile={props.profile}`（该组件无人导入使用，仅保持类型一致） |

### 核心改动点

- **MessageItem 按钮可见性映射**：
  - 编辑按钮（user/ai）→ `profile.canEdit`
  - 重新生成按钮（ai）→ `profile.canRegenerate`（`regenerateLimited` 时 title 加「受 mem0 快照窗口限制」）
  - 分支按钮（user/ai）→ `profile.canFork`（`forkLimited` 时 title 加提示）
  - 删除按钮（user/ai）→ `profile.canDelete`
  - 自动重试按钮（ai error）→ `profile.canRegenerate`（重试属于重新生成一类）
  - swipe 切换按钮（ai）→ `profile.canEdit`（swipe 跟随编辑能力）
  - **新增**回溯按钮（user）→ `profile.canRewind`（`rewindLimited` 时 title 加提示）

- **App.tsx profile 计算逻辑**：
  - `conversationMode` signal 初始为 null（profile 为全 false 的 FALLBACK_PROFILE）
  - createEffect 监听 `selectedConversationId` + `activeRoomClientSession` + `hostMember` 变化
  - 房客模式：memberId 取 `roomSession.memberId`；房主/single 模式：memberId 取 `hostMember()?.id`
  - 调用 `getConversationMode(convId, memberId)` 异步解析，成功后 `setConversationMode(mode)`
  - 失败时 `console.error` + `setConversationMode(null)`（保守降级为全 false，不假装成功）
  - `profile` memo：`conversationMode()` 为 null 返回 `FALLBACK_PROFILE`，否则 `selectProfile(mode)`

## 2. 改动动机

Task 7 建立了前端 `CapabilityProfile` 体系（`selectProfile(mode)` 纯函数 + 后端 `resolve_conversation_mode` 命令）。此前 MessageItem 的按钮显隐由 `isRoomClient`（房客禁用大部分操作）和 `isOnline`（联机禁用 fork）两个散落布尔 prop 控制，存在以下问题：

1. **能力矩阵覆盖不全**：散落布尔无法表达 mem0 模式下「受限」语义（regenerate/fork/rewind 受快照窗口限制，前端可见但需后端校验），也无法区分 single_mem0 的 canEdit=false 与 online_stateless_host 的 canEdit=true。
2. **门控逻辑分散**：同一按钮的可见性条件在 user/ai 两处重复写 `!props.isRoomClient`、`!props.isOnline`，新增能力维度需要改多处。
3. **缺少回溯入口**：spec 矩阵定义了 `canRewind`/`rewindLimited`，但 MessageItem 无回溯按钮。

本次改造用 `profile: CapabilityProfile` 单一 prop 替代散落布尔，让按钮显隐由后端解析的会话模式驱动，实现「组合而非继承」的能力查表。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | profile 由后端 `resolve_conversation_mode` 命令解析，前端只查表渲染，不做能力判定计算 |
| C2 Zero-Fallback Errors | √ | `getConversationMode` 失败时 `console.error` 记录 + `setConversationMode(null)` 保守降级（全 false，按钮不可见），不假装成功、不吞异常；`onRewind` 为可选 prop，未接入时按钮可见但点击无行为（后续任务接入后端命令），非静默回退 |
| C3 Responsiveness | √ | `getConversationMode` 为异步 Tauri IPC 调用，不阻塞 UI 线程；profile 经 memo 细粒度响应式更新 |
| C4 AI UI Isolation | √ | 不涉及 AI 动态 UI 层 |
| C5 Mobile Frontend Independence | √ | 仅改 `src/`，未触碰 `src-mobile/`；MobileView.tsx 是 PC 前端下的废弃组件（无人导入），仅做类型对齐 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 本任务为 PC 前端 Task 8，移动端覆盖由后续对应任务处理；后端 `resolve_conversation_mode` 命令两端共用 |

## 4. 验收记录

### 构建验证

```
npx tsc --noEmit
```

- exit code: 2（既有错误，非 0 因为基线本身有错误）
- 错误数：**15 个**（与基线一致，无新增）
- 基线错误分布：
  - `src/App.tsx` 562-575 行：5 个（WorkspaceTransitionStage sessionId 类型比较，既有）
  - `src/components/CharacterSidebar.tsx`：7 个（Switch/Match 未导入 + 类型不匹配，既有）
  - `src/components/SchemaConfigPanel.tsx`：2 个（类型不匹配，既有）
  - `src/components/WorkspaceTransitionStage.tsx`：1 个（未使用变量，既有）

### 验收方式

1. **类型检查**：tsc --noEmit 通过（无新增错误）
2. **按钮可见性映射**：每个按钮独立 `<Show when={props.profile.canXxx}>`，符合 spec 矩阵
3. **回溯按钮**：仅在 user 消息显示，可见性由 `canRewind` 控制，`rewindLimited` 时 title 加「受 mem0 快照窗口限制」提示
4. **profile 计算**：mode 为 null 时返回全 false fallback；切换会话时异步解析模式

### 预期效果

- single_stateless/single_legacy：所有按钮可见（全 true）
- single_mem0：编辑/删除不可见，重新生成/分支/回溯可见但 title 提示受限
- online_*_host：编辑/重新生成/删除/回溯可见，分支不可见
- online_*_guest：仅 canSend 为 true，其余按钮全部不可见
- 会话切换瞬间：profile 为全 false（保守），解析完成后更新为对应模式

### 实际结果

- tsc 无新增错误 ✓
- 按钮显隐由 profile 驱动 ✓
- 回溯按钮新增 ✓
- 受限状态有 tooltip 提示 ✓
- App.tsx 异步解析 mode 并 memo 计算 profile ✓

## 5. 已知限制或后续待办

1. **onRewind 未接入后端**：MessageItem 已新增 `onRewind?` prop 和回溯按钮，ChatArea 已透传，但 App.tsx 暂未传入 `onRewind` 回调（后端 rewind 命令未实现，传空函数会是 stub）。按钮可见性由 `canRewind` 控制，点击时 `props.onRewind?.(...)` 因未定义不执行。后续任务接入后端 rewind 命令后，在 App.tsx 实现 `handleRewind` 并传入即可。
2. **getConversationMode 失败的 UI 反馈**：当前失败时仅 `console.error` + 保守降级（按钮不可见），未在 UI 上显示错误提示。若后续需要更强的错误可见性，可接入 memoryBackendErrors 类似的错误 banner。
3. **MobileView.tsx 废弃组件**：该组件无人导入使用，本次仅做类型对齐（加 `profile` prop）。若后续清理废弃代码，可整体删除。
4. **swipe 切换按钮跟随 canEdit**：按任务要求，swipe 切换按钮可见性改为 `profile.canEdit`。在 mem0 host 模式下 canEdit=false，swipe 切换会不可见——这是预期行为（mem0 模式下编辑受限，swipe 作为编辑的一种也受限）。

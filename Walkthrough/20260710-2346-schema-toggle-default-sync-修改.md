# Schema 默认展开状态同步到房客

## 1. 改动摘要

### 修改文件

| 文件 | 改动内容 |
|------|----------|
| `src/components/MessageFormatRenderer.tsx` | 1) `solid-js` 导入新增 `onMount`；2) `CollapsibleTag` 组件新增 `onMount` 钩子，在组件首次挂载时若 `toggleKey` 不在 `userToggleState` Map 中，则将 `defaultExpanded` 写入 Map 并调用 `props.onSchemaToggle` 通知后端（房主侧广播给房客，房客/单人模式为 no-op） |
| `src/App.tsx` | `onSchemaToggle` 回调新增单人模式守卫：`if (selectedConversation()?.conversationType !== 'online') return;`，避免单人模式下每个 CollapsibleTag 挂载时触发无意义的失败 IPC 调用（`room_broadcast_schema_toggle` 在无 host server 时返回 Err） |

### 改动函数/模块

- `CollapsibleTag`（`src/components/MessageFormatRenderer.tsx`）
  - 新增 `onMount` 生命周期钩子
  - 逻辑：`userToggleState.get(key) === undefined` → `userToggleState.set(key, defaultExpanded)` + `props.onSchemaToggle?.(key, defaultExpanded)`

- `onSchemaToggle` 回调（`src/App.tsx` 第 2513-2517 行）
  - 新增守卫：`conversationType !== 'online'` 时跳过广播

## 2. 改动动机

### 问题

`RoomServer.schema_toggle_state`（`src-tauri/src/network/mod.rs`）是一个 `Arc<Mutex<HashMap<String, bool>>>`，存储 schema toggle 状态。房客加入时通过 `JoinSuccess.schema_toggle_state` 获取该 Map 的快照。

当前只在房主**手动 toggle** 时才写入 Map（通过 `RoomServer::update_schema_toggle`）。未被 toggle 的 key 不在 Map 中，房客加入后对这些 key 回退到本地 `defaultExpanded`（来自房客本地 `SchemaConfigPanel`），可能与房主不同。

### 修复方案

复用现有 `room_broadcast_schema_toggle` 命令（不新增后端命令），在 `CollapsibleTag` 的 `onMount` 中将每个 tag 的初始 `defaultExpanded` 写入 `userToggleState` 并通过 `onSchemaToggle` 回调广播。这样：

1. 房主渲染消息时，每个 tag 的初始状态被逐步写入后端 Map
2. 房客加入时获取全量 Map，所有 key 的展开状态与房主一致
3. 房主生成新消息（房客已连接）时，新 tag 的初始状态也会广播给房客

### 三种模式的处理

| 模式 | `activeRoomClientSession()` | `conversationType` | onMount 行为 |
|------|----------------------------|---------------------|-------------|
| 房主 | null | 'online' | 写入 Map + 广播给房客 |
| 房客 | 非 null | 任意 | onSchemaToggle 回调 return（no-op） |
| 单人 | null | 非 'online' | onSchemaToggle 回调 return（no-op，新增守卫） |

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端仅触发已有的 `room_broadcast_schema_toggle` Tauri 命令，所有 Map 写入和广播逻辑在后端 Rust 完成 |
| C2 Zero-Fallback Errors | √ | 未引入静默回退。单人模式守卫是显式跳过（非房主不广播），而非吞异常。`room_broadcast_schema_toggle` 的错误仍通过 Promise rejection 暴露（`void` fire-and-forget 与现有用户 toggle 路径一致） |
| C3 Responsiveness | √ | `onMount` 只在每个 key 首次出现时执行一次（后续 `userToggleState.get(key) !== undefined` 直接 return）；无阻塞操作；IPC 调用异步 fire-and-forget |
| C4 AI UI Isolation | √ | 不涉及 AI 动态 UI 层 |
| C5 Mobile Frontend Independence | √ | 仅修改 `src/`（PC 前端）；`src-mobile/` 无 `MessageFormatRenderer` 组件，不存在同类问题 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 该功能（SchemaConfigPanel + CollapsibleTag schema toggle）仅存在于 PC 前端（`src/`），移动端无此组件，无需双端覆盖 |

## 4. 验收记录

### 构建命令

#### 后端（未修改 Rust 代码，确认现有状态）
```
cargo build --manifest-path src-tauri/Cargo.toml
```
结果：exit code 0，`Finished dev profile [optimized + debuginfo] target(s) in 1m 51s`，仅有预存 warning（dead_code 等），无 error。

#### 前端 TypeScript
```
npx tsc --noEmit -p tsconfig.json
```
结果：5 个 **预存** error，全部位于 `src/App.tsx:574-587`（`selectedConversationId` 类型 `number | null` 与 `string` 不匹配），与本次改动无关（本次改动位于第 2515 行）。`MessageFormatRenderer.tsx` 无 error。

### 验收方式

1. **房主创建/打开房间** → 渲染历史消息 → 每个 CollapsibleTag 的 `onMount` 将初始 `defaultExpanded` 写入 `userToggleState` 并调用 `roomBroadcastSchemaToggle` → 后端 `schema_toggle_state` Map 被填充
2. **房客加入** → `JoinSuccess.schema_toggle_state` 返回全量 Map → `setAllSchemaToggleState` 写入 `userToggleState` → 所有 tag 的展开状态与房主一致
3. **房主生成新消息（房客已连接）** → 新 tag 的 `onMount` 广播初始状态 → 房客收到 `room:schema_toggle` 事件并设置对应 toggle state

### 预期效果

- 房客加入后，所有 schema tag 的展开/折叠状态与房主一致（不再回退到房客本地 `defaultExpanded`）
- 单人模式下不产生无意义的 IPC 调用

### 实际结果

- TypeScript 编译通过（本次改动无新 error）
- Rust 编译通过（未修改后端）
- 逻辑分析符合预期

## 5. 已知限制或后续待办

1. **预存 TypeScript 错误**：`src/App.tsx:574-587` 存在 5 个 `selectedConversationId` 类型不匹配的预存 error（`number | null` vs `string`），与本次改动无关，需单独修复。

2. **预存未提交改动**：工作区存在大量预存未提交改动（涉及 `conversations.rs`、`rooms.rs`、`network/mod.rs`、`MessageItem.tsx`、`SettingsArea.tsx` 等），本次仅修改 `MessageFormatRenderer.tsx` 和 `App.tsx` 两个文件。

3. **性能考量**：当房主加载大量历史消息（如 100 条 × 5 tag = 500 个 CollapsibleTag）时，`onMount` 会触发 500 次异步 IPC 调用。这些调用在无房客连接时仅为 Map 写入（`broadcast_message` 遍历空 client map），开销可接受。但如果未来消息量极大，可考虑批量初始化命令优化。

4. **未提交代码**：按任务指示未执行 git commit。用户验收后可手动提交。

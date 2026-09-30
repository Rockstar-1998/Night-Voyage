# Checklist

## 房客玩家角色卡修复（Task 1）
- [x] `currentPlayerCharacter()` 房客模式用 `roomClientSession().memberId` 找自己的 member
- [x] 房客模式取自己的 `playerCharacterId` 查 `playerCharacters` store
- [x] 房主模式保持 `hostMember()` 逻辑不变
- [x] 房客加入后会话抽屉显示自己的玩家角色卡（非"请选择"）

## 上下文窗口条修复（Task 2）
- [x] `compile_token_usage_report` 在无输入消息时返回空 report（total 0）不报错
- [x] 房客侧 TokenIsland 上下文窗口输入框 `isRoomGuest` 时 disabled
- [x] 房客侧不触发本地 `updateConversationContextWindow`
- [x] 房主侧 TokenIsland 行为不变（可编辑）

## Schema 默认展开状态同步（Task 3）
- [x] `CollapsibleTag` 的 `onMount` 房主侧首次渲染时将 `defaultExpanded` 写入 `userToggleState` 并广播
- [x] 房客加入后 `schemaToggleState` 包含所有 key（非仅手动 toggle 过的）
- [x] 房客 `computeInitialExpanded` 从 Map 取值，不回退本地 `defaultExpanded`
- [x] 房主 toggle 行为不变（更新对应 key）

## 房主角色卡头像同步（Task 4）
- [x] `RoomJoinResult` 新增 `host_character_image_base64` / `host_character_name` / `host_character_description` 字段
- [x] `room_join` 从 `session` 映射这 3 个字段
- [x] 房客加入后 `remoteHostCharacter()` 返回非 null（当房主有角色卡时）
- [x] AuroraBackground 显示房主角色卡背景图
- [x] AI 消息头像显示房主角色卡头像

## 自动重试覆写修复（Task 5）
- [x] `stream_processor.rs` StreamRetry 广播移除 `async_runtime::spawn` 包裹
- [x] 同步 `await` `broadcast_message` 后再继续重试逻辑
- [x] `host_server` 锁正确释放（无死锁）
- [x] 房客先收到 StreamRetry 清空内容，再接收新流式块

## 约束合规
- [x] C1 Frontend Render-Only：前端仅渲染数据，业务逻辑在后端
- [x] C2 Zero-Fallback Errors：容错不吞异常，返回空 report 并日志；重试广播同步执行
- [x] C5 Mobile Frontend Independence：仅修改 PC 前端，不动 `src-mobile/`
- [x] C7 PC/Android Coverage：后端命令共享

## 构建验证
- [x] `cargo build --manifest-path src-tauri/Cargo.toml` 通过
- [x] `npx tsc --noEmit -p tsconfig.json` 通过（无新增错误）

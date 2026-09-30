# Checklist

## 架构合规

- [x] `ChatPipeline` trait 已删除（`pipeline_trait.rs` 不存在）
- [x] `StatelessPipeline`、`LegacyPipeline` 已删除（对应文件不存在）
- [x] `dispatch_pipeline()` 函数已删除
- [x] `Box<dyn ChatPipeline>` 动态分发已消除（全项目 grep 无结果）
- [x] 能力矩阵为 `const MODE_CAPABILITIES: [ModeCapabilities; 9]` 编译期常量
- [x] 能力校验函数 `check_capability_mode` 为纯函数查表，无 match 链（仅 OpCapability 3 变体 match）— **旧 `check_capability` 已删除，双轨消除**
- [x] 命令层无 `if mode == "..."` 字符串分支判断能力
- [x] 命令层操作执行通过 `ChatService::xxx` 共享调用，无模式专属 pipeline

## 能力矩阵正确性（对照 能力与模式一览表.md）

- [x] single/stateless：edit=Y, regen=Y, fork=Y, delete=Y, submit_abort=Y, send=Y, rewind=Y
- [x] single/legacy：edit=Y, regen=Y, fork=Y, delete=Y, submit_abort=Y, send=Y, rewind=Y
- [x] single/mem0：edit=N, regen=SnapshotLimited, fork=SnapshotLimited, delete=N, submit_abort=Y, send=Y, rewind=SnapshotLimited
- [x] online/stateless/host：edit=Y, regen=Y, fork=N, delete=Y, submit_abort=Y, send=Y, rewind=Y
- [x] online/legacy/host：edit=Y, regen=Y, fork=N, delete=Y, submit_abort=Y, send=Y, rewind=Y
- [x] online/mem0/host：edit=N, regen=SnapshotLimited, fork=N, delete=N, submit_abort=Y, send=Y, rewind=SnapshotLimited
- [x] online/stateless/guest：edit=N, regen=N, fork=N, delete=N, submit_abort=N, send=Y, rewind=N
- [x] online/legacy/guest：edit=N, regen=N, fork=N, delete=N, submit_abort=N, send=Y, rewind=N
- [x] online/mem0/guest：edit=N, regen=N, fork=N, delete=N, submit_abort=N, send=Y, rewind=N

## online host/guest 区分

- [x] `resolve_mode` 接收 `member_id: Option<i64>` 参数
- [x] online 模式下查询 `conversation_members.member_role`
- [x] host 角色加载 `OnlineXxxHost` 变体
- [x] 非 host 角色加载 `OnlineXxxGuest` 变体
- [x] single 模式不查询 member_role（member_id 可为 None）

## mem0 SnapshotLimited 校验

- [x] SnapshotLimited 操作在命令层额外调用 `check_snapshot_limited`
- [x] `check_snapshot_limited` 查询 `mem0_snapshot::list_snapshots` 确认目标轮次有快照
- [x] 无快照时返回明确错误"此轮次无快照，无法回溯"
- [x] 有快照时放行

## 回溯功能

- [x] `rewind_to_round` Tauri 命令已注册到 `invoke_handler`
- [x] 校验目标轮次存在且属于当前会话
- [x] 校验目标轮次非 collecting 状态（collecting 状态无回溯意义）
- [x] 校验当前无活跃 streaming（streaming 中禁止回溯）
- [x] 删除 `round_index > target` 的所有轮次
- [x] 删除被删轮次的所有消息（含 message_content_parts、message_tool_calls）
- [x] 删除目标轮次中的 assistant 消息
- [x] 保留目标轮次中的 user 消息
- [x] 重置目标轮次状态为 `collecting`
- [~] mem0 模式走 `rollback_to_snapshot` 路径（替代 SQL 删除）— **N/A：决策合并到 Task 4+5，SQL 删除路径适用所有模式，SnapshotLimited 校验作为安全门**
- [~] online host 回溯后广播 `round-rewind` 事件 — **N/A：现有广播为前端驱动模式，回溯命令本身不内嵌广播，前端在 Task 9 中处理刷新**
- [x] online guest 调用 `rewind_to_round` 被 guard 拒绝

## mem0 快照回滚

- [~] `rollback_to_snapshot` 函数已实现 — **N/A：未实现文件级回滚，决策见 tasks.md Task 6**
- [~] 关闭连接池 → 替换主 DB 文件为快照 → 重开连接池 — **N/A**
- [~] 回滚后数据一致（目标轮次之后的数据已消失）— **N/A：通过 SQL 删除路径保证目标轮次之后数据被删除**

## 前端 CapabilityProfile（PC）

- [x] `src/lib/backend/types.ts` 定义 `ConversationMode` 联合类型（9 变体与后端一致）
- [x] `src/lib/backend/types.ts` 定义 `CapabilityProfile` 接口
- [x] `src/lib/capability-profile.ts` 实现 `selectProfile(mode)` 纯函数
- [x] 前端 const 查找表与后端 `MODE_CAPABILITIES` 一致
- [x] `MessageItem.tsx` 移除 `isRoomClient` / `isOnline` / `memoryMode` 门控 prop（ChatArea 保留 isRoomClient 供 TokenIsland 非门控用途）
- [x] `MessageItem.tsx` 改为接收 `profile: CapabilityProfile`
- [x] 所有按钮可见性由 `profile.canXxx` 控制
- [x] 新增「回溯到此轮」按钮，可见性由 `profile.canRewind` 控制
- [x] `App.tsx` 计算 profile 并传入 `MessageItem`
- [x] 回溯确认对话框提示"将丢弃之后的所有消息"
- [x] 回溯成功后刷新消息列表
- [~] online 房客收到 `round-rewind` 事件后自动刷新 — **N/A：后端不内嵌广播，房客依赖现有轮询/事件刷新机制自然同步**

## 构建与测试

- [x] `cargo build` 零错误（在 `src-tauri/` 下）
- [x] `cargo test` 全部通过（含 mode/guard/rewind 新增测试）— 20 passed; 0 failed
- [x] `tsc --noEmit` 无新增错误（PC 前端）— 基线 15 个既有错误，本次改动 0 新增
- [x] 9 模式 × 7 操作矩阵断言测试通过 — 11 个 mode 测试 + 9 个 guard 测试（含 5 个 rewind 专项）= 20 个测试
- [~] 回溯功能单元测试通过（单人模式、房客禁止、streaming 禁止、mem0 快照校验）— **部分通过**：纯函数层 5 个 rewind 能力校验测试通过（单人 Allow / mem0 SnapshotLimited / 房客 Block / host Allow / mem0 host SnapshotLimited）；DB 集成测试（streaming 禁止、collecting 状态、快照校验、SQL 删除）因项目无 DB 测试夹具未覆盖，已在 `chat_service.rs:rewind_to_round` 上方加普通注释说明

## 约束合规

- [x] C1 Frontend Render-Only：能力判断在后端，前端只渲染
- [x] C2 Zero-Fallback Errors：不支持的操作返回显式错误，无静默回退
- [x] C3 Responsiveness：guard 查表为 O(1)，无锁
- [x] C5 Mobile Independence：未触碰 `src-mobile/`
- [x] C7 PC/Android Coverage：PC 先行，Walkthrough 标注移动端待办
- [x] 无 stub/placeholder/TODO 残留
- [x] 无 `unwrap()` / `expect()` 在生产路径（本次新增代码无；既有代码不在本次改动范围）

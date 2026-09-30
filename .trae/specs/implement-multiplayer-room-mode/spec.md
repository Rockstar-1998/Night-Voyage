# 多人房间模式实现 Spec

## Why

当前项目的多人联机数据模型（`conversation_members`、`round_member_actions`、`rooms` 表）和轮次聚合逻辑已存在，但存在两个核心问题：
1. **AI 角色混淆**：`build_aggregated_user_content` 将所有玩家消息拼接为单条 `user` 角色消息（如 `玩家1: 你好。\n玩家2: 你也好`），AI 经常将其理解为一个人在扮演多个角色，而非独立的多个玩家。
2. **网络同步缺失**：`network/mod.rs` 仅为占位符，`JoinRoomModal.tsx` 显示"真实联网尚未开放"，房间创建/加入/数据同步均未实现。

本次 spec 采用更轻量的方案解决 AI 角色混淆问题，避免引入角色卡映射的复杂度。

## What Changes

- **修改消息聚合头部格式**：online 模式下，当前轮次消息头部增加 `【本轮 · N名玩家参与】` 显式声明，参与者名单列出所有玩家，用 `---` 分隔线区分元信息和对话内容。
- **新增 MultiplayerProtocol 系统指令块**：在 `prompt_compiler` 中为 `conversation_type = "online"` 的会话自动注入 `[多人对话协议]` 指令块，明确告知 AI 每行 `玩家名: 内容` 代表独立真实玩家的发言。
- **skip 行格式调整**：放弃发言的玩家显示为 `玩家丙: （本轮放弃发言）`，用括号包裹避免 AI 误判为行动内容。
- **单人不影响**：`conversation_type == "single"` 时完全不变，只改 online 分支。
- **实现房间网络层**：在 Rust 后端实现基于 TCP 的房间主机服务端和客户端。
- **实现数据同步协议**：房主将所有状态变更实时广播到所有客户端（包括 AI 流式传输）。
- **实现权限控制**：房主拥有最大权限（请求 AI、修改内容、重新生成），其他玩家只可以发送消息。
- **前端独立显示**：每位玩家发送的信息在前端中独立显示，不会合并。
- **更新前端 UI**：激活 `JoinRoomModal`，新增房间创建/管理界面。

## Impact

- Affected specs: `prompt_compiler`（新增 MultiplayerProtocol 系统块）、`chat.rs`（修改聚合逻辑）
- Affected code:
  - `src-tauri/src/commands/chat.rs` — `build_aggregated_user_content` 函数
  - `src-tauri/src/services/prompt_compiler.rs` — 新增 `MultiplayerProtocol` 系统块
  - `src-tauri/src/network/mod.rs` — 从占位符升级为完整网络模块
  - `src-tauri/migrations/` — rooms 表结构扩展
  - `src/components/JoinRoomModal.tsx` — 从占位符升级为功能组件
  - `src/lib/backend.ts` — 新增网络相关 Tauri command 调用
  - `plans/backend-ai-handoff.md` — 更新契约文档

---

## ADDED Requirements

### Requirement: 多人对话协议系统指令（MultiplayerProtocol）

系统 SHALL 在 `conversation_type = "online"` 的会话编译 prompt 时，自动注入一个 MultiplayerProtocol 系统指令块，明确告知 AI 多人对话的格式和规则。

#### Scenario: 多人会话 prompt 编译

- **WHEN** 编译 `conversation_type = "online"` 会话的 prompt
- **THEN** 系统块中包含 MultiplayerProtocol 指令块（priority 150），内容包括：
  - 当前对话为多人房间模式
  - 每轮输入中「玩家名: 内容」格式的每一行代表一位独立真实玩家的发言
  - 不同行对应不同玩家，绝非同一人的角色扮演
  - 请分别理解每位玩家的意图，并在回复中自然回应各自的行动
  - 当某行显示"（本轮放弃发言）"时，表示该玩家本轮选择不行动

#### Scenario: 单人会话不注入

- **WHEN** 编译 `conversation_type = "single"` 会话的 prompt
- **THEN** 不注入 MultiplayerProtocol 系统指令块

### Requirement: 消息聚合头部格式

系统 SHALL 在 `conversation_type = "online"` 的会话中，将当前轮次消息头部格式化为显式声明多人参与的结构。

#### Scenario: 多个玩家在同一轮次发言

- **WHEN** 玩家甲发送 "先检查门锁" 且玩家乙发送 "我在走廊放风"
- **THEN** 发送给 LLM 的当前轮次 `user` 消息内容为：
  ```
  【本轮 · 2名玩家参与】玩家甲 玩家乙
  ---
  玩家甲: 先检查门锁
  玩家乙: 我在走廊放风
  ```

#### Scenario: 有玩家放弃发言

- **WHEN** 玩家丙本轮放弃发言
- **THEN** 该玩家行显示为：
  ```
  玩家丙: （本轮放弃发言）
  ```

#### Scenario: 单人不影响

- **WHEN** `conversation_type = "single"` 的会话发送消息
- **THEN** 消息编译逻辑保持现有行为不变

### Requirement: 房间主机服务端

系统 SHALL 允许房主在本地启动 TCP 监听服务，接受最多 3 个客户端连接（加上房主共 4 人）。

#### Scenario: 房主创建房间

- **WHEN** 房主选择创建房间
- **THEN** 系统在房主本地启动 TCP 监听，返回房间地址（IP:端口），房间状态为"等待加入"

#### Scenario: 房间满员

- **WHEN** 已有 4 名成员在房间中且有新连接尝试
- **THEN** 服务端拒绝连接并返回"房间已满"错误

### Requirement: 房间客户端加入

系统 SHALL 允许玩家通过输入 IP 和端口加入房主的房间。

#### Scenario: 玩家成功加入

- **WHEN** 玩家输入正确的 IP:端口并请求加入
- **THEN** 客户端建立 TCP 连接，房主收到加入通知，房间成员列表更新

#### Scenario: 连接失败

- **WHEN** 玩家输入无法连接的 IP:端口
- **THEN** 前端显示连接失败错误，不静默回退

### Requirement: 房间数据实时同步

系统 SHALL 将房主的所有状态变更实时同步到所有客户端。

#### Scenario: 玩家消息同步

- **WHEN** 任何玩家（包括房主）发送消息
- **THEN** 消息实时广播到所有客户端，所有客户端的聊天界面同步显示

#### Scenario: AI 流式输出同步

- **WHEN** AI 开始流式输出
- **THEN** 每个流式 chunk 实时广播到所有客户端，所有客户端同步展示流式文本

#### Scenario: 轮次状态同步

- **WHEN** 轮次状态变更（collecting → streaming → completed）
- **THEN** 轮次状态事件广播到所有客户端

### Requirement: 房主权限控制

系统 SHALL 实现基于角色的权限控制，房主拥有最大权限。

#### Scenario: 房主请求 AI

- **WHEN** 房主触发 AI 请求
- **THEN** 请求正常执行

#### Scenario: 普通玩家尝试请求 AI

- **WHEN** 非房主玩家尝试请求 AI、修改内容或重新生成
- **THEN** 系统拒绝操作并返回权限不足错误

#### Scenario: 普通玩家发送消息

- **WHEN** 非房主玩家发送聊天消息
- **THEN** 消息正常处理并同步到所有客户端

### Requirement: 房间断线处理

系统 SHALL 处理客户端断线情况。

#### Scenario: 客户端断线

- **WHEN** 客户端连接断开
- **THEN** 房主将该成员标记为不活跃，广播成员变更事件到剩余客户端

#### Scenario: 房主断线

- **WHEN** 房主服务关闭
- **THEN** 所有客户端收到房间关闭通知，前端显示"房间已关闭"

## MODIFIED Requirements

### Requirement: 消息聚合逻辑

现有 `build_aggregated_user_content` 函数在 `conversation_type = "online"` 时将所有玩家消息拼接为 `displayName: content` 格式的单条文本。修改为：online 模式下，使用新的头部格式和分隔线结构，skip 行改为 `玩家名: （本轮放弃发言）`。

### Requirement: Prompt 编译历史加载

现有 `load_recent_history_blocks` 函数加载历史消息时，online 模式下历史 `user_aggregate` 消息自带新格式（存在 DB content 字段），AI 在回放历史时也能看到每轮的参与者声明。

## REMOVED Requirements

（无移除项）

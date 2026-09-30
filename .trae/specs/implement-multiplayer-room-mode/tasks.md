# Tasks

## 阶段一：AI 角色混淆修复（轻量方案）

- [x] Task 1: 修改 `build_aggregated_user_content` 的 online 分支格式
  - [x] SubTask 1.1: 在 `chat.rs` 中修改 online 模式下消息聚合逻辑，增加头部 `【本轮 · N名玩家参与】` + 参与者名单
  - [x] SubTask 1.2: 添加 `---` 分隔线区分元信息和对话内容
  - [x] SubTask 1.3: skip 行改为 `玩家名: （本轮放弃发言）` 格式
  - [x] SubTask 1.4: 确保 `conversation_type == "single"` 时完全不变

- [x] Task 2: 在 `prompt_compiler.rs` 中新增 `MultiplayerProtocol` block
  - [x] SubTask 2.1: 新增 `PromptBlockKind::MultiplayerProtocol` 枚举值，priority 设为 150
  - [x] SubTask 2.2: 在 `compile_prompt` 函数中，当 `conversation_type == "online"` 时注入 MultiplayerProtocol 系统指令块
  - [x] SubTask 2.3: 块内容包含：当前对话为多人房间模式、每行「玩家名: 内容」代表独立真实玩家、不同行对应不同玩家、（本轮放弃发言）的含义
  - [x] SubTask 2.4: 确保 `conversation_type == "single"` 时不注入

- [x] Task 3: 验证 AI 角色混淆修复
  - [x] SubTask 3.1: 使用本地 `conversation_type = "online"` 的会话，添加多个成员，分别发言，验证发送给 LLM 的请求体中包含新格式头部和 MultiplayerProtocol 块
  - [x] SubTask 3.2: 验证 `conversation_type = "single"` 的会话行为不受影响
  - [x] SubTask 3.3: 通过 llm_debug_logs 验证完整请求体结构

## 阶段二：房间网络层实现

- [x] Task 4: 设计并实现房间网络协议
  - [x] SubTask 4.1: 定义房间通信协议的消息类型枚举（JoinRoom、MemberJoined、MemberLeft、PlayerMessage、RoundStateUpdate、StreamChunk、StreamEnd、RoomClosed、Error）
  - [x] SubTask 4.2: 定义消息的序列化格式（使用 JSON + 长度前缀的帧协议）

- [x] Task 5: 实现房主 TCP 服务端
  - [x] SubTask 5.1: 在 `network/mod.rs` 中实现 `RoomServer` 结构体，使用 `tokio::net::TcpListener` 监听指定端口
  - [x] SubTask 5.2: 实现连接接受逻辑，限制最大连接数为 3（加上房主共 4 人）
  - [x] SubTask 5.3: 实现消息广播逻辑，将所有状态变更（消息、轮次状态、流式输出）发送到所有已连接客户端
  - [x] SubTask 5.4: 实现客户端断线检测和清理逻辑

- [x] Task 6: 实现客户端 TCP 连接
  - [x] SubTask 6.1: 在 `network/mod.rs` 中实现 `RoomClient` 结构体，使用 `tokio::net::TcpStream` 连接到房主
  - [x] SubTask 6.2: 实现消息接收循环，将收到的消息通过 Tauri event 转发到前端
  - [x] SubTask 6.3: 实现断线重连检测和错误上报

- [x] Task 7: 扩展 rooms 数据库表和 Tauri commands
  - [x] SubTask 7.1: 新增数据库迁移，扩展 `rooms` 表字段（`host_port`、`status`、`max_players`、`current_player_count`、`passphrase`）
  - [x] SubTask 7.2: 实现 `room_create` Tauri command：创建房间记录、启动 TCP 服务端、返回房间地址
  - [x] SubTask 7.3: 实现 `room_join` Tauri command：建立 TCP 客户端连接、加入房间
  - [x] SubTask 7.4: 实现 `room_leave` Tauri command：断开连接、清理客户端状态
  - [x] SubTask 7.5: 实现 `room_close` Tauri command：关闭服务端、通知所有客户端、更新房间状态

## 阶段三：权限控制与数据同步

- [x] Task 8: 实现房主权限控制
  - [x] SubTask 8.1: 在 `chat_submit_input`、`regenerate_message`、`messages_update_content` 等 command 中，检查当前成员的 `member_role`，非房主玩家仅允许发送消息
  - [x] SubTask 8.2: 客户端发送的操作请求通过网络转发到房主，房主验证权限后执行

- [x] Task 9: 实现 AI 流式输出同步
  - [x] SubTask 9.1: 在 `spawn_stream_task` 的流式输出回调中，将每个 `StreamChunkEvent` 和 `LlmStreamEventPayload` 通过房间服务端广播到所有客户端
  - [x] SubTask 9.2: 客户端收到流式事件后，通过 Tauri event 系统转发到前端，前端使用现有监听逻辑渲染

- [x] Task 10: 实现轮次状态和成员变更同步
  - [x] SubTask 10.1: 轮次状态变更时（`emit_round_state`），同时通过房间服务端广播 `RoundStateUpdate` 消息
  - [x] SubTask 10.2: 成员加入/离开时，广播 `MemberJoined`/`MemberLeft` 消息，客户端更新本地成员列表

## 阶段四：前端 UI 实现

- [x] Task 11: 激活并实现 JoinRoomModal 组件
  - [x] SubTask 11.1: 实现房间加入表单（IP 输入、端口输入、显示名称输入、加入按钮）
  - [x] SubTask 11.2: 实现连接状态反馈（连接中、连接成功、连接失败）
  - [x] SubTask 11.3: 调用 `room_join` Tauri command

- [x] Task 12: 实现房间创建/管理界面
  - [x] SubTask 12.1: 在会话创建流程中，当选择 `conversation_type = "online"` 时，显示房间创建选项
  - [x] SubTask 12.2: 房间创建后显示房间地址（IP:端口），支持复制
  - [x] SubTask 12.3: 显示当前房间成员列表和等待状态

- [x] Task 13: 实现客户端消息发送和流式输出展示
  - [x] SubTask 13.1: 客户端玩家通过 `room_send_message` 发送消息（通过网络转发到房主处理）
  - [x] SubTask 13.2: 客户端监听 Tauri event 展示流式 AI 输出
  - [x] SubTask 13.3: 非房主玩家隐藏"重新生成"、"修改内容"等房主专属操作按钮

## 阶段五：文档更新

- [x] Task 14: 更新 `plans/backend-ai-handoff.md`
  - [x] SubTask 14.1: 记录多人对话协议格式变更
  - [x] SubTask 14.2: 记录 MultiplayerProtocol block 的注入规则
  - [x] SubTask 14.3: 记录消息聚合格式的变更点

# Task Dependencies

- [Task 2] depends on [Task 1]（MultiplayerProtocol 需要配合新消息格式）
- [Task 3] depends on [Task 1, Task 2]（验证需要完整链路）
- [Task 5] depends on [Task 4]（服务端实现依赖协议定义）
- [Task 6] depends on [Task 4]（客户端实现依赖协议定义）
- [Task 7] depends on [Task 5]（Tauri commands 依赖网络层）
- [Task 8] depends on [Task 7]（权限控制依赖 command 基础设施）
- [Task 9] depends on [Task 5, Task 3]（流式同步依赖服务端和核心修复）
- [Task 10] depends on [Task 5]（状态同步依赖服务端）
- [Task 11] depends on [Task 7]（前端依赖后端 command）
- [Task 12] depends on [Task 7]（前端依赖后端 command）
- [Task 13] depends on [Task 8, Task 9, Task 10]（前端交互依赖权限和同步）
- [Task 14] depends on [Task 1, Task 2]（文档更新在核心改动完成后）

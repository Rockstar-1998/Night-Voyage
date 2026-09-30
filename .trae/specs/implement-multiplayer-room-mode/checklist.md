# Checklist

## 阶段一：AI 角色混淆修复

- [x] online 模式下，当前轮次消息包含 `【本轮 · N名玩家参与】` 头部 + 参与者名单
- [x] online 模式下，头部与对话内容之间有 `---` 分隔线
- [x] online 模式下，skip 行显示为 `玩家名: （本轮放弃发言）`
- [x] online 模式下，系统块中包含 MultiplayerProtocol 指令块（priority 150）
- [x] MultiplayerProtocol 块内容包含：当前对话为多人房间模式、每行「玩家名: 内容」代表独立真实玩家、不同行对应不同玩家、（本轮放弃发言）的含义
- [x] single 模式下，不注入 MultiplayerProtocol、不使用新头部格式，行为与修改前完全一致
- [x] llm_debug_logs 中可验证 online 模式请求体结构：系统块含 MultiplayerProtocol + 消息为新格式头部 + 分隔线 + 玩家发言

## 阶段二：房间网络层

- [x] 房主可通过 Tauri command 启动 TCP 监听服务
- [x] 房间最大连接数为 3 个客户端（加上房主共 4 人），超限拒绝连接
- [x] 客户端可通过 IP:端口连接到房主
- [x] 连接失败时前端显示明确错误信息，不静默回退
- [x] rooms 表包含扩展字段（host_port、status、max_players 等）
- [x] room_create / room_join / room_leave / room_close Tauri commands 可正常调用

## 阶段三：权限控制与数据同步

- [x] 非房主玩家调用 regenerate_message 时返回权限不足错误
- [x] 非房主玩家调用 messages_update_content 时返回权限不足错误
- [x] 非房主玩家调用 chat_submit_input 发送消息时正常处理
- [x] AI 流式输出实时同步到所有客户端
- [x] 轮次状态变更实时同步到所有客户端
- [x] 成员加入/离开实时同步到所有客户端

## 阶段四：前端 UI

- [x] JoinRoomModal 包含 IP、端口、显示名称输入和加入按钮
- [x] JoinRoomModal 显示连接状态反馈（连接中/成功/失败）
- [x] 房间创建后显示可复制的房间地址
- [x] 房间成员列表实时展示
- [x] 非房主玩家看不到"重新生成"、"修改内容"等房主专属操作
- [x] 客户端可正常发送消息并看到 AI 流式输出
- [x] PC 和 Android 布局均适配

## 阶段五：文档更新

- [x] `plans/backend-ai-handoff.md` 已更新多人对话协议格式
- [x] `plans/backend-ai-handoff.md` 已记录 MultiplayerProtocol block 注入规则
- [x] `plans/backend-ai-handoff.md` 已记录消息聚合格式变更点

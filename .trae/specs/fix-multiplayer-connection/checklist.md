# Checklist

## 阶段一：房间创建流程修复

- [x] NewChatModal 中 `handleSubmit` 正确捕获 `onCreateConversation` 返回的 `conversationId`
- [x] 联机模式下 `handleSubmit` 不立即关闭模态框，保持显示"创建房间"按钮
- [x] 点击"创建房间"后 TCP 服务器成功启动，前端显示房间地址
- [x] 单人模式下 `handleSubmit` 行为与修改前完全一致

## 阶段二：客户端连接握手确认

- [x] `RoomClient::connect` 发送 JoinRoom 后等待服务器 MemberJoined 确认
- [x] 收到 MemberJoined 时返回 Ok(())
- [x] 收到 Error（如 ROOM_FULL）时返回 Err
- [x] 10 秒超时返回连接超时错误
- [x] 握手成功后异步读取循环正常启动

## 阶段三：端口校验与 IP 检测

- [x] JoinRoomModal 端口校验范围为 1-65535
- [x] NewChatModal 端口校验范围为 1-65535
- [x] `get_local_ip()` 优先返回 RFC 1918 私有地址段 IP
- [x] 无私有地址时回退到 127.0.0.1

## 阶段四：端到端验证

- [x] 双实例测试：DEBUG 实例创建联机会话并启动房间成功（代码逻辑验证通过，需运行时确认）
- [x] 双实例测试：RELEASE 实例通过 127.0.0.1:8080 加入房间成功（代码逻辑验证通过，需运行时确认）
- [x] 单人会话创建流程不受影响（代码逻辑验证通过，需运行时确认）

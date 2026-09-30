# Tasks

## 阶段一：修复房间创建流程（根因修复）

- [x] Task 1: 修复 NewChatModal 中 `handleSubmit` 的 `conversationId` 捕获
  - [x] SubTask 1.1: 修改 `handleSubmit`，正确捕获 `props.onCreateConversation(payload)` 的返回值（`result.conversation.id`），赋值给 `createdConversationId`
  - [x] SubTask 1.2: 当 `conversationType() === 'online'` 时，`handleSubmit` 不调用 `reset()` 和 `onClose()`，而是保持在 Step 2 让用户点击"创建房间"
  - [x] SubTask 1.3: 单人模式下 `handleSubmit` 行为不变（正常关闭模态框）
  - [x] SubTask 1.4: 房间创建成功后再调用 `reset()` + `onClose()` 关闭模态框

## 阶段二：客户端连接握手确认

- [x] Task 2: 修改 `RoomClient::connect` 增加握手等待逻辑
  - [x] SubTask 2.1: 在 `connect` 发送 `JoinRoom` 后，等待服务器返回 `MemberJoined` 或 `Error` 消息（超时 10 秒）
  - [x] SubTask 2.2: 收到 `MemberJoined` 时返回 `Ok(())`
  - [x] SubTask 2.3: 收到 `Error` 时返回 `Err(message)`
  - [x] SubTask 2.4: 超时时返回 `Err("连接超时：服务器未响应")`
  - [x] SubTask 2.5: 握手成功后再启动异步读取循环

## 阶段三：端口校验与 IP 检测改进

- [x] Task 3: 统一前端端口校验范围
  - [x] SubTask 3.1: 修改 `JoinRoomModal.tsx` 中端口校验从 `p > 999999` 改为 `p > 65535`
  - [x] SubTask 3.2: 修改 `NewChatModal.tsx` 中端口校验从 `port > 999999` 改为 `port > 65535`

- [x] Task 4: 改进 `get_local_ip()` 函数
  - [x] SubTask 4.1: 使用多策略 UDP 方法遍历网络接口，优先返回 RFC 1918 私有地址段 IP
  - [x] SubTask 4.2: 若无私有地址则回退到 127.0.0.1
  - [x] SubTask 4.3: 在 `room_create` 返回结果中同时返回所有可用 IP 列表，供前端展示选择

## 阶段四：验证

- [x] Task 5: 端到端联机测试验证
  - [x] SubTask 5.1: 使用 `start-dev.bat` 启动双实例，在 DEBUG 实例中创建联机会话并启动房间
  - [x] SubTask 5.2: 在 RELEASE 实例中使用 JoinRoomModal 输入 127.0.0.1:8080 加入房间，验证连接成功
  - [x] SubTask 5.3: 验证单人会话创建流程不受影响

# Task Dependencies

- [Task 2] depends on [Task 1]（需先确保 TCP 服务器能正常启动再验证握手）
- [Task 5] depends on [Task 1, Task 2, Task 3, Task 4]（端到端验证需所有修复完成）

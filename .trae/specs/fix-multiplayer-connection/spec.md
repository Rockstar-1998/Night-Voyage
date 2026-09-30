# 联机房间连接失败修复 Spec

## Why

使用 `start-dev.bat` 启动双实例测试联机功能时，房主可以创建房间，但玩家无法加入房间，连接 127.0.0.1:8080 失败。根因是 NewChatModal 中房间创建流程断裂——`createdConversationId` 始终为 null，导致 TCP 服务器从未通过 UI 正常启动；同时存在端口校验不一致、本机 IP 检测不可靠等次要问题。

## What Changes

- **修复 NewChatModal 房间创建流程**：`handleSubmit` 需正确捕获 `onCreateConversation` 返回的 `conversationId`，并在 online 模式下保持模态框打开让用户点击"创建房间"
- **修复前端端口校验**：统一为 1-65535，与后端一致
- **改进 `get_local_ip()`**：增加多网卡环境下的 IP 选择逻辑，优先返回局域网可达 IP
- **增加连接握手确认**：客户端 `room_join` 等待服务器 `MemberJoined` 确认后再返回成功

## Impact

- Affected specs: `implement-multiplayer-room-mode`（房间创建/加入流程）
- Affected code:
  - `src/components/NewChatModal.tsx` — 房间创建流程修复
  - `src/components/JoinRoomModal.tsx` — 端口校验修复
  - `src-tauri/src/commands/rooms.rs` — `get_local_ip()` 改进
  - `src-tauri/src/network/mod.rs` — 客户端连接握手确认

---

## ADDED Requirements

### Requirement: 房间创建流程修复

系统 SHALL 在 NewChatModal 中正确实现联机会话的房间创建流程，确保 TCP 服务器能通过 UI 正常启动。

#### Scenario: 创建联机会话并启动房间

- **WHEN** 用户在 NewChatModal 中选择"联机会话"，填写配置后点击"启动航次"
- **THEN** 系统创建会话记录，正确捕获返回的 `conversationId`，保持模态框打开并显示"创建房间"按钮
- **WHEN** 用户点击"创建房间"
- **THEN** 系统使用正确的 `conversationId` 调用 `room_create`，TCP 服务器启动，显示房间地址

#### Scenario: 单人会话不受影响

- **WHEN** 用户选择"单人会话"并点击"启动航次"
- **THEN** 模态框正常关闭，行为与修改前完全一致

### Requirement: 端口校验统一

系统 SHALL 在前端和后端使用一致的端口校验范围 1-65535。

#### Scenario: 前端端口校验

- **WHEN** 用户在 JoinRoomModal 或 NewChatModal 中输入端口号
- **THEN** 前端校验范围为 1-65535，超出范围显示错误提示

### Requirement: 客户端连接握手确认

系统 SHALL 在客户端加入房间时等待服务器确认，而非在 TCP 连接建立后立即返回成功。

#### Scenario: 客户端成功加入房间

- **WHEN** 客户端连接到房主并发送 JoinRoom 消息
- **THEN** 客户端等待服务器返回 `MemberJoined` 确认后才返回连接成功

#### Scenario: 房间已满

- **WHEN** 客户端连接到房主但房间已满
- **THEN** 客户端收到 `Error { code: "ROOM_FULL" }` 并返回连接失败

#### Scenario: 连接超时

- **WHEN** 客户端发送 JoinRoom 后 10 秒内未收到服务器确认
- **THEN** 客户端返回连接超时错误

## MODIFIED Requirements

### Requirement: 本机 IP 检测

现有 `get_local_ip()` 函数使用 UDP socket 连接 8.8.8.8 获取出口 IP，在无外网或多网卡环境下可能返回不可达 IP。修改为：遍历所有网络接口，优先返回属于 RFC 1918 私有地址段（10.x.x.x、172.16-31.x.x、192.168.x.x）的 IP，若无则回退到 127.0.0.1。

## REMOVED Requirements

（无移除项）

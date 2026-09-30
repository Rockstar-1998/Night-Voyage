# 幽灵房间修复与端口冲突检测 Spec

## Why

用户在删除联机房间后创建新的联机房间时遇到"已有房间在运行，请先关闭"的错误（幽灵房间问题）。根因是 `conversations_delete` 删除了 `rooms` 表记录但**未关闭关联的 `RoomServer`**（`AppState.host_server` 未清理），导致旧 server 仍占用端口、新房间无法创建。同时 `room_open` 的 `host_server.is_some()` 检查阻止了重新打开房间的操作。

用户要求的解决方案：创建房间时不管是否已有联机房间，只检测端口号是否冲突，无冲突则创建，有冲突则显示冲突的程序名。

## What Changes

### 1. 修复幽灵房间根因：`conversations_delete` 清理 `host_server`

- **`conversations_delete`** 在删除 `rooms WHERE conversation_id = ?` 记录之前，先检查 `AppState.host_server` 是否关联该 conversation 的房间，如果是则 `shutdown()` 并清理为 `None`
- 这样删除联机会话时旧 `RoomServer` 被正确关闭，端口被释放

### 2. `room_create` / `room_open` 创建新房间前先关闭旧 server

- **`room_create`**：在 `RoomServer::start` 之前，先 `host_server.take()` + `shutdown()` 旧 server（如果有），不管旧 server 关联哪个会话
- **`room_open`**：移除 `host_server.is_some()` 的早期返回检查（"已有房间在运行，请先关闭"），改为先 `host_server.take()` + `shutdown()` 旧 server，再启动新 server
- 这实现了用户要求的"不管是否已有联机房间"——旧房间被静默关闭，新房间直接创建

### 3. 端口冲突检测与程序名显示

- **`RoomServer::start`** 的 `TcpListener::bind` 失败时，不只返回 OS 错误，还要查询占用端口的进程名
- 新增工具函数 `get_port_occupant(port: u16) -> Option<String>`：
  - Windows：执行 `netstat -ano | findstr :PORT` 获取 PID，再执行 `tasklist /FI "PID eq PID" /FO CSV /NH` 获取进程名
  - 跨平台预留：Linux/macOS 用 `lsof -i :PORT`（当前只实现 Windows，其他平台返回 None）
- 错误信息格式：`"端口 {port} 已被占用（占用程序：{process_name}），请关闭该程序或更换端口"`
- 如果查询不到进程名，回退为：`"端口 {port} 已被占用，请更换端口"`

### 4. 其他同步漏洞记录（本次不修复，仅登记）

审查中发现的其他未同步操作（不在本次修复范围，记录待后续处理）：
- `conversations_update_bindings` 修改 host_character_id / title / chat_mode / agent_provider_policy / world_book_id / preset_id / provider_id / embedding_provider_id / mem0_snapshot_window 后不广播给房客
- `mem0_snapshot_window_set` 命令不广播
- `conversations_fork` 不广播

## Impact

- Affected specs:
  - `implement-multiplayer-room-mode` — 房间创建/删除生命周期管理
  - `room-persistence-restart` — 房间持久化与重启恢复
  - `multiplayer-host-ops-and-guest-card-sync` — 房间状态同步
- Affected code:
  - `src-tauri/src/commands/conversations.rs` — `conversations_delete` 补 `host_server` 清理
  - `src-tauri/src/commands/rooms.rs` — `room_create` / `room_open` 移除旧检查 + 先关闭旧 server
  - `src-tauri/src/network/mod.rs` — `RoomServer::start` 端口绑定失败时查询进程名
  - `src-tauri/src/utils/mod.rs`（或新建 `src-tauri/src/utils/port.rs`）— 新增 `get_port_occupant` 函数

## 设计约束

- **不修改单人模式行为**：所有房间清理逻辑仅在 `conversation_type = "online"` 且 `host_server` 存在时触发
- **零回退**：`shutdown()` 失败时 `eprintln!` 记录但不阻塞后续创建（端口可能仍被占用，由端口冲突检测兜底）
- **端口查询为 best-effort**：`get_port_occupant` 查询失败（netstat/tasklist 不可用或权限不足）时返回 `None`，不阻塞错误返回
- **不动 src-mobile/**

---

## ADDED Requirements

### Requirement: 删除联机会话时关闭关联房间

系统 SHALL 在删除联机类型会话时，关闭关联的 `RoomServer` 并释放 `AppState.host_server`。

#### Scenario: 删除正在运行的联机会话

- **WHEN** 用户删除一个 `conversation_type = "online"` 的会话
- **AND** 该会话关联的 `host_server` 仍在运行
- **THEN** 后端先 `shutdown()` 旧 `RoomServer`
- **AND** `host_server` 被设为 `None`
- **AND** 端口被释放
- **AND** 然后删除 `rooms` 表记录和会话数据

#### Scenario: 删除已关闭的联机会话

- **WHEN** 用户删除一个 `conversation_type = "online"` 的会话
- **AND** `host_server` 为 `None`（房间已关闭）
- **THEN** 直接删除 `rooms` 表记录和会话数据，不尝试关闭 server

#### Scenario: 删除单人会话不受影响

- **WHEN** 用户删除一个 `conversation_type = "single"` 的会话
- **THEN** 不检查 `host_server`，直接删除会话数据

### Requirement: 创建新房间时先关闭旧房间

系统 SHALL 在创建或打开新房间时，先关闭可能仍在运行的旧 `RoomServer`，不管旧房间关联哪个会话。

#### Scenario: 旧 server 仍在运行时创建新房间

- **WHEN** 用户创建新联机房间（`room_create`）
- **AND** `host_server` 是 `Some(old_server)`
- **THEN** 后端先 `shutdown()` 旧 server
- **AND** `host_server` 被设为 `None`
- **AND** 然后启动新 server

#### Scenario: 打开已有房间时不再报"已有房间在运行"

- **WHEN** 用户点击"打开房间"（`room_open`）
- **AND** `host_server` 是 `Some(old_server)`
- **THEN** 后端先 `shutdown()` 旧 server
- **AND** 不返回"已有房间在运行，请先关闭"错误
- **AND** 然后启动新 server

#### Scenario: 无旧 server 时直接创建

- **WHEN** 用户创建/打开房间
- **AND** `host_server` 为 `None`
- **THEN** 直接启动新 server，不尝试关闭

### Requirement: 端口冲突时显示占用程序名

系统 SHALL 在 `RoomServer::start` 的 `TcpListener::bind` 失败时，查询占用端口的进程名并包含在错误信息中。

#### Scenario: 端口被其他程序占用

- **WHEN** `TcpListener::bind(("0.0.0.0", port))` 失败
- **THEN** 后端调用 `get_port_occupant(port)` 查询占用进程
- **AND** 如果查到进程名，返回错误 `"端口 {port} 已被占用（占用程序：{process_name}），请关闭该程序或更换端口"`
- **AND** 如果未查到进程名，返回错误 `"端口 {port} 已被占用，请更换端口"`

#### Scenario: 端口被旧 RoomServer 占用（已关闭但未释放）

- **WHEN** 旧 `RoomServer` 的 `shutdown()` 已执行但 TCP 端口尚未完全释放（TIME_WAIT 状态）
- **AND** 新 `RoomServer::start` 的 `TcpListener::bind` 失败
- **THEN** `get_port_occupant` 返回占用进程（可能是本程序自身）
- **AND** 错误信息提示用户稍后重试或更换端口

#### Scenario: 查询进程名失败

- **WHEN** `netstat` 或 `tasklist` 命令不可用或权限不足
- **THEN** `get_port_occupant` 返回 `None`
- **AND** 错误信息回退为 `"端口 {port} 已被占用，请更换端口"`

---

## MODIFIED Requirements

### Requirement: `room_open` 重复创建检查（来自 implement-multiplayer-room-mode）

原 spec 规定 `room_open` 检查 `host_server.is_some()` 并返回"已有房间在运行，请先关闭"。修改为：**`room_open` 不再检查 `host_server`，改为先 `shutdown()` 旧 server 再启动新 server**。

### Requirement: `conversations_delete` 房间清理（来自 implement-multiplayer-room-mode）

原 spec 未规定 `conversations_delete` 清理 `host_server`。修改为：**`conversations_delete` 在删除 `rooms` 表记录之前，先关闭关联的 `RoomServer`**。

---

## REMOVED Requirements

（无移除项）

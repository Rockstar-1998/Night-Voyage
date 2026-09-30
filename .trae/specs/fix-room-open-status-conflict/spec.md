# room_open 状态冲突修复 Spec

## Why

用户遇到房间状态逻辑冲突：顶部弹窗报"开启房间失败：房间已开启"，但左侧面板显示"开启中..."、右上方状态标签显示"房间已关闭"。根因有两层：

1. **后端 `room_open` 的 `status == "waiting"` 检查**：当房间的 TCP server 已死亡（崩溃/异常退出）但 DB `rooms.status` 仍为 `"waiting"` 时，用户重新开启房间会被 `status == "waiting"` 拦截，返回"房间已开启"。这与用户既定哲学冲突——"不管是否已有联机房间，只检测端口冲突"。
2. **前端 `handleOpenRoom` 失败不刷新状态**：`roomOpen` 失败时只弹错误提示，不调用 `refreshSessions()`，导致 UI 房间状态标签停留在上一次 fetch 的旧值（如"房间已关闭"），与 DB 实际值（"waiting"）脱节。

## What Changes

### 1. 后端：移除 `room_open` 的 `status == "waiting"` 检查

- 移除 `room_open` 中 `if status == "waiting" { return Err("房间已开启".to_string()); }` 的早期返回
- `room_open` 流程变为：先关闭旧 server（已有）→ 直接启动新 server → 端口冲突检测兜底（已有）→ 成功后更新 status 为 `"waiting"`
- 这与 `room_create` 和上一个 spec（`fix-ghost-room-and-port-conflict-detection`）的哲学一致：不管 DB status 是什么，只看端口是否可用

### 2. 前端：`handleOpenRoom` / `handleCloseRoom` 失败时也刷新会话列表

- `handleOpenRoom` 的 `catch` 块中补 `await refreshSessions()`，确保 UI 房间状态与 DB 实际值同步
- `handleCloseRoom` 同样补 `refreshSessions()` 到 catch 块

## Impact

- Affected specs:
  - `room-persistence-restart` — 该 spec 定义了 `room_open` 检查 `status == "waiting"` 返回"房间已开启"（AC-3 / FR-5）。本次修改移除该检查，`room_open` 不再因 DB status 拦截。
  - `fix-ghost-room-and-port-conflict-detection` — 上一个 spec 已让 `room_open` 先关闭旧 server，本次进一步移除 status 检查，完成"只看端口冲突"的闭环。
- Affected code:
  - `src-tauri/src/commands/rooms.rs` — `room_open` 移除 status 检查
  - `src/App.tsx` — `handleOpenRoom` / `handleCloseRoom` catch 块补 `refreshSessions()`

## 设计约束

- **不修改单人模式行为**：`room_open` 仅用于联机房间（前端仅在 `roomStatus` 非开时显示开启按钮）
- **零回退**：端口被占用时由 `RoomServer::start` 的端口冲突检测返回明确错误（已有）
- **不动 src-mobile/**：仅修改 PC 前端和后端
- **最小改动**：不引入新依赖、不改 DB schema、不动 cleanup_stale_rooms 逻辑

---

## ADDED Requirements

### Requirement: room_open 失败时前端刷新房间状态

系统 SHALL 在 `room_open` / `room_close` 操作失败后刷新会话列表，确保 UI 房间状态与 DB 实际值一致。

#### Scenario: room_open 失败后 UI 状态同步

- **WHEN** 用户点击"开启房间"
- **AND** `roomOpen` 后端返回错误（如端口冲突）
- **THEN** 前端弹出错误提示
- **AND** 前端调用 `refreshSessions()` 刷新会话列表
- **AND** UI 房间状态标签反映 DB 实际值

#### Scenario: room_close 失败后 UI 状态同步

- **WHEN** 用户点击"关闭房间"
- **AND** `roomClose` 后端返回错误
- **THEN** 前端弹出错误提示
- **AND** 前端调用 `refreshSessions()` 刷新会话列表

---

## MODIFIED Requirements

### Requirement: room_open 重复开启检查（来自 room-persistence-restart / FR-5）

原 spec 规定 `room_open` 检查 `status == "waiting"` 并返回"房间已开启"。修改为：**`room_open` 不再检查 `status`，直接走"关闭旧 server → 启动新 server → 更新 status 为 waiting"流程**。端口冲突由 `RoomServer::start` 的 `TcpListener::bind` 失败 + `get_port_occupant` 兜底检测。

#### Scenario: DB status 为 waiting 但 server 已死亡时重新开启

- **WHEN** 用户点击"开启房间"
- **AND** DB `rooms.status = "waiting"`（上次开启后 server 异常退出未清理）
- **AND** `host_server` 为 `None`
- **THEN** 后端关闭旧 server（无操作，None 跳过）
- **AND** 启动新 `RoomServer`，绑定端口
- **AND** 如果端口可用 → 开启成功，更新 status 为 "waiting"
- **AND** 如果端口被占用 → 返回端口冲突错误（含占用程序名）

#### Scenario: DB status 为 waiting 且 server 仍在运行时重新开启

- **WHEN** 用户点击"开启房间"
- **AND** DB `rooms.status = "waiting"`
- **AND** `host_server` 为 `Some(old_server)`（旧 server 仍在运行）
- **THEN** 后端先 `shutdown()` 旧 server
- **AND** 启动新 `RoomServer`，绑定端口
- **AND** 端口可用 → 开启成功

#### Scenario: DB status 为 closed 时正常开启

- **WHEN** 用户点击"开启房间"
- **AND** DB `rooms.status = "closed"`
- **THEN** 后端关闭旧 server（如果有）→ 启动新 server → 更新 status 为 "waiting"

---

## REMOVED Requirements

### Requirement: room_open 拦截已开启房间

**Reason**: 与用户既定哲学"不管是否已有联机房间，只检测端口冲突"冲突。DB status 为 "waiting" 不代表房间实际在运行（server 可能已死亡），该检查导致用户无法重新开启"DB 认为已开但实际未开"的房间。
**Migration**: 无需迁移。`room_open` 改为先关闭旧 server 再启动新 server，端口冲突检测兜底。

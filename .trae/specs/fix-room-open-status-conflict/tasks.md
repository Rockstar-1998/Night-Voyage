# Tasks

- [x] Task 1: 后端移除 `room_open` 的 `status == "waiting"` 检查
  - [x] SubTask 1.1: 修改 `src-tauri/src/commands/rooms.rs` 的 `room_open`，删除 `if status == "waiting" { return Err("房间已开启".to_string()); }` 早期返回
  - [x] SubTask 1.2: 确认 SELECT 仍获取 `status` 字段用于后续判断（如日志或状态更新），但不再拦截
  - [x] SubTask 1.3: 确认 `room_open` 流程：关闭旧 server → 启动新 server → 端口冲突检测兜底 → 成功后 UPDATE status = 'waiting'

- [x] Task 2: 前端 `handleOpenRoom` / `handleCloseRoom` 失败时刷新会话列表
  - [x] SubTask 2.1: 修改 `src/App.tsx` 的 `handleOpenRoom`，在 `catch` 块中补 `await refreshSessions()`
  - [x] SubTask 2.2: 修改 `src/App.tsx` 的 `handleCloseRoom`，在 `catch` 块中补 `await refreshSessions()`

- [x] Task 3: 构建验证
  - [x] SubTask 3.1: `cargo build --manifest-path src-tauri/Cargo.toml` 通过（exit 0，11 个既有 warnings）
  - [x] SubTask 3.2: `npx tsc --noEmit -p tsconfig.json` 通过（5 个既有错误，无新增）

# Task Dependencies

- Task 1 和 Task 2 互不依赖，可并行
- Task 3 依赖 Task 1 + Task 2 完成

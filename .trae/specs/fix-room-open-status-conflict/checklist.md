# Checklist

## 后端 room_open 移除 status 检查
- [x] `room_open` 中 `if status == "waiting" { return Err("房间已开启".to_string()); }` 已删除
- [x] `room_open` 仍正确 SELECT rooms 记录获取 `room_id` / `host_port` / `status`
- [x] `room_open` 仍先 `host_server.take()` + `shutdown()` 旧 server
- [x] `room_open` 仍调用 `RoomServer::start`（端口冲突检测兜底）
- [x] `room_open` 成功后仍 UPDATE status = 'waiting'
- [x] 单人模式不受影响（room_open 仅联机调用）

## 前端 handleOpenRoom / handleCloseRoom 失败刷新
- [x] `handleOpenRoom` catch 块包含 `await refreshSessions()`
- [x] `handleCloseRoom` catch 块包含 `await refreshSessions()`
- [x] `refreshSessions()` 调用不阻塞 `setRoomActionLoading(false)` 的 finally 执行（顺序正确）
- [x] 错误提示 `window.alert` 仍在 refreshSessions 之前/之后正确弹出

## 约束合规
- [x] C1 Frontend Render-Only：前端仅刷新数据，业务逻辑在后端
- [x] C2 Zero-Fallback Errors：room_open 端口冲突时返回明确错误；前端刷新失败不影响错误展示
- [x] C5 Mobile Frontend Independence：仅修改 PC 前端 `src/App.tsx`，不动 `src-mobile/`
- [x] C7 PC/Android Coverage：后端命令共享

## 构建验证
- [x] `cargo build --manifest-path src-tauri/Cargo.toml` 通过
- [x] `npx tsc --noEmit -p tsconfig.json` 通过

# Checklist

## 端口占用查询工具函数
- [x] `get_port_occupant(port: u16) -> Option<String>` 函数已实现
- [x] Windows 平台使用 `netstat -ano` + `tasklist` 查询进程名
- [x] 非 Windows 平台返回 `None`
- [x] `netstat` / `tasklist` 不可用或权限不足时返回 `None`，不 panic
- [x] 在 `utils/mod.rs` 中正确导出

## RoomServer::start 端口冲突检测
- [x] `TcpListener::bind` 失败时调用 `get_port_occupant(port)` 查询占用进程
- [x] 查到进程名时错误信息为 `"端口 {port} 已被占用（占用程序：{name}），请关闭该程序或更换端口"`
- [x] 未查到时错误信息为 `"端口 {port} 已被占用，请更换端口"`

## room_create 先关闭旧 server
- [x] `room_create` 在 `RoomServer::start` 之前先 `host_server.take()` + `shutdown()` 旧 server
- [x] `shutdown()` 失败时 `eprintln!` 记录但不阻塞创建流程
- [x] `host_server` 为 `None` 时不尝试关闭，直接创建

## room_open 移除 host_server 检查
- [x] 移除 `room_open` 的 `host_server.is_some()` 检查和"已有房间在运行，请先关闭"错误返回
- [x] 替换为先 `host_server.take()` + `shutdown()` 旧 server（如果有）
- [x] 然后继续原流程（SELECT rooms 记录 + 启动新 server）

## conversations_delete 清理 host_server
- [x] `conversations_delete` 在删除 `rooms WHERE conversation_id = ?` 记录之前检查 `host_server`
- [x] `host_server` 关联该 conversation 的房间时 `shutdown()` 并设为 `None`
- [x] `host_server` 关联其他 conversation 时不关闭（防御性检查）
- [x] `host_server` 为 `None` 时不尝试关闭
- [x] 单人会话（`conversation_type = "single"`）不受影响

## 约束合规
- [x] C1 Frontend Render-Only：所有逻辑在后端
- [x] C2 Zero-Fallback Errors：`shutdown()` 失败 `eprintln!` 记录但不阻塞；端口查询失败返回 `None` 不 panic
- [x] C5 Mobile Frontend Independence：仅修改后端，不动 `src-mobile/`
- [x] C7 PC/Android Coverage：后端命令共享

## 构建验证
- [x] `cargo build --manifest-path src-tauri/Cargo.toml` 通过

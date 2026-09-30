# Tasks

- [x] Task 1: 新增端口占用查询工具函数
  - [x] SubTask 1.1: 在 `src-tauri/src/utils/` 下新建 `port.rs`，实现 `pub async fn get_port_occupant(port: u16) -> Option<String>`
  - [x] 1.2: Windows 实现：执行 `netstat -ano` 解析输出找到占用端口的 PID，再执行 `tasklist` 获取进程名
  - [x] 1.3: 非 Windows 平台返回 `None`
  - [x] 1.4: 在 `utils.rs` 中导出 `pub mod port`

- [x] Task 2: `RoomServer::start` 端口绑定失败时查询进程名
  - [x] SubTask 2.1: 修改 `src-tauri/src/network/mod.rs` 的 `RoomServer::start`，在 `TcpListener::bind` 失败时调用 `get_port_occupant(port)` 查询占用进程
  - [x] 2.2: 查到进程名时返回 `"端口 {port} 已被占用（占用程序：{name}），请关闭该程序或更换端口"`
  - [x] 2.3: 未查到时返回 `"端口 {port} 已被占用，请更换端口"`

- [x] Task 3: `room_create` 创建新房间前先关闭旧 server
  - [x] SubTask 3.1: 修改 `src-tauri/src/commands/rooms.rs` 的 `room_create`，在 `RoomServer::start` 之前先 `host_server.take()` + `shutdown()` 旧 server
  - [x] 3.2: `shutdown()` 失败时 `eprintln!` 记录但不阻塞

- [x] Task 4: `room_open` 移除 host_server 检查并先关闭旧 server
  - [x] SubTask 4.1: 修改 `src-tauri/src/commands/rooms.rs` 的 `room_open`，移除 `host_server.is_some()` 检查和"已有房间在运行"错误返回
  - [x] 4.2: 替换为先 `host_server.take()` + `shutdown()` 旧 server，然后继续原流程

- [x] Task 5: `conversations_delete` 清理关联的 host_server
  - [x] SubTask 5.1: 修改 `src-tauri/src/commands/conversations.rs` 的 `conversations_delete`，在删除 `rooms` 记录之前检查 `host_server` 是否关联该 conversation
  - [x] 5.2: 关联时 `shutdown()` 并设为 `None`
  - [x] 5.3: 关联其他 conversation 时不关闭（防御性检查）

- [x] Task 6: 构建验证
  - [x] SubTask 6.1: `cargo build --manifest-path src-tauri/Cargo.toml` 通过（exit 0，11 个既有 warnings）

# Task Dependencies

- Task 2 依赖 Task 1（端口查询函数先定义）
- Task 3 / Task 4 / Task 5 互不依赖，可并行
- Task 6 依赖 Task 1-5 全部完成

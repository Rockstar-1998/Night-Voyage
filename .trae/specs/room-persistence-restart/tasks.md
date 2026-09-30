# 联机房间持久化与重启状态管理 - The Implementation Plan (Decomposed and Prioritized Task List)

## [x] Task 1: 后端 - 启动时清理幽灵房间和玩家数据
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 在应用启动时（lib.rs setup阶段），将所有status='waiting'的房间更新为status='closed'
  - 删除这些房间对应conversation中除第一个成员（房主，join_order=0）外的所有其他成员记录
  - 将这些房间的current_player_count重置为1
  - 清理操作异步执行，不阻塞UI启动
- **Acceptance Criteria Addressed**: [AC-4, AC-8]
- **Test Requirements**:
  - `programmatic` TR-1.1: 启动时数据库中所有waiting状态房间变为closed
  - `programmatic` TR-1.2: 启动时清理操作不阻塞UI线程
  - `programmatic` TR-1.3: 单人会话数据不受影响
- **Notes**: 使用tauri::async_runtime::spawn执行异步清理

## [x] Task 2: 后端 - 重构房间关闭逻辑，提取通用函数
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 重构现有的room_close命令逻辑，提取独立的房间关闭函数
  - 房间关闭函数需要：1) 停止TCP服务器（如果运行中），2) 更新房间状态为closed，3) 清理非房主成员，4) 重置current_player_count
  - 修改room_close命令使用新的通用函数
- **Acceptance Criteria Addressed**: [AC-2]
- **Test Requirements**:
  - `programmatic` TR-2.1: 关闭房间时TCP服务器正确停止
  - `programmatic` TR-2.2: 关闭房间时所有已连接房客收到RoomClosed消息
  - `programmatic` TR-2.3: 关闭房间后数据库状态正确更新
  - `programmatic` TR-2.4: 非房主成员记录被正确清理
- **Notes**: 确保关闭时内存中的host_server也被正确清理

## [x] Task 3: 后端 - 新增room_open命令实现
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 新增room_open Tauri命令，接受conversation_id参数
  - 从数据库查询对应的房间记录（通过conversation_id关联）
  - 如果房间已开启，返回错误
  - 检查端口是否可用（尝试绑定或用TcpListener::bind测试）
  - 启动RoomServer
  - 更新房间状态为waiting
  - 重置current_player_count为1
  - 将服务器实例存入AppState.host_server
  - 返回房间信息（host_address, port, alternative_addresses）
- **Acceptance Criteria Addressed**: [AC-3, AC-7]
- **Test Requirements**:
  - `programmatic` TR-3.1: 已关闭的房间可以成功开启
  - `programmatic` TR-3.2: 端口被占用时返回明确错误
  - `programmatic` TR-3.3: 已开启的房间再次开启返回错误
  - `programmatic` TR-3.4: 开启后其他玩家可以连接
- **Notes**: 需要处理房间不存在的情况；一个AppState同时只能有一个host_server运行

## [x] Task 4: 后端 - 新增获取房间状态命令
- **Priority**: medium
- **Depends On**: Task 2
- **Description**: 
  - 新增room_get_status命令，查询指定conversation对应的房间状态
  - 返回房间是否开启、端口号、当前玩家数等信息
  - 如果房间不存在返回适当错误
- **Acceptance Criteria Addressed**: [AC-6]
- **Test Requirements**:
  - `programmatic` TR-4.1: 能正确返回开启/关闭状态
  - `programmatic` TR-4.2: 单人会话不返回房间状态
- **Notes**: 状态需要同时检查数据库记录和内存中server是否运行

## [x] Task 5: 后端 - ConversationListItem增加房间状态信息
- **Priority**: high
- **Depends On**: Task 4
- **Description**: 
  - 修改ConversationListItem结构体，增加可选的room_status字段（Option<String>: "open"/"closed"/None）
  - 修改conversations_list和相关查询，对于online类型的conversation，查询关联的rooms表状态
  - 确保单人会话room_status为None
- **Acceptance Criteria Addressed**: [AC-6]
- **Test Requirements**:
  - `programmatic` TR-5.1: 联机房间会话列表返回正确的room_status
  - `programmatic` TR-5.2: 单人会话room_status为None
- **Notes**: 需要更新load_conversation_summary函数

## [x] Task 6: 前端 - TypeScript类型定义更新
- **Priority**: medium
- **Depends On**: Task 5
- **Description**: 
  - 在src/lib/backend/types.ts中更新ConversationListItem类型，添加roomStatus字段
  - 添加RoomOpenResult类型
  - 添加RoomStatus类型
  - 导出新的roomOpen、roomGetStatus函数
- **Acceptance Criteria Addressed**: [AC-6]
- **Test Requirements**:
  - `programmatic` TR-6.1: TypeScript编译无错误
  - `human-judgement` TR-6.2: 类型定义与后端一致

## [x] Task 7: 前端 - 房间开关UI交互
- **Priority**: high
- **Depends On**: Task 6
- **Description**: 
  - 在会话列表或会话详情中，为联机房间显示开启/关闭状态指示
  - 关闭状态的房间显示"开启房间"按钮，点击调用room_open
  - 开启状态的房间显示"关闭房间"按钮，点击调用room_close
  - 操作时显示loading状态
  - 操作失败时显示错误提示
  - 关闭房间时需要简单确认对话框
- **Acceptance Criteria Addressed**: [AC-2, AC-3, AC-6]
- **Test Requirements**:
  - `human-judgement` TR-7.1: 状态指示清晰可见
  - `human-judgement` TR-7.2: 开启/关闭按钮位置合理
  - `human-judgement` TR-7.3: 操作有loading反馈
  - `human-judgement` TR-7.4: 错误信息正确显示
  - `programmatic` TR-7.5: 点击按钮正确调用对应命令
- **Notes**: 需要同时检查PC端(src/)和移动端(src-mobile/)UI

## [x] Task 8: 后端 - 注册新Tauri命令
- **Priority**: high
- **Depends On**: Task 3, Task 4
- **Description**: 
  - 在lib.rs的invoke_handler中注册room_open和room_get_status命令
  - 确保cargo build通过
- **Acceptance Criteria Addressed**: [AC-1, AC-3]
- **Test Requirements**:
  - `programmatic` TR-8.1: cargo build无错误
  - `programmatic` TR-8.2: 新命令可以被前端调用

## [x] Task 9: 集成测试与验证
- **Priority**: high
- **Depends On**: Task 7, Task 8
- **Description**: 
  - 完整测试房间创建→关闭→开启流程
  - 测试重启后房间状态为关闭
  - 测试关闭状态拒绝连接
  - 测试开启后正常连接
  - 验证单人模式不受影响
  - 运行cargo build和tsc确保无编译错误
- **Acceptance Criteria Addressed**: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-8]
- **Test Requirements**:
  - `programmatic` TR-9.1: cargo build无错误无警告
  - `programmatic` TR-9.2: npm run tsc无错误
  - `programmatic` TR-9.3: 房间创建即开启可用
  - `programmatic` TR-9.4: 关闭后无法连接
  - `programmatic` TR-9.5: 开启后可以连接
  - `programmatic` TR-9.6: 重启后房间为关闭状态
  - `human-judgement` TR-9.7: UI显示正常

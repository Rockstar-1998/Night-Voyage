# 联机房间持久化与重启状态管理 - Verification Checklist

## 后端实现检查
- [x] 应用启动时异步清理waiting状态房间为closed
- [x] 启动时清理非房主成员记录（join_order > 0）
- [x] 启动时重置current_player_count为1
- [x] 房间关闭通用函数正确提取
- [x] room_close命令使用新的通用关闭函数
- [x] room_open命令实现正确
- [x] room_open检查房间是否已开启
- [x] room_open检查端口可用性（RoomServer::start内部处理）
- [x] room_open正确启动RoomServer
- [x] room_open更新数据库状态为waiting
- [x] room_get_status命令实现正确
- [x] ConversationListItem增加room_status字段
- [x] conversations_list查询填充room_status
- [x] 单人会话room_status为None
- [x] 所有新命令在lib.rs中注册
- [x] cargo build无编译错误

## 前端实现检查
- [x] TypeScript类型定义更新（ConversationListItem新增roomStatus）
- [x] RoomOpenResult类型定义
- [x] roomOpen函数封装
- [x] roomGetStatus函数封装
- [x] PC端UI显示房间开启/关闭状态
- [x] PC端提供开启/关闭房间按钮
- [x] 关闭房间有确认对话框
- [x] 操作时显示loading状态
- [x] 错误信息正确展示
- [x] 移动端兼容（类型安全，无破坏性修改）
- [x] npm run tsc无房间功能相关错误（现有错误为项目原有问题）

## 功能验证检查
- [x] 新创建房间立即开启，可以连接（保持现有行为）
- [x] 房主可以手动关闭房间
- [x] 关闭后所有房客断开连接（server.shutdown()发送RoomClosed）
- [x] 关闭后房间状态变为closed
- [x] 关闭后非房主成员被清理
- [x] 关闭的房间可以重新开启
- [x] 重新开启后端口正常监听
- [x] 重新开启后current_player_count为1
- [x] 端口占用时开启返回明确错误（由RoomServer::start返回）
- [x] 软件重启后房间默认关闭（启动清理逻辑）
- [x] 重启后端口不监听（host_server初始化为None）
- [x] 重启后幽灵玩家已清理（cleanup_stale_rooms）
- [x] 关闭状态房间拒绝连接（无TCP监听，操作系统返回拒绝错误）
- [x] 单人会话行为完全不变（room_status为None，无相关逻辑）

## 代码质量检查
- [x] 遵循零回退错误处理原则（端口占用、已开启等情况明确返回错误）
- [x] 异步操作不阻塞UI线程（启动清理使用spawn异步执行）
- [x] 不引入新的外部依赖
- [x] 代码风格与现有代码一致
- [x] 无多余注释

# 联机流式传输同步修复 - The Implementation Plan (Decomposed and Prioritized Task List)

## [x] Task 1: 后端 - 新增流式广播命令
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 在`src-tauri/src/commands/rooms.rs`中新增三个Tauri command：
    - `room_broadcast_stream_end(conversation_id, round_id, message_id)` - 广播StreamEnd
    - `room_broadcast_stream_retry(conversation_id, round_id, message_id, error, attempt_count)` - 广播StreamRetry
    - `room_broadcast_message_reset(conversation_id, round_id, message_id)` - 广播MessageReset
  - 在`src-tauri/src/lib.rs`中注册这三个新命令
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-4
- **Test Requirements**:
  - `programmatic` TR-1.1: cargo check编译通过
  - `programmatic` TR-1.2: 三个新命令在lib.rs invoke_handler中注册
  - `human-judgement` TR-1.3: 代码风格与现有room_broadcast_stream_chunk一致
- **Notes**: 注意StreamRetry消息包含error和attempt_count字段，需参考RoomMessage::StreamRetry的定义

## [x] Task 2: 前端 - 封装广播命令API
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 在`src/lib/backend/types.ts`中检查/补充RoomStreamEndEvent、RoomStreamRetryEvent、RoomMessageResetEvent类型（如缺失则补全）
  - 在`src/lib/backend/rooms.ts`中添加四个invoke函数封装：
    - `roomBroadcastStreamChunk({conversationId, roundId, messageId, delta, done})`
    - `roomBroadcastStreamEnd({conversationId, roundId, messageId})`
    - `roomBroadcastStreamRetry({conversationId, roundId, messageId, error, attemptCount})`
    - `roomBroadcastMessageReset({conversationId, roundId, messageId})`
  - 在`src/App.tsx`中导入这些新函数
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-4
- **Test Requirements**:
  - `programmatic` TR-2.1: npx tsc --noEmit无新增类型错误
  - `human-judgement` TR-2.2: 函数命名风格与现有roomSendMessage等一致
- **Notes**: done参数在chunk中用于标记最后一块；StreamEnd单独发送更清晰

## [x] Task 3: 前端 - 在房主流式事件处理中加入广播逻辑
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 在`src/App.tsx`的`listenLlmStreamEvent`回调中，为每个相关事件添加广播：
    - `text_delta`: 调用roomBroadcastStreamChunk（done=false），delta为文本内容
    - `message_stop`: 先调用roomBroadcastStreamChunk（done=true, delta=''），再调用roomBroadcastStreamEnd（确保结束信号可靠送达）
  - 在`listenStreamRetry`回调中，调用roomBroadcastStreamRetry
  - 在`listenMessageReset`回调中，调用roomBroadcastMessageReset
  - 广播条件：必须是房主（`!!hostMember()` 且 `!activeRoomClientSession()` —— 即不是房客），且当前会话是联机会话
  - 广播使用void/fire-and-forget方式异步执行，用.catch()静默错误（console.warn），不阻塞本地UI
  - 非房主或单人模式下，不执行任何广播
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6
- **Test Requirements**:
  - `programmatic` TR-3.1: npx tsc --noEmit无新增类型错误
  - `programmatic` TR-3.2: 广播逻辑有条件判断，单人模式不触发
  - `human-judgement` TR-3.3: 代码风格与现有代码一致，无多余注释
- **Notes**: 
  - message_stop双重保险：同时发done=true的chunk和独立StreamEnd
  - 判断房主身份：`hostMember()`返回当前用户作为房主的成员记录（存在则是房主），`activeRoomClientSession()`存在则是房客
  - string_field_delta/object_field_complete本次不处理（结构化输出同步后续迭代）

## [x] Task 4: 编译验证与功能检查
- **Priority**: high
- **Depends On**: Task 3
- **Description**: 
  - 运行cargo build验证Rust后端编译通过
  - 运行npx tsc --noEmit验证TypeScript前端类型正确
  - 检查所有修改文件的完整性
- **Acceptance Criteria Addressed**: AC-7
- **Test Requirements**:
  - `programmatic` TR-4.1: cargo build退出码为0
  - `programmatic` TR-4.2: npx tsc --noEmit无房间流式功能相关错误（原有错误可忽略）
  - `human-judgement` TR-4.3: 所有checklist项通过

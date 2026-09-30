# 联机流式传输同步修复 - Product Requirement Document

## Overview
- **Summary**: 修复联机房间中LLM流式回复不同步问题。房主接收AI流式回复时，需将所有流式事件（text_delta、message_stop、stream_retry、message_reset）实时广播给房客，确保房客看到完整流式内容、正确结束流式状态，避免房客卡在"正在流式"无法继续发言。
- **Purpose**: 解决重启后房间问题已修复，但联机时AI回复流式传输不广播的致命缺陷——房客完全收不到AI回复内容，isStreaming永远为true，导致房客无法继续操作。
- **Target Users**: Night Voyage联机房间的房主和房客。

## Goals
- 房主接收LLM流式text_delta时实时广播给房客，房客看到打字机效果
- 房主收到message_stop（流式结束）时广播StreamEnd给房客，房客结束isStreaming状态
- 房主收到stream_retry（自动重试）时广播StreamRetry给房客，房客重置消息内容
- 房主收到message_reset（消息重置）时广播MessageReset给房客，房客重置消息
- 房主收到string_field_delta（结构化字段增量）时实时广播给房客，房客structuredFields增量组装
- 房主收到object_field_complete（结构化对象字段完成）时广播给房客，房客写入完整JSON字段
- 流式出错/中止时后端广播StreamEnd给房客，房客结束isStreaming状态不卡死
- 房客正确接收所有流式事件，流式结束后可正常发言
- 单人模式不受影响，不广播任何内容
- 不引入新依赖，遵循现有代码风格

## Non-Goals (Out of Scope)
- 不修改TCP网络协议或序列化格式（新增RoomMessage变体属扩展，不改既有格式）
- 不修改AI回复生成逻辑
- 不增加断点续传或chunk重传机制（流式实时性要求高，丢一两个delta可接受）
- 不同步思考过程（thinking_delta，即reasoning_content）给房客（保持现有行为；结构化输出中的"thinking"字符串字段属于响应内容，会同步）

## Background & Context
- 后端已定义RoomMessage::StreamChunk/StreamEnd/StreamRetry/MessageReset网络消息类型
- 后端已实现room_broadcast_stream_chunk命令，但缺少StreamEnd/StreamRetry/MessageReset对应的广播命令
- 前端rooms.ts只封装了事件监听，完全没有封装任何广播invoke命令
- App.tsx中listenLlmStreamEvent处理text_delta/message_stop等事件时只更新本地UI，未调用广播
- 房客端listenRoomStreamChunk/listenRoomStreamEnd等事件监听已正确实现，只需房主端正确广播即可

## Functional Requirements
- **FR-1**: 后端新增room_broadcast_stream_end命令，广播StreamEnd消息
- **FR-2**: 后端新增room_broadcast_stream_retry命令，广播StreamRetry消息
- **FR-3**: 后端新增room_broadcast_message_reset命令，广播MessageReset消息
- **FR-4**: 前端rooms.ts封装roomBroadcastStreamChunk/End/Retry/Reset四个invoke函数
- **FR-5**: 房主端处理text_delta时，若当前是房主且房间运行中，调用roomBroadcastStreamChunk
- **FR-6**: 房主端处理message_stop时，若当前是房主且房间运行中，调用roomBroadcastStreamEnd（done=true）
- **FR-7**: 房主端处理stream_retry时，若当前是房主且房间运行中，调用roomBroadcastStreamRetry
- **FR-8**: 房主端处理message_reset时，若当前是房主且房间运行中，调用roomBroadcastMessageReset
- **FR-9**: 广播失败时静默忽略（房主服务器未启动时不阻塞本地UI）
- **FR-10**: 非房主（房客）不执行任何广播
- **FR-11**: 后端在string_field_delta发出时，同步广播RoomMessage::StreamStructuredFieldDelta（含field_key与delta）给房客，房客structuredFields[fieldKey]增量追加（含\\n/\\t/\\r转义还原）
- **FR-12**: 后端在object_field_complete发出时，同步广播RoomMessage::StreamObjectFieldComplete（含field_key与json）给房客，房客structuredFields[fieldKey]写入完整JSON字符串
- **FR-13**: 流式生命周期广播（text_delta / message_stop / stream_retry / message_reset / 结构化字段）统一由后端发起（chat_service.rs helper + stream_processor.rs），前端不再触发任何room_broadcast_stream_*命令；已删除room_broadcast_stream_chunk/end/retry/message_reset命令与前端invoke封装
- **FR-14**: 后端spawn_stream_task在永久失败/中止路径（STREAM_ABORTED_ERROR、mem0/Prompt Compiler确定性错误、流中被中止）广播StreamEnd给房客，房客isStreaming转false不卡死
- **FR-15**: 房客模式（isRoomClient）下ChatArea不渲染TokenIsland，避免get_conversation_token_usage因本地DB无conversation行报错；后端load_conversation_compile_context改用fetch_optional返回明确错误（C2显式错误，非静默回退）

## Non-Functional Requirements
- **NFR-1**: 广播操作异步执行，不阻塞UI渲染和本地消息更新
- **NFR-2**: 广播失败不影响本地功能，错误在console.warn输出
- **NFR-3**: 保持代码风格一致，遵循零回退错误处理（仅在广播场景下允许静默失败，因为这是非关键路径）

## Constraints
- **Technical**: Tauri 2 + Rust后端、SolidJS前端、现有TCP自定义协议
- **Business**: 不破坏现有单人模式和联机其他功能
- **Dependencies**: 使用现有RoomMessage枚举、现有broadcast_message机制

## Assumptions
- 房间状态可通过hostMember()和currentRoundState()判断当前用户是否为房主
- 房间是否在运行可通过检查是否有roomClientSession（房客）或host_server（房主）判断——实际上只需要判断"我是房主"即可，因为room_broadcast_stream_chunk在服务器未启动时返回错误，我们catch掉即可
- 房客端已有的事件监听器无需修改，已能正确处理这些事件
- thinking_delta不需要广播（属于内部思考，房客不需要看到）
- content_block_start/stop/tool_use等结构化事件暂不同步，房客只看到最终文本delta

## Acceptance Criteria

### AC-1: 房客看到流式文本
- **Given**: 房主和房客在同一个联机房间，房主发起AI对话
- **When**: 房主收到LLM的text_delta事件
- **Then**: 房客实时收到room:stream_chunk事件，消息内容逐步追加，显示打字机效果
- **Verification**: `programmatic` + `human-judgment`

### AC-2: 流式正确结束，房客可发言
- **Given**: 房主和房客在同一个联机房间，AI正在流式回复
- **When**: 房主收到message_stop事件
- **Then**: 房客收到room:stream_end事件，消息isStreaming变为false，输入框可用，可正常发送下一条消息
- **Verification**: `human-judgment`

### AC-3: 重试时房客同步重置
- **Given**: 房主和房客在同一个联机房间，AI流式过程中遇到错误自动重试
- **When**: 房主收到stream_retry事件
- **Then**: 房客收到room:stream_retry事件，消息内容清空，重新显示流式状态
- **Verification**: `human-judgment`

### AC-4: 消息重置时房客同步
- **Given**: 房主和房客在同一个联机房间，AI流式过程中被重置
- **When**: 房主收到message_reset事件
- **Then**: 房客收到room:message_reset事件，消息内容清空，重新显示流式状态
- **Verification**: `human-judgment`

### AC-5: 单人模式不受影响
- **Given**: 用户在单人会话中
- **When**: AI回复流式传输
- **Then**: 不调用任何房间广播命令，行为与修复前完全一致
- **Verification**: `programmatic`

### AC-6: 房客不广播
- **Given**: 用户是房客（加入别人的房间）
- **When**: 收到任何LLM流式事件（理论上房客不会收到，因为AI只在房主端生成）
- **Then**: 不调用任何广播命令
- **Verification**: `programmatic`

### AC-7: 编译通过
- **Given**: 代码修改完成
- **When**: 运行cargo build和npx tsc --noEmit
- **Then**: 无新增编译错误和类型错误
- **Verification**: `programmatic`

## Open Questions
- [x] ~~结构化输出（选项A/B/C/D）是否需要同步给房客？~~ 已解决（FR-11/FR-12）：string_field_delta / object_field_complete 现已通过后端统一广播给房客，房客structuredFields增量组装，与房主渲染一致。

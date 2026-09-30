# Checklist

## 后端事件结构扩展（Task 1）
- [x] `StreamRetryEvent` 新增 `auto_retry_enabled: bool` 字段
- [x] `RoomMessage::StreamRetry` variant 新增 `auto_retry_enabled: bool` 字段
- [x] `RoomStreamRetryPayload` 新增 `auto_retry_enabled: bool` 字段
- [x] `event_payload()` 中 `StreamRetry` 分支正确映射 `auto_retry_enabled`

## 后端 spawn_stream_task 改造（Task 2）
- [x] `spawn_stream_task` 签名新增 `auto_retry_enabled: bool` 参数
- [x] emit `llm-stream-retry` 时携带 `auto_retry_enabled`
- [x] 广播 `StreamRetry` 时携带 `auto_retry_enabled`
- [x] `auto_retry_enabled = false` 时失败后 break loop（不 sleep、不 continue）
- [x] `auto_retry_enabled = true` 时保持现有 sleep 1 秒 + continue 行为
- [x] abort / 确定性错误路径不受影响（仍 break）

## 后端调用点传参（Task 3）
- [x] `submit_input` 传入 `auto_retry_enabled = false`
- [x] `dispatch_tool_round` 传入 `auto_retry_enabled = false`
- [x] `regenerate_round` 传入 `auto_retry_enabled = false`
- [x] `retry_failed_round` 传入 `auto_retry_enabled = true`

## 前端类型扩展（Task 4）
- [x] `StreamRetryEvent` 新增 `autoRetryEnabled: boolean`
- [x] `RoomStreamRetryEvent` 新增 `autoRetryEnabled: boolean`

## 前端 retryNotice 信号 + 事件处理（Task 5）
- [x] `retryNotice` 信号类型新增 `autoRetryEnabled: boolean` 和 `roundId: number`
- [x] `listenStreamRetry` 回调根据 `autoRetryEnabled` 分流
- [x] `autoRetryEnabled = false` 时：`replyStatus = 'idle'` + `isStreaming = false` + `error` 保留 + 不自动消失
- [x] `autoRetryEnabled = true` 时：`replyStatus = 'connecting'` + `isStreaming = true` + 不自动消失
- [x] `listenRoomStreamRetry` 回调（房客侧）根据 `autoRetryEnabled` 分流
- [x] `retryNotice` UI 显示"发送失败" + "自动重试"按钮（`autoRetryEnabled = false`）
- [x] "自动重试"按钮点击调用 `handleRetryFailed('', roundId)`
- [x] `retryNotice` UI 显示"自动重试中" + "停止"按钮（`autoRetryEnabled = true`）
- [x] "停止"按钮点击调用 `handleAbortReply`
- [x] 收到流式结束（`message_stop`）时清除 `retryNotice`
- [x] 收到 `llm-stream-error` 时清除 `retryNotice`
- [x] 收到 `room:stream_end` 时清除 `retryNotice`（房客侧）
- [x] `handleSend` 开头清除 `retryNotice`
- [x] 切换会话时清除 `retryNotice`

## 多人适配
- [x] 房客收到 `room:stream_retry`（`autoRetryEnabled = false`）显示"发送失败"（无按钮）
- [x] 房客收到 `room:stream_retry`（`autoRetryEnabled = true`）显示"自动重试中"（无按钮）
- [x] 房客收到 `room:stream_end` 后清除 `retryNotice` + `isStreaming = false`
- [x] 房主侧 `llm-stream-retry` 和 `room:stream_retry` 不重复处理（房主跳过 `room:stream_retry`）

## 约束合规
- [x] C1 Frontend Render-Only：重试循环逻辑在后端，前端仅渲染状态
- [x] C2 Zero-Fallback Errors：abort / 确定性错误路径不受影响，不吞异常
- [x] C5 Mobile Frontend Independence：仅修改 PC 前端 `src/`，不动 `src-mobile/`
- [x] C7 PC/Android Coverage：后端命令共享，房客通过 TCP 广播同步

## 构建验证
- [x] `cargo build --manifest-path src-tauri/Cargo.toml` 通过（exit 0，11 个既有 warnings）
- [x] `npx tsc --noEmit -p tsconfig.json` 通过（5 个既有错误，无新增）

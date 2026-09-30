# chat-auto-retry-fix

## 背景
用户报告聊天「自动重试」失效，截图显示 nvidia provider HTTP 请求失败后 toast 停留在「发送失败 · 第 4 次尝试」，且「自动重试」按钮仍可用。检查后端的 `stream_processor.rs` 与 `chat_service.rs` 发现两处可能导致重试行为异常的缺陷：

1. `retry_failed_round` 在 `llm_retry_snapshots.status == "running"` 时直接拒绝并返回「该轮次正在重试中」。若前一个重试任务异常退出（panic / 进程被杀），快照会永久停留在 `running`，导致按钮后续完全无响应。
2. 自动重试循环没有最大尝试次数上限，遇到持续性 provider 故障时会无限重试，且没有干净的最终失败事件让前端退出「自动重试中」状态。

## 目标
修复上述两处缺陷，使手动「自动重试」按钮可靠、自动重试有上限、到达上限后给出明确失败事件。

## 改动范围
仅后端 Rust：
- `src-tauri/src/repositories/llm_retry_snapshot_repository.rs`
- `src-tauri/src/services/chat_service.rs`
- `src-tauri/src/services/stream_processor.rs`

前端无需改动：最终失败复用已有的 `llm-stream-error` 事件处理。

## 详细设计

### 1. 快照记录暴露 `last_started_at`
在 `RetrySnapshotRecord` 中新增 `last_started_at: Option<i64>`，并在 `load_by_round` / `row_to_record` 中填充。用于判断 `running` 状态是否已过期。

### 2. 检测并回收僵死的 `running` 快照
在 `ChatService::retry_failed_round` 中：
- 若 `snapshot.status != "running"`，保持原流程。
- 若 `snapshot.status == "running"`：
  - 加载当前 round 状态；
  - 若 `round.status == "streaming"` 且 `snapshot.last_started_at` 在 30 秒内，认为真的有任务在跑，返回「该轮次正在重试中，请勿重复操作」；
  - 否则认为前一个任务已僵死，调用 `RetrySnapshotRepository::mark_failed` 把快照重置为 `failed`，然后继续本次重试流程。

### 3. 自动重试上限与最终失败事件
在 `stream_processor::spawn_stream_task` 的重试循环中：
- 新增常量 `MAX_CHAT_AUTO_RETRY_ATTEMPTS: i64 = 4`（含首次尝试，即最多 4 次请求）。
- 每次 `mark_attempt_started` 之后：
  - 若 `auto_retry_enabled` 为 true 且 `attempt_count > MAX_CHAT_AUTO_RETRY_ATTEMPTS`：
    - 构造错误文案「已达到最大自动重试次数（4 次），请检查 provider 网络或稍后手动重试」；
    - `RoundRepository::mark_failed` + `RetrySnapshotRepository::mark_failed`；
    - 发送 `llm-stream-error` 事件；
    - `broadcast_stream_end`；
    - `break` 退出循环。

### 4. 不变的行为
- 首次发送仍保持 `auto_retry_enabled = false`，失败后等待用户点击「自动重试」。
- 用户点击后进入自动重试模式，最多尝试 4 次（含第一次手动触发的那次）。
- 成功、用户中断、确定性错误（mem0 / Prompt Compiler）的原有路径不变。

## 合规
- C1 Frontend Render-Only：无前端代码改动。
- C2 Zero-Fallback Errors：新增路径均显式发出错误事件，不静默吞错。
- C5 Mobile Frontend Independence：后端改动双端共享。
- C7 PC/Android Dual-Platform Coverage：命令层无新增单端后门。

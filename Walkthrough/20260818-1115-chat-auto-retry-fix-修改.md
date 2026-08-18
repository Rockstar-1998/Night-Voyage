# 聊天自动重试修复

## 改动摘要
修复 `src-tauri/src/` 后端聊天自动重试/手动重试逻辑中的两处缺陷：

1. **`src-tauri/src/repositories/llm_retry_snapshot_repository.rs`**
   - `RetrySnapshotRecord` 新增 `last_started_at: Option<i64>` 字段。
   - `load_by_round` SELECT 与 `row_to_record` 同步填充该字段。

2. **`src-tauri/src/services/chat_service.rs::retry_failed_round`**
   - 原逻辑：只要 `snapshot.status == "running"` 就直接拒绝「该轮次正在重试中」。
   - 新逻辑：检测 `running` 是否为僵死状态。若 round 仍在 `streaming` 且 `last_started_at` 在 30 秒内，才拒绝；否则把快照重置为 `failed` 并允许本次重试继续。
   - 修复「前一个重试任务异常退出后，自动重试按钮永久无响应」的问题。

3. **`src-tauri/src/services/stream_processor.rs::spawn_stream_task`**
   - 新增常量 `MAX_CHAT_AUTO_RETRY_ATTEMPTS = 4`。
   - 在每次 `mark_attempt_started` 后检查：若已开启自动重试且 `attempt_count > 4`，则停止循环，标记 round/snapshot 为失败，发送 `llm-stream-error` 事件，并 `broadcast_stream_end`。
   - 修复「持续性 provider 故障时无限重试、UI 卡在自动重试中」的问题。

## 改动动机
用户反馈自动重试失效，截图显示 nvidia provider HTTP 请求失败后停留在第 4 次尝试。根因是：
- 重试快照的 `running` 状态没有超时回收机制，异常退出的任务会让按钮永久失效；
- 自动重试没有上限，失败时无法干净地退出到最终错误状态。

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅改动后端，前端复用已有 `llm-stream-error` 监听器。 |
| C2 Zero-Fallback Errors | √ | 上限到达路径显式 emit `llm-stream-error`，不静默吞错。 |
| C3 Responsiveness | √ | 无阻塞 UI 的同步操作；重试间隔保持 1 秒不变。 |
| C4 AI UI Isolation | √ | 未触碰 AI 生成 UI / iframe / Shadow DOM。 |
| C5 Mobile Frontend Independence | √ | 后端命令改动双端共享，未新增移动端耦合代码。 |
| C6 Project Cache Location | √ | 未引入新的缓存/持久化路径。 |
| C7 PC/Android Coverage | √ | Tauri command `retry_failed_round` 双端可用，无单端后门。 |
| 组合原则 | √ | 未新增继承/downcast/enum Kind + bool；改动为最小分支与显式状态。 |

## 验收记录
- **构建命令**：`export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSC_RUSTFLAGS="" cargo build`
- **预期效果**：编译通过，无新增错误。
- **实际结果**：`Finished dev profile ... CARGO_EXIT=0`，仅保留 8 条既有 dead-code 警告，无新增错误。

## 已知限制
- 本次未跑 `scripts/build_dual_release.bat`（完整双端 release 构建耗时较长），debug `cargo build` 已通过。如需 release 验证可后续补跑。
- 自动重试上限当前硬编码为 4 次（含用户点击后的首次尝试）。如需按 provider 配置化，需后续在 `api_providers` 表增加 `max_retries` 字段并在前端设置面板暴露。

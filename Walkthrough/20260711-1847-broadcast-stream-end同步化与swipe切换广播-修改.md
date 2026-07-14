# broadcast_stream_end 同步化 + swipe 切换广播

## 1. 改动摘要

### 涉及文件

| 文件 | 模块/函数 | 改动内容 |
|------|-----------|----------|
| `src-tauri/src/network/mod.rs` | `RoomMessage` enum | 新增 `SwipeActivated { conversation_id, round_id, message_id }` variant |
| `src-tauri/src/network/mod.rs` | `RoomSwipeActivatedEvent` | 新增 flat payload 结构体（参考 `StreamEndPayload`/`RoomMessageDeletedEvent` 模式） |
| `src-tauri/src/network/mod.rs` | `RoomMessage::event_name()` | 新增 `SwipeActivated => "room:swipe_activated"` 映射 |
| `src-tauri/src/network/mod.rs` | `RoomMessage::event_payload()` | 新增 `SwipeActivated` arm，返回 `RoomSwipeActivatedEvent` 序列化值 |
| `src-tauri/src/services/chat_service.rs` | `broadcast_stream_end` | 由 `pub fn` + `tauri::async_runtime::spawn` 改为 `pub async fn`，直接 `await`，去掉 spawn 包裹 |
| `src-tauri/src/services/stream_processor.rs` | `spawn_stream_task` 内 3 处调用 | `broadcast_stream_end(...)` → `broadcast_stream_end(...).await`（abort 路径、Prompt Compiler/mem0 错误路径、is_round_aborted 路径） |
| `src-tauri/src/services/chat_service.rs` | `ChatService::switch_swipe` | 函数签名新增 `app: &AppHandle` 参数；在 `set_active_assistant_message` 之后、`find_by_id` 之前，同步 `await` 广播 `RoomMessage::SwipeActivated` |
| `src-tauri/src/commands/chat.rs` | `messages_switch_swipe` | Tauri command 新增 `app: AppHandle` 注入参数；调用 `switch_swipe` 时传入 `&app` |

### Task 3: broadcast_stream_end 同步化

- 原实现用 `tauri::async_runtime::spawn` 异步广播，房客无法及时收到 `room:stream_end`，房主点击停止后房客卡在流式阶段。
- 改为 `pub async fn`，直接在函数体内 `await`。`spawn_stream_task` 本身是 async 函数，调用点可直接 `.await`。
- 调用点共 3 处（`stream_processor.rs` 第 189/210/221 行），全部补 `.await`。

### Task 5 后端: swipe 切换广播

- 新增 `RoomMessage::SwipeActivated` variant，携带 `conversation_id / round_id / message_id`。
- 完整接入序列化链路：`#[serde(tag = "type", content = "payload")]` 自动序列化 + `event_name()` 映射 `room:swipe_activated` + `event_payload()` 返回 `RoomSwipeActivatedEvent` 扁平 payload（与 `StreamEnd` 处理方式一致）。
- `switch_swipe` 新增 `app: &AppHandle`，在设置 active message 后同步 `await` 广播 `SwipeActivated`（不使用 spawn，与 `broadcast_stream_end` 同步化思路一致）。
- `messages_switch_swipe` command 同步增加 `app: AppHandle` 参数（Tauri 自动注入），调用点传入 `&app`。

## 2. 改动动机

1. **房客流式同步**：房主点击停止/重试/abort 后，房客需立即收到 `room:stream_end` 以退出流式 UI。原 spawn 路径在事件循环外异步执行，时序不可控，导致房客卡住。
2. **房客 swipe 同步**：房主切换重新生成版本（swipe）时，房客端无任何通知，无法同步切换到对应 message。新增 `SwipeActivated` 广播使房客可监听 `room:swipe_activated` 并切换展示。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 全部改动在 Rust 后端（services / network / commands），前端只消费 Tauri event。 |
| C2 Zero-Fallback Errors | √ | 广播使用 `if let Some(server) = host_server.as_ref()`，当无 host_server（单机模式）时静默不广播——这是单机模式无房客的正常路径，非错误吞没；`switch_swipe` 错误仍由 `?` 传播。未引入任何兜底伪成功。 |
| C3 Responsiveness | √ | 广播改为同步 `await` 但底层 `broadcast_message` 仅向 mpsc channel `send`（非阻塞 send），不会阻塞 UI 线程；`spawn_stream_task`/`switch_swipe` 均在异步上下文执行。 |
| C4 AI UI Isolation | √ | 不涉及 AI 动态 UI 层。 |
| C5 Mobile Frontend Independence | √ | 纯后端改动，PC/移动端共享同一后端 command，未引入 `isMobile` 分支。 |
| C6 Project Cache Location | √ | 不涉及缓存写入。 |
| C7 PC/Android Coverage | √ | 后端 command/event 双端共享，PC 与移动端通过同一 Tauri 接口调用 `messages_switch_swipe` 并监听 `room:swipe_activated`。 |

## 4. 验收记录

### 构建命令

```
cd d:\data\Night Voyage\src-tauri ; cargo build
```

### 实际输出（末尾）

```
warning: `night-voyage` (lib) generated 11 warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 8m 38s
```

- 退出码：0
- 编译通过。
- 11 个 warning 均为与本次改动无关的既有 dead-code 告警（`PromptCompileMode`、`PresetCompilePreviewData`、`compile_chat_messages`、`adapt_prompt_compile_result_to_openai_messages`、`StreamResponseData.prompt_tokens/completion_tokens` 等），无本次改动引入的新告警。

### 验收方式

- Task 3：房主触发 stop / 流式错误 / abort 后，`broadcast_stream_end` 在 `spawn_stream_task` 内同步 await 完成，房客应即时收到 `room:stream_end` 并退出流式 UI。
- Task 5：房主调用 `messages_switch_swipe` 切换 swipe 版本后，`RoomMessage::SwipeActivated` 经 TCP 广播到达房客，房客前端监听 `room:swipe_activated` 事件并切换到 `target_message_id` 对应的消息。

### 预期效果

- 房客不再卡在流式传输阶段。
- 房客能与房主同步 swipe 切换。

## 5. 已知限制或后续待办

1. **前端监听未在本次后端改动中实现**：`room:swipe_activated` 事件已由后端发出，但 PC/移动端前端需新增对应监听与 UI 切换逻辑（属 Task 5 前端部分，不在本次后端任务范围）。
2. `network/mod.rs` 的 `event_name()` / `event_payload()` 仍保留既有 `_ =>` 兜底 arm（用于其它未显式映射的 variant），本次未改动，属既有设计，超出本次任务范围。
3. 本次仅完成后端改动，未执行 git commit（按 sub-agent 规约，提交由用户/上层 agent 决定）。

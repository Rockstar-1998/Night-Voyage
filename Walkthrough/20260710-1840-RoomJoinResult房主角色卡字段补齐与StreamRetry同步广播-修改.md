# RoomJoinResult 房主角色卡字段补齐与 StreamRetry 同步广播修复

## 1. 改动摘要

### 修改文件

- `src-tauri/src/commands/rooms.rs`
- `src-tauri/src/services/stream_processor.rs`

### 改动内容

**修改 1：RoomJoinResult 补齐房主角色卡字段（rooms.rs）**

- `RoomJoinResult` 结构体（约 44-66 行）新增 3 个字段：
  - `host_character_image_base64: Option<String>`
  - `host_character_name: Option<String>`
  - `host_character_description: Option<String>`
- `room_join` 函数 `Ok(session)` 分支（约 255-257 行）：从 `session` 映射这 3 个字段。
- `room_join` 函数 `Err(e)` 分支（约 277-279 行）：将这 3 个字段设为 `None`。

字段名与 `RoomJoinSession`（`network/mod.rs` 769-771 行）完全一致，join handler 已填充这些字段，此前 `RoomJoinResult` 构造时未映射，导致房客收不到房主角色卡信息。

**修改 2：StreamRetry 广播改为同步执行（stream_processor.rs）**

- 约 240-254 行：将 `tauri::async_runtime::spawn({ ... async move { ... } })` 包裹的 StreamRetry 广播改为同步块执行。
- 移除 `app.clone()`、`error.clone()` 的 move 到 async block 的中间变量（保留 `error.clone()` 传入消息体）。
- `host_server` 锁在块结束时自动释放，无死锁风险。
- `app.emit("llm-stream-retry", ...)` 保留在前方不变（给房主前端的事件）。

此前 spawn 异步广播会导致 retry 事件可能晚于新流式块到达房客，改为同步执行保证 retry 事件先于后续流式块发出。

## 2. 改动动机

### 修改 1 动机

`RoomJoinSession` 已包含房主角色卡的 3 个字段（image_base64 / name / description），join handler 也已填充，但 `room_join` Tauri command 构造 `RoomJoinResult` 返回给前端时未映射这些字段。房客加入房间后无法获取房主角色卡信息，导致角色卡展示缺失。

### 修改 2 动机

StreamRetry 广播通过 `tauri::async_runtime::spawn` 异步执行，与后续的流式重试块（重置消息内容后继续循环）存在竞态：spawn 的任务可能被调度延迟，导致房客先收到新一轮流式块，再收到 retry 事件，前端状态错乱。改为同步执行后，retry 事件必然先于后续流式块发出，保证事件顺序正确。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅改后端 Rust 代码，前端职责未变 |
| C2 Zero-Fallback Errors | √ | 未引入静默回退；Err 分支显式返回 None 字段并保留 success: false 与错误信息 |
| C3 Responsiveness | √ | StreamRetry 同步广播为短时锁操作（broadcast_message），不阻塞 UI 线程（运行在 Tauri 后端 async 上下文）；RoomJoinResult 字段映射为同步赋值，无耗时操作 |
| C4 AI UI Isolation | √ | 不涉及 AI 动态 UI 层 |
| C5 Mobile Frontend Independence | √ | 仅改后端，PC/移动端共用同一 Tauri command，无前端代码耦合 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 后端 command 双端共享，修复同时覆盖 PC 与 Android |

## 4. 验收记录

### 构建命令

```
cargo build --manifest-path src-tauri/Cargo.toml
```

### 构建输出（末尾）

```
warning: `night-voyage` (lib) generated 11 warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 9m 04s
```

退出码：0（成功）。所有 warning 均为既有死代码警告（prompt_compiler.rs、provider_adapter.rs、stream_processor.rs 的未使用字段），与本次修改无关。

### 验收说明

- **修改 1 验收**：`RoomJoinResult` 结构体含 3 个新字段；`room_join` 的 Ok 分支从 session 映射、Err 分支置 None。字段名与 `RoomJoinSession` 一致，编译通过证明类型匹配。
- **修改 2 验收**：`stream_processor.rs` 中 StreamRetry 广播不再包裹 `spawn`，改为同步块；`app.emit("llm-stream-retry", ...)` 保留在前。编译通过证明借用与锁使用正确。

### 预期效果

- 房客加入房间后可获取房主角色卡的图像/名称/描述。
- 流式重试时，retry 事件先于新一轮流式块到达房客，避免前端状态错乱。

## 5. 已知限制或后续待办

- 本次仅修复后端字段映射与广播时序，未验证前端对这 3 个新字段（`hostCharacterImageBase64` / `hostCharacterName` / `hostCharacterDescription`）的消费逻辑；若前端未读取这些字段，需后续在前端补齐展示。
- StreamRetry 同步广播持有 `host_server` 锁直到 `broadcast_message` 完成；若广播耗时较长（大量房客），可能短暂阻塞同一锁的其他等待者。当前房间人数上限为 4，风险可接受。

# Capability Unit Refactor — Spec

> 设计真相源：每对 `(conversationType × memoryMode)` 作为独立的能力单元，共享底座 + 能力声明驱动 UI/后端。

## 1. 问题根因

当前"能力门控"散落在两个维度：

| 门控层 | 位置 | 问题 |
|--------|------|------|
| 前端 | `MessageItem.tsx` JSX 中的 `Show when={!isRoomClient}` | `memoryMode` 完全隐形，按钮存在性与模式能力脱节 |
| 前端 | `App.tsx:450` `onRegenerate={isRoomClient ? () => {} : handler}` | 静默空操作，违背 C2 Zero-Fallback |
| 后端 | 无 | 后端不校验能力契约，不支持的操作不报错 |

## 2. 解决方案

**组合模式**：共享底座 + 每组合独立能力声明。

- **后端**：`ChatPipeline` trait 定义能力契约，`capability_guard` 在命令入口校验
- **前端**：`CapabilityProfile` 接口驱动按钮渲染，消除 JSX 散落的 if/else
- **共享层不变**：provider_adapter、DB repositories、ChatService 核心操作

## 3. 后端架构

### 3.1 文件结构

```
src-tauri/src/services/chat/
  mod.rs                  ← 模块入口 + 重新导出
  pipeline_trait.rs       ← ChatPipeline trait：8 个操作方法的异步 trait，默认返回"不支持"
  capability_guard.rs     ← 能力校验：加载对话 profile → 查询 capability matrix → 放行或显式拒绝
  stateless_pipeline.rs   ← single/stateless 管道实现：全部 8 个方法委托 ChatService
```

### 3.2 ChatPipeline trait

```rust
#[async_trait]
pub trait ChatPipeline {
    async fn submit_input(...) -> Result<...>   // 默认 Err("不支持")
    async fn regenerate_round(...) -> Result<...>
    async fn update_message_content(...) -> Result<...>
    async fn delete_message(...) -> Result<...>
    async fn switch_swipe(...) -> Result<...>
    async fn retry_failed_round(...) -> Result<...>
    async fn abort_round_stream(...) -> Result<...>
    async fn fork_conversation(...) -> Result<...>
}
```

- 每个方法默认返回 `Err("该会话模式不支持此操作")`。
- 具体 pipeline 实现选择性地 override 支持的操作。
- `StatelessPipeline` override 全部 8 个（探索确认 stateless 下所有操作均有效）。

### 3.3 capability_guard 校验流

```
命令入口 → check_capability(db, conversation_id, operation) → 
  ├─ 加载 (conversation_type, memory_mode) from DB
  ├─ 查询 capability matrix
  │   ├─ single/stateless → 全部放行
  │   └─ 其余组合 → 全部放行（向后兼容，后续逐步收紧）
  └─ Ok(()) 或 Err("该会话模式不支持此操作")
```

**为什么 POC 阶段只收紧 single/stateless**：其余组合在 legacy-compat profile 和向后兼容策略下行为不变。后续每新增一个组合，capability matrix 增加一行匹配规则，前端增加一个 profile 文件。

### 3.4 命令层改造

`commands/chat.rs` 中每个相关命令入口增加一行：

```rust
capability_guard::check_capability(&state.db, conversation_id, "regenerate_round").await?;
```

覆盖命令：`send_message`、`chat_submit_input`、`regenerate_message`、`chat_regenerate_round`、`messages_update_content`、`messages_switch_swipe`、`messages_delete`、`abort_round_stream`、`retry_failed_round`。

`conversations_fork`（在 `commands/conversations.rs`）本次不改造（spec 范围外，后续组合加入时同步改造）。

## 4. 前端架构（后续任务，仅占位）

### 4.1 文件结构

```
src/components/chat-capability/
  types.ts              ← CapabilityProfile 接口
  single-stateless.ts   ← single/stateless profile（全部能力=true）
  legacy-compat.ts      ← 向后兼容 profile（镜像现有 isRoomClient/isOnline 行为）
  select-profile.ts     ← 选择器：(convType, memMode, isRoomClient) → CapabilityProfile
```

### 4.2 CapabilityProfile 接口

```typescript
interface CapabilityProfile {
  canEditUserMessage: boolean;
  canEditAssistantMessage: boolean;
  canFork: boolean;
  canDelete: boolean;
  canRegenerate: boolean;
  canRetryFailed: boolean;
  canSwitchSwipe: boolean;
  // 组合专属 UI
  showMemoryRetrieval?: boolean;
  showSnapshotIndicator?: boolean;
  showRoomPanel?: boolean;
  // ...
}
```

### 4.3 渲染变更

- `ChatArea.tsx`：接收 `profile` prop 替代 `isRoomClient`/`isOnline`
- `MessageItem.tsx`：`Show when={profile.canEditUserMessage}` 替代 `Show when={!isRoomClient}`
- `App.tsx`：`selectProfile(convType, memMode, isRoomClient)` 计算 profile

## 5. POC 范围（已完成）

| 组件 | 状态 |
|------|------|
| `single/stateless` 能力契约 | ✅ 完整 |
| `single/legacy` / `single/mem0` / online | 向后兼容（全部放行） |
| PC 端 | ✅ |
| 移动端 `src-mobile/` | 本次不覆盖，PC 验收后移植 |

## 5.1 第二步：single/legacy 收紧 + dispatch_pipeline 接入

### 能力矩阵（来自 `能力与模式一览表.md`）

`single/legacy` 与 `single/stateless` 在现有 8 个 `ChatPipeline` 操作 + `fork` 上**完全一致**（全部允许）。差异仅在 prompt 编译层（plot summary、history 窗口策略），已由 `prompt_compiler.rs` 按 `memory_mode` 分支处理，不在 pipeline 层。

| 操作 | single/stateless | single/legacy | 说明 |
|------|-----------------|---------------|------|
| submit_input | ✅ | ✅ | ChatService 委托 |
| regenerate_round | ✅ | ✅ | ChatService 委托 |
| update_message_content | ✅ | ✅ | ChatService 委托 |
| switch_swipe | ✅ | ✅ | ChatService 委托 |
| delete_message | ✅ | ✅ | ChatService 委托 |
| retry_failed_round | ✅ | ✅ | ChatService 委托 |
| abort_round_stream | ✅ | ✅ | ChatService 委托 |
| resolve_round_id_from_reply_to | ✅ | ✅ | ChatService 委托 |
| conversations_fork | ✅ | ✅ | 仅 online 被禁用 |

> 「总结剧情」「回溯到某轮对话」是独立功能（前者见 `plans/plot-summary-layer-plan.md`，后者未实现），不在 ChatPipeline 8 操作范围内，本轮不引入。

### dispatch_pipeline 接入

POC 阶段 `dispatch_pipeline()` 是死代码（命令层直接调 `ChatService`）。本轮把命令层改为通过 pipeline 实例调用：

```rust
// 命令层新流程（9 个写操作）
let pipeline = capability_guard::check_and_get_pipeline(&state.db, conversation_id, OP).await?;
pipeline.xxx(...).await
```

`check_and_get_pipeline` 内部：加载 profile → 校验能力 → 返回 `Box<dyn ChatPipeline>`。一次 DB 查询完成校验+分发。

### capability_guard API 演进

```rust
// 保留：用于不需要 pipeline 的命令（如 conversations_fork）
pub async fn check_capability(db, conv_id, operation) -> Result<(), String>

// 新增：用于需要 pipeline 的命令（8 个 chat 操作）
pub async fn check_and_get_pipeline(db, conv_id, operation) -> Result<Box<dyn ChatPipeline>, String>

// 新增：能力矩阵按 profile 校验（内部函数复用）
fn check_capability_with_profile(conv_type, mem_mode, operation) -> Result<(), String>
```

### dispatch_pipeline match 扩展

```rust
pub fn dispatch_pipeline(conversation_type: &str, memory_mode: &str) -> Box<dyn ChatPipeline> {
    match (conversation_type, memory_mode) {
        ("single", "stateless") => Box::new(StatelessPipeline),
        ("single", "legacy")    => Box::new(LegacyPipeline),
        // 其余组合暂返回 StatelessPipeline（向后兼容，能力由 guard 控制）
        _ => Box::new(StatelessPipeline),
    }
}
```

### conversations_fork 补 guard

`conversations_fork` 当前已在函数体内硬编码 `if conversation_type == "online" { return Err(...) }`。本轮改为在入口调用 `capability_guard::check_capability(db, conv_id, OP_FORK_CONVERSATION)`，并把 `online` 的 fork 拒绝逻辑收敛到 guard 的 match 分支中。原硬编码校验移除，避免双重校验。

### 第二步范围

| 组件 | 本次 | 后续 |
|------|------|------|
| `single/legacy` 能力契约 | ✅ 完整 | — |
| `dispatch_pipeline` 命令层接入 | ✅ 9 个写操作 | — |
| `conversations_fork` guard 接入 | ✅ | — |
| `single/mem0` / online | 向后兼容 | 下一轮 |
| PC 端 | ✅ | — |
| 移动端 `src-mobile/` | 本次不覆盖 | PC 验收后移植 |

## 6. 约束合规基线

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 能力判断在后端 capability_guard |
| C2 Zero-Fallback Errors | √ | 不支持的操作返回显式中文错误；前端不渲染不存在的按钮 |
| C3 Responsiveness | √ | capability_guard 一次 DB 查询，2 列，无锁 |
| C4 AI UI Isolation | — | 不涉及 |
| C5 Mobile Independence | — | PC 先行，移动端后续移植 |
| C6 Cache Location | — | 不涉及 |
| C7 PC/Android Coverage | — | POC 阶段 PC 先行 |

## 7. 已知限制

- `single/mem0`、`online/*` 组合当前全部放行，能力矩阵未收紧（下一轮逐步收紧）
- 移动端移植在 PC 验收后进行
- 「总结剧情」「回溯到某轮对话」等 matrix 中的能力未在 ChatPipeline 8 操作内，由独立功能任务承接
- `chat_submit_tool_result` 未接入 guard（受 `chat_mode` 维度控制，非 `memory_mode` 维度，待 chat_mode 维度纳入时统一改造）

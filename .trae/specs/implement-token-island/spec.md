# Token 计数条（灵动岛风格）Spec

## Why

用户在聊天时无法直观感知当前 Prompt 的 token 占用情况，也不知道距离上下文窗口上限还有多少余量。需要一个类似苹果灵动岛的紧凑可视化组件，让用户一眼看到各层 token 占比，并能快速设定模型的上下文窗口大小。

## What Changes

- 新增 Rust 后端 Tauri command：`get_conversation_token_usage`，返回当前会话的 Prompt Compiler 各层 token 估算值
- 新增 Rust 后端 Tauri command：`update_conversation_context_window`，设定会话关联 provider 的上下文窗口大小
- 新增前端组件 `TokenIsland`：灵动岛风格的 token 计数条，嵌入聊天界面（ChatArea）正上方
- `TokenIsland` 点击后展开为上下文窗口设定面板，设定完毕后以不同颜色显示各层 token 占用
- 在 `LlmStreamEventPayload` 中新增 `prompt_tokens` / `completion_tokens` 可选字段，用于从 API 响应中捕获实际 token 用量（倒推法校准）

## Impact

- Affected specs: prompt-compiler-stage-a, prompt-block-debug-logging
- Affected code:
  - `src-tauri/src/services/prompt_compiler.rs` — 新增轻量编译接口
  - `src-tauri/src/commands/chat.rs` — 新增 Tauri command
  - `src-tauri/src/services/stream_processor.rs` — 捕获 usage 字段
  - `src-tauri/src/models/mod.rs` — LlmStreamEventPayload 新增字段
  - `src/components/ChatArea.tsx` — 在聊天区域正上方嵌入 TokenIsland
  - `src/components/TokenIsland.tsx` — 新组件
  - `src/lib/backend.ts` — 新增类型和 invoke 封装

## ADDED Requirements

### Requirement: Token 用量查询接口

系统 SHALL 提供 `get_conversation_token_usage` Tauri command，接收 `conversation_id`，返回结构化的各层 token 估算数据。

#### Scenario: 正常查询

- **WHEN** 前端调用 `get_conversation_token_usage(conversation_id)`
- **THEN** 后端执行轻量 Prompt Compiler 编译（不发送请求），返回 `TokenUsageReport`：
  - `context_window_size: Option<usize>` — 当前 provider 的上下文窗口大小
  - `layers: Vec<TokenLayerUsage>` — 各层 token 占用
  - `total_estimated_tokens: usize` — 总估算 token 数
  - `total_actual_tokens: Option<usize>` — 最近一次 API 返回的实际 prompt_tokens（如有）

#### Scenario: 无 provider 或无上下文窗口设定

- **WHEN** 会话未关联 provider 或 provider 未设定 `max_context_tokens`
- **THEN** `context_window_size` 为 `None`，前端显示"未设定"状态

### Requirement: Token 层级数据结构

系统 SHALL 定义 `TokenLayerUsage` 结构：

```
TokenLayerUsage {
  kind: String,         // PromptBlockKind 的 as_str()
  title: Option<String>,
  estimated_tokens: usize,
  color: String,        // 前端使用的颜色标识
}
```

各层颜色映射：

| 层级 | 颜色 | 色值 |
|------|------|------|
| PresetRule | 靛蓝 | #6366f1 |
| MultiplayerProtocol | 紫色 | #a855f7 |
| CharacterBase | 翠绿 | #10b981 |
| PlayerBase | 青色 | #06b6d4 |
| WorldBookMatch | 琥珀 | #f59e0b |
| PlotSummary | 玫红 | #ec4899 |
| RecentHistory | 蓝灰 | #64748b |
| CurrentUser | 橙色 | #f97316 |

### Requirement: 上下文窗口设定接口

系统 SHALL 提供 `update_conversation_context_window` Tauri command，接收 `conversation_id` 和 `context_window_size`，更新会话关联 provider 的 `max_context_tokens` 字段。

#### Scenario: 设定成功

- **WHEN** 用户在 TokenIsland 中输入上下文窗口大小并确认
- **THEN** 后端更新 `api_providers.max_context_tokens`，前端刷新 token 用量数据

#### Scenario: 会话无关联 provider

- **WHEN** 会话未关联 provider
- **THEN** 返回错误，前端提示"请先为会话选择 API Provider"

### Requirement: 灵动岛风格 Token 计数条组件

系统 SHALL 在聊天界面（ChatArea）正上方显示 `TokenIsland` 组件。

#### Scenario: 收起状态（默认）

- **WHEN** 用户进入一个会话的聊天界面
- **THEN** 在聊天消息区域正上方显示一个紧凑的圆角胶囊条，外观类似灵动岛：
  - 左侧显示总 token 数 / 上下文窗口大小（如 "1.2K / 8K"）
  - 右侧显示一个迷你分段进度条，各段颜色对应各层
  - 整体水平居中，最大宽度与聊天内容区域对齐，高度约 28px
  - 背景使用半透明毛玻璃效果
  - 不遮挡聊天内容，作为聊天区域的顶部固定元素

#### Scenario: 未设定上下文窗口

- **WHEN** provider 未设定 `max_context_tokens`
- **THEN** 胶囊条显示 "点击设定上下文窗口" 提示文字，进度条不显示

#### Scenario: 展开状态（点击后）

- **WHEN** 用户点击 TokenIsland
- **THEN** 组件展开为设定面板：
  - 顶部：上下文窗口大小输入框（数字输入，单位 tokens）
  - 中部：各层 token 占用的详细列表，每行显示层名、颜色标记、token 数、占比百分比
  - 底部：总 token 数和剩余可用 token 数
  - 展开/收起使用 Motion One 动画，时长 300ms

#### Scenario: Token 占用接近上限

- **WHEN** 总 token 占用超过上下文窗口的 80%
- **THEN** 进度条右侧显示警告色（红色渐变），数字变为红色

#### Scenario: Token 占用超过上限

- **WHEN** 总 token 占用超过上下文窗口的 100%
- **THEN** 进度条溢出部分以红色条纹动画显示，数字闪烁警告

### Requirement: API 响应 usage 字段捕获（倒推法）

系统 SHALL 在流式响应处理中捕获 API 返回的 `usage.prompt_tokens` 和 `usage.completion_tokens` 字段，存储到数据库并用于校准本地估算。

#### Scenario: OpenAI 兼容 API 返回 usage

- **WHEN** 流式响应的最后一个 chunk 或非流式响应中包含 `usage.prompt_tokens`
- **THEN** 后端将该值存储到 `messages` 表的新字段 `actual_prompt_tokens`，并通过 `LlmStreamEventPayload` 的新字段 `prompt_tokens` / `completion_tokens` 发送到前端

#### Scenario: 无 usage 字段

- **WHEN** API 响应不包含 `usage` 字段
- **THEN** 不影响现有流程，`actual_prompt_tokens` 为 `None`

### Requirement: Token 用量数据刷新时机

系统 SHALL 在以下时机自动刷新 token 用量数据：

1. 用户切换选中会话时
2. 用户发送消息后（流式响应完成时）
3. 用户在 TokenIsland 中设定上下文窗口后
4. 用户编辑或删除消息后

## MODIFIED Requirements

### Requirement: LlmStreamEventPayload 新增 usage 字段

在现有 `LlmStreamEventPayload` 结构中新增：

```
pub prompt_tokens: Option<i64>,
pub completion_tokens: Option<i64>,
```

仅在 `event_kind` 为 `stream_end` 时填充这两个字段。

### Requirement: messages 表新增 actual_prompt_tokens 字段

新增数据库迁移，为 `messages` 表添加：

```sql
ALTER TABLE messages ADD COLUMN actual_prompt_tokens INTEGER;
```

仅在 `message_kind = 'assistant_visible'` 且 API 返回了 `usage.prompt_tokens` 时填充。

## REMOVED Requirements

无移除项。

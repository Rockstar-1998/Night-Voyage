# 统一结构化消息渲染路径 Spec

## Why

前端存在两套独立渲染结构化消息的代码路径：
- 流式路径（`MessageItem.tsx` 的 `StreamingFieldTag` + 内联按钮）：处理流式传输中的 `message.structuredFields`，视觉风格与静态路径不一致。
- 静态路径（`MessageFormatRenderer.tsx` 的 `StructuredResponseRenderer`）：处理传输完毕后的完整 JSON，作为视觉基准。

两套代码产生不同的视觉效果（圆角 vs 直角选项按钮、字段键显示策略不同），且存在大量重复逻辑。应删除流式路径的独立渲染代码，统一使用 `StructuredResponseRenderer`，同时保留流式传输动画。

## What Changes

- **删除** `MessageItem.tsx` 中的 `StreamingFieldTag` 组件及其流式专用渲染分支
- **删除** `streamingObjectFields`、`streamingStringAuxFieldKeys`、`streamingContentText` 等流式专用 memo
- **修改** `structuredResponse` memo，使其同时处理流式和静态两种数据来源
- **保留** 流式传输动画（`StreamingText` 逐字动画、光标闪烁动画）
- **保留** `streamingStructuredMode` memo（仅用于判断数据来源，不再决定渲染路径）

## Impact

- Affected specs: `add-structured-output-response-mode`
- Affected code:
  - `src/components/MessageItem.tsx` — 删除流式渲染分支，统一走 `StructuredResponseRenderer`
  - `src/components/MessageFormatRenderer.tsx` — 无需修改（已是统一目标）

## ADDED Requirements

### Requirement: 统一渲染路径

The system SHALL 使用 `StructuredResponseRenderer` 渲染所有结构化消息，无论消息处于流式传输中还是已完成传输。

#### Scenario: 流式结构化消息
- **WHEN** 消息处于流式传输状态且 `message.structuredFields` 存在
- **THEN** 将 `structuredFields` 转换为 `StructuredResponseNode` 格式，交由 `StructuredResponseRenderer` 渲染
- **THEN** `isStreaming` 标志为 `true`，启用逐字动画和光标闪烁

#### Scenario: 静态结构化消息
- **WHEN** 消息已完成传输且 `message.content` 为有效 JSON
- **THEN** 通过 `parseStructuredResponse` 解析后交由 `StructuredResponseRenderer` 渲染
- **THEN** `isStreaming` 标志为 `false`

### Requirement: 流式数据到 StructuredResponseNode 的转换

The system SHALL 将 `message.structuredFields` 响应式地转换为 `StructuredResponseNode` 格式，确保字段增量更新时 UI 同步刷新。

#### Scenario: 流式字段增量更新
- **WHEN** `message.structuredFields` 中的某个字段值因 `string_field_delta` 事件而更新
- **THEN** 转换后的 `StructuredResponseNode` 响应式更新，`StreamingText` 组件自动渲染新增文本的逐字动画

#### Scenario: 流式对象字段解析
- **WHEN** `structuredFields` 中某个字段值为 JSON 对象
- **THEN** 将其解析为 `kind: 'object'` 的 `StructuredField`，由 `StructuredResponseRenderer` 渲染为对话选项按钮

### Requirement: 保留流式传输动画

The system SHALL 在统一渲染路径后保留以下流式动画效果：

#### Scenario: 逐字动画
- **WHEN** 消息处于流式传输状态
- **THEN** 新增文本通过 `StreamingText` 组件的 `streaming-char` CSS 类实现逐字动画

#### Scenario: 光标闪烁
- **WHEN** 消息处于流式传输状态
- **THEN** 显示闪烁光标（`animate-pulse` 的竖线元素）

## MODIFIED Requirements

无修改需求。

## REMOVED Requirements

### Requirement: StreamingFieldTag 组件
**Reason**: 流式路径统一走 `StructuredResponseRenderer`，`StreamingFieldTag` 不再需要。
**Migration**: 其响应式读取字段值的能力通过 `structuredResponse` memo 的响应式转换实现。

### Requirement: 流式路径的内联对话选项按钮
**Reason**: 统一由 `StructuredResponseRenderer` 渲染对话选项。
**Migration**: 无需迁移，`StructuredResponseRenderer` 已有完整的选项渲染逻辑。

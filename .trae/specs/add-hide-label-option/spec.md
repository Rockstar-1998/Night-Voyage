# 新增"隐藏标签"显示配置选项 Spec

## Why

当前结构化消息中，每个非主内容字段都会渲染为可折叠标签（CollapsibleTag），但某些字段（如 `content`）用户希望直接展示内容而不显示标签头。目前只能通过将字段设为 `mainContentKey` 来隐藏标签，但这仅限一个字段。需要一种更灵活的方式让用户控制任意字段是否隐藏标签。

## What Changes

- 在 `SchemaKeyConfig` 接口中新增 `hideLabel: boolean` 字段
- 在 `SchemaConfigPanel` 的每个键配置区域新增"隐藏标签"复选框
- 勾选"隐藏标签"时，强制将 `defaultExpanded` 设为 `true`（即"默认展开"复选框自动勾选并禁用）
- 扩展 `serializeDisplayConfig` 的输出格式，新增 `hideLabel` 字段
- 扩展 `parseJsonSchema` 解析 `hideLabel` 配置
- 在 `StructuredResponseRenderer` 中，当字段的 `hideLabel` 为 `true` 时，跳过 `CollapsibleTag` 包裹，直接渲染字段内容

## Impact

- Affected specs: `add-structured-output-response-mode`
- Affected code:
  - `src/components/SchemaConfigPanel.tsx` — 新增复选框、序列化/反序列化逻辑
  - `src/components/MessageFormatRenderer.tsx` — `StructuredResponseRenderer` 根据 `hideLabel` 决定渲染方式
  - `src/lib/messageFormatter.ts` — `StructuredResponseNode` 的 `displayConfig` 类型扩展

## ADDED Requirements

### Requirement: "隐藏标签"配置选项

The system SHALL 在 Schema 配置面板中为每个键提供"隐藏标签"复选框选项。

#### Scenario: 勾选"隐藏标签"
- **WHEN** 用户勾选某个键的"隐藏标签"复选框
- **THEN** 该键的 `defaultExpanded` 自动设为 `true`，"默认展开"复选框被勾选并禁用

#### Scenario: 取消勾选"隐藏标签"
- **WHEN** 用户取消勾选某个键的"隐藏标签"复选框
- **THEN** "默认展开"复选框恢复可编辑状态，保持之前的值

### Requirement: 隐藏标签的消息渲染

The system SHALL 在渲染结构化消息时，根据 `hideLabel` 配置决定是否显示字段标签。

#### Scenario: hideLabel 为 true 的字段
- **WHEN** 渲染一个 `hideLabel` 为 `true` 的字符串类型字段
- **THEN** 跳过 `CollapsibleTag` 包裹，直接渲染字段内容（与 `mainContentKey` 的渲染方式一致）
- **THEN** 字段内容始终展开显示，不可折叠

#### Scenario: hideLabel 为 false 或未设置的字段
- **WHEN** 渲染一个 `hideLabel` 为 `false` 或未设置的字段
- **THEN** 保持现有行为，渲染为可折叠标签

### Requirement: displayConfig 序列化扩展

The system SHALL 在 `displayConfig` 中支持 `hideLabel` 字段的持久化。

#### Scenario: 序列化
- **WHEN** 保存 Schema 配置
- **THEN** `serializeDisplayConfig` 输出格式为 `{ keyName: { defaultCollapsed: boolean; hideLabel?: boolean } }`

#### Scenario: 反序列化
- **WHEN** 加载已有 Schema 配置
- **THEN** `parseJsonSchema` 正确解析 `hideLabel` 字段，缺失时默认为 `false`

## MODIFIED Requirements

无修改需求。

## REMOVED Requirements

无移除需求。

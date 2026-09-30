# 移除 mainContentKey 硬编码 Spec

## Why

`mainContentKey` 是硬编码逻辑（优先选 `content` 字段，否则选第一个字段），与"主字段由用户定义"的要求矛盾。该行为从未与用户约定，属于未定义行为——用户永远不知情哪个字段被自动选为主字段。现在已有 `hideLabel` 选项让用户显式控制，`mainContentKey` 应被彻底移除，不做任何向后兼容回退（违反零回退原则）。

## What Changes

- **删除** `StructuredResponseNode.mainContentKey` 字段
- **删除** `StructuredResponseRenderer` 的 `mainContentKey` prop
- **删除** `MessageItem.tsx` 和 `messageFormatter.ts` 中 `mainContentKey` 的硬编码赋值逻辑
- **修改** `StructuredResponseRenderer` 渲染逻辑，仅依据 `hideLabel` 决定是否隐藏标签
- **不做** 任何向后兼容默认值——旧数据中未设置 `hideLabel` 的字段将显示标签，用户需在配置中显式勾选"隐藏标签"

## Impact

- Affected specs: `add-hide-label-option`
- Affected code:
  - `src/lib/messageFormatter.ts` — 删除 `mainContentKey` 字段和赋值逻辑
  - `src/components/MessageFormatRenderer.tsx` — 删除 `mainContentKey` prop，简化渲染条件
  - `src/components/MessageItem.tsx` — 删除 `mainContentKey` 赋值

## ADDED Requirements

无新增需求。

## MODIFIED Requirements

### Requirement: 字段标签隐藏由 hideLabel 唯一控制

原逻辑中，字段是否隐藏标签由 `mainContentKey` 和 `hideLabel` 共同决定。

**修改后**：
- 仅由 `hideLabel` 决定字段是否隐藏标签
- `mainContentKey` 概念完全移除
- 不做任何隐式默认值，所有字段默认显示标签，除非用户在配置中显式勾选"隐藏标签"

## REMOVED Requirements

### Requirement: mainContentKey 硬编码逻辑
**Reason**: 与"主字段由用户定义"的要求矛盾，且属于未定义行为（用户不知情），已被 `hideLabel` 显式控制替代。
**Migration**: 无迁移。旧数据中未设置 `hideLabel` 的字段将显示标签，用户需在 Schema 配置面板中显式勾选"隐藏标签"。

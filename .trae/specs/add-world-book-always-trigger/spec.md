# 世界书条目新增"永远触发"模式 Spec

## Why

世界书条目的触发方式目前只有"任一命中"（any）和"全部命中"（all），缺少"永远触发"模式。某些条目（如角色核心设定、场景基础描述）需要每次对话都注入，无需关键词匹配。

## What Changes

- 在 `trigger_mode` 的可选值中新增 `"always"`
- 在后端 `world_book_entry_matches` 函数中，`"always"` 模式直接返回 `true`
- 在前端类型定义中扩展 `triggerMode` 为 `'any' | 'all' | 'always'`
- 在前端 UI 的触发方式选择器中新增"永远触发"选项

## Impact

- Affected code:
  - `src-tauri/src/services/world_book_matcher.rs` — 匹配逻辑
  - `src/components/WorldBookEntryArea.tsx` — UI 选择器
  - `src/App.tsx` — 类型定义
  - `src/lib/backend.ts` — 类型定义

## ADDED Requirements

### Requirement: "永远触发"触发模式

The system SHALL 支持世界书条目的"永远触发"模式，该模式下条目无需关键词匹配即被触发。

#### Scenario: 永远触发模式匹配
- **WHEN** 世界书条目的 `trigger_mode` 为 `"always"` 且 `is_enabled` 为 `true`
- **THEN** 该条目始终被触发，无论对话内容是否包含其关键词

#### Scenario: 永远触发模式 UI
- **WHEN** 用户在世界书条目编辑面板中选择触发方式
- **THEN** 可选择"永远触发"选项，与"任一命中"和"全部命中"并列

## MODIFIED Requirements

无修改需求。

## REMOVED Requirements

无移除需求。

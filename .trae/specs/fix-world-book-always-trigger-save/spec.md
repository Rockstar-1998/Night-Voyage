# 修复世界书"永远触发"保存失败 Spec

## Why

世界书条目的 `trigger_mode` 列存在数据库 `CHECK` 约束 `CHECK (trigger_mode IN ('any', 'all'))`，不包含 `'always'`。当用户选择"永远触发"并保存时，SQLite 拒绝写入并抛出约束违反错误，导致保存失败。

## What Changes

- 修改原始迁移文件 `0003_feature_foundation.sql`，将 `CHECK (trigger_mode IN ('any', 'all'))` 改为 `CHECK (trigger_mode IN ('any', 'all', 'always'))`
- 删除旧数据库文件，让应用以更新后的迁移重建数据库

## Impact

- Affected code:
  - `src-tauri/migrations/0003_feature_foundation.sql` — CHECK 约束扩展

## ADDED Requirements

### Requirement: 数据库 CHECK 约束支持 `"always"`

The system SHALL 确保数据库 `world_book_entries.trigger_mode` 的 CHECK 约束允许 `"always"` 值。

#### Scenario: 保存"永远触发"条目成功
- **WHEN** 用户将世界书条目的触发方式设为"永远触发"并点击保存
- **THEN** 后端成功将 `trigger_mode = 'always'` 写入数据库，前端刷新后标签显示"永远触发"

## MODIFIED Requirements

无修改需求。

## REMOVED Requirements

无移除需求。

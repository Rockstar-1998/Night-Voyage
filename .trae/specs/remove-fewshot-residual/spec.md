# 移除 Few-shot 残留 Spec

## Why

前序 spec `remove-examples-prefill-add-player-base` 已移除 `ExampleMessage` 枚举、`example_blocks` 字段及大部分 examples 读写代码，但故意保留了 `preset_examples` 表和 `PresetExampleRecord` 结构体（"数据保留但不再读写"）。用户确认第7层 few-shot 彻底废弃，需要清除残留死代码和死表，保持代码库整洁。

## What Changes

- **移除** 数据库表 `preset_examples`（新建 migration 0032 DROP TABLE）
- **移除** `models/mod.rs` 中的 `PresetExampleRecord` 结构体（无任何使用方）
- **移除** `backend.ts` 中的 `PresetExampleRecord` 接口（无任何使用方）
- **修改** `docs/preset-system-architecture.md`：移除第3节"Few-shot 示例层"、第5节编译顺序中的第7层、第9节实现顺序中的第2阶段 few-shot 项

## Impact

- Affected specs: `remove-examples-prefill-add-player-base`（完成其未竟的清理）
- Affected code:
  - `src-tauri/migrations/` — 新建 0032
  - `src-tauri/src/models/mod.rs` — 删除结构体
  - `src/lib/backend.ts` — 删除接口
  - `docs/preset-system-architecture.md` — 文档更新

## ADDED Requirements

### Requirement: Migration 0032 清除 preset_examples 表

系统 SHALL 新建 migration `0032_drop_preset_examples.sql`，执行 `DROP TABLE IF EXISTS preset_examples;`。

#### Scenario: 已有数据库实例

- **WHEN** 应用启动并执行迁移
- **THEN** `preset_examples` 表 SHALL 被删除，`_sqlx_migrations` 表 SHALL 记录 0032

## REMOVED Requirements

### Requirement: PresetExampleRecord 结构体

**Reason**: 第7层 few-shot 已废弃，该结构体无任何使用方（grep 确认仅定义行，无读写）。
**Migration**: 删除 `models/mod.rs` 中的 `PresetExampleRecord` 结构体和 `backend.ts` 中的 `PresetExampleRecord` 接口。

### Requirement: 文档中的 Few-shot 示例层

**Reason**: 第7层已废弃，文档不应再描述该层。
**Migration**: 从 `docs/preset-system-architecture.md` 移除第3节、第5节编译顺序第7项、第9节第2阶段 few-shot 相关项。

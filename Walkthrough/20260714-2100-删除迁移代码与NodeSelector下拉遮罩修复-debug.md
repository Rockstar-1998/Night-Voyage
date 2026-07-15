# 删除迁移代码与 NodeSelector 下拉遮罩修复

**修改类型**：debug

**日期**：2026-07-14

## 1. 改动摘要

1. **删除全部迁移代码**：移除 `migrateToBlueprint` 调用、`LegacyPresetForMigration` 映射函数、`migration.ts` 文件
2. **修复 NodeSelector 下拉被遮罩**：header 加 `relative z-50`，使其 stacking context 高于 NodeConfigPanel

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/components/blueprint/BlueprintEditor.tsx` | 删除 migration import + 5 个映射函数 + onMount 迁移分支；header 加 `relative z-50` |
| `src-mobile/components/blueprint/MobilePresetBlueprintEntry.tsx` | 删除 migration import + 4 个映射函数；handleOpenPreset 改为直接读取 blueprintGraph 或用空图 |
| `src/lib/blueprint/migration.ts` | **删除** |

## 2. 改动动机

### 删除迁移代码

用户明确要求删除迁移代码。旧预设迁移逻辑（`migrateToBlueprint`）已不再需要——新建空白预设直接用 `createEmptyGraph()`，已有图直接从 DB 读取。迁移代码的存在只会引入复杂性（上一轮 bug 就因迁移误触发导致）。

### NodeSelector 下拉被遮罩

NodeConfigPanel 根元素 `<aside>` 有 `backdrop-blur-xl` 创建了 stacking context，而 header 虽有 `backdrop-blur-sm` 但无显式 z-index。由于 header 在 DOM 中先于 body，body 区域（含 NodeConfigPanel）渲染在其上，导致 NodeSelector 的 `absolute z-50` 下拉菜单被 NodeConfigPanel 覆盖。

修复：header 加 `relative z-50`，使其 stacking context 高于 body。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅改前端，不涉及后端。 |
| C2 Zero-Fallback Errors | √ | 无图时直接用空图，非静默回退。 |
| C3 Responsiveness | √ | 不涉及。 |
| C4 AI UI Isolation | √ | 不涉及。 |
| C5 Mobile Frontend Independence | √ | 两端各自独立实现，零 UI 代码耦合；移动端不再从 `src/` 引用 migration.ts。 |
| C6 Project Cache Location | √ | 不涉及。 |
| C7 PC/Android Coverage | √ | 双端同步修复。 |

## 4. 验收记录

```
> npx tsc --noEmit -p tsconfig.json         (exit 0)
> npx tsc --noEmit -p tsconfig.mobile.json  (exit 0)
```

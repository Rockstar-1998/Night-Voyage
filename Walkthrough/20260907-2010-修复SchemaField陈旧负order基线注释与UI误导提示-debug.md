# 修复 SchemaField 陈旧负 order 基线注释与 UI 误导提示

## 1. 改动摘要

- `src/components/blueprint/nodes/SchemaFieldNode.tsx`：更新 PC 端 SchemaField 节点的 `order` 字段下方提示文案，删除已废弃的“核心基线字段 thinking/text 由执行器固定在前”的误导性说明，准确修正为“按 (order, 遍历序) 升序排序，数值越小越靠前；相同 order 按画布连线遍历序”。
- `src-mobile/components/blueprint/MobileNodeConfigForms.tsx`：同步更新移动端 SchemaField 节点的 `order` 字段下方提示文案，保持双端一致（C5 / C7）。
- `src-tauri/src/services/blueprint_executor.rs`：更新 `order_schema_properties` 函数文档注释，删除已废弃的“核心基线字段 thinking(-2) / text(-1) 永远排在作者自定义字段之前”，准确说明由作者配置的 order 与遍历序驱动，执行器不预设任何基线字段顺序。
- `src-tauri/src/models/blueprint.rs`：更新 `SchemaFieldConfig.order` 字段注释，删除执行器注入负 order 的陈旧说明。
- `src/lib/blueprint/types.ts`：更新共享前端类型 `SchemaFieldConfig.order` 的 TSDoc 注释。

## 2. 改动动机

- 用户在检查 JSON 回复体时发现 Schema 属性顺序不符合预期（`text` 叙事正文被排在了 `status_bar`、`todo_list` 等所有推演/状态字段之前）。
- 经深入排查：
  1. **人工配置（预设参数）原因**：在测试预设（如 `V2.1` / `V2.2`）中，`text` 节点的 `order` 被设为了 `-1`，而 `status_bar`（2）、`todo_list`（3）等均为正数。由于执行器按升序排序，`-1` 必然使 `text` 排在最前。
  2. **软件引导与文案 BUG**：早前代码库曾由执行器硬编码注入 `thinking(-2)` 和 `text(-1)`，后续虽然完全移除了越权注入、将排序控制权交还给蓝图作者，但前端双端 UI 输入框与后端注释残留了“核心基线字段 thinking/text 由执行器固定在前”的陈旧文案，误导了预设作者为 `text` 填写负数权重。
- 本次改动清理了代码与 UI 中的误导性提示，使用户与作者能明确理解排序规则并自由配置字段顺序。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅更新 UI 提示文本与类型注解，无业务计算侵入。 |
| C2 Zero-Fallback Errors | √ | 保持严格错误处理，无静默降级。 |
| C3 Responsiveness | √ | 无任何阻塞主线程操作。 |
| C4 AI UI Isolation | √ | 不涉及 AI UI 层。 |
| C5 Mobile Frontend Independence | √ | PC 与移动端表单分别独立维护与修改，无跨端引用。 |
| C6 Project Cache Location | √ | 无新增缓存。 |
| C7 PC/Android Coverage | √ | PC 端、移动端及后端数据契约同步更新覆盖。 |

## 4. 验收记录

- **前端检查**：
  - PC：`npx tsc --noEmit -p tsconfig.json` → 退出码 0，无任何类型错误。
  - 移动端：`npx tsc --noEmit -p tsconfig.mobile.json` → 退出码 0，无任何类型错误。
- **后端单测**：
  - `cargo test --manifest-path src-tauri/Cargo.toml -- services::blueprint_executor` → 32 passed; 0 failed。
- **双端全量编译**：
  - `scripts\build_dual_release.bat` → `✓ built in 6.09s`（PC 前端），`Finished release profile [optimized] in 2m 35s`，`Release build succeeded`。
- **预期效果**：
  - PC 与移动端蓝图编辑器的 SchemaField 节点配置面板中，order 提示文案准确清晰，不再包含“固定在前”的误导性描述。

## 5. 已知限制或后续待办

- 现有已保存的预设文件（如 `V2.2.nvpreset.json`）中的节点数据属于作者的配置资产，需由作者在蓝图画布中将 `text` 节点的 `order: -1` 更改为所需的目标权重（例如改为 7 以排在最后，或统一重置为 0 以遵循画布连线顺序）。

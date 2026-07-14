# Preset Blueprint 旧代码删除 Task 11 + Task 12

## 1. 改动摘要

本文件记录 spec `d:\data\Night Voyage\.trae\specs\preset-blueprint-editor\spec.md` 第四阶段（Phase 4）的旧代码删除工作：Task 11（删除旧前端代码）与 Task 12（删除旧后端代码）。

### Task 11：删除旧前端代码

**删除文件（5 个，均在 `src/components/`）：**

| 文件 | 说明 |
|------|------|
| `src/components/SchemaConfigPanel.tsx` | 旧 schema 字段编辑器（已迁移至 SchemaFieldNode） |
| `src/components/CompletionPresetArea.tsx` | 旧 preset 编辑器宿主 |
| `src/components/CompletionDetailModal.tsx` | 旧 block 编辑模态框 |
| `src/components/CompletionParametersPanel.tsx` | 旧 preset 设置面板 |
| `src/components/CompletionPreviewModal.tsx` | 旧编译预览模态框 |

**修改文件：**

- `src/App.tsx`
  - 删除 `import { CompletionPresetArea } from './components/CompletionPresetArea';`
  - 将死代码组件 `const DesktopView = (props: {...}) => {...}`（原 212-528 行，仅其 props 类型被 `AnimatedDesktopView` 引用）转换为 `type DesktopViewProps = {...}`，消除死组件定义。
  - `AnimatedDesktopView` 的 props 类型从 `Parameters<typeof DesktopView>[0]` 改为 `DesktopViewProps`。

- `src/components/MessageFormatRenderer.tsx`
  - 第 147 行注释更新：原引用已删除的 `SchemaConfigPanel`，改为 "falling back to their local toggle state."

### Task 12：删除旧后端代码

**修改文件：**

- `src-tauri/src/services/prompt_compiler.rs`（`compile_prompt` 函数）
  - **删除旧逻辑回退路径**：原 `if let Some(graph_str) = blueprint_graph_str { ... } else { 旧逻辑 }` 条件块。`blueprint_graph` 为空时不再回退到旧 blocks/structured_output_schema 读取。
  - **替换为显式错误**（C2 零回退）：使用 `ok_or_else` 在 `blueprint_graph` 缺失/空时返回显式错误信息 `"preset has no blueprint_graph; open preset in the blueprint editor to migrate. conversation_id={}"`。
  - **修复 `db_mappings` 未使用赋值警告**：原 `let mut db_mappings: HashMap<String, String> = HashMap::new();` 在第 653 行被 `db_mappings = blueprint_result.db_mappings;` 覆盖前从未读取。改为在赋值点直接 `let db_mappings: HashMap<String, String> = blueprint_result.db_mappings;`，删除多余的初始化。
  - **保留 `load_preset_compiler_data`**：该函数仍从 `preset_prompt_blocks` 表加载 `output_validators`（蓝图执行器不产出 output validators，见 spec 能力边界），故整体保留。

### 保留的代码（经调研确认必需）

| 代码 | 位置 | 保留原因 |
|------|------|----------|
| `PromptBlockKind` enum | `prompt_compiler.rs:84-127` | 动态内存层（WorldVariable/PlotSummary/RecentHistory/RetrievedDetail）仍使用 |
| `load_world_variable_block` | `prompt_compiler.rs` | 动态内存层，非蓝图可控能力 |
| `load_plot_summary_blocks` | `services/plot_summaries.rs` | 动态内存层，非蓝图可控能力 |
| `plot_summaries.rs` | `services/` | 整模块保留，PlotSummary 为动态内存层 |
| `load_preset_compiler_data` | `prompt_compiler.rs:1392-1595` | 产出 `output_validators`（蓝图不产出）；产出 `blueprint_graph` 字符串 |
| `preset_repository.rs` 旧字段读写 | `repositories/` | preset CRUD 命令仍接受 blocks/semantic_groups/structured_output_schema；前端迁移逻辑需读旧数据 |
| `preset_validator.rs` 语义组校验 | `validators/` | preset create/update 命令仍使用 |
| `BlueprintEditor.tsx` 迁移逻辑 | `src/components/blueprint/` | 读旧 blocks/semanticGroups/structuredOutputSchema 以执行 lazy migration |

## 2. 改动动机

蓝图编辑器（Task 1-10 + Task 13）已实现并集成：
- 8 种节点类型（Start/End/Prompt/SchemaField/MutexGate/GroupGate/ModeSwitch/SamplingParams）覆盖旧 preset 编辑器全部能力。
- `compile_prompt` 已改为调用 `execute_blueprint` 产出 blocks / structured_output_schema / sampling_params / db_mappings。
- `preset` 表已加 `blueprint_graph` 列（migration 0040），`message_rounds` 表已加 `plot_summary` 列（migration 0041）。
- 前端 `BlueprintEditor.tsx` 在打开 preset 时执行 lazy migration：若无 `blueprint_graph`，读旧 blocks/semanticGroups 并调用 `migrateToBlueprint` 生成图，回写后端。

旧代码（5 个前端组件 + 后端 fallback 路径）已无活跃引用，保留只会造成"双路径"困惑并违反 C2 零回退（旧 fallback 路径会静默回退到旧逻辑而非报错）。删除后：
- 前端只有蓝图编辑器一条 preset 编辑入口。
- 后端 `compile_prompt` 只有蓝图执行一条路径，无 `blueprint_graph` 时显式报错（C2 合规）。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端仅渲染 + 调 Tauri 命令，无业务逻辑变更 |
| C2 Zero-Fallback Errors | √ | 删除旧 fallback 路径正是为了 C2 合规：`blueprint_graph` 缺失时返回显式错误而非静默回退 |
| C3 Responsiveness | √ | 无热路径变更；`db_mappings` 警告修复减少无用分配 |
| C4 AI UI Isolation | √ | 不涉及 AI UI 层 |
| C5 Mobile Frontend Independence | √ | 删除的 5 个文件均在 `src/components/`；`src-mobile/` 无任何引用（已 grep 验证）；移动端无旧 preset 编辑器组件 |
| C6 Project Cache Location | √ | 不涉及缓存 |
| C7 PC/Android Coverage | √ | Task 11/12 仅涉及 PC 前端 + 后端；移动端蓝图编辑器已在 Task 13 完成，两端均有蓝图编辑入口 |

## 4. 验收记录

### 4.1 前端构建（PC）

**命令：** `npx tsc --noEmit`（在 `d:\data\Night Voyage` 下）

**实际输出：**（无输出，exit code 0）

```
(TraeAI-3) D:\data\Night Voyage [0:0] $ npx tsc --noEmit 2>&1 | Select-Object -First 80
(TraeAI-3) D:\data\Night Voyage [0:0] $
```

**预期效果：** 删除 5 个组件 + 修改 App.tsx 后无残留引用，TypeScript 编译无错误。
**实际结果：** ✅ 通过，无错误。

### 4.2 后端构建

**命令：** `cargo build`（在 `d:\data\Night Voyage\src-tauri` 下）

**实际输出：**

```
   Compiling night-voyage v0.1.0 (D:\data\Night Voyage\src-tauri)
warning: enum `NodeType` is never used
  --> src\models\blueprint.rs:12:10
warning: method `node_type` is never used
  --> src\models\blueprint.rs:44:12
warning: method `node_type` is never used
  --> src\models\blueprint.rs:79:12
warning: associated functions `load_one` and `delete_by_conversation` are never used
  --> src\repositories\conversation_gate_repository.rs:68:18
warning: variant `SchemaBuildError` is never constructed
  --> src\services\blueprint_executor.rs:54:5
warning: `night-voyage` (lib) generated 5 warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 1m 57s
```

**预期效果：** 删除 fallback 路径后后端编译通过。
**实际结果：** ✅ 通过，exit code 0。5 个警告均为预存 dead code（Task 1-10 引入），与本次 Task 11/12 删除无关：
- `NodeType` enum + `node_type` 方法（`models/blueprint.rs`）— 蓝图数据模型预留
- `load_one` / `delete_by_conversation`（`conversation_gate_repository.rs`）— Gate 仓库预留方法
- `SchemaBuildError`（`blueprint_executor.rs`）— 蓝图错误枚举预留变体

本次改动引入的 `db_mappings` unused assignment 警告已在二次构建前修复（改为赋值点直接 `let` 声明），二次构建无此警告。

### 4.3 DROP COLUMN 评估

**决策：不新增 DROP COLUMN migration。**

**原因：**

1. **`output_validators` 依赖旧表**：`load_preset_compiler_data` 从 `preset_prompt_blocks` 表加载 `output_validators`（`prompt_compiler.rs:1488`）。蓝图执行器不产出 output validators（spec 能力边界），故 `preset_prompt_blocks` 表不能删。

2. **CRUD 命令仍接受旧字段**：`presets_create` / `presets_update`（`commands/presets/mod.rs`）仍接受 `blocks` / `semantic_groups` / `structured_output_schema` 参数；`preset_repository.rs` 仍读写这些字段。

3. **前端迁移逻辑读旧数据**：`BlueprintEditor.tsx` 的 `buildLegacyPresetForMigration`（第 256-275 行）读 `detail.blocks` / `detail.preset.structuredOutputSchema` / `detail.semanticGroups` 以执行 lazy migration。删列会破坏未迁移 preset 的迁移路径。

4. **spec 迁移策略为 lazy migration**：旧数据须保留至每个 preset 被打开并迁移。DROP COLUMN 会强制一次性迁移，违反 spec。

结论：旧列/表（`presets.structured_output_schema`、`preset_prompt_blocks`、`preset_semantic_groups`、`preset_semantic_options`、`preset_semantic_option_blocks`）全部保留。

## 5. 已知限制或后续待办

1. **未迁移 preset 会显式报错**：`compile_prompt` 在 `blueprint_graph` 为空时返回错误 `"preset has no blueprint_graph; open preset in the blueprint editor to migrate."`。用户须先在蓝图编辑器中打开旧 preset 触发迁移，否则发送消息会失败。这是 C2 零回退的预期行为。

2. **5 个预存 dead-code 警告未清理**：`NodeType` / `node_type` / `load_one` / `delete_by_conversation` / `SchemaBuildError` 均为 Task 1-10 引入的预留代码，与本次删除无关，不在 Task 11/12 范围内。

3. **旧列/表保留**：`presets.structured_output_schema` 列、`preset_prompt_blocks` / `preset_semantic_groups` / `preset_semantic_options` / `preset_semantic_option_blocks` 表全部保留（见 §4.3）。未来若要清理，须先迁移所有 preset 并将 `output_validators` 迁移到蓝图节点或独立表。

4. **移动端无变更**：Task 11/12 不涉及 `src-mobile/`。移动端蓝图编辑器已在 Task 13 完成。

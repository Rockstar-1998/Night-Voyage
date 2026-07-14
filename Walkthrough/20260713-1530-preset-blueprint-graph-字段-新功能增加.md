# Preset 蓝图 blueprint_graph 字段（Task 4）

## 改动摘要

实现 preset-blueprint-editor spec 的 Task 4（preset 数据模型重构 — 第二阶段），为 Preset 新增 `blueprint_graph` 字段，保留所有旧字段（迁移期兼容）。

### 新建文件

| 文件 | 说明 |
|------|------|
| `src-tauri/migrations/0040_preset_blueprint_graph.sql` | presets 表新增 `blueprint_graph TEXT` 列 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/models/mod.rs` | `PresetSummary` 新增 `pub blueprint_graph: Option<String>` 字段（带 `#[doc]`） |
| `src-tauri/src/repositories/preset_repository.rs` | `list_all` / `find_by_id` SELECT 新增 `blueprint_graph` 列；`row_to_preset_summary` 解析新列；`create` 新增 `blueprint_graph: Option<&str>` 参数 + INSERT 列；`update` 新增参数 + `blueprint_graph = COALESCE(?, blueprint_graph)` 避免误清空 |
| `src-tauri/src/services/preset_service.rs` | `create` / `update` 新增 `blueprint_graph: Option<String>` 参数，normalize + validate 后透传到 repository；`PortablePresetMeta` 新增字段；`export` / `import` 透传 |
| `src-tauri/src/commands/presets/mod.rs` | `presets_create` / `presets_update` Tauri command 新增 `blueprint_graph: Option<String>` 参数（JS 侧 `blueprintGraph`），透传到 service |
| `src-tauri/src/validators/preset_validator.rs` | 新增 `pub fn validate_blueprint_graph(graph_json: &str) -> Result<(), String>` — 反序列化校验 BlueprintGraph，失败显式报错（C2 零回退），错误信息反斜杠替换为正斜杠 |

## 改动动机

spec `preset-blueprint-editor` Task 4：为 Preset 数据模型新增 `blueprint_graph` 字段，使后端能存储和读取蓝图编辑器产出的完整 BlueprintGraph JSON。这是 Task 5（prompt_compiler 集成图执行器）和 Task 6（stream_processor db_mappings 持久化）的前置依赖。

迁移期保留所有旧字段（blocks / structured_output_schema / semantic_groups / temperature 等），旧字段删除在 Task 12。

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅后端改动，前端不参与计算 |
| C2 Zero-Fallback Errors | √ | `validate_blueprint_graph` 反序列化失败显式返回 `Err`；repository 错误用 `map_err` 传播；无 unwrap/expect/静默回退 |
| C3 Responsiveness | √ | 所有 DB 操作（list_all / find_by_id / create / update）均为 `async`，在 transaction/pool 上执行 |
| C4 AI UI Isolation | √ | 不涉及 AI 动态 UI |
| C5 Mobile Frontend Independence | √ | 仅后端改动，双端通过同一 Tauri command 访问 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 后端 command 对双端统一开放，无单端后门 |

## 验收记录

### 构建命令

```bash
cd d:\data\Night Voyage\src-tauri && cargo build
```

### 构建输出（真实）

```
warning: night-voyage@0.1.0: [Night Voyage][build.rs] enter ts=1783922247
warning: night-voyage@0.1.0: [Night Voyage][build.rs] exit ts=1783922248
warning: enum `NodeType` is never used          → src/models/blueprint.rs:12 (Task 1，待 Task 5 接入)
warning: method `node_type` is never used       → src/models/blueprint.rs:44,79 (Task 1)
warning: struct `GateSelection` is never constructed → src/models/blueprint.rs:203 (Task 1)
warning: struct `BlueprintExecutionContext` is never constructed → src/models/blueprint.rs:212 (Task 1)
warning: struct `CompiledBlock` is never constructed → src/models/blueprint.rs:219 (Task 1)
warning: struct `CompiledSamplingParams` is never constructed → src/models/blueprint.rs:232 (Task 1)
warning: struct `BlueprintExecutionResult` is never constructed → src/models/blueprint.rs:246 (Task 1)
warning: associated functions `load_one` and `delete_by_conversation` are never used → src/repositories/conversation_gate_repository.rs:68,109 (Task 3)
warning: enum `BlueprintError` is never used    → src/services/blueprint_executor.rs:22 (Task 2)
warning: function `execute_blueprint` is never used → src/services/blueprint_executor.rs:96 (Task 2)
... (Task 2 blueprint_executor.rs 中其余未使用函数，均为待 Task 5 接入)
warning: `night-voyage` (lib) generated 22 warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 1m 48s
```

- 退出码：**0**（成功）
- 22 个 warning 全部来自 Task 1/2/3 的未接入代码（blueprint.rs / blueprint_executor.rs / conversation_gate_repository.rs），**本任务改动无任何 warning 或 error**

### 验收检查点

1. **迁移文件 0040**：`ALTER TABLE presets ADD COLUMN blueprint_graph TEXT;` — 编译时由 `sqlx::migrate!()` 嵌入
2. **PresetSummary 新增字段**：`blueprint_graph: Option<String>`，`#[serde(rename_all = "camelCase")]` → JS 侧 `blueprintGraph`
3. **PresetDetail**：通过 `preset: PresetSummary` 嵌套获得 `blueprint_graph`（`detail.preset.blueprintGraph`）
4. **repository INSERT**：新增 `blueprint_graph` 列 + `?` 占位 + `.bind(blueprint_graph)`
5. **repository UPDATE**：`blueprint_graph = COALESCE(?, blueprint_graph)` — 传 None 不覆盖已有蓝图
6. **repository SELECT**：`list_all` 和 `find_by_id` 均新增 `blueprint_graph` 列
7. **commands 透传**：`presets_create` / `presets_update` 新增 `blueprint_graph: Option<String>` 参数
8. **validator**：`validate_blueprint_graph` 反序列化为 `BlueprintGraph`，失败显式报错
9. **service 验证流程**：`create` / `update` 中 normalize 后调用 `validate_blueprint_graph`（使用 `.map().transpose()?` 组合子）
10. **export/import**：`PortablePresetMeta` 新增 `blueprint_graph`，导出导入透传（防数据丢失）

## 已知限制或后续待办

1. **UPDATE 无法清空 blueprint_graph**：`COALESCE(?, blueprint_graph)` 设计使得传 None = 不覆盖。若需清空蓝图，需传空字符串（但 `normalize_optional_text_impl` 会将空字符串转为 None）。这是迁移期的有意设计（避免误清空），Task 12 删除旧字段时可重新评估。
2. **prompt_compiler.rs 未改动**：仍从 presets 表直接读旧字段（temperature / structured_output_schema 等），未使用 `blueprint_graph`。Task 5 将改造 `compile_prompt` 调用图执行器。
3. **stream_processor.rs 未改动**：未实现 db_mappings 持久化。Task 6 将改造。
4. **前端未改动**：前端尚未调用 `blueprintGraph` 参数。Task 7+（蓝图编辑器 UI）将接入。
5. **旧字段全部保留**：blocks / structured_output_schema / semantic_groups / exclusive_group_key 等旧字段及其 validator / repository 读写全部保留。Task 12 删除。
6. **PortablePresetFile schema_version 未升级**：新增的 `blueprint_graph` 为 `Option`，旧导出文件反序列化为 None，向后兼容。

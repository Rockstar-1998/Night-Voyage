# compile_prompt 集成蓝图图执行器（Task 5）

## 改动摘要

实现 preset-blueprint-editor spec 的 Task 5（compile_prompt 重构 — 第二阶段），在 `compile_prompt` 中集成 `execute_blueprint` 图执行器。当 `preset.blueprint_graph` 存在且非空时，调用图执行器产出 blocks / structured_output_schema / sampling_params / db_mappings，替换旧字段读取结果；为 None 时沿用旧逻辑（迁移期兼容）。

### 修改文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/services/prompt_compiler.rs` | imports 新增 `HashMap` / `BlueprintGraph` / `BlueprintExecutionContext` / `CompiledBlock` / `GateSelection` / `execute_blueprint` / `ConversationGateRepository`；`LoadedPresetCompilerData` 新增 `blueprint_graph: Option<String>` 字段；`PromptCompileResult` 新增 `db_mappings: HashMap<String, String>` 字段；`load_preset_compiler_data` SELECT 新增 `blueprint_graph` 列并返回；`compile_prompt` 在加载 preset 后新增蓝图执行分支（构建 context → 调用 execute_blueprint → 转换 blocks/schema/sampling_params/db_mappings → 替换旧字段）；新增 3 个 helper 函数：`block_type_to_prompt_block_kind` / `compiled_block_to_prompt_block` / `apply_blueprint_sampling_params` |
| `src-tauri/src/services/provider_adapter.rs` | 测试辅助函数 `empty_result` 补 `db_mappings: HashMap::new()` 字段（PromptCompileResult 新增字段的下游同步） |

## 改动动机

spec `preset-blueprint-editor` Task 5：让 `compile_prompt` 在蓝图激活时调用后端图执行器获取编译数据，使蓝图成为 preset 的运行时权威数据源。

核心数据流：
```
preset.blueprint_graph (JSON)
  → serde_json::from_str → BlueprintGraph
  → execute_blueprint(graph, context)
  → BlueprintExecutionResult { blocks, structured_output_schema, sampling_params, db_mappings }
  → 转换 → PromptCompileResult { system_blocks, params, db_mappings, ... }
  → stream_processor (Task 6) 读 db_mappings 持久化
```

保守策略（迁移期）：
- 蓝图激活时：用 `execute_blueprint` 结果替换 preset_prompt_blocks 表加载的 blocks、structured_output_schema、sampling_params；db_mappings 从执行结果填入
- 蓝图为 None 时：沿用旧逻辑，`db_mappings` 为空 HashMap
- 旧 if/else 三模式分支**保留**（动态内存层 WorldVariable / PlotSummary / RecentHistory / RetrievedDetail 仍按 memory_mode 加载——这些不是蓝图可控能力，见 spec 能力边界）；Task 12 删除

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅后端改动，前端不参与计算 |
| C2 Zero-Fallback Errors | √ | `serde_json::from_str` 失败显式报错；`execute_blueprint` 失败显式报错；未知 `block_type` 显式报错；错误信息反斜杠替换为正斜杠；无 unwrap/expect/静默回退 |
| C3 Responsiveness | √ | 所有 DB 操作（gate_selections 加载、memory_mode 加载）和图执行均为 `async`，不阻塞 UI 线程 |
| C4 AI UI Isolation | √ | 不涉及 AI 动态 UI |
| C5 Mobile Frontend Independence | √ | 仅后端改动，双端通过同一 Tauri command 链路访问 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 后端 compile_prompt 对双端统一开放，无单端后门 |

## 验收记录

### 构建命令

```bash
cd d:\data\Night Voyage\src-tauri && cargo build
```

### 构建输出（真实）

```
warning: night-voyage@0.1.0: [Night Voyage][build.rs] enter ts=1783922247
warning: night-voyage@0.1.0: [Night Voyage][build.rs] exit ts=1783922248
   Compiling night-voyage v0.1.0 (D:\data\Night Voyage\src-tauri)
warning: enum `NodeType` is never used                     → src/models/blueprint.rs:12 (Task 1)
warning: method `node_type` is never used                  → src/models/blueprint.rs:44,79 (Task 1)
warning: associated functions `load_one` and `delete_by_conversation` are never used → src/repositories/conversation_gate_repository.rs:68,109 (Task 3)
warning: variant `SchemaBuildError` is never constructed   → src/services/blueprint_executor.rs:54 (Task 2)
warning: field `db_mappings` is never read                 → src/services/prompt_compiler.rs:384 (Task 6 将读取)
warning: `night-voyage` (lib) generated 6 warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 1m 16s
```

- 退出码：**0**（成功）
- 6 个 warning：5 个来自 Task 1/2/3 未接入代码，1 个 `db_mappings` never read 是预期（Task 6 stream_processor 将读取）；**本任务改动无 error**

### 验收检查点

1. **SubTask 5.1 读取 blueprint_graph**：`load_preset_compiler_data` SELECT 新增 `blueprint_graph` 列；`LoadedPresetCompilerData` 新增字段；`compile_prompt` 检查 `preset_compiler_data.blueprint_graph` 非空时进入蓝图分支
2. **SubTask 5.2 构建 BlueprintExecutionContext**：蓝图分支内调用 `load_memory_mode` + `ConversationGateRepository::load_by_conversation`，构建 `BlueprintExecutionContext { memory_mode, gate_selections }`
3. **SubTask 5.3 调用 execute_blueprint**：`serde_json::from_str` 解析 BlueprintGraph（失败显式报错）；`execute_blueprint(&graph, &context).await?` 调用图执行器
4. **SubTask 5.4 用执行结果继续编译**：
   - `result.blocks` → 通过 `compiled_block_to_prompt_block` 转换为 `Vec<PromptBlock>`，替换 `system_blocks`（保留 online 模式的 MultiplayerProtocol block）
   - `result.structured_output_schema` → `serde_json::to_string` 序列化为 String，塞入 `CompiledSamplingParams.structured_output_schema`
   - `result.sampling_params` → 通过 `apply_blueprint_sampling_params` 映射字段名（`max_tokens` → `max_output_tokens`，`stop` → `stop_sequences`），仅 `Some`/非空覆盖
5. **SubTask 5.5 三模式分支处理策略**：**保守策略**——蓝图激活时跳过 compile_prompt 内 Prompt block 层的 memory_mode 硬编码分支（由 ModeSwitch 节点决定）；动态内存层（WorldVariable / PlotSummary / RecentHistory / RetrievedDetail）仍按 memory_mode 加载（非蓝图可控能力）；旧 if/else 分支代码**保留**作为 fallback，Task 12 删除
6. **SubTask 5.6 db_mappings 字段**：`PromptCompileResult` 新增 `pub db_mappings: HashMap<String, String>` 字段；蓝图激活时从 `blueprint_result.db_mappings` 填入；蓝图为 None 时为空 HashMap；两处构造点（`prompt_compiler.rs` / `provider_adapter.rs` 测试）均补齐字段
7. **SubTask 5.7 cargo build**：退出码 0，6 warning（5 个 Task 1/2/3 预接入 + 1 个 Task 6 将读取），无 error

### block_type → PromptBlockKind 映射实现

`block_type_to_prompt_block_kind` 函数（prompt_compiler.rs L2399-2415）穷尽 match，未知 block_type 显式报错（C2）：

| block_type 字符串 | PromptBlockKind 变体 |
|-------------------|---------------------|
| `"system"` | `PresetRule` |
| `"character"` | `CharacterBase` |
| `"player"` | `PlayerBase` |
| `"world_book"` | `WorldBookMatch` |
| `"world_variable"` | `WorldVariable` |
| `"plot_summary"` | `PlotSummary` |
| `"recent_history"` | `RecentHistory` |
| `"current_user"` | `CurrentUser` |
| `"multiplayer_protocol"` | `MultiplayerProtocol` |
| `"retrieved_detail"` | `RetrievedDetail` |
| 其他 | `Err("blueprint block_type \`{block_type}\` is not a known PromptBlockKind")` |

## 已知限制或后续待办

1. **`db_mappings` 字段 never read warning**：Task 6（stream_processor 改造）将读取此字段实现 db_mapping 持久化（world_variables / plot_summary 写入 message_rounds）。当前 warning 是预期。
2. **旧三模式 if/else 分支保留**：compile_prompt 内基于 memory_mode 的 WorldVariable / PlotSummary / RecentHistory / RetrievedDetail 加载分支**未删除**。这些是动态内存层，不属于蓝图可控能力（spec 能力边界：世界书触发 ❌、MEM0 检索 ⏸ 待讨论）。Task 12 删除旧逻辑时再评估。
3. **stream_processor.rs 未改动**：Task 6 将改造 `spawn_post_round_tasks`，从 `PromptCompileResult.db_mappings` 提取需持久化字段写入 `message_rounds`。
4. **未删除 TODO 注释**：prompt_compiler.rs L85 的 WorldVariable TODO 注释保留（Task 6 处理）。
5. **MultiplayerProtocol block 保留策略**：蓝图激活时，online 模式注入的 MultiplayerProtocol block 不被蓝图 blocks 替换（蓝图不控制多人协议，见 spec 能力边界）。实现方式：先取出 MultiplayerProtocol block，替换 system_blocks 后再放回。
6. **蓝图 sampling_params 仅覆盖非 None 字段**：`apply_blueprint_sampling_params` 仅当蓝图字段为 `Some`/非空时覆盖旧字段。若蓝图无 SamplingParams 节点，旧字段（preset 表的 temperature / max_output_tokens / stop_sequences 等）保留。蓝图未覆盖的字段（thinking_enabled / beta_features / response_mode / context_included_keys / structured_output_display / top_k）始终来自 preset 表。

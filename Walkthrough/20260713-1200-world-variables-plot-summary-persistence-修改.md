# Walkthrough: 世界变量 + PlotSummary 持久化（Task 6）

## 1. 改动摘要

### 修改文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/services/stream_processor.rs` | 新增 db_mappings 持久化路径；删除 2 处 TODO；扩展 stream_llm_response 返回类型 |
| `src-tauri/src/services/prompt_compiler.rs` | 删除 1 处过时 TODO 注释 |

### 改动详情

#### stream_processor.rs

1. **`stream_llm_response` 返回类型扩展**（L476）：
   - `Result<StreamResponseData, String>` → `Result<(StreamResponseData, HashMap<String, String>), String>`
   - 末尾 `stream_result.map(|data| (data, compiled_prompt.db_mappings.clone()))` 将蓝图产出的 db_mappings 传出

2. **`spawn_stream_task` 重试循环 Ok 分支**（L297）：
   - `Ok(data)` → `Ok((data, db_mappings))`
   - 调用 `spawn_post_round_tasks` 时传入 `&db_mappings` 和 `&data.full_content`

3. **`spawn_post_round_tasks` 签名扩展**（L334）：
   - 新增 `db_mappings: &HashMap<String, String>` 和 `structured_content: &str` 参数
   - 在三模式 match 之前新增 db_mappings 持久化步骤（mode-independent）

4. **新增 `persist_db_mapping_fields` 函数**（L418）：
   - 解析 structured_content 为 JSON
   - 遍历 db_mappings，对每个 (field_name, db_column)：
     - 验证 db_column 在安全白名单内（防 SQL 注入）
     - 从 JSON 提取 field_name 对应值
     - 序列化后 `UPDATE message_rounds SET {column} = ? WHERE id = ?`
   - 空 db_mappings 为 no-op（兼容旧 preset）
   - 错误显式传播（`?` + `map_err`），C2 合规

5. **新增 `is_valid_message_rounds_column` 函数**（L472）：
   - 安全白名单：仅允许 `"world_variables"` 列名
   - 防止动态列名 SQL 注入（列标识符无法参数化）

6. **删除 2 处 TODO**：
   - legacy 分支：`// TODO: spawn_world_variable_generation_task (preset-gated)`
   - stateless 分支：`// TODO: spawn_world_variable_generation_task (preset-gated)`
   - 保留 stateless 分支说明性注释：`// Stateless: only world variable generation (preset-gated).`

#### prompt_compiler.rs

7. **删除 1 处 TODO**（原 L90）：
   - `// TODO: WorldVariable layer is not yet implemented. PlotSummary layer already covers its functionality to some extent.`
   - `load_world_variable_block` 已实现（L2242），TODO 过时

## 2. 改动动机

### 解决的问题

spec `preset-blueprint-editor` Task 6：实现世界变量 + PlotSummary 的即时持久化。

蓝图 SchemaField 节点通过 `db_mapping` 声明字段持久化映射。Task 5 已在 `PromptCompileResult` 中新增 `db_mappings: HashMap<String, String>` 字段，由 `execute_blueprint` 产出。本任务在 stream_processor 解析 structured_output 后，查 db_mappings 提取需要持久化的字段值，写入 message_rounds 对应列。

### 数据流

```
[蓝图] SchemaField(field_name="world_variables", db_mapping="world_variables")
    ↓ 图执行器产出
[compile_prompt] schema 含 world_variables + db_mappings 记录
    ↓ PromptCompileResult.db_mappings 传出
[AI 输出] structured_output 含 world_variables 值
    ↓ stream_llm_response 返回 (StreamResponseData, db_mappings)
[spawn_post_round_tasks] persist_db_mapping_fields 查 db_mappings
    ↓ 提取 world_variables → UPDATE message_rounds.world_variables
[下一轮] load_world_variable_block 读取 → 注入 prompt
```

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 改动仅在 Rust 后端，前端无变更 |
| C2 Zero-Fallback Errors | √ | db_mappings 提取失败显式报错（map_err + ?）；空 db_mappings 为 no-op 不是回退（旧 preset 无蓝图时本来就无持久化需求）；unsupported db_column 返回显式错误而非静默跳过 |
| C3 Responsiveness | √ | 所有 DB 操作异步（sqlx::query().await）；persist_db_mapping_fields 是 async fn |
| C4 AI UI Isolation | √ | 不涉及 AI 渲染层 |
| C5 Mobile Frontend Independence | √ | 不涉及前端，双端共享同一 Rust 后端 |
| C6 Project Cache Location | √ | 无缓存写入 |
| C7 PC/Android Coverage | √ | 后端命令双端共享，无单端后门 |

## 4. 验收记录

### 构建命令

```bash
cd d:\data\Night Voyage\src-tauri ; cargo build
```

### 构建输出（真实）

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
    Finished `dev` profile [optimized + debuginfo] target(s) in 58.41s
```

- 退出码：0（成功）
- 5 条 warning 均为预存 dead_code 警告（blueprint.rs / conversation_gate_repository.rs / blueprint_executor.rs），与本次改动无关
- 本次修改的 stream_processor.rs 和 prompt_compiler.rs 无任何新警告

### 验收方式

1. 蓝图激活的 preset 对话：AI 输出 structured_output 含 world_variables 字段 → 检查 message_rounds.world_variables 是否被写入
2. 旧 preset（无 blueprint_graph）对话：db_mappings 为空 → persist_db_mapping_fields 为 no-op，不影响现有流程
3. 下一轮对话：load_world_variable_block 读取 message_rounds.world_variables → 注入 prompt

### 预期效果

- world_variables 即时持久化生效（替换原 TODO 中的 spawn_world_variable_generation_task）
- plot_summaries.rs 批量处理逻辑不变（保留 pending/ready/completed 状态机）
- 三模式分支保留（spawn_post_round_tasks 的 mem0/legacy/stateless match 不变）

## 5. 已知限制或后续待办

### message_rounds.plot_summary 列缺失（阻塞 SubTask 6.3 完整实现）

- **风险点**：spec 要求 `db_mapping="plot_summary"` 时写入 `message_rounds.plot_summary`，但该列在数据库中不存在（仅 `message_rounds.world_variables` 存在，migration 0036）。PlotSummary 当前存储在独立的 `plot_summaries` 表中（migration 0013）。
- **影响范围**：若蓝图配置了 `SchemaField(field_name="plot_summary", db_mapping="plot_summary")`，`persist_db_mapping_fields` 会返回显式错误（C2 合规，不静默跳过），错误信息提示需要 DB migration 添加列。plot_summaries.rs 的批量处理逻辑不受影响，继续独立运行。
- **建议的修正方向**：新增 migration `ALTER TABLE message_rounds ADD COLUMN plot_summary TEXT;`，然后将 `is_valid_message_rounds_column` 白名单扩展为 `matches!(column, "world_variables" | "plot_summary")`。该 migration 未在本任务中添加，因为任务约束限定"只修改 stream_processor.rs 和 prompt_compiler.rs"。

### 其他待办

- db_mappings 持久化错误目前通过 `dbg_eprintln!` 记录（与 spawn_post_round_tasks 现有错误处理模式一致）。未来可考虑通过 Tauri event 将持久化失败上报前端 UI。
- `persist_db_mapping_fields` 在 structured_content 非 JSON 时返回错误。这在 db_mappings 非空但 response_mode 非 structured_json 时触发（蓝图配置错误），错误是显式的（C2 合规）。

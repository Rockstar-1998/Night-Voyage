# 对话预设蓝图编辑器 Spec（v2 — 运行时执行架构）

## Why

当前 preset 系统有三个结构性问题：

1. **编辑分散**：blocks 表单、schema 编辑器、semanticGroups 配置、采样参数面板各自独立，用户看不到整体 prompt 结构
2. **后端硬编码模式分支**：compile\_prompt 里三模式（无状态/传统/MEM0）分支是硬编码 if/else，用户无法配置"同一预设在不同模式下走不同流程"
3. **运行时不可控**：后端不按 semanticGroups 裁剪 schema，PlotSummary / 世界变量持久化 / 采样参数都分散在不同代码路径

用户要一个**可视化蓝图编辑器**作为 preset 的唯一编辑入口，从 Start 开始连线，用节点图表达完整的 prompt 编译流程——包括模式分支、提示词片段、schema 字段、采样参数、db 字段映射。后端**运行时执行**蓝图，产出 compile\_prompt 所需的全部数据。

## 核心设计决策（v2 修订）

| 决策点         | v1 方案                                | **v2 方案**                      | 修订理由                       |
| ----------- | ------------------------------------ | ------------------------------ | -------------------------- |
| 执行模型        | 编辑时编译（前端）                            | **运行时执行（后端图执行器）**              | 支持三模式分支，同一预设运行时根据会话模式走不同路径 |
| 分支系统        | 无（Gate 只有编辑时选择）                      | **ModeSwitch 节点**（运行时三路分支）     | 同一预设支持不同模式                 |
| 旧代码         | 兼容保留 SchemaConfigPanel               | **全删 + 迁移**                    | 不留隐患                       |
| PlotSummary | 后端硬编码                                | **SchemaField + db\_mapping**  | 通过 schema 控制，映射到 db 字段     |
| 世界变量持久化     | 后端硬编码 TODO                           | **SchemaField + db\_mapping**  | 同上                         |
| 采样参数        | 表单配置                                 | **SamplingParams 节点**          | 纳入蓝图统一编排                   |
| preset 数据模型 | 保留 blocks/schema/semantic\_groups 字段 | **只保留 blueprint\_graph + 元数据** | 运行时产出一切，消除冗余               |
| MEM0 检索     | —                                    | **待讨论，暂不纳入**                   | 用户要求单独讨论                   |

## What Changes

* **新增**蓝图编辑器（PC `src/components/blueprint/` + 移动端 `src-mobile/components/blueprint/`，C5 双端独立）

* **新增**后端图执行器 `services/blueprint_executor.rs`（运行时遍历节点图，产出 blocks + schema + sampling\_params + db\_mappings）

* **新增** 8 种节点类型（Start / End / Prompt / SchemaField / MutexGate / GroupGate / ModeSwitch / SamplingParams）

* **重构** compile\_prompt：改为调用图执行器获取编译数据，删除硬编码三模式分支

* **删除** SchemaConfigPanel.tsx 及相关旧编辑 UI（代码迁移进蓝图编辑器后删除）

* **删除** preset 表的 blocks / structured\_output\_schema / semantic\_groups / exclusive\_group 字段（运行时由图执行器产出）

* **解决** 3 处 Rust TODO（world\_variables 通过 SchemaField + db\_mapping 实现）

* **迁移**旧 preset 自动转为蓝图（前端加载时检测 + 迁移 + 保存）

## 能力边界

蓝图**覆盖 preset 可控的全部**，参考 [能力与模式一览表](file:///d:/data/Night%20Voyage/能力与模式一览表.md)：

| 能力                            | 蓝图覆盖  | 节点类型                                        |
| ----------------------------- | ----- | ------------------------------------------- |
| 预设提示词片段                       | ✅     | Prompt                                      |
| structured\_output\_schema 组装 | ✅     | SchemaField                                 |
| 语义选项单选/多选                     | ✅     | MutexGate / GroupGate                       |
| 条目锁                           | ✅     | 节点 is\_locked                               |
| 三模式分支（无状态/传统/MEM0）            | ✅     | ModeSwitch                                  |
| 采样参数（temperature 等）           | ✅     | SamplingParams                              |
| 世界变量 schema + 持久化             | ✅     | SchemaField(db\_mapping="world\_variables") |
| PlotSummary schema + 持久化      | ✅     | SchemaField(db\_mapping="plot\_summary")    |
| MEM0 记忆检索控制                   | ⏸ 待讨论 | 暂不纳入                                        |
| 世界书触发                         | ❌     | 后端 WorldBook 逻辑不变                           |
| 多人协议                          | ❌     | 后端 network 不变                               |

***

## ADDED Requirements

### Requirement: 蓝图节点类型清单（8 种）

| 节点类型           | 标识                | 输入 | 输出 | 可锁定 | 说明                           |
| -------------- | ----------------- | -- | -- | --- | ---------------------------- |
| Start          | `start`           | 0  | 1  | 否   | 链表起点，每图唯一                    |
| End            | `end`             | 1  | 0  | 否   | 链表终点，每图唯一                    |
| Prompt         | `prompt`          | 1  | 1  | 是   | 提示词片段 → block                |
| SchemaField    | `schema_field`    | 1  | 1  | 是   | schema 字段，可选 db\_mapping     |
| MutexGate      | `mutex_gate`      | 1  | N  | 否   | 互斥组，单选                       |
| GroupGate      | `group_gate`      | 1  | N  | 否   | 普通组，多选                       |
| ModeSwitch     | `mode_switch`     | 1  | 3  | 否   | 三模式分支（legacy/mem0/stateless） |
| SamplingParams | `sampling_params` | 1  | 1  | 是   | 采样参数设置                       |

#### Start / End 节点

* 配置：无

* 约束：每图唯一

#### Prompt 节点

* 配置：

  * `identifier: string` — block 标识

  * `block_type: string` — block 类型（system / character / world\_book / plot\_summary / world\_variable / recent\_history / current\_user / etc.，对应 PromptBlockKind）

  * `content: string` — 提示词内容

  * `priority: int | null` — block 优先级（可选，默认按 block\_type 的预设优先级）

  * `is_locked: bool` — 条目锁

  * `lock_reason: string | null`

* 编译产出：追加到 blocks 列表

#### SchemaField 节点

* 配置：

  * `field_name: string` — schema property 名（content / thinking / choices / world\_variables / plot\_summary / ...）

  * `field_type: string` — JSON Schema 类型（string / object / array / number / boolean）

  * `description: string` — 字段描述

  * `sub_schema: object | null` — 子结构（object/array 时定义 properties/items）

  * `db_mapping: string | null` — **db 字段映射**（"world\_variables" → message\_rounds.world\_variables；"plot\_summary" → message\_rounds.plot\_summary；null → 普通字段不持久化）

  * `is_locked: bool`

  * `lock_reason: string | null`

* 编译产出：

  * 追加到 structured\_output\_schema.properties

  * 若 db\_mapping 非空，追加到 db\_mappings 列表（供 stream\_processor 提取持久化）

#### MutexGate 节点（互斥组，单选）

* 配置：

  * `gate_id: string` — 唯一标识

  * `label: string` — 显示名

  * `options: [{key, label}]` — 选项列表

  * `selected: string` — 运行时选中的 option key

* 端口：`in` × 1, `out_{key}` × N

* 编译行为：运行时只走 selected 对应的子链表

* **selected 来源**：会话级运行时状态（用户在对话中可切换），图执行器读取会话的 gate 选择状态

#### GroupGate 节点（普通组，多选）

* 配置：同 MutexGate，但 `selected: string[]`

* 编译行为：运行时走所有 selected 的子链表，按 options 顺序

#### ModeSwitch 节点（三模式分支）

* 配置：

  * `label: string` — 显示名

* 端口：`in` × 1, `out_legacy` × 1, `out_mem0` × 1, `out_stateless` × 1

* 编译行为：运行时根据会话的 `memory_mode` 走对应出口

* 用途：同一预设支持不同模式，每条分支可连不同的 Prompt / SchemaField 子链表

* 约束：三个出口都必须连通（每条分支必须有至少一个节点到汇聚点）

#### SamplingParams 节点（采样参数）

* 配置：

  * `temperature: float | null`

  * `max_tokens: int | null`

  * `top_p: float | null`

  * `frequency_penalty: float | null`

  * `presence_penalty: float | null`

  * `stop: string[] | null`

  * `is_locked: bool`

* 编译产出：合并到 sampling\_params（多个 SamplingParams 节点时后者覆盖前者）

***

### Requirement: 端口规范与连线规则

#### 端口命名

* 单端口节点：`in` / `out`

* Gate 节点：`in` + `out_{option_key}` × N

* ModeSwitch：`in` + `out_legacy` + `out_mem0` + `out_stateless`

#### 连线规则

1. 连线方向：output → input，不可反向
2. 扇出：一个 output 可连多条线
3. 汇聚（集线器）：一个 input 可接多条线（Gate/ModeSwitch 子链表末尾汇聚）
4. 禁止环路：DFS 检测
5. Start 唯一出度
6. Gate/ModeSwitch 子链表汇聚：所有分支的尾节点汇聚到同一下游 input

#### 锁定节点约束

* is\_locked=true：内容只读 + 入出连线不可断开/重连 + 不可删除

* 锁定节点不能被 Gate/ModeSwitch 跳过（编译时验证：所有分支路径都必须经过锁定节点，或锁定节点不在任何 Gate/ModeSwitch 下游）

***

### Requirement: 序列化格式

```json
{
  "version": 2,
  "nodes": [
    { "id": "n_start", "type": "start", "position": {"x":0,"y":300} },
    {
      "id": "n_role", "type": "prompt", "position": {"x":200,"y":300},
      "config": {
        "identifier": "role_definition",
        "block_type": "system",
        "content": "你是角色扮演故事叙述者……",
        "priority": null,
        "is_locked": true,
        "lock_reason": "核心角色定义不可改"
      }
    },
    {
      "id": "n_mode", "type": "mode_switch", "position": {"x":400,"y":300},
      "config": { "label": "记忆模式分支" }
    },
    {
      "id": "n_thinking", "type": "schema_field", "position": {"x":700,"y":200},
      "config": {
        "field_name": "thinking", "field_type": "string",
        "description": "AI 内心思考", "sub_schema": null,
        "db_mapping": null, "is_locked": false, "lock_reason": null
      }
    },
    {
      "id": "n_wv", "type": "schema_field", "position": {"x":900,"y":200},
      "config": {
        "field_name": "world_variables", "field_type": "object",
        "description": "当前世界状态",
        "sub_schema": { "properties": {"location":{"type":"string"}, "mood":{"type":"string"}} },
        "db_mapping": "world_variables",
        "is_locked": false, "lock_reason": null
      }
    },
    {
      "id": "n_params", "type": "sampling_params", "position": {"x":1100,"y":300},
      "config": { "temperature": 0.8, "max_tokens": 4096, "top_p": 0.95,
                  "frequency_penalty": null, "presence_penalty": null, "stop": null,
                  "is_locked": false }
    },
    { "id": "n_end", "type": "end", "position": {"x":1300,"y":300} }
  ],
  "edges": [
    {"id":"e1","source":"n_start","source_port":"out","target":"n_role","target_port":"in"},
    {"id":"e2","source":"n_role","source_port":"out","target":"n_mode","target_port":"in"},
    {"id":"e3","source":"n_mode","source_port":"out_legacy","target":"n_thinking","target_port":"in"},
    {"id":"e4","source":"n_mode","source_port":"out_mem0","target":"n_thinking","target_port":"in"},
    {"id":"e5","source":"n_mode","source_port":"out_stateless","target":"n_thinking","target_port":"in"},
    {"id":"e6","source":"n_thinking","source_port":"out","target":"n_wv","target_port":"in"},
    {"id":"e7","source":"n_wv","source_port":"out","target":"n_params","target_port":"in"},
    {"id":"e8","source":"n_params","source_port":"out","target":"n_end","target_port":"in"}
  ]
}
```

#### 字段说明

* `version`: 2（v2 运行时执行架构）

* `nodes[]`: 节点数组（id / type / position / config）

* `edges[]`: 连线数组（id / source / source\_port / target / target\_port）

* position 仅编辑器用，执行器忽略

***

### Requirement: 后端图执行器

系统 SHALL 在 `services/blueprint_executor.rs` 实现运行时图执行器。

#### 执行器接口

```rust
pub struct BlueprintExecutionContext {
    pub memory_mode: String,           // "legacy" | "mem0" | "stateless"
    pub gate_selections: HashMap<String, GateSelection>,  // gate_id → selected keys
}

pub struct BlueprintExecutionResult {
    pub blocks: Vec<CompiledBlock>,
    pub structured_output_schema: serde_json::Value,
    pub sampling_params: CompiledSamplingParams,
    pub db_mappings: HashMap<String, String>,  // field_name → db_column
}

pub async fn execute_blueprint(
    graph: &BlueprintGraph,
    context: &BlueprintExecutionContext,
) -> Result<BlueprintExecutionResult, BlueprintError>;
```

#### 执行算法（DFS 遍历）

```
execute_blueprint(graph, context):
    result = { blocks: [], schema: {type:object, properties:{}}, sampling_params: {}, db_mappings: {} }
    start_node = find_start(graph)
    traverse(graph, start_node, context, result)
    return result

traverse(graph, node, context, result):
    if node.type == "end": return

    if node.type == "prompt":
        result.blocks.push(compile_block(node.config))
        traverse(graph, next_node(graph, node), context, result)

    if node.type == "schema_field":
        result.schema.properties[node.config.field_name] = build_property_schema(node.config)
        if node.config.db_mapping:
            result.db_mappings[node.config.field_name] = node.config.db_mapping
        traverse(graph, next_node(graph, node), context, result)

    if node.type == "mutex_gate":
        selected = context.gate_selections[node.config.gate_id].single()
        traverse(graph, target_of(graph, node, "out_"+selected), context, result)
        // 子链表遍历完后继续汇聚点
        traverse(graph, merge_node(graph, node), context, result)

    if node.type == "group_gate":
        for key in context.gate_selections[node.config.gate_id].multiple():
            traverse(graph, target_of(graph, node, "out_"+key), context, result)
        traverse(graph, merge_node(graph, node), context, result)

    if node.type == "mode_switch":
        branch = context.memory_mode  // "legacy" | "mem0" | "stateless"
        traverse(graph, target_of(graph, node, "out_"+branch), context, result)
        traverse(graph, merge_node(graph, node), context, result)

    if node.type == "sampling_params":
        result.sampling_params.merge(node.config)
        traverse(graph, next_node(graph, node), context, result)
```

#### compile\_prompt 集成

```rust
// prompt_compiler.rs 改造
pub async fn compile_prompt(...) -> Result<CompiledPrompt, CompileError> {
    let preset = load_preset(...).await?;
    let graph: BlueprintGraph = serde_json::from_str(&preset.blueprint_graph)?;
    let context = BlueprintExecutionContext {
        memory_mode: conversation.memory_mode,
        gate_selections: load_gate_selections(conversation.id).await?,
    };
    let result = execute_blueprint(&graph, &context).await?;
    // 用 result.blocks / result.schema / result.sampling_params 继续编译
    // 删除原有的三模式 if/else 硬编码分支
}
```

#### 后端零前端依赖

* 图执行器是纯 Rust 模块，不依赖前端

* 蓝图 JSON 反序列化为 Rust 结构体（BlueprintGraph）

* 执行器产出 Rust 结构体，直接用于 compile\_prompt

***

### Requirement: Gate 选择状态存储

MutexGate / GroupGate 的 `selected` 是运行时状态，需持久化到会话级。

#### 数据模型

* 新增 `conversation_gate_selections` 表：

  ```sql
  CREATE TABLE conversation_gate_selections (
      conversation_id INTEGER NOT NULL,
      gate_id TEXT NOT NULL,
      selected_keys TEXT NOT NULL,  -- JSON array of strings
      PRIMARY KEY (conversation_id, gate_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
  ```

* 用户在对话中切换 Gate 选项时，更新此表

* 图执行器读取此表填充 `gate_selections`

#### ModeSwitch 不需要选择状态

* ModeSwitch 的分支由 `conversation.memory_mode` 决定，不是用户运行时切换的

* memory\_mode 是会话级配置（已有字段），图执行器直接读取

***

### Requirement: 世界变量 + PlotSummary 持久化（解决 3 处 TODO）

通过 SchemaField 的 `db_mapping` 实现，不再需要独立的 spawn 任务。

#### 数据流

```
[蓝图] SchemaField(field_name="world_variables", db_mapping="world_variables")
    ↓ 图执行器产出
[compile_prompt] schema 包含 world_variables 字段 + db_mappings 记录
    ↓
[AI 输出] structured_output 含 world_variables 值
    ↓
[stream_processor] 解析 structured_output → 查 db_mappings → 提取 world_variables
    ↓
[持久化] 写入 message_rounds.world_variables
    ↓
[下一轮] load_world_variable_block 读取 → 注入 prompt
```

#### TODO 解决

| TODO                                   | 位置                                                                                                         | 解决方式                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| WorldVariable layer                    | [prompt\_compiler.rs:85](file:///d:/data/Night%20Voyage/src-tauri/src/services/prompt_compiler.rs#L85)     | load\_world\_variable\_block 已实现，删除 TODO 注释；schema 由图执行器产出      |
| legacy 分支 world variable generation    | [stream\_processor.rs:378](file:///d:/data/Night%20Voyage/src-tauri/src/services/stream_processor.rs#L378) | 删除 TODO，改为查 db\_mappings 提取 world\_variables 写入 message\_rounds |
| stateless 分支 world variable generation | [stream\_processor.rs:382](file:///d:/data/Night%20Voyage/src-tauri/src/services/stream_processor.rs#L382) | 同上                                                              |

#### stream\_processor 改造

* structured\_output 解析完成后，从 compile\_prompt 传来的 db\_mappings 查找需要持久化的字段

* 提取对应字段值，写入 message\_rounds 的对应列（world\_variables / plot\_summary）

* 删除 spawn\_world\_variable\_generation\_task 的 TODO（不需要独立任务，AI 在正文输出时顺带产出）

#### PlotSummary 特殊处理

* PlotSummary 在 legacy 模式下有独立的批量处理逻辑（[plot\_summaries.rs](file:///d:/data/Night%20Voyage/src-tauri/src/services/plot_summaries.rs)）

* db\_mapping="plot\_summary" 时，AI 输出的 plot\_summary 字段值写入 message\_rounds.plot\_summary

* 现有的 plot\_summary 批量处理 / pending 状态机是否保留？**保留**——蓝图只控制 schema 字段 + 持久化映射，plot\_summary 的批量处理逻辑（pending/ready/completed 状态机）不变

***

### Requirement: 条目锁扩展

扩展现有 `is_locked` 语义。

#### 现有语义（保留）

* 锁定 block 不被后端 normalize

#### 新增语义（蓝图编辑器内）

* 锁定节点配置面板只读

* 锁定节点入出连线不可断开/重连

* 锁定节点不可删除

* 锁定节点不能被 Gate/ModeSwitch 跳过（所有运行时分支路径都必须经过锁定节点，或锁定节点不在分支下游）

***

### Requirement: preset 数据模型重构

#### 删除字段（旧字段全删）

* `blocks` — 运行时由图执行器产出

* `structured_output_schema` — 运行时由图执行器产出

* `semantic_groups` — 被 Gate 节点替代

* `exclusive_group_key` / `exclusive_group_label`（在 block 级）— 被 MutexGate 节点替代

* 其他与旧编辑器相关的字段

#### 保留字段

* `id` / `name` / `description` / `created_at` / `updated_at` — 元数据

* `blueprint_graph` — **唯一真相源**（TEXT，存 JSON）

* `memory_mode` 默认值（可选，作为新会话的初始模式）

#### 数据库迁移

```sql
-- 1. 新增 blueprint_graph（若 v1 未加）
ALTER TABLE presets ADD COLUMN blueprint_graph TEXT;

-- 2. 删除旧字段（确认迁移完成后执行）
ALTER TABLE presets DROP COLUMN blocks;
ALTER TABLE presets DROP COLUMN structured_output_schema;
ALTER TABLE presets DROP COLUMN semantic_groups;
-- 其他旧字段...
```

***

### Requirement: 旧代码删除清单

#### 前端删除

* `src/components/SchemaConfigPanel.tsx` — 代码迁移进蓝图编辑器后删除

* `src/components/preset/` 下的旧 blocks 编辑组件 — 删除

* `src/components/preset/` 下的 semanticGroups 配置组件 — 删除

* `src-mobile/components/` 下对应的旧编辑组件 — 删除

#### 后端删除

* `validators/preset_validator.rs` 中 semantic\_groups / exclusive\_group 验证逻辑 — 删除（被蓝图节点验证替代）

* `repositories/preset_repository.rs` 中 blocks / structured\_output\_schema / semantic\_groups 的读写 — 删除

* `models/mod.rs` 中 PresetBlock / SemanticGroup 等旧结构体 — **保留**（图执行器产出这些结构体供 compile\_prompt 使用，但不再从 DB 读取）

* `prompt_compiler.rs` 中三模式硬编码 if/else 分支 — 删除（由 ModeSwitch 节点替代）

#### 保留

* `PromptBlockKind` 枚举 — 保留（图执行器产出的 block 仍用此枚举）

* `load_world_variable_block` / `load_plot_summary_blocks` — 保留（这些是运行时读取已持久化数据的逻辑，不受蓝图影响）

* `plot_summaries.rs` 的批量处理状态机 — 保留

***

### Requirement: 迁移策略

#### 自动迁移（旧 preset → 蓝图）

* 前端加载 preset 时，若无 `blueprint_graph` 但有旧 `blocks` + `structured_output_schema`，执行迁移

* 迁移规则：

  * blocks 按 priority 排序 → Prompt 节点链

  * schema properties → SchemaField 节点（db\_mapping 根据字段名推断：world\_variables→"world\_variables"，plot\_summary→"plot\_summary"，其余→null）

  * 同 exclusive\_group\_key 的 block → MutexGate 节点

  * semanticGroups multiple → GroupGate 节点

  * 采样参数 → SamplingParams 节点

  * 添加 ModeSwitch 节点（三出口都连到同一后续链表，因为旧 preset 不区分模式）

* 迁移后自动保存 blueprint\_graph

* 迁移失败时保留旧数据，提示用户手动处理

#### 迁移时机

* 前端加载 preset 列表时检测

* 或：后端启动时批量迁移（但用户倾向前端按需迁移，降低后端复杂度）

***

### Requirement: 蓝图编辑器 UI（含旧编辑器代码迁移）

#### 编辑器结构

* `BlueprintEditor.tsx` — 主组件（画布 + 工具栏 + 配置面板）

* `BlueprintCanvas.tsx` — 节点图画布（SVG/Canvas，拖拽/连线/缩放）

* `nodes/` — 8 种节点组件

* `NodeConfigPanel.tsx` — 节点配置面板

* `NodeSelector.tsx` — **原 SchemaConfigPanel 退化的选择器**（从列表选要添加的节点类型）

#### 旧编辑器代码迁移

* SchemaConfigPanel 的字段编辑逻辑 → 迁移到 SchemaFieldNode 的配置面板

* 旧 blocks 编辑的内容编辑 → 迁移到 PromptNode 的配置面板

* semanticGroups 的选项配置 → 迁移到 Gate 节点的配置面板

* 采样参数表单 → 迁移到 SamplingParams 节点的配置面板

* 迁移完成后删除原文件

#### "隐藏不必要条目"

* 蓝图编辑器可折叠/隐藏节点（视觉上收起，但节点仍参与执行）

* 例如：系统角色定义节点可隐藏，不显示在画布上，但运行时仍注入 prompt

* 通过节点上的"眼睛"图标切换显隐

***

## MODIFIED Requirements

### Requirement: compile\_prompt

**现有**：硬编码三模式 if/else 分支，从 preset 表读 blocks / structured\_output\_schema
**修改后**：

1. 读取 preset.blueprint\_graph
2. 构建 BlueprintExecutionContext（memory\_mode + gate\_selections）
3. 调用 `execute_blueprint` 获取 blocks / schema / sampling\_params / db\_mappings
4. 用执行结果继续编译（删除硬编码三模式分支）
5. db\_mappings 传给 stream\_processor 供持久化使用

### Requirement: stream\_processor 后置任务

**现有**：spawn\_post\_round\_tasks 硬编码三模式分支，有 world variable generation TODO
**修改后**：

* structured\_output 解析后，查 db\_mappings 提取需要持久化的字段

* 写入 message\_rounds 对应列

* 删除 spawn\_world\_variable\_generation\_task TODO

* spawn\_post\_round\_tasks 的三模式分支简化（模式相关行为已由蓝图 ModeSwitch 控制）

### Requirement: Preset 编辑入口

**现有**：SchemaConfigPanel 表单编辑
**修改后**：蓝图编辑器是唯一入口，无蓝图\_graph 的旧 preset 自动迁移

***

## Impact

### Affected specs

* `add-structured-output-response-mode` — schema 由图执行器产出

* `prompt-compiler-stage-a` — compile\_prompt 重构为调用图执行器

* `plot-summary-and-retrieved-detail` — PlotSummary 通过 db\_mapping 持久化

* `capability-matrix-completion` — 世界变量能力补全

### Affected code

#### 新增（后端）

* `services/blueprint_executor.rs` — 图执行器

* `models/blueprint.rs` — 蓝图 Rust 数据模型（BlueprintGraph / BlueprintNode / etc.）

* `commands/blueprint.rs` — Gate 选择状态读写命令

* 数据库迁移：conversation\_gate\_selections 表

#### 新增（前端）

* `src/components/blueprint/` — PC 端蓝图编辑器

* `src-mobile/components/blueprint/` — 移动端独立实现

* `src/lib/blueprint/` — 共享类型定义 + 迁移转换器（移动端通过相对路径引用）

#### 修改（后端）

* `services/prompt_compiler.rs` — 重构为调用图执行器

* `services/stream_processor.rs` — db\_mappings 持久化，删除 3 处 TODO

* `models/mod.rs` — Preset 删除旧字段，保留 blueprint\_graph

* `repositories/preset_repository.rs` — 删除旧字段读写

* `validators/preset_validator.rs` — 删除旧验证，新增蓝图验证

* `commands/presets.rs` — 透传 blueprint\_graph

#### 删除

* `src/components/SchemaConfigPanel.tsx`（迁移后删）

* 旧 blocks / semanticGroups 编辑组件

* 后端旧字段验证逻辑

### 约束合规预估

| 约束                              | 合规 | 说明                |
| ------------------------------- | -- | ----------------- |
| C1 Frontend Render-Only         | √  | 图执行器在后端，前端只编辑+提交图 |
| C2 Zero-Fallback Errors         | √  | 图执行失败明确报错，不静默回退   |
| C3 Responsiveness               | √  | 图执行器异步执行，不阻塞 UI   |
| C4 AI UI Isolation              | √  | 蓝图是宿主 UI          |
| C5 Mobile Frontend Independence | √  | 双端独立实现            |
| C6 Project Cache Location       | √  | 无缓存需求             |
| C7 PC/Android Coverage          | √  | 双端支持              |

### 待讨论

* **MEM0 记忆检索节点**：是否将 MEM0 检索的开关 / 参数纳入蓝图编辑器，用户要求单独讨论


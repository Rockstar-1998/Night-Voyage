# Tasks（v2 — 运行时执行架构）

## 阶段 1: 后端蓝图数据模型 + 图执行器（基础，可并行启动）

- [ ] Task 1: 后端蓝图数据模型
  - [ ] SubTask 1.1: `models/blueprint.rs` — 定义 BlueprintGraph / BlueprintNode / BlueprintEdge / NodeConfig 枚举（8 种节点类型配置）
  - [ ] SubTask 1.2: `models/blueprint.rs` — 定义 BlueprintExecutionContext / BlueprintExecutionResult / GateSelection / CompiledBlock / CompiledSamplingParams
  - [ ] SubTask 1.3: `models/blueprint.rs` — 实现 serde Serialize/Deserialize
  - [ ] SubTask 1.4: `models/mod.rs` — 声明 `pub mod blueprint;`
  - [ ] SubTask 1.5: `cargo build` 验证编译通过

- [ ] Task 2: 后端图执行器
  - [ ] SubTask 2.1: `services/blueprint_executor.rs` — 实现 execute_blueprint 函数（DFS 遍历）
  - [ ] SubTask 2.2: 实现 Prompt 节点处理（compile_block → blocks 列表）
  - [ ] SubTask 2.3: 实现 SchemaField 节点处理（build_property_schema → schema.properties + db_mappings）
  - [ ] SubTask 2.4: 实现 MutexGate 节点处理（单选分支 + 子链表遍历 + 汇聚点继续）
  - [ ] SubTask 2.5: 实现 GroupGate 节点处理（多选分支 + 按 options 顺序遍历 + 汇聚点继续）
  - [ ] SubTask 2.6: 实现 ModeSwitch 节点处理（三路分支 + 按 memory_mode 选路 + 汇聚点继续）
  - [ ] SubTask 2.7: 实现 SamplingParams 节点处理（合并到 sampling_params）
  - [ ] SubTask 2.8: 实现汇聚点查找（find_merge_node — Gate/ModeSwitch 所有分支尾节点汇聚的下游节点）
  - [ ] SubTask 2.9: 实现环路检测（DFS 时记录访问栈，遇环报错）
  - [ ] SubTask 2.10: 实现编译时验证（Start/End 唯一、可达、field_name/identifier 不重复、锁定节点不被跳过）
  - [ ] SubTask 2.11: `services/mod.rs` — 声明 `pub mod blueprint_executor;`
  - [ ] SubTask 2.12: `cargo build` 验证编译通过

- [ ] Task 3: Gate 选择状态存储
  - [ ] SubTask 3.1: 数据库迁移 — 新增 `conversation_gate_selections` 表（conversation_id + gate_id + selected_keys JSON）
  - [ ] SubTask 3.2: `repositories/conversation_gate_repository.rs` — 实现 upsert / load / delete
  - [ ] SubTask 3.3: `commands/blueprint.rs` — 实现 gate_selection_update / gate_selection_load 命令
  - [ ] SubTask 3.4: `lib.rs` — 注册命令
  - [ ] SubTask 3.5: `cargo build` 验证编译通过

## 阶段 2: compile_prompt 重构 + 世界变量 TODO 解决（依赖 Task 1, 2）

- [ ] Task 4: preset 数据模型重构
  - [ ] SubTask 4.1: 数据库迁移 — presets 表新增 `blueprint_graph TEXT` 列
  - [ ] SubTask 4.2: `models/mod.rs` — Preset 结构体新增 blueprint_graph 字段，**暂保留**旧字段（迁移期兼容）
  - [ ] SubTask 4.3: `repositories/preset_repository.rs` — 读写 blueprint_graph
  - [ ] SubTask 4.4: `commands/presets.rs` — 透传 blueprint_graph
  - [ ] SubTask 4.5: `validators/preset_validator.rs` — blueprint_graph 存在时校验 JSON 可反序列化为 BlueprintGraph
  - [ ] SubTask 4.6: `cargo build` 验证编译通过

- [ ] Task 5: compile_prompt 重构为调用图执行器
  - [ ] SubTask 5.1: `services/prompt_compiler.rs` — compile_prompt 读取 preset.blueprint_graph
  - [ ] SubTask 5.2: 构建 BlueprintExecutionContext（memory_mode + gate_selections）
  - [ ] SubTask 5.3: 调用 execute_blueprint 获取 blocks / schema / sampling_params / db_mappings
  - [ ] SubTask 5.4: 用执行结果继续编译（替换原 blocks / structured_output_schema 读取逻辑）
  - [ ] SubTask 5.5: 删除三模式硬编码 if/else 分支（由 ModeSwitch 节点替代）
  - [ ] SubTask 5.6: db_mappings 通过 CompiledPrompt 传给 stream_processor
  - [ ] SubTask 5.7: `cargo build` 验证编译通过

- [ ] Task 6: 世界变量 + PlotSummary 持久化（解决 3 处 TODO）
  - [ ] SubTask 6.1: `services/stream_processor.rs` — structured_output 解析后，查 db_mappings 提取需持久化字段
  - [ ] SubTask 6.2: 提取 world_variables 值写入 message_rounds.world_variables
  - [ ] SubTask 6.3: 提取 plot_summary 值写入 message_rounds.plot_summary
  - [ ] SubTask 6.4: 删除 [stream_processor.rs:378](file:///d:/data/Night%20Voyage/src-tauri/src/services/stream_processor.rs#L378) 的 TODO 注释
  - [ ] SubTask 6.5: 删除 [stream_processor.rs:382](file:///d:/data/Night%20Voyage/src-tauri/src/services/stream_processor.rs#L382) 的 TODO 注释
  - [ ] SubTask 6.6: 删除 [prompt_compiler.rs:85](file:///d:/data/Night%20Voyage/src-tauri/src/services/prompt_compiler.rs#L85) 的 TODO 注释
  - [ ] SubTask 6.7: `cargo build` 验证编译通过

## 阶段 3: 前端蓝图编辑器（PC 端，依赖 Task 1 类型定义）

- [ ] Task 7: 前端蓝图类型定义 + 迁移转换器
  - [ ] SubTask 7.1: `src/lib/blueprint/types.ts` — 定义 BlueprintGraph / BlueprintNode / BlueprintEdge / NodeConfig 类型（与后端 models/blueprint.rs 对齐）
  - [ ] SubTask 7.2: `src/lib/blueprint/migration.ts` — 实现 migrateToBlueprint（旧 blocks + schema + semantic_groups → BlueprintGraph）
  - [ ] SubTask 7.3: 迁移规则：blocks 按 priority → Prompt 节点链；schema properties → SchemaField（db_mapping 按字段名推断）；exclusive_group → MutexGate；semanticGroups multiple → GroupGate；采样参数 → SamplingParams；添加 ModeSwitch（三出口连同一链表）
  - [ ] SubTask 7.4: 迁移失败时返回明确错误，不破坏原数据
  - [ ] SubTask 7.5: `npx tsc --noEmit` 验证类型正确

- [ ] Task 8: PC 端蓝图编辑器画布
  - [ ] SubTask 8.1: `src/components/blueprint/BlueprintCanvas.tsx` — SVG 画布，支持节点拖拽 / 连线 / 缩放 / 平移
  - [ ] SubTask 8.2: 画布渲染节点（矩形 + 标题 + 端口圆点）和连线（贝塞尔曲线）
  - [ ] SubTask 8.3: 连线交互：从 output 端口拖到 input 端口创建连线；点击连线删除
  - [ ] SubTask 8.4: 环路检测 — 创建连线时若成环，拒绝并提示
  - [ ] SubTask 8.5: 锁定节点连线不可断开/重连
  - [ ] SubTask 8.6: 节点"眼睛"图标切换显隐（隐藏仍参与执行）

- [ ] Task 9: PC 端 8 种节点组件 + 配置面板
  - [ ] SubTask 9.1: `src/components/blueprint/nodes/StartNode.tsx`
  - [ ] SubTask 9.2: `src/components/blueprint/nodes/EndNode.tsx`
  - [ ] SubTask 9.3: `src/components/blueprint/nodes/PromptNode.tsx` — identifier / block_type / content / priority / is_locked / lock_reason（迁移自旧 blocks 编辑）
  - [ ] SubTask 9.4: `src/components/blueprint/nodes/SchemaFieldNode.tsx` — field_name / field_type / description / sub_schema / db_mapping / is_locked（迁移自 SchemaConfigPanel）
  - [ ] SubTask 9.5: `src/components/blueprint/nodes/MutexGateNode.tsx` — gate_id / label / options / selected
  - [ ] SubTask 9.6: `src/components/blueprint/nodes/GroupGateNode.tsx` — gate_id / label / options / selected[]
  - [ ] SubTask 9.7: `src/components/blueprint/nodes/ModeSwitchNode.tsx` — 三出口（legacy/mem0/stateless）
  - [ ] SubTask 9.8: `src/components/blueprint/nodes/SamplingParamsNode.tsx` — temperature / max_tokens / top_p 等（迁移自旧采样参数表单）
  - [ ] SubTask 9.9: `src/components/blueprint/NodeConfigPanel.tsx` — 选中节点时显示配置，锁定节点只读
  - [ ] SubTask 9.10: Gate 节点选项可"点进去编辑"（label + 子链表入口）

- [ ] Task 10: PC 端蓝图编辑器集成
  - [ ] SubTask 10.1: `src/components/blueprint/BlueprintEditor.tsx` — 主组件（画布 + 工具栏 + 配置面板 + NodeSelector）
  - [ ] SubTask 10.2: `src/components/blueprint/NodeSelector.tsx` — 节点类型选择器（原 SchemaConfigPanel 退化）
  - [ ] SubTask 10.3: 保存时序列化 blueprint_graph 存入 preset
  - [ ] SubTask 10.4: preset 编辑界面用蓝图编辑器作为唯一入口
  - [ ] SubTask 10.5: 旧 preset（无 blueprint_graph）加载时自动迁移
  - [ ] SubTask 10.6: `npx tsc --noEmit` 验证类型正确

## 阶段 4: 旧代码删除（依赖 Task 10 完成）

- [ ] Task 11: 删除旧前端代码
  - [ ] SubTask 11.1: 确认 SchemaConfigPanel 逻辑已迁移到 SchemaFieldNode 配置面板
  - [ ] SubTask 11.2: 删除 `src/components/SchemaConfigPanel.tsx`
  - [ ] SubTask 11.3: 删除 `src/components/preset/` 下旧 blocks 编辑组件
  - [ ] SubTask 11.4: 删除 semanticGroups 配置 UI
  - [ ] SubTask 11.5: 删除 `src-mobile/components/` 下对应旧编辑组件
  - [ ] SubTask 11.6: `npx tsc --noEmit` 验证无引用残留

- [ ] Task 12: 删除旧后端代码
  - [ ] SubTask 12.1: 数据库迁移 — presets 表 DROP COLUMN blocks / structured_output_schema / semantic_groups（确认迁移期结束）
  - [ ] SubTask 12.2: `models/mod.rs` — Preset 删除旧字段
  - [ ] SubTask 12.3: `repositories/preset_repository.rs` — 删除旧字段读写
  - [ ] SubTask 12.4: `validators/preset_validator.rs` — 删除 semantic_groups / exclusive_group 验证
  - [ ] SubTask 12.5: `prompt_compiler.rs` — 删除三模式硬编码分支（若 Task 5 未完全删除）
  - [ ] SubTask 12.6: 保留 PromptBlockKind 枚举 / load_world_variable_block / load_plot_summary_blocks / plot_summaries.rs
  - [ ] SubTask 12.7: `cargo build` 验证编译通过

## 阶段 5: 移动端蓝图编辑器（C5 独立，依赖 Task 7 类型定义）

- [ ] Task 13: 移动端蓝图编辑器
  - [ ] SubTask 13.1: `src-mobile/components/blueprint/` — 独立实现画布 + 节点 + 配置面板（C5 零 UI 代码耦合）
  - [ ] SubTask 13.2: 复用 `src/lib/blueprint/types.ts` 和 `migration.ts`（通过相对路径引用）
  - [ ] SubTask 13.3: 移动端适配 — 触摸拖拽、捏合缩放、底部配置面板
  - [ ] SubTask 13.4: `src-mobile/App.tsx` 或 preset 编辑入口集成蓝图编辑器

## 阶段 6: 验证与交付

- [ ] Task 14: 全量构建与验收
  - [ ] SubTask 14.1: `cargo build`（src-tauri/）验证后端编译通过
  - [ ] SubTask 14.2: `npx tsc --noEmit` 验证 PC 端类型正确
  - [ ] SubTask 14.3: 移动端 tsc 验证
  - [ ] SubTask 14.4: 创建 Walkthrough 文件记录变更
  - [ ] SubTask 14.5: git commit + push

# Task Dependencies

- [Task 1] 独立（后端数据模型）
- [Task 2] 依赖 [Task 1]（执行器用数据模型）
- [Task 3] 独立（Gate 选择状态存储）
- [Task 4] 依赖 [Task 1]（Preset 含 blueprint_graph，用 BlueprintGraph 类型）
- [Task 5] 依赖 [Task 2, Task 3, Task 4]（compile_prompt 调用执行器 + gate_selections + preset.blueprint_graph）
- [Task 6] 依赖 [Task 5]（stream_processor 用 compile_prompt 传来的 db_mappings）
- [Task 7] 独立（前端类型定义 + 迁移，纯逻辑）
- [Task 8] 依赖 [Task 7]（画布用类型定义）
- [Task 9] 依赖 [Task 8]（节点组件渲染在画布上）
- [Task 10] 依赖 [Task 8, Task 9]（编辑器集成）
- [Task 11] 依赖 [Task 10]（旧代码迁移完成才能删）
- [Task 12] 依赖 [Task 5, Task 10]（后端重构完成 + 前端迁移完成才能删旧字段）
- [Task 13] 依赖 [Task 7]，建议在 [Task 8] 完成后参考 PC 实现独立做
- [Task 14] 依赖所有任务完成

# 可并行任务

- [Task 1] + [Task 3] + [Task 7] 可完全并行（后端模型 + Gate 存储 + 前端类型，互不依赖）
- [Task 4] 依赖 Task 1 但可与 Task 2, Task 3 并行
- [Task 8] + [Task 9] 可在 Task 7 完成后并行
- [Task 13] 可与 [Task 9, Task 10] 并行（移动端独立实现）

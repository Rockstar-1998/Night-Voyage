# Checklist（v2 — 运行时执行架构）

## 后端蓝图数据模型

- [ ] models/blueprint.rs 定义了 BlueprintGraph / BlueprintNode / BlueprintEdge
- [ ] 8 种节点类型的 NodeConfig 枚举/结构体已定义
- [ ] BlueprintExecutionContext / BlueprintExecutionResult / GateSelection 已定义
- [ ] CompiledBlock / CompiledSamplingParams 已定义
- [ ] 所有结构体实现 serde Serialize/Deserialize
- [ ] cargo build 编译通过

## 后端图执行器

- [ ] execute_blueprint 函数实现 DFS 遍历
- [ ] Prompt 节点 → compile_block → blocks 列表
- [ ] SchemaField 节点 → build_property_schema + db_mappings
- [ ] MutexGate 节点 → 单选分支 + 汇聚点继续
- [ ] GroupGate 节点 → 多选分支（按 options 顺序）+ 汇聚点继续
- [ ] ModeSwitch 节点 → 按 memory_mode 三路分支 + 汇聚点继续
- [ ] SamplingParams 节点 → 合并到 sampling_params
- [ ] 汇聚点查找（find_merge_node）正确实现
- [ ] 环路检测（DFS 访问栈）实现
- [ ] 编译时验证：Start/End 唯一
- [ ] 编译时验证：从 Start 到 End 可达
- [ ] 编译时验证：field_name 不重复
- [ ] 编译时验证：identifier 不重复
- [ ] 编译时验证：锁定节点不被 Gate/ModeSwitch 跳过
- [ ] 图执行失败时返回明确错误（C2 零回退）
- [ ] cargo build 编译通过

## Gate 选择状态存储

- [ ] conversation_gate_selections 表已创建（conversation_id + gate_id + selected_keys）
- [ ] upsert / load / delete 仓库方法实现
- [ ] gate_selection_update / gate_selection_load 命令实现
- [ ] 命令已注册到 lib.rs
- [ ] cargo build 编译通过

## preset 数据模型重构

- [ ] presets 表新增 blueprint_graph TEXT 列
- [ ] Preset 结构体新增 blueprint_graph 字段
- [ ] preset_repository 读写 blueprint_graph
- [ ] preset CRUD 命令透传 blueprint_graph
- [ ] blueprint_graph 存在时校验 JSON 可反序列化为 BlueprintGraph

## compile_prompt 重构

- [ ] compile_prompt 读取 preset.blueprint_graph
- [ ] 构建 BlueprintExecutionContext（memory_mode + gate_selections）
- [ ] 调用 execute_blueprint 获取 blocks / schema / sampling_params / db_mappings
- [ ] 用执行结果继续编译（替换原 blocks / structured_output_schema 读取）
- [ ] 三模式硬编码 if/else 分支已删除（由 ModeSwitch 节点替代）
- [ ] db_mappings 通过 CompiledPrompt 传给 stream_processor
- [ ] cargo build 编译通过

## 世界变量 + PlotSummary 持久化

- [ ] stream_processor 解析 structured_output 后查 db_mappings 提取需持久化字段
- [ ] world_variables 值写入 message_rounds.world_variables
- [ ] plot_summary 值写入 message_rounds.plot_summary
- [ ] stream_processor.rs:378 的 TODO 注释已删除
- [ ] stream_processor.rs:382 的 TODO 注释已删除
- [ ] prompt_compiler.rs:85 的 TODO 注释已删除
- [ ] 无 spawn_world_variable_generation_task 残留
- [ ] cargo build 编译通过

## 前端蓝图类型定义 + 迁移

- [ ] src/lib/blueprint/types.ts 定义了与后端对齐的类型
- [ ] migrateToBlueprint 能将旧 preset 转为蓝图
- [ ] 迁移规则：blocks → Prompt 节点链
- [ ] 迁移规则：schema properties → SchemaField（db_mapping 按字段名推断）
- [ ] 迁移规则：exclusive_group → MutexGate
- [ ] 迁移规则：semanticGroups multiple → GroupGate
- [ ] 迁移规则：采样参数 → SamplingParams
- [ ] 迁移规则：添加 ModeSwitch（三出口连同一链表）
- [ ] 迁移失败时返回明确错误，不破坏原数据
- [ ] npx tsc --noEmit 通过

## PC 端蓝图编辑器

- [ ] BlueprintCanvas 支持节点拖拽 / 连线 / 缩放 / 平移
- [ ] 连线用贝塞尔曲线渲染
- [ ] 创建连线时环路检测生效
- [ ] 8 种节点组件均已实现
- [ ] Prompt 节点配置面板（迁移自旧 blocks 编辑）
- [ ] SchemaField 节点配置面板（迁移自 SchemaConfigPanel）
- [ ] MutexGate 节点支持单选
- [ ] GroupGate 节点支持多选
- [ ] ModeSwitch 节点三出口（legacy/mem0/stateless）
- [ ] SamplingParams 节点配置面板（迁移自旧采样参数表单）
- [ ] Gate 节点选项可点进去编辑
- [ ] 锁定节点配置面板只读
- [ ] 锁定节点连线不可断开/重连
- [ ] 锁定节点不可删除
- [ ] 节点"眼睛"图标切换显隐
- [ ] BlueprintEditor 保存时序列化 blueprint_graph
- [ ] preset 编辑界面用蓝图编辑器作为唯一入口
- [ ] 旧 preset 加载时自动迁移
- [ ] npx tsc --noEmit 通过

## 旧代码删除

- [ ] SchemaConfigPanel 逻辑已迁移到 SchemaFieldNode 配置面板
- [ ] src/components/SchemaConfigPanel.tsx 已删除
- [ ] src/components/preset/ 下旧 blocks 编辑组件已删除
- [ ] semanticGroups 配置 UI 已删除
- [ ] src-mobile/components/ 下对应旧编辑组件已删除
- [ ] npx tsc --noEmit 无引用残留
- [ ] presets 表 DROP COLUMN blocks / structured_output_schema / semantic_groups 已执行
- [ ] Preset 结构体旧字段已删除
- [ ] preset_repository 旧字段读写已删除
- [ ] preset_validator 旧验证逻辑已删除
- [ ] prompt_compiler 三模式硬编码分支已删除
- [ ] PromptBlockKind 枚举保留（图执行器产出仍用）
- [ ] load_world_variable_block / load_plot_summary_blocks 保留
- [ ] plot_summaries.rs 批量处理状态机保留
- [ ] cargo build 编译通过

## 移动端蓝图编辑器（C5）

- [ ] src-mobile/components/blueprint/ 独立实现，与 PC 端零 UI 代码耦合
- [ ] 移动端复用 src/lib/blueprint/types.ts 和 migration.ts
- [ ] 移动端适配触摸拖拽
- [ ] 移动端适配捏合缩放
- [ ] 移动端配置面板在底部
- [ ] 移动端 tsc 验证通过

## 约束合规

- [ ] C1 Frontend Render-Only — 图执行器在后端，前端只编辑+提交图
- [ ] C2 Zero-Fallback Errors — 图执行失败明确报错，不静默回退
- [ ] C3 Responsiveness — 图执行器异步执行，不阻塞 UI
- [ ] C4 AI UI Isolation — 蓝图是宿主 UI，不涉及 AI sandbox
- [ ] C5 Mobile Frontend Independence — 双端独立实现
- [ ] C6 Project Cache Location — 无缓存需求
- [ ] C7 PC/Android Coverage — 双端支持

## 交付物

- [ ] Walkthrough 文件已创建
- [ ] 约束合规审计表填写完整
- [ ] 真实构建命令输出已贴出（cargo build + tsc）
- [ ] git commit + push 完成

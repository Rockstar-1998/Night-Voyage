# 蓝图 RoleSwitch 拆分 + GateOption 恢复 description + 预设级 Gate 选择（里程碑 A 后端）

**修改类型**：新功能增加
**日期**：2026-07-15
**关联 spec**：`.trae/specs/blueprint-runtime-selection-and-role-axis/spec.md`（里程碑 A）
**关联问题**：用户反馈 6 问题中的 3、4、6 的后端部分

---

## 1. 改动摘要

### 新增文件
- `src-tauri/migrations/0042_preset_gate_selections.sql` — 预设级 Gate 选择表迁移
- `src-tauri/src/repositories/preset_gate_repository.rs` — 预设级 Gate 选择仓库

### 修改文件
- `src-tauri/src/models/blueprint.rs`
  - `GateOption` 新增 `description: Option<String>` 字段（核心字段恢复）
  - `MutexGateConfig` / `GroupGateConfig` 移除 `gate_id` 字段（节点 ID 已唯一）
  - 新增 `RoleSwitchConfig { label: String }` 结构体
  - `NodeType` / `NodeConfig` 枚举新增 `RoleSwitch` 变体
  - `NodeConfig::node_type()` 新增 RoleSwitch 分支
  - `BlueprintExecutionContext` 新增 `conversation_type: String` 字段
  - 新增测试 `role_switch_and_gate_option_description_round_trip` 锁定新契约
  - `node_type_discriminant_matches_config_variant` 测试新增 RoleSwitch 用例

- `src-tauri/src/services/blueprint_executor.rs`
  - `BlueprintError` 移除 `DuplicateGateId` 变体（gate_id 已不存在）
  - `BlueprintError` 新增 `MissingRoleSwitchPort(String, String)` 变体
  - MutexGate / GroupGate 执行改用 `node_id` 作为 selection key（原 `cfg.gate_id`）
  - 新增 `NodeConfig::RoleSwitch(_)` 执行分支：`port = format!("out_{}", context.conversation_type)`
  - `validate_graph` 移除 gate_id 唯一性检查（注释说明原因）
  - `validate_graph` 新增 RoleSwitch 端口校验（out_single + out_online 必须有出边）
  - 测试 helper `mutex_gate` / `group_gate` 签名改为 `(id, label, opts: &[(&str, &str, &str)])`，GateOption 加 description
  - 新增 `role_switch` helper 与 `ctx_with_role` helper
  - `ctx` / `ctx_with_gates` helper 加 `conversation_type: "single"`
  - 现有 3 个 Gate 测试更新：selection key 从 gate_id 改用 node_id
  - 新增 3 个 RoleSwitch 测试：single/online 分支选择、端口缺失校验、与 ModeSwitch 串联

- `src-tauri/src/services/prompt_compiler.rs`
  - 替换 `ConversationGateRepository` 引用为 `PresetGateRepository`
  - Gate 选择从 `preset_gate_selections` 表按 `preset_id` 读取（原 `conversation_gate_selections` 按 `conversation_id`）
  - `gate_selections` key 用 `node_id`（原 `gate_id`）
  - 构建 `BlueprintExecutionContext` 时填充 `conversation_type` 字段（从 `ConversationCompileContext` 透传）
  - preset_id 缺失时显式报错（C2 零回退）

- `src-tauri/src/services/preset_service.rs`
  - 4 处 `BlueprintExecutionContext` 构造加 `conversation_type: "single"`
  - Test 7 / Test 8 中 MutexGateConfig / GroupGateConfig 移除 `gate_id`、GateOption 加 `description: None`
  - Test 7 / Test 8 中 gate_selections key 从 "g1"/"g2" 改为 "n_gate"

- `src-tauri/src/commands/blueprint.rs`（完整重写）
  - 废弃 3 个会话级 command：`update_gate_selection` / `load_gate_selections` / `clear_gate_selection`
  - 废弃 `ConversationGateSelectionDto`
  - 新增 3 个预设级 command：`update_preset_gate_selection` / `load_preset_gate_selections` / `clear_preset_gate_selection`
  - 新增 `load_blueprint_gates(preset_id)` command：返回预设蓝图中所有 MutexGate/GroupGate 节点定义
  - 新增 DTO：`PresetGateSelectionDto` / `BlueprintGateDto` / `BlueprintGateOptionDto`

- `src-tauri/src/lib.rs`
  - 移除 3 个旧 command 注册
  - 新增 4 个新 command 注册

- `src-tauri/src/repositories/mod.rs`
  - 注册 `preset_gate_repository` 模块

---

## 2. 改动动机

### 问题3：GateOption 缺失 description + gate_id 冗余
用户反馈：选项节点必须恢复到最初有 `description` 的样子，否则没有存在的必要。
- `description` 是选项节点的核心字段（选择 UI 中显示的选项说明），不是可选增强
- `gate_id` 冗余：图中每个 MutexGate/GroupGate 节点本身就是独立的分组单位，节点 ID 已唯一
- 运行时 selection key 改用 `node_id`

### 问题4：ModeSwitch 拆分为两个独立节点
用户澄清：ModeSwitch 不是扩展为 6 组合端口，而是**拆分为两个独立节点**。
- 保留 ModeSwitch 专管记忆模式（legacy/mem0/stateless，3 端口）
- 新增 RoleSwitch 专管角色模式（single/online，未来扩展 agent）
- 两个节点在图中串联使用，实现 6 种排列组合路径
- 遵循 guardrails "组合优于继承"原则：两个正交维度用两个独立类型表达
- 未来 agent 模式扩展只影响 RoleSwitch，符合"最小变更"原则

### 问题6：选择 UI 在预设工作区，不在对话界面
用户澄清：**不是在对话界面选择，而是在预设工作区选择，蓝图作为"幕后"**。
- Gate 选择从"会话级运行时"改为"预设级配置期"
- 新增 `preset_gate_selections` 表（preset_id + node_id + selected_keys）
- 所有使用该预设的会话共享同一套 Gate 选择
- 蓝图编辑器是预设作者的"幕后"工具，预设详情是最终用户的"台前"配置界面
- 里程碑 A 只实现后端数据结构与命令；前端 UI 在里程碑 C 实现

---

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 里程碑 A 仅后端改动，前端无变更 |
| C2 Zero-Fallback Errors | √ | preset_id 缺失时显式报错；蓝图 JSON 缺失/解析失败显式报错；Gate 未选择时执行报 `MissingGateSelection`，不静默跳过；废弃 `conversation_gate_selections` 表保留迁移文件不删，但后端代码不再读写 |
| C3 Responsiveness | √ | 所有新仓库方法均为异步（`async`）；新 command 异步执行不阻塞 UI 线程 |
| C4 AI UI Isolation | √ | 不涉及 AI 沙箱层 |
| C5 Mobile Frontend Independence | √ | 里程碑 A 仅后端，前端 PC/移动端独立实现将在里程碑 B/C 同步 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 后端 command 双端共享；RoleSwitch 节点行为对 PC/Android 一致 |

---

## 4. 验收记录

### 构建验证
- 命令：`cargo build --lib --manifest-path src-tauri/Cargo.toml`
- 结果：**Finished `dev` profile [optimized + debuginfo] target(s) in 1m 22s**（exit 0）
- 警告：5 个，均为预存在或预期（`ConversationGateRepository` 已废弃但保留文件；`PresetGateRepository::load_one`/`delete_by_preset` 待前端调用；`SchemaBuildError` 变体预存在未使用；`NodeType`/`node_type` 仅测试使用）

### 测试验证
- 命令：`cargo test --lib --manifest-path src-tauri/Cargo.toml`
- 结果：**93 passed; 1 failed**
- 失败测试：`services::provider_adapter::tests::openai_structured_json_request_sets_json_schema_format`
- 失败原因：**预存在失败**（通过 `git stash` 验证，在 base commit `da34180` 上独立运行该测试同样失败）
- 失败内容：`assertion left == right failed: left: Some(true), right: Some(false)`（OpenAI strict mode 字段断言，与本次改动无关）

### 本次改动相关测试（全部通过）
- `models::blueprint::tests::node_type_discriminant_matches_config_variant` ✓（含新 RoleSwitch 用例）
- `models::blueprint::tests::role_switch_and_gate_option_description_round_trip` ✓（新增，锁定 RoleSwitch + description + gate_id 移除契约）
- `models::blueprint::tests::deserialize_spec_sample_succeeds` ✓
- `models::blueprint::tests::serialize_then_deserialize_is_equivalent` ✓
- `services::blueprint_executor::tests::test_simple_chain` ✓
- `services::blueprint_executor::tests::test_mode_switch` ✓
- `services::blueprint_executor::tests::test_mutex_gate` ✓（更新：node_id key + description）
- `services::blueprint_executor::tests::test_group_gate_multi_select` ✓（更新：node_id key + description）
- `services::blueprint_executor::tests::test_cycle_detection` ✓
- `services::blueprint_executor::tests::test_duplicate_field_name` ✓
- `services::blueprint_executor::tests::test_duplicate_identifier` ✓
- `services::blueprint_executor::tests::test_missing_gate_selection` ✓（更新：期望 node_id 而非 gate_id）
- `services::blueprint_executor::tests::test_no_start_node` ✓
- `services::blueprint_executor::tests::test_mode_switch_converge_at_intermediate_node` ✓
- `services::blueprint_executor::tests::test_role_switch_single_branch` ✓（新增）
- `services::blueprint_executor::tests::test_role_switch_missing_port_rejected` ✓（新增）
- `services::blueprint_executor::tests::test_role_switch_then_mode_switch_serial` ✓（新增，验证 6 种排列组合路径）
- `services::preset_service::tests::test_execute_full_blueprint_graph` ✓（更新：加 conversation_type）
- `services::preset_service::tests::test_full_lifecycle_create_update_execute` ✓（更新：加 conversation_type）
- `services::preset_service::tests::test_mutex_gate_full_lifecycle` ✓（更新：移除 gate_id + 加 description + node_id key + conversation_type）
- `services::preset_service::tests::test_group_gate_full_lifecycle` ✓（更新：同上）

### 验收要点
1. ✓ `GateOption` 含 `description: Option<String>` 字段
2. ✓ `MutexGateConfig` / `GroupGateConfig` 不含 `gate_id` 字段
3. ✓ `NodeConfig::RoleSwitch(RoleSwitchConfig)` 变体存在
4. ✓ `BlueprintExecutionContext` 含 `conversation_type: String` 字段
5. ✓ RoleSwitch 执行分支：`port = format!("out_{}", context.conversation_type)`
6. ✓ `validate_graph` 校验 RoleSwitch 的 out_single + out_online 端口
7. ✓ `validate_graph` 不再校验 gate_id 唯一性
8. ✓ `preset_gate_selections` 表迁移存在
9. ✓ `PresetGateRepository` 提供 upsert/load_by_preset/load_one/delete/delete_by_preset
10. ✓ `prompt_compiler.rs` 从 `preset_gate_selections` 按 preset_id 读取，key 用 node_id
11. ✓ 4 个新 Tauri command 注册：update_preset_gate_selection / load_preset_gate_selections / clear_preset_gate_selection / load_blueprint_gates
12. ✓ 3 个旧会话级 command 已从 `lib.rs` 移除

---

## 5. 已知限制与后续待办

### 已知限制
1. **`conversation_gate_repository.rs` 文件保留**：按 spec 要求保留迁移文件不删避免 checksum 问题，但后端代码不再调用该模块。Cargo 会发出 dead_code 警告，预期行为。
2. **`PresetGateRepository::load_one` / `delete_by_preset` 暂未被调用**：作为完整 CRUD API 提供，前端 UI 在里程碑 C 实现后会调用 `load_by_preset`；`load_one` / `delete_by_preset` 为预留 API（与旧 `ConversationGateRepository` 对称设计）。
3. **预存在测试失败**：`openai_structured_json_request_sets_json_schema_format` 在本次改动前已失败，与本次改动无关，需单独排查 OpenAI strict mode 断言。

### 后续待办
- **里程碑 B（前端蓝图编辑器同步）**：
  - `src/lib/blueprint/types.ts` 同步 GateOption + description、移除 gate_id、新增 RoleSwitchConfig + NodeType
  - 新增 `src/components/blueprint/nodes/RoleSwitchNode.tsx`（PC）
  - `src/components/blueprint/nodeLayout.ts` 新增 role_switch 端口/标题/配色
  - `src/components/blueprint/NodeConfigPanel.tsx` Gate 选项加 description 输入、移除 gate_id、加 RoleSwitch 表单
  - `src/components/blueprint/NodeSelector.tsx` 新增 role_switch 选项
  - `src/components/blueprint/BlueprintEditor.tsx` defaultConfigForType 加 role_switch + 移除 gate_id + Option 加 description
  - 移动端 `src-mobile/` 同步独立实现
- **里程碑 C（预设详情视图 + 选择 UI）**：
  - 新增 `src/lib/backend/gates.ts` 封装 4 个新 command
  - 新增 `src/components/PresetDetailView.tsx`（PC）+ 移动端独立实现
  - `src/App.tsx` 导航重构：预设卡片 → 预设详情视图 → 蓝图编辑器
  - `src/lib/backend/types.ts` 新增 PresetGateSelection / BlueprintGate 类型

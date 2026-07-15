# Constant + Branch 节点：替代 RoleSwitch 的常量+分支模式

## 改动摘要

本次新增两种蓝图节点类型 `Constant`（常量）与 `Branch`（分支），用于替代已废弃的 `RoleSwitch`。设计目标是让预设能适配不同会话上下文（单人/多人、记忆模式等），而非固定服务于单一模式。`RoleSwitch` 变体保留以向后兼容旧图，但从可选列表移除并加废弃提示。

### 后端（Milestone A）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/models/blueprint.rs` | 修改 | `NodeType` 枚举加 `Constant`/`Branch`；`NodeConfig` 枚举加 `Constant(ConstantConfig)`/`Branch(BranchConfig)`；新增 `ConstantConfig`/`BranchCase`/`BranchConfig` 三个结构体；`node_type()` 补匹配分支；`RoleSwitchConfig` doc 加废弃说明 |
| `src-tauri/src/services/blueprint_executor.rs` | 修改 | `BlueprintError` 加 4 个变体（`BranchNoIncomingEdge`/`BranchMustFollowConstant`/`UnknownConstantSource`/`MissingBranchPort`）；`traverse` 加 `Constant`（直通 `out`）与 `Branch`（回溯取值+匹配 cases+默认端口+汇聚节点）分支；新增 `resolve_constant_source` 函数（沿入边回溯到 ConstantNode 读 `source` 再从 context 取值）；`validate_graph` 加 Constant 出边校验与 Branch 入边/全端口出边校验；新增 7 个单元测试 |

### PC 前端（Milestone B）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/blueprint/types.ts` | 修改 | `NODE_TYPES` 加 `'constant'`/`'branch'`；新增 `ConstantConfig`/`BranchCase`/`BranchConfig` 接口；`NodeConfig` 判别联合加两个分支 |
| `src/components/blueprint/NodeSelector.tsx` | 修改 | `NODE_TYPE_LABELS`/`NODE_TYPE_DESCRIPTIONS` 加 constant/branch 文案；新增 `SELECTABLE_NODE_TYPES` 过滤掉 `role_switch`；`<For>` 改用过滤后数组 |
| `src/components/blueprint/nodeLayout.ts` | 修改 | 强调色 `constant:#14b8a6`/`branch:#d946ef`；`getOutputPorts`/`getInputPorts`/`isNodeLocked`/`computeNodeTitle`/`computeNodeSubtitle` 5 个 switch 全部补 constant/branch 分支（Branch 出口端口由 cases 动态生成） |
| `src/components/blueprint/nodes/ConstantNode.tsx` | 新增 | 常量节点配置面板：label 文本输入 + source 下拉（conversation_type / memory_mode） |
| `src/components/blueprint/nodes/BranchNode.tsx` | 新增 | 分支节点配置面板：label + 动态 cases 列表（增删改每条 match_value/port）+ default_port 输入 |
| `src/components/blueprint/NodeConfigPanel.tsx` | 修改 | 导入两个新组件；`NODE_TYPE_LABELS` 加 `constant:'Constant'`/`branch:'Branch'`；`renderConfig` switch 加两个 case |
| `src/components/blueprint/BlueprintEditor.tsx` | 修改 | `defaultConfigForType` 加 constant（默认会话角色/conversation_type）与 branch（默认 single/online 两 case + out_single 默认） |

### 移动端（Milestone C）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-mobile/components/blueprint/mobileNodeLayout.ts` | 修改 | 强调色与 5 个 switch 与 PC 对齐；`createNode` 补 constant/branch 默认 config（与 PC `defaultConfigForType` 一致） |
| `src-mobile/components/blueprint/MobileNodeConfigPanel.tsx` | 修改 | `nodeTypeLabel` switch 加 `constant:'Constant（常量）'`/`branch:'Branch（分支）'`；role_switch 标签加"已废弃" |
| `src-mobile/components/blueprint/MobileNodeConfigForms.tsx` | 修改 | 类型导入加 `BranchCase`/`BranchConfig`/`ConstantConfig`；新增 `ConstantForm`/`BranchForm`（触摸优化）；`RoleSwitchForm` 顶部加废弃横幅；分发器与 `defaultConfigForType` 补 constant/branch |
| `src-mobile/components/blueprint/BlueprintEditor.tsx` | 修改 | `ADDABLE_NODE_TYPES` 移除 `role_switch`，加入 `constant`/`branch`（文案与 PC 对齐） |

### 迁移提示（Milestone D）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/blueprint/nodes/RoleSwitchNode.tsx` | 修改 | 顶部加琥珀色废弃横幅；文件 doc 注释加"已废弃/被替代/从 NodeSelector 移除"说明 |

## 改动动机

### 背景：RoleSwitch 的局限性

原 `RoleSwitch` 节点硬编码两个出口端口 `out_single`/`out_online`，仅能分支"单人/多人"一种维度。用户反馈："三模式与单人\多人的配合不是很协调"，并希望"让预设适配不同的情况，而不是让预设固定死为一个模式服务"。

### 新设计：常量 + 分支的组合

用户提出将"角色判断"改为**常量节点 + 分支节点**的通用模式：

- **ConstantNode**：在运行时读取会话属性（如 `conversation_type` 或 `memory_mode`），通过 `out` 端口输出值。本身不参与值传递管线，仅作为 Branch 的回溯源。
- **BranchNode**：接收上游 Constant 的值（通过 `resolve_constant_source` 沿入边回溯到 ConstantNode，读取其 `source` 配置，再从 `context` 取实际值），按 `cases` 数组匹配 `match_value` 走对应出口；无匹配时走 `default_port`；分支后自动找汇聚节点继续遍历。

### 6 路径组合

`ModeSwitch`（legacy/mem0/stateless 三模式）× `Constant+Branch`（single/online 两角色）= 6 种执行路径。这让预设作者可以在一张图里同时覆盖"单人+legacy"、"多人+mem0"等全部组合，无需为每种组合单独建图。

### RoleSwitch 废弃策略

- 变体保留在 `NodeType` 枚举中，旧图可加载、可执行（向后兼容）
- 从 PC `NodeSelector` 和移动端 `ADDABLE_NODE_TYPES` 可选列表移除（不可新建）
- 选中已有 RoleSwitch 节点时，PC/移动端配置面板均显示琥珀色废弃横幅，引导迁移为 Constant+Branch

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端只做配置编辑与图渲染；节点执行、值回溯、分支选择全在 Rust `blueprint_executor.rs` |
| C2 Zero-Fallback Errors | √ | Branch 缺入边/上游非 Constant/未知 source/缺端口均显式返回 `BlueprintError` 变体；Constant 配置非法 source 在 `resolve_constant_source` 显式报错；不吞任何分支异常 |
| C3 Responsiveness | √ | 图执行是后端异步任务；前端节点配置用 SolidJS 细粒度响应式，Branch cases 列表用 `<For>` 增量渲染 |
| C4 AI UI Isolation | √ | 不涉及 AI 动态 UI |
| C5 Mobile Frontend Independence | √ | PC 与移动端各自独立实现节点表单（`ConstantNode.tsx` vs `MobileNodeConfigForms.tsx` 的 `ConstantForm`），零 UI 代码互引；仅共享 `src/lib/blueprint/types.ts` 类型定义 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 双端同步覆盖：types/nodeLayout/NodeSelector/ConfigPanel/Editor 全部双端实现；RoleSwitch 废弃提示双端一致 |

## 验收记录

### 构建命令

```bash
# 后端
cd src-tauri && cargo build
# 退出码 0

# 后端单元测试
cd src-tauri && cargo test --lib blueprint_executor::tests
# 20/20 通过（含新增 7 个 Constant+Branch 测试）

# PC 前端
npx tsc --noEmit -p tsconfig.json
# 退出码 0

# 移动端前端
npx tsc --noEmit -p tsconfig.mobile.json
# 退出码 0
```

### 后端测试清单（新增 7 个）

1. `test_constant_branch_single_online` — 基础 single/online 分支
2. `test_branch_default_port` — 无匹配走 default_port
3. `test_branch_no_incoming_edge_rejected` — Branch 缺入边被拒
4. `test_branch_missing_port_rejected` — 缺 case 端口出边被拒
5. `test_constant_unknown_source_rejected` — 非法 source 被拒
6. `test_constant_branch_with_mode_switch_6_paths` — 6 路径组合（验证其中 4 条）
7. `test_constant_branch_json_round_trip` — 序列化/反序列化往返

### 预期效果

- **新建节点**：PC/移动端蓝图编辑器"+ 添加"列表显示 Constant 与 Branch，不显示 RoleSwitch
- **Constant 配置**：可编辑 label，下拉选 source（conversation_type / memory_mode）
- **Branch 配置**：可编辑 label、动态增删 cases（每条 match_value + port）、default_port
- **执行**：Constant→Branch 连线后，运行时按会话属性自动走对应分支，与 ModeSwitch 组合可覆盖 6 种路径
- **旧图兼容**：含 RoleSwitch 的旧图仍可加载、执行、编辑（显示废弃横幅）
- **错误显式**：Branch 缺入边/上游非 Constant/缺端口/未知 source 均在执行前校验失败并返回明确错误

### 实际结果

- 后端 `cargo build` 通过，`cargo test --lib blueprint_executor::tests` 20/20 通过
- PC `tsc --noEmit -p tsconfig.json` 退出码 0
- 移动端 `tsc --noEmit -p tsconfig.mobile.json` 退出码 0
- 运行时人工验收未做（后续待办）

## 已知限制或后续待办

1. **运行时人工验收未做**：6 路径组合的端到端运行时验证仅通过单元测试覆盖，未在真实会话中走通
2. **旧 RoleSwitch 图无自动迁移**：用户需手动将 RoleSwitch 拆为 Constant+Branch；后续可考虑加一键迁移脚本
3. **Branch 的汇聚节点查找**：当前 `find_merge_node` 假设分支后存在汇聚节点；若用户画了非汇聚的菱形结构，行为依赖现有实现，未在本批测试中覆盖所有边界
4. **Constant 的 source 仅两种**：当前仅支持 `conversation_type` 与 `memory_mode`；若未来需读取更多会话属性，需扩展 `resolve_constant_source` 的匹配分支
5. **运行时 Gate 选择 UI 未联动 Constant+Branch**：本批仅交付图编辑与执行层；预设详情页的 Gate 选择 UI 仍针对 MutexGate/GroupGate，Constant+Branch 是运行时自动判断，无需用户选择

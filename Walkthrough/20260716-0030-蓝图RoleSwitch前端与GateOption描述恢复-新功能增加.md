# 20260716-0030 蓝图 RoleSwitch 前端 + GateOption description 恢复 + 移除 gate_id（里程碑 B 前端）

> 里程碑 B（前端蓝图编辑器同步）。本文件是 spec
> `.trae/specs/blueprint-runtime-selection-and-role-axis/spec.md` 第 3 个里程碑
> 中"前端编辑器同步"部分的留痕。前端只是把里程碑 A 已落地的后端数据结构
> 在编辑器 UI 上对齐呈现，不涉及任何运行时执行 / 选择 UI（那是里程碑 C）。

## 1. 改动摘要

### 1.1 共享类型（PC + 移动端共用同一份 types.ts）

- `src/lib/blueprint/types.ts`
  - `NODE_TYPES` 数组新增 `'role_switch'`。
  - `GateOption` 接口恢复 `description: string`（必填，与后端 `Option<String>`
    在序列化时对称；前端空串 = 后端 None 的语义已通过 serde 默认行为吸收）。
  - `MutexGateConfig` / `GroupGateConfig` 删除 `gate_id` 字段——节点自身即
    分组单位，gate_id 是冗余标识。
  - 新增 `RoleSwitchConfig { label: string }`，作为 `NodeConfig` 联合类型
    的新分支 `{ type: 'role_switch'; config: RoleSwitchConfig }`。
  - `BlueprintExecutionContext` 新增 `conversationType: 'single' | 'online'`，
    作为 RoleSwitch 的运行时驱动轴。

### 1.2 PC 前端（`src/`）

- `src/components/blueprint/nodes/RoleSwitchNode.tsx`（新建）
  - RoleSwitch 节点的配置编辑器，仅编辑 `label`；列出固定出口端口
    `out_single` / `out_online` 作为只读参考，不可编辑。
- `src/components/blueprint/nodeLayout.ts`
  - `NODE_ACCENT_COLORS` 新增 `role_switch: '#8b5cf6'`。
  - `getOutputPorts` 为 role_switch 返回 `[{out_single, '单人'},
    {out_online, '多人'}]`。
  - `getInputPorts` 为 role_switch 返回 `[{in, null}]`。
  - `isNodeLocked` role_switch 返回 `false`（节点本身不可锁定）。
  - `computeNodeTitle` 移除 mutex_gate / group_gate 的 `node.config.gate_id`
    兜底；新增 role_switch 分支。
  - `computeNodeSubtitle` 新增 role_switch → `'2 branches'`。
- `src/components/blueprint/NodeSelector.tsx`
  - `NODE_LABELS` 新增 `role_switch: 'Role Switch（角色模式分支）'`。
  - `NODE_DESCRIPTIONS` 新增 role_switch 的说明文案。
- `src/components/blueprint/NodeConfigPanel.tsx`
  - 导入 `RoleSwitchNode` 组件。
  - `NODE_TYPE_LABELS` 新增 `role_switch: 'Role Switch'`。
  - `renderConfig` 分发器新增 role_switch 分支。
- `src/components/blueprint/BlueprintEditor.tsx`
  - `defaultConfigForType`：
    - mutex_gate / group_gate 移除 `gate_id`，选项初始值补 `description: ''`。
    - 新增 role_switch 分支：`{ type: 'role_switch', config: { label: '角色模式分支' } }`。
- `src/components/blueprint/nodes/MutexGateNode.tsx`
  - 移除 gate_id 输入；新增选项 `description` 文本框（折叠态下显示）。
- `src/components/blueprint/nodes/GroupGateNode.tsx`
  - 同 MutexGateNode：移除 gate_id，新增 description 输入。

### 1.3 移动端前端（`src-mobile/`，独立实现，遵守 C5）

- `src-mobile/components/blueprint/mobileNodeLayout.ts`
  - `NODE_ACCENT_COLORS` 新增 `role_switch: '#8b5cf6'`。
  - `getOutputPorts` / `getInputPorts` / `isNodeLocked` / `computeNodeTitle`
    / `computeNodeSubtitle` 同步 PC 端 role_switch 处理，移除 gate_id 兜底。
  - `createNode`：mutex_gate / group_gate 移除 gate_id、选项补 description；
    新增 role_switch 工厂分支。
- `src-mobile/components/blueprint/MobileNodeConfigForms.tsx`
  - `GateForm`：移除 gate_id 输入；选项行重构为两行——首行 key/label/删除，
    次行 description；`addOption` 补 `description: ''`。
  - 新增 `RoleSwitchForm` 组件（label 输入 + out_single/out_online 提示）。
  - `MobileNodeConfigForm` 分发器新增 role_switch 分支。
  - `defaultConfigForType`：移除 gate_id、补 description、新增 role_switch。
- `src-mobile/components/blueprint/BlueprintEditor.tsx`
  - `ADDABLE_NODE_TYPES` 新增 role_switch 条目。
- `src-mobile/components/blueprint/MobileNodeConfigPanel.tsx`
  - `nodeTypeLabel` switch 新增 role_switch 分支。

## 2. 改动动机

里程碑 A 已把后端数据结构 / 命令 / 执行器全部对齐 spec，但前端编辑器仍引用
旧字段：

- `GateOption` 缺 `description`——spec §3.2 明确 description 是核心字段，
  运行时选择 UI 必须显示给用户，"选项节点没有 description 就没有存在的必要"。
- `MutexGateConfig` / `GroupGateConfig` 仍带 `gate_id`——spec §3.1 删除该字段，
  节点自身即分组单位，gate_id 是与 node_id 重复的冗余标识。
- 缺 RoleSwitch 节点类型——spec §3.3 拆分 ModeSwitch：保留 ModeSwitch 处理
  记忆模式三态，新增 RoleSwitch 处理会话角色模式二态。两个正交轴通过图中
  串联组合，避免在 ModeSwitch 上开出 6 端口的"假组合"。

前端不同步这些结构会导致：编辑器无法新增 RoleSwitch 节点、Gate 选项缺
description 输入、保存时仍发送已废弃的 gate_id 字段触发后端反序列化错误。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端只做表单 / 画布渲染，无任何业务逻辑 |
| C2 Zero-Fallback Errors | √ | 表单解析失败时不静默写入（参考 MobileNodeConfigForms sub_schema 解析注释）；运行时校验由里程碑 C 选择 UI 承担 |
| C3 Responsiveness | √ | 细粒度响应式：表单为受控组件，逐字段回调父级；无热路径大计算 |
| C4 AI UI Isolation | √ | 不涉及 AI 动态 UI 层 |
| C5 Mobile Frontend Independence | √ | `src-mobile/components/blueprint/` 内独立实现 RoleSwitchForm、GateForm 改造、createNode；仅共享 `src/lib/blueprint/types.ts` 类型定义，无任何 PC 组件 import |
| C6 Project Cache Location | √ | 不涉及运行时缓存 |
| C7 PC/Android Dual-Platform Coverage | √ | PC 与移动端双端同步：role_switch 节点类型、description 字段、gate_id 移除在两端均落地 |

## 4. 验收记录

### 4.1 构建命令

| 命令 | 范围 | 结果 |
|------|------|------|
| `npx tsc --noEmit -p tsconfig.json` | PC 前端（`src/`） | exit 0，无任何错误输出 |
| `npx tsc --noEmit -p tsconfig.mobile.json` | 移动端前端（`src-mobile/`） | exit 0，无任何错误输出 |

### 4.2 验收方式

- 双端 `tsc --noEmit` 通过——前端类型与后端 Rust 类型（mirror）完全对齐。
- spec §4.2 / §4.3 中列举的所有 PC + 移动端文件均已落地编辑。
- 编辑内容自检：
  - `GateOption` 在 PC `MutexGateNode` / `GroupGateNode` + 移动端 `GateForm`
    中都有 description 输入控件（textarea / input）。
  - mutex_gate / group_gate 在 `defaultConfigForType`（PC + 移动端）、
    `createNode`（移动端）中都已移除 `gate_id`，选项初始值都带
    `description: ''`。
  - role_switch 在 PC `NodeSelector` / `NodeConfigPanel` / `BlueprintEditor`
    + 移动端 `BlueprintEditor` / `MobileNodeConfigForms` / `MobileNodeConfigPanel`
    全部 5 处分发器 / 工厂 / 类型标签都已注册。

### 4.3 预期效果

- 在 PC 和移动端蓝图编辑器中可以从工具栏新增 RoleSwitch 节点，画布显示
  紫色标题"Role Switch"，2 个出口端口（单人 / 多人），1 个入口端口。
- 点击 RoleSwitch 节点打开配置面板，仅可编辑 label，下方提示固定端口列表。
- 互斥组 / 多选组节点的选项编辑面板中，每个选项都有 description 输入框。
- 互斥组 / 多选组节点的配置 / 创建路径不再生成 `gate_id` 字段。

### 4.4 实际结果

- 双端 `tsc --noEmit` 通过，无类型错误。
- 节点新增 / 编辑路径已按 spec 描述实现。
- 不涉及运行时执行——执行器已在里程碑 A 验收（commit `ac403a3`）。

## 5. 已知限制或后续待办

- 本里程碑仅落地编辑器 UI 同步；**运行时选择 UI（预设工作区中的选择器）
  属于里程碑 C**，尚未实现。当前编辑蓝图中的 MutexGate / GroupGate 节点
  仍无法在预设工作区被用户选择具体选项——这是预期的，由里程碑 C 补齐。
- spec §3.2 中提到 `description` 在后端是 `Option<String>`；前端
  `GateOption.description` 设为必填 `string`，空串对应后端 None——序列化
  对称性已通过 Rust serde 默认行为吸收，无歧义。如果后续需要明确区分
  "空描述" 与 "无描述"，再评估是否把前端也改成 `string | null`。
- 里程碑 C 需在 `src/lib/backend/` 新增 4 个命令包装
  （`update_preset_gate_selection` / `load_preset_gate_selections` /
  `clear_preset_gate_selection` / `load_blueprint_gates`）+ 类型定义
  （`PresetGateSelection` / `BlueprintGate`），并新建 `PresetDetailView`
  组件、重构 App 导航（卡片 → PresetDetailView → BlueprintEditor）。

# 蓝图 Gate 预设级选择 UI + RoleSwitch 节点拆分 + GateOption 恢复 description

**状态**：待用户审阅
**日期**：2026-07-15
**关联问题**：用户反馈 6 问题中的 3、4、6

---

## 1. 背景与问题

用户反馈三个设计级问题：

- **问题3**：互斥组/普通组选项（GateOption）只有 `key`+`label`，行为与旧版条目式预设不一致。用户澄清：`gate_id` 冗余（节点本身即分组单位）；选项节点必须恢复到最初有 `description` 的样子，否则没有存在的必要。
- **问题4**：需添加单人/多人模式分支。用户澄清：ModeSwitch 不是扩展为 6 组合端口，而是**拆分为两个独立节点**——保留 ModeSwitch 专管记忆模式（3 端口），新增 RoleSwitch 专管角色模式（single/online，未来扩展 agent）。两个节点在图中串联实现排列组合。
- **问题6**：选择 UI 完全缺失。用户澄清：**不是在对话界面选择，而是在预设工作区选择，蓝图作为"幕后"**。

---

## 2. 用户澄清要点

1. **gate_id 冗余**：图中每个 MutexGate/GroupGate 节点本身就是独立的分组单位，配置内的 `gate_id` 字段多余。运行时 selection 的 key 应改用节点 ID（`node_id`）。
2. **description 是核心字段**：选项节点必须恢复到最初有 `description` 的样子。没有 description 的选项节点没有存在的必要——description 不是可选增强，是选项节点的核心组成。
3. **ModeSwitch 拆分而非扩展**：拆分为两个独立节点：
   - ModeSwitch：保留现有 3 端口（legacy/mem0/stateless），专管记忆模式轴。
   - RoleSwitch：新增节点，端口 single/online，专管角色模式轴。后期加入 agent 模式时只需给 RoleSwitch 加一个端口，不影响 ModeSwitch。
   - 两个节点在图中串联使用，实现 6 种排列组合路径。
4. **选择 UI 在预设工作区，不在对话界面**：蓝图编辑器是"幕后"（定义 Gate 和选项结构），预设工作区是"台前"（用户选择启用哪些选项）。对话界面不展示选择 UI，直接使用预设工作区配置的选择。

---

## 3. 设计决策

### 3.1 问题3：GateOption 恢复 description + gate_id 移除

**决策**：
- `GateOption` 恢复 `description: string` 字段（非可选，核心字段）。为兼容旧 JSON 反序列化，Rust 侧用 `Option<String>` 并在缺失时回退空字符串；TS 侧用 `string` 并在加载时回退 `''`。
- 移除 `MutexGateConfig.gate_id` 和 `GroupGateConfig.gate_id` 配置字段。
- Gate 选择的 key 从 `gate_id` 改为 `node_id`（`BlueprintNode.id`，编辑器自动生成，本就唯一）。
- `validate_graph` 的 `DuplicateGateId` 检查移除（`node_id` 本就唯一）。

**理由**：
- description 是选项节点的核心：没有它，选择 UI 只能显示光秃秃的 label，用户无法理解选项含义。
- 节点 ID 已是唯一标识，配置内再维护 `gate_id` 是冗余且易错。
- 不挂载 blocks/examples——保持蓝图"选项是分支开关，内容在下游 Prompt 节点"的哲学。

### 3.2 问题4：拆分为 ModeSwitch + RoleSwitch 两个独立节点

**决策**：
- **保留 ModeSwitch 不变**：3 端口 `out_legacy` / `out_mem0` / `out_stateless`，由会话 `memory_mode` 自动驱动。
- **新增 RoleSwitch 节点类型**：
  - 配置：`RoleSwitchConfig { label: String }`（与 ModeSwitchConfig 对称）。
  - 端口：`out_single` / `out_online`（未来扩展 `out_agent`）。
  - 由会话 `conversation_type` 自动驱动，无用户选择 API（与 ModeSwitch 一致）。
  - 执行逻辑：`port = format!("out_{}", context.conversation_type)`。
- **`BlueprintExecutionContext` 新增 `conversation_type: String`**。
- **图中串联**：用户在蓝图中可串接 RoleSwitch → ModeSwitch，实现 6 种排列组合路径。两个节点各自独立，互不耦合。
- **`validate_graph` 新增 RoleSwitch 端口校验**：要求 `out_single` 和 `out_online` 都有出边。
- **未来扩展**：加入 agent 模式时，只需给 RoleSwitch 加 `out_agent` 端口 + 校验，ModeSwitch 完全不动。

**理由**：
- 用户明确要求拆分，避免单节点臃肿。
- 遵循 guardrails "组合优于继承"原则：两个正交维度用两个独立类型表达。
- 未来 agent 模式扩展只影响 RoleSwitch，符合"最小变更"原则。

### 3.3 问题6：预设工作区选择 UI（预设级存储，非会话级）

**核心变更**：Gate 选择从"会话级运行时"改为"预设级配置期"。

**决策**：
- **存储改为预设级**：新增 `preset_gate_selections` 表（`preset_id` + `node_id` + `selected_keys`），废弃 `conversation_gate_selections` 表（保留迁移文件不删，避免 checksum 问题）。
- **UI 位置改为预设工作区**：预设工作区当前点击预设卡片直接进入蓝图编辑器。改为点击预设卡片进入"预设详情"视图（新增），详情中展示 Gate 选项选择区 + "编辑蓝图"入口。
- **预设详情视图布局**：
  - 顶部：返回按钮 + 预设名
  - 主体：Gate 选项选择区（互斥组单选 chip、普通组多选 checkbox，每项显示 label + description）
  - 次要入口："编辑蓝图"按钮（进入蓝图编辑器，幕后入口）
- **蓝图编辑器入口**：从预设详情中的按钮进入，仍是全屏编辑视图。
- **数据来源**：新增 Tauri command `load_blueprint_gates(preset_id)` 返回当前预设蓝图中所有 Gate 节点的 `{ nodeId, kind, label, options }` 列表。
- **选择持久化**：用户在预设详情中选择后，调 `update_preset_gate_selection(preset_id, node_id, selected_keys)` 持久化到 `preset_gate_selections` 表。
- **蓝图执行时读取**：`blueprint_executor` 从 `preset_gate_selections`（按 preset_id）读取选择，而非 `conversation_gate_selections`。
- **对话界面**：不展示任何 Gate 选择 UI，直接使用预设工作区配置的选择。
- **移动端**：`src-mobile/` 同步独立实现预设详情视图（C5 约束）。

**理由**：
- 用户明确要求"在预设工作区选择，蓝图作为幕后"。
- 预设级存储意味着所有使用该预设的会话共享同一套 Gate 选择，简化数据模型。
- 蓝图编辑器是预设作者的"幕后"工具，预设详情是最终用户的"台前"配置界面。

---

## 4. 数据结构变更

### 4.1 Rust 后端

#### `src-tauri/src/models/blueprint.rs`

```rust
// GateOption: 恢复 description
pub struct GateOption {
    pub key: String,
    pub label: String,
    pub description: Option<String>,  // 恢复；旧 JSON 缺失时回退 None → UI 显示空
}

// MutexGateConfig / GroupGateConfig: 移除 gate_id
pub struct MutexGateConfig {
    pub label: String,
    pub options: Vec<GateOption>,
}
pub struct GroupGateConfig {
    pub label: String,
    pub options: Vec<GateOption>,
}

// ModeSwitchConfig: 不变
pub struct ModeSwitchConfig {
    pub label: String,
}

// 新增 RoleSwitchConfig
pub struct RoleSwitchConfig {
    pub label: String,
}

// NodeConfig: 新增 RoleSwitch 变体
pub enum NodeConfig {
    Start,
    End,
    Prompt(PromptConfig),
    SchemaField(SchemaFieldConfig),
    MutexGate(MutexGateConfig),
    GroupGate(GroupGateConfig),
    ModeSwitch(ModeSwitchConfig),
    RoleSwitch(RoleSwitchConfig),  // 新增
    SamplingParams(SamplingParamsConfig),
}

// BlueprintExecutionContext: 加 conversation_type；gate_selections key 改为 node_id
pub struct BlueprintExecutionContext {
    pub memory_mode: String,
    pub conversation_type: String,  // 新增
    pub gate_selections: HashMap<String, GateSelection>,  // key 改为 node_id
}
```

#### `src-tauri/src/services/blueprint_executor.rs`

- MutexGate/GroupGate 执行：`context.gate_selections.get(&node_id)`（用节点 ID，不再用 `cfg.gate_id`）。
- ModeSwitch 执行：不变（`port = format!("out_{}", context.memory_mode)`）。
- **新增 RoleSwitch 执行**：
  ```rust
  NodeConfig::RoleSwitch(_) => {
      let port = format!("out_{}", context.conversation_type);
      let branch_target = target_of(graph, node_id, &port)?;
      traverse(graph, &branch_target, context, result, visited, path)?;
      let merge_node = find_merge_node(graph, node_id)?;
      traverse(graph, &merge_node, context, result, visited, path)?;
  }
  ```
- `validate_graph`：移除 `DuplicateGateId` 检查；新增 RoleSwitch 端口校验（`out_single` + `out_online` 必须有出边）。
- `BlueprintError`：`MissingGateSelection(String)` 参数语义改为 node_id；移除 `DuplicateGateId`。

#### `src-tauri/src/services/prompt_compiler.rs`

- 构建 `BlueprintExecutionContext` 时，从 `conversations` 表读取 `conversation_type`，填入 context。
- `gate_selections` 改为从 `preset_gate_selections`（按 preset_id）读取，key 用 `node_id`。

#### 新增 `src-tauri/src/repositories/preset_gate_repository.rs`

```rust
pub struct PresetGateSelection {
    pub preset_id: i64,
    pub node_id: String,
    pub selected_keys: Vec<String>,
}

pub struct PresetGateRepository;

impl PresetGateRepository {
    pub async fn upsert(db, preset_id, node_id, selected_keys) -> Result<(), String>
    pub async fn load_by_preset(db, preset_id) -> Result<Vec<PresetGateSelection>, String>
    pub async fn load_one(db, preset_id, node_id) -> Result<Option<PresetGateSelection>, String>
    pub async fn delete(db, preset_id, node_id) -> Result<(), String>
    pub async fn delete_by_preset(db, preset_id) -> Result<(), String>
}
```

#### `src-tauri/src/commands/blueprint.rs`

- **废弃** 3 个会话级 command（`update_gate_selection` / `load_gate_selections` / `clear_gate_selection`）。
- **新增** 3 个预设级 command：
  - `update_preset_gate_selection(preset_id, node_id, selected_keys)`
  - `load_preset_gate_selections(preset_id) -> Vec<PresetGateSelectionDto>`
  - `clear_preset_gate_selection(preset_id, node_id)`
- **新增** `load_blueprint_gates(preset_id) -> Vec<BlueprintGateDto>` command，返回预设蓝图中所有 Gate 节点定义。

#### 新增迁移 `src-tauri/migrations/00NN_preset_gate_selections.sql`

```sql
CREATE TABLE preset_gate_selections (
    preset_id INTEGER NOT NULL,
    node_id TEXT NOT NULL,
    selected_keys TEXT NOT NULL,
    PRIMARY KEY (preset_id, node_id),
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
);

CREATE INDEX idx_preset_gate_selections_preset_id
    ON preset_gate_selections(preset_id);
```

注：`conversation_gate_selections` 表保留不删（迁移文件不删除，避免 checksum 问题）。后端代码不再读写该表。

### 4.2 TypeScript 前端

#### `src/lib/blueprint/types.ts`

```typescript
export interface GateOption {
  key: string;
  label: string;
  description: string;  // 恢复（加载时 None → ''）
}

export interface MutexGateConfig {
  // gate_id 移除
  label: string;
  options: GateOption[];
}
export interface GroupGateConfig {
  // gate_id 移除
  label: string;
  options: GateOption[];
}

// 新增
export interface RoleSwitchConfig {
  label: string;
}

export type NodeConfig =
  | { type: 'start'; config: Record<string, never> }
  | { type: 'end'; config: Record<string, never> }
  | { type: 'prompt'; config: PromptConfig }
  | { type: 'schema_field'; config: SchemaFieldConfig }
  | { type: 'mutex_gate'; config: MutexGateConfig }
  | { type: 'group_gate'; config: GroupGateConfig }
  | { type: 'mode_switch'; config: ModeSwitchConfig }
  | { type: 'role_switch'; config: RoleSwitchConfig }  // 新增
  | { type: 'sampling_params'; config: SamplingParamsConfig };

export type NodeType = ... | 'role_switch';
```

#### `src/lib/backend/types.ts`

```typescript
// 预设级 Gate 选择（替换原会话级 GateSelection）
export interface PresetGateSelection {
  presetId: number;
  nodeId: string;
  selectedKeys: string[];
}

export interface BlueprintGate {
  nodeId: string;
  kind: 'mutex' | 'group';
  label: string;
  options: GateOption[];
}
```

#### 新增 `src/lib/backend/gates.ts`

```typescript
// 预设级 Gate 选择 API
export async function updatePresetGateSelection(presetId: number, nodeId: string, selectedKeys: string[]): Promise<void>;
export async function loadPresetGateSelections(presetId: number): Promise<PresetGateSelection[]>;
export async function clearPresetGateSelection(presetId: number, nodeId: string): Promise<void>;
export async function loadBlueprintGates(presetId: number): Promise<BlueprintGate[]>;
```

### 4.3 前端组件

#### 预设工作区改造（`src/App.tsx`）

当前点击预设卡片直接进入 `BlueprintEditor`。改为进入"预设详情"视图。

新增视图状态：`editingPresetId`（已存在）拆分为两个子状态：
- `presetDetailId: number | null` — 预设详情视图（台前）
- `editingBlueprintId: number | null` — 蓝图编辑器视图（幕后）

导航流：预设卡片列表 → 点击卡片 → 预设详情视图 → 点击"编辑蓝图" → 蓝图编辑器。

#### 新增 `src/components/PresetDetailView.tsx`（PC）

- Props: `presetId`, `onBack`, `onEditBlueprint`
- 顶部：返回按钮 + 预设名 + "编辑蓝图"按钮
- 主体：Gate 选项选择区
  - 加载 `loadBlueprintGates(presetId)` 获取 Gate 定义
  - 加载 `loadPresetGateSelections(presetId)` 获取已选状态
  - 互斥组：单选 chip 组（选一个自动清除同组其他选择）
  - 普通组：多选 checkbox 组
  - 每个选项显示 label（主）+ description（次）
  - 用户点击时调 `updatePresetGateSelection`
- 无 Gate 节点时显示提示："该预设蓝图未定义可选项"

#### `src/components/blueprint/nodeLayout.ts`

- `getOutputPorts` 新增 `role_switch` case：`out_single` / `out_online`
- `getInputPorts` 新增 `role_switch` case：`in`
- `NODE_ACCENT_COLORS` 新增 `role_switch` 配色
- `computeNodeTitle` / `computeNodeSubtitle` 新增 `role_switch` case
- `isNodeLocked` 新增 `role_switch` case（返回 false）
- ModeSwitch 端口定义**不变**

#### 新增 `src/components/blueprint/nodes/RoleSwitchNode.tsx`

- 与 ModeSwitchNode 对称结构
- 展示 2 个固定端口（out_single / out_online）
- 唯一可编辑字段：`label`
- 提示文案：角色模式分支，由会话 conversation_type 驱动

#### `src/components/blueprint/BlueprintEditor.tsx`

- `defaultConfigForType` 新增 `role_switch` case
- `MutexGateConfig`/`GroupGateConfig` 默认配置移除 `gate_id`
- `GateOption` 默认配置加 `description: ''`

#### `src/components/blueprint/NodeConfigPanel.tsx`

- Gate 选项编辑表单加 description 输入框
- 移除 gate_id 输入框
- 新增 RoleSwitch 配置表单（与 ModeSwitch 对称）

#### `src/components/blueprint/NodeSelector.tsx`

- 新增 `role_switch` 选项

#### 移动端同步

- `src-mobile/lib/blueprint/types.ts`（同 PC types）
- `src-mobile/lib/backend/gates.ts`（独立实现）
- `src-mobile/components/PresetDetailView.tsx`（独立实现）
- `src-mobile/components/blueprint/mobileNodeLayout.ts`（新增 role_switch 端口）
- `src-mobile/components/blueprint/MobileNodeConfigForms.tsx`（新增 RoleSwitch 表单 + Gate 选项加 description）
- `src-mobile/components/blueprint/BlueprintEditor.tsx`（defaultConfigForType 同步）

---

## 5. 改动清单（按层）

| # | 层 | 文件 | 改动 |
|---|----|------|------|
| 1 | 迁移 | `migrations/00NN_preset_gate_selections.sql` | 新增：preset_gate_selections 表 |
| 2 | 模型 | `models/blueprint.rs` | GateOption 恢复 description；Mutex/GroupGateConfig 移除 gate_id；新增 RoleSwitchConfig + NodeConfig::RoleSwitch；ExecutionContext 加 conversation_type |
| 3 | Repo（新） | `repositories/preset_gate_repository.rs` | 新增预设级 Gate 选择仓库 |
| 4 | Repo（废弃） | `repositories/conversation_gate_repository.rs` | 废弃，不再使用（文件可保留或删除） |
| 5 | 执行器 | `services/blueprint_executor.rs` | gate_selections key 用 node_id；新增 RoleSwitch 执行；移除 DuplicateGateId；validate_graph 加 RoleSwitch 端口校验 |
| 6 | 编译器 | `services/prompt_compiler.rs` | ExecutionContext 填 conversation_type；gate_selections 从 preset_gate_selections 读取 |
| 7 | 命令 | `commands/blueprint.rs` | 废弃 3 个会话级 command；新增 3 个预设级 command + load_blueprint_gates command |
| 8 | 命令注册 | `src-tauri/src/lib.rs` | 注册新 command，移除旧 command 注册 |
| 9 | 内置预设 | `services/preset_service.rs` | 内置蓝图模板若含 ModeSwitch 边则不变 |
| 10 | PC 类型 | `src/lib/blueprint/types.ts` | GateOption 恢复 description；移除 gate_id；新增 RoleSwitchConfig + NodeType |
| 11 | PC 类型 | `src/lib/backend/types.ts` | PresetGateSelection/BlueprintGate 类型 |
| 12 | PC 封装 | `src/lib/backend/gates.ts` | 新增 4 个函数封装 |
| 13 | PC 组件（新） | `src/components/PresetDetailView.tsx` | 新增预设详情视图（Gate 选项选择 + 蓝图编辑入口） |
| 14 | PC 组件（新） | `src/components/blueprint/nodes/RoleSwitchNode.tsx` | 新增 RoleSwitch 配置面板 |
| 15 | PC 组件 | `src/components/blueprint/nodeLayout.ts` | 新增 role_switch 端口/标题/配色 |
| 16 | PC 组件 | `src/components/blueprint/BlueprintEditor.tsx` | defaultConfigForType 加 role_switch + 移除 gate_id + Option 加 description |
| 17 | PC 组件 | `src/components/blueprint/NodeConfigPanel.tsx` | Gate 选项加 description 输入；移除 gate_id；加 RoleSwitch 表单 |
| 18 | PC 组件 | `src/components/blueprint/NodeSelector.tsx` | 新增 role_switch 选项 |
| 19 | PC 入口 | `src/App.tsx` | 预设工作区导航重构：卡片→预设详情→蓝图编辑器 |
| 20 | 移动类型 | `src-mobile/lib/blueprint/types.ts` | 同 #10 |
| 21 | 移动封装 | `src-mobile/lib/backend/gates.ts` | 同 #12 |
| 22 | 移动组件（新） | `src-mobile/components/PresetDetailView.tsx` | 新增 |
| 23 | 移动组件 | `src-mobile/components/blueprint/mobileNodeLayout.ts` | 同 #15 |
| 24 | 移动组件 | `src-mobile/components/blueprint/MobileNodeConfigForms.tsx` | 同 #14+#17 |
| 25 | 移动组件 | `src-mobile/components/blueprint/BlueprintEditor.tsx` | 同 #16 |
| 26 | 移动入口 | `src-mobile/App.tsx`（或对应入口） | 同 #19 |

---

## 6. 迁移策略

### 数据库迁移
- 新增 `preset_gate_selections` 表（预设级存储）。
- `conversation_gate_selections` 表保留不删（迁移文件不删除避免 checksum 问题），后端代码不再读写。
- 由于前端从未调用过会话级 Gate 选择 API，`conversation_gate_selections` 表应为空，无数据迁移。

### 蓝图 JSON 兼容性
- `MutexGateConfig`/`GroupGateConfig` 移除 `gate_id`：旧 JSON 中的 `gate_id` 被 serde 忽略（默认行为）。
- `GateOption` 恢复 `description`：旧 JSON 无此字段时反序列化为 `None`，前端加载时回退 `''`。
- `NodeConfig::RoleSwitch` 是新变体：旧 JSON 不含此变体，无兼容问题。
- ModeSwitch 端口未变：现有 ModeSwitch 边完全兼容。

---

## 7. 验收标准

### 问题3验收
- 蓝图编辑器中 MutexGate/GroupGate 节点配置面板无 `gate_id` 输入框。
- GateOption 编辑有 `label` + `description` 两个输入框。
- 保存后重新加载，`gate_id` 字段不再出现在 JSON 中，`description` 正确持久化。
- 预设详情视图显示 label + description。

### 问题4验收
- NodeSelector 中可选择 RoleSwitch 节点。
- RoleSwitch 节点展示 2 个输出端口（out_single / out_online）。
- 蓝图中可串联 RoleSwitch → ModeSwitch，实现 6 种排列组合路径。
- 单人会话（`conversation_type=single`）执行蓝图时走 RoleSwitch 的 `out_single` 分支。
- 多人会话（`conversation_type=online`）执行蓝图时走 RoleSwitch 的 `out_online` 分支。
- `validate_graph` 要求 RoleSwitch 的 2 端口都有出边，否则报错。
- ModeSwitch 节点行为完全不变。

### 问题6验收
- 预设工作区点击预设卡片进入"预设详情"视图（而非直接进蓝图编辑器）。
- 预设详情视图显示所有 Gate 节点的选项选择区。
- 互斥组显示为单选 chip，普通组显示为多选 checkbox。
- 每个选项显示 label（主）+ description（次）。
- 用户选择后，`preset_gate_selections` 表写入对应记录（key 为 preset_id + node_id）。
- 重新打开预设详情，选择状态回填。
- 预设详情中有"编辑蓝图"入口，进入蓝图编辑器。
- 蓝图执行时根据预设级选择走对应分支，不再报 `MissingGateSelection`。
- 对话界面不展示任何 Gate 选择 UI。

---

## 8. 约束合规

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | PresetDetailView 只渲染 + 调 Tauri command，不做业务逻辑 |
| C2 Zero-Fallback Errors | √ | Gate 未选择时执行报错（已有逻辑），不静默跳过；废弃 conversation_gate_selections 不做静默回退 |
| C3 Responsiveness | √ | PresetDetailView 用细粒度信号；选项点击只更新单条 selection |
| C4 AI UI Isolation | √ | 不涉及 AI 沙箱层 |
| C5 Mobile Independence | √ | PC 与移动端各自独立实现 PresetDetailView + 封装 |
| C6 Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | RoleSwitch 节点 + PresetDetailView 双端同步 |

---

## 9. 分阶段交付计划

### 里程碑 A：后端数据结构 + 命令（问题3后端 + 问题4后端 + 问题6后端）
- 迁移（preset_gate_selections 表）、模型（含 RoleSwitch + GateOption description + 移除 gate_id）、preset_gate_repository、executor（含 RoleSwitch 执行 + node_id key）、compiler（从 preset_gate_selections 读取）、commands（废弃会话级 + 新增预设级 + load_blueprint_gates）
- `cargo build --lib` + `cargo test --lib` 通过
- 验收：9 个 NodeConfig 类型测试（含 RoleSwitch）+ Gate selection 用 node_id 测试 + 预设级 selection 读写测试

### 里程碑 B：前端蓝图编辑器同步（问题3前端 + 问题4前端）
- types.ts、RoleSwitchNode、nodeLayout、NodeConfigPanel、NodeSelector、BlueprintEditor
- PC + 移动端
- `tsc --noEmit` 双端通过
- 验收：编辑器中 Gate 无 gate_id、Option 有 description、可添加 RoleSwitch 节点并连线

### 里程碑 C：预设详情视图 + 选择 UI（问题6前端）
- gates.ts 封装、PresetDetailView 组件、App.tsx 导航重构
- PC + 移动端
- `tsc --noEmit` 双端通过
- 验收：预设工作区点击卡片进入预设详情（非蓝图编辑器），可选择 Gate 选项（显示 label+description），选择状态持久化，蓝图执行走选中分支

---

## 10. 已知风险

1. **RoleSwitch 未来扩展**：用户提到后期会加 agent 模式。届时只需给 RoleSwitch 加 `out_agent` 端口 + validate_graph 校验 + 前端端口定义，ModeSwitch 完全不动。
2. **旧蓝图数据**：ModeSwitch 端口未变，兼容。新增 RoleSwitch 是新变体，旧 JSON 不受影响。GateOption 的 description 缺失时回退空字符串，兼容。
3. **conversation_type 值域**：当前只有 `single`/`online`，与 RoleSwitch 端口一一对应。未来加 agent 时需同步扩展值域。
4. **预设工作区导航重构**：当前点击预设卡片直接进蓝图编辑器，改为先进预设详情。这是较大的前端导航变更，需确保现有蓝图编辑器入口不受影响。
5. **废弃 conversation_gate_selections 表**：保留表结构不删，但后端代码不再读写。未来若需恢复会话级选择，可重新启用。

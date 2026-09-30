# Spec: 蓝图常量节点 + 分支节点（替代 RoleSwitch）

## 1. 背景与动机

### 1.1 当前状态

蓝图系统有两类"专用分支节点"：
- **ModeSwitch**：硬编码三出口 `out_legacy` / `out_mem0` / `out_stateless`，运行时读取 `context.memory_mode`
- **RoleSwitch**：硬编码二出口 `out_single` / `out_online`，运行时读取 `context.conversation_type`

两者都是"分支条件 + 出口端口"完全写死在节点类型里的专用节点。

### 1.2 问题

RoleSwitch 的分支逻辑写死在节点类型里，不灵活：
- 出口端口名固定（`out_single` / `out_online`），无法适配未来新增的角色类型（如 `agent`）
- 分支条件硬编码为 `conversation_type`，无法用于其他会话属性的分支
- 一个节点类型只服务一种分支场景，节点类型膨胀

### 1.3 目标

将 RoleSwitch 拆成两个更通用的节点：
- **ConstantNode（常量节点）**：运行时读取会话属性，输出该值
- **BranchNode（分支节点）**：接收上游值，按配置的 cases 匹配走对应出口

**ModeSwitch 保留专用**，不拆。理由：ModeSwitch 的三模式分支是稳定的、不会扩展的，专用节点的硬编码出口更直观。

### 1.4 设计原则

预设作者用 **ModeSwitch（三模式）+ 常量+分支（单人/多人）串联**，组合出 3×2=6 种执行路径。这样预设可以适配不同会话情况，而非固定死为一个模式服务。

## 2. 节点类型变更

### 2.1 新增：ConstantNode

**用途**：运行时读取会话属性，输出该值作为下游分支节点的输入。

**配置**：
```rust
pub struct ConstantConfig {
    pub label: String,
    /// 值来源：会话属性的键名
    /// 当前支持："conversation_type"（输出 "single" / "online"）
    /// 未来可扩展："memory_mode" 等
    pub source: String,
}
```

**序列化示例**：
```json
{
  "id": "n_const_role",
  "type": "constant",
  "config": {
    "label": "会话角色",
    "source": "conversation_type"
  },
  "position": {"x": 100, "y": 200}
}
```

**出口端口**：`out`（将值传给下游）

**运行时行为**：
- 读取 `context` 中 `source` 指定的属性
- 将值传递给 `out` 端口连接的下游节点（通常是 BranchNode）
- 当前支持的 source：
  - `"conversation_type"` → 输出 `context.conversation_type`（`"single"` / `"online"`）

### 2.2 新增：BranchNode

**用途**：接收上游 ConstantNode 的值，按配置的 cases 匹配走对应出口。

**配置**：
```rust
pub struct BranchConfig {
    pub label: String,
    /// 分支匹配规则
    /// 每条规则：匹配值 → 出口端口名
    /// 运行时按顺序匹配，第一个匹配的规则生效
    pub cases: Vec<BranchCase>,
    /// 默认出口端口名（所有 case 都不匹配时走此出口）
    /// 必填，避免无匹配时图执行器无路可走
    pub default_port: String,
}

pub struct BranchCase {
    /// 匹配值（与上游 ConstantNode 输出值做字符串相等比较）
    pub match_value: String,
    /// 匹配成功时走的出口端口名
    pub port: String,
}
```

**序列化示例**：
```json
{
  "id": "n_branch_role",
  "type": "branch",
  "config": {
    "label": "角色分支",
    "cases": [
      { "match_value": "single", "port": "out_single" },
      { "match_value": "online", "port": "out_online" }
    ],
    "default_port": "out_single"
  },
  "position": {"x": 300, "y": 200}
}
```

**入口端口**：`in`（接收上游值）

**出口端口**：每个 case 的 `port` + `default_port`

**运行时行为**：
- 接收上游 ConstantNode 传来的值
- 按顺序遍历 `cases`，第一个 `match_value` 与输入值相等的 case 生效
- 走该 case 的 `port` 出口
- 若无 case 匹配，走 `default_port`

### 2.3 废弃：RoleSwitch

**RoleSwitch 节点废弃**，被 ConstantNode + BranchNode 替代。

**迁移策略**：
- 后端 `NodeConfig::RoleSwitch` 变体保留但标记 `#[deprecated]`
- 图执行器遇到 RoleSwitch 节点仍能执行（向后兼容）
- 前端节点选择器移除 RoleSwitch 选项
- 前端加载旧图时，若遇到 RoleSwitch 节点，提示用户手动迁移为 ConstantNode + BranchNode

**迁移示例**：

旧图（RoleSwitch）：
```
Start → RoleSwitch → (out_single) → PromptSingle → End
                   → (out_online) → PromptOnline → End
```

新图（ConstantNode + BranchNode）：
```
Start → ConstantNode(source=conversation_type) → BranchNode(cases=[
  {match:"single", port:"out_single"},
  {match:"online", port:"out_online"}
], default_port="out_single")
  → (out_single) → PromptSingle → End
  → (out_online) → PromptOnline → End
```

## 3. 数据流与执行模型

### 3.1 值传递机制

ConstantNode 的输出值需要传递给下游 BranchNode。当前图执行器的 `traverse` 函数是"节点 → 出口端口 → 下游节点"的遍历，没有"值传递"概念。

**设计决策**：不引入运行时值传递管道，而是**编译期解析**。

图执行器在遍历到 BranchNode 时：
1. 查找上游 ConstantNode（通过入边回溯）
2. 读取 ConstantNode 的 `source` 配置
3. 从 `context` 中取对应属性值
4. 用该值匹配 BranchNode 的 cases
5. 走匹配的出口

这样避免了修改 `traverse` 的签名（不需要传 `value: Option<String>` 参数），保持执行器内部不变。

### 3.2 执行器改动

`traverse` 函数新增两个 match 分支：

```rust
NodeConfig::Constant(cfg) => {
    // 常量节点不直接产出值传递，仅记录 source 供下游 BranchNode 回溯查询
    // 直接连到 out 端口的下游节点继续遍历
    let next = next_node_id(graph, node_id, "out")?;
    traverse(graph, &next, context, result, visited, path)?;
}

NodeConfig::Branch(cfg) => {
    // 回溯查找上游 ConstantNode
    let source_value = resolve_constant_source(graph, node_id, context)?;
    // 匹配 cases
    let port = cfg.cases.iter()
        .find(|c| c.match_value == source_value)
        .map(|c| c.port.as_str())
        .unwrap_or(&cfg.default_port);
    let branch_target = target_of(graph, node_id, port)?;
    traverse(graph, &branch_target, context, result, visited, path)?;
    let merge_node = find_merge_node(graph, node_id)?;
    traverse(graph, &merge_node, context, result, visited, path)?;
}
```

`resolve_constant_source` 函数：
```rust
fn resolve_constant_source(
    graph: &BlueprintGraph,
    branch_node_id: &str,
    context: &BlueprintExecutionContext,
) -> Result<String, BlueprintError> {
    // 找到 branch 节点的入边
    let incoming_edge = graph.edges.iter()
        .find(|e| e.target == branch_node_id)
        .ok_or(BlueprintError::NoIncomingEdge(branch_node_id.to_string()))?;
    
    // 找到上游节点
    let source_node = graph.nodes.iter()
        .find(|n| n.id == incoming_edge.source)
        .ok_or(BlueprintError::NodeNotFound(incoming_edge.source.clone()))?;
    
    // 必须是 ConstantNode
    match &source_node.config {
        NodeConfig::Constant(cfg) => {
            match cfg.source.as_str() {
                "conversation_type" => Ok(context.conversation_type.clone()),
                "memory_mode" => Ok(context.memory_mode.clone()),
                _ => Err(BlueprintError::UnknownConstantSource(cfg.source.clone())),
            }
        }
        _ => Err(BlueprintError::BranchMustFollowConstant(branch_node_id.to_string())),
    }
}
```

### 3.3 图校验改动

`validate_graph` 新增校验：
1. **BranchNode 必须有入边**（来自 ConstantNode）
2. **BranchNode 的每个 case port 和 default_port 都必须有出边**
3. **ConstantNode 必须有 `out` 出边**

### 3.4 与 ModeSwitch 的组合

ModeSwitch 保留专用，不拆。预设作者用以下结构实现 6 种路径：

```
Start → ModeSwitch → (out_stateless) → ConstantNode → BranchNode → (out_single) → PromptSS → End
                   → (out_legacy)    → ConstantNode → BranchNode → (out_online) → PromptSO → End
                   → (out_mem0)      → ...
```

或更紧凑的串联：

```
Start → ConstantNode → BranchNode → (out_single) → ModeSwitch → (out_stateless) → PromptSS → End
                                 → (out_online) → ModeSwitch → (out_legacy)    → PromptOL → End
                                                 → (out_mem0)      → PromptOM → End
```

## 4. 前端改动

### 4.1 节点选择器

- 移除 RoleSwitch 选项
- 新增 "常量"（constant）选项
- 新增 "分支"（branch）选项

### 4.2 节点配置面板

**ConstantNode 配置**：
- `label`：文本输入
- `source`：下拉选择，选项：
  - `conversation_type`（会话角色：single/online）
  - （未来可扩展 `memory_mode` 等）

**BranchNode 配置**：
- `label`：文本输入
- `cases`：可增删的规则列表，每条：
  - `match_value`：文本输入（如 `single`）
  - `port`：文本输入（如 `out_single`）
- `default_port`：文本输入

### 4.3 节点渲染

**ConstantNode**：菱形或圆角矩形，单出口 `out`
**BranchNode**：与 ModeSwitch 类似的分支形状，多出口

### 4.4 旧图迁移提示

加载蓝图时若遇到 RoleSwitch 节点：
- 节点仍能渲染（向后兼容）
- 节点上方显示"已废弃，建议迁移为常量+分支"提示
- 不自动迁移（避免破坏用户图结构）

## 5. 后端改动清单

### 5.1 `src-tauri/src/models/blueprint.rs`

- `NodeType` 新增 `Constant`、`Branch` 变体
- `NodeConfig` 新增 `Constant(ConstantConfig)`、`Branch(BranchConfig)` 变体
- 新增 `ConstantConfig`、`BranchConfig`、`BranchCase` 结构体
- `RoleSwitch` 变体标记 `#[deprecated]`

### 5.2 `src-tauri/src/services/blueprint_executor.rs`

- `traverse` 新增 `Constant`、`Branch` 分支
- 新增 `resolve_constant_source` 函数
- `validate_graph` 新增 BranchNode 入边、出口校验
- `BlueprintError` 新增 `NoIncomingEdge`、`UnknownConstantSource`、`BranchMustFollowConstant`、`MissingBranchPort` 变体

### 5.3 `src-tauri/src/commands/blueprint.rs`

- `load_blueprint_gates` 不受影响（Gate 节点不变）

### 5.4 测试

- 新增 ConstantNode + BranchNode 单元测试
- 新增 ConstantNode + BranchNode + ModeSwitch 组合测试（6 种路径）
- 保留 RoleSwitch 旧测试（向后兼容验证）

## 6. 前端改动清单

### 6.1 PC 端（`src/`）

- `src/lib/blueprint/types.ts`：新增 `ConstantConfig`、`BranchConfig`、`BranchCase` 类型
- `src/components/blueprint/NodeSelector.tsx`：移除 RoleSwitch，新增 Constant、Branch
- `src/components/blueprint/NodeConfigPanel.tsx`：新增两种节点的配置表单
- `src/components/blueprint/nodes/ConstantNode.tsx`：新增节点渲染
- `src/components/blueprint/nodes/BranchNode.tsx`：新增节点渲染
- `src/components/blueprint/nodeLayout.ts`：新增两种节点的布局配置

### 6.2 移动端（`src-mobile/`）

- `src-mobile/components/blueprint/MobileNodeConfigForms.tsx`：新增两种节点的配置表单
- `src-mobile/components/blueprint/MobileNodeConfigPanel.tsx`：注册新节点类型
- `src-mobile/components/blueprint/mobileNodeLayout.ts`：新增布局配置

## 7. 验收标准

### 7.1 功能验收

1. 蓝图编辑器可选择"常量"和"分支"节点
2. ConstantNode 配置 source 后，运行时正确读取会话属性
3. BranchNode 根据 ConstantNode 的值走对应出口
4. ConstantNode + BranchNode 可与 ModeSwitch 串联，组合出 6 种路径
5. 旧图中的 RoleSwitch 节点仍能执行（向后兼容）
6. 旧图加载时显示迁移提示

### 7.2 构建验收

- `cargo build`（后端）
- `tsc --noEmit -p tsconfig.json`（PC 前端）
- `tsc --noEmit -p tsconfig.mobile.json`（移动端前端）

## 8. 里程碑划分

### 里程碑 A：后端节点类型与执行器

- 新增 `ConstantConfig`、`BranchConfig`、`BranchCase` 结构体
- `NodeConfig` 新增变体
- `traverse` 新增分支
- `validate_graph` 新增校验
- 单元测试

### 里程碑 B：PC 前端节点编辑

- 类型定义
- NodeSelector 注册
- NodeConfigPanel 配置表单
- 节点渲染组件
- 布局配置

### 里程碑 C：移动端前端同步

- MobileNodeConfigForms 配置表单
- MobileNodeConfigPanel 注册
- 布局配置

### 里程碑 D：迁移提示与文档

- 旧图 RoleSwitch 迁移提示
- Walkthrough 文档

## 9. 已知限制

1. **不自动迁移旧图**：RoleSwitch 节点保留但标记废弃，用户需手动迁移
2. **ConstantNode 仅支持会话属性**：当前不支持配置期固定值，后续可扩展
3. **BranchNode 仅支持字符串相等匹配**：不支持正则、数值比较等复杂匹配
4. **单上游 ConstantNode**：BranchNode 只能有一个 ConstantNode 上游，不支持多常量组合判断

# [工单 01] 统一 Agent 核心循环与图语义编排引擎设计 (Unified Agent Runtime & Graph Orchestration)

**Ticket Label**: `wayfinder:task`  
**Parent Map**: `plans/unified-all-agent-architecture/map.md`  
**Status**: `Unblocked / Frontier`

---

## Question

如何重构 Night Voyage 的底层运行器，彻底废弃 Rust 后端硬编码的“导演-演员”(`AgentPipeline::DirectorActor`) 与“剧本流水线”(`AgentPipeline::Scriptwriter`)，转而将多智能体协作流转完全交由**蓝图图语义 (Blueprint Graph Semantics)** 驱动？如何通过新增一等公民节点 **`StepBudgetNode`（步长预算节点）**，在模式分流后为各分支物理注入执行步长，配合通用的 `AgentCycleRuntime` 实现单步即时充填 (`max_steps=1`) 与多步自主推理 (`max_steps>=2`) 的统一调度？

---

## Context & Key Decisions

### 1. 根除 Rust 硬编码流水线，确立“图即编排”原则
- 彻底删除 `src-tauri/src/services/agent/orchestrator.rs` 中硬编码的 `run_scriptwriter_pipeline`（固定 draft -> critique -> polish 阶段）与 `src-tauri/src/services/agent/director_actor.rs`（固定 director -> 分镜槽位 -> actor 阶段）。
- **图即编排 (Graph IS the Orchestration)**：分镜由谁写、几个人演、被打回几次、经过哪些审阅节点，全部作为标准蓝图拓扑节点（Exec 流程引脚与 Data 数据引脚）由创作者自由连线。Rust 后端只充当通用的图执行器。

### 2. 核心物理护栏：`StepBudgetNode`（步长预算限制节点）
为了实现“**物理限制步长 + 提示词单步契约**”的双保险机制，在蓝图节点库中新增一等公民控制节点：

- **节点模型 (`src-tauri/src/models/blueprint.rs`)**：
  ```rust
  /// 步长预算限制节点配置
  #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
  pub struct StepBudgetConfig {
      /// 步长预算上限（1 表示单步直出，>=2 表示允许多步反思循环）
      #[serde(default = "default_max_steps")]
      pub max_steps: usize,

      /// 是否在第 1 步完成工具执行后强制短路（单步模式下为 true）
      #[serde(default = "default_short_circuit")]
      pub short_circuit_on_tools: bool,

      /// 节点锁状态
      #[serde(default)]
      pub is_locked: bool,
  }

  fn default_max_steps() -> usize { 1 }
  fn default_short_circuit() -> bool { true }
  ```
- **引脚规格**：
  - 输入：`in` (白三角 Exec)
  - 输出：`out` (白三角 Exec)
- **拓扑用法**：
  - 在模式 If 分流节点（`BranchNode`）后，各分支入口直接串接一个 `StepBudgetNode`；
  - 分支 A（即时叙事）：配置 `max_steps: 1, short_circuit_on_tools: true`，下游接入单步契约提示词；
  - 分支 B（复杂推理）：配置 `max_steps: 5, short_circuit_on_tools: false`，下游接入多步探案提示词与子智能体；
  - 彻底解耦“业务模式”与“步长数值”，未来新增任何分支均无需修改底层 Rust 代码。

### 3. 图编译遍历注入机制 (`blueprint_executor.rs`)
在遍历蓝图拓扑时，流经 `StepBudgetNode` 将直接向会话的编译结果 `BlueprintExecutionResult` 写入步长上下文：
```rust
NodeConfig::StepBudget(cfg) => {
    result.step_budget = cfg.max_steps;
    result.short_circuit_on_first_step = cfg.short_circuit_on_tools;
    let next = next_node_id(graph, node_id, "out")?;
    traverse(graph, &next, context, result, visited, path, values)?;
}
```

### 4. 通用单核 Agent 循环状态机 (`stream_processor.rs` / `agent_runtime.rs`)
拿到编译后的 `step_budget` 后，底层调用单一通用的驱动循环：

- **分支 A：`step_budget == 1`（单步充填模式）**：
  1. 向 LLM 发送请求（带单步契约提示词 + 工具白名单）；
  2. 正文 Token 实时通过 `llm-stream-chunk` 推送到前端打字机；
  3. 工具 Token 静默缓冲拼装；
  4. 流结束时，本地执行 ToolCall 原子落盘；
  5. **短路生效**：`short_circuit_on_first_step == true` 触发，立即收工退出，绝不发起第 2 次 API 调用，实现极致低延迟。

- **分支 B：`step_budget >= 2`（多步自主推理模式）**：
  1. 向 LLM 发送请求；
  2. 若模型响应包含工具调用（`finish_reason == "tool_calls"`）：本地执行工具，将 `ToolResult` 回注到历史消息，发起下一轮 API 请求；
  3. 循环往复，直到模型给出纯正文（`finish_reason == "stop"`）自然定稿；
  4. 若 `current_step >= step_budget` 且模型仍未退出：触发步长超限熔断错误（C2 零回退原则），显式向前端和时序泳道报错，严禁假死。

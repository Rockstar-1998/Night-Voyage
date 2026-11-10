# 01: 步长预算节点 (StepBudgetNode) 与单步直出核心循环

**What to build:** 为蓝图系统引入物理控制节点 `StepBudgetNode`，使创作者能够在模式分支后为各分支物理配置执行步长预算（`max_steps` 与 `short_circuit_on_tools`）；并在 Rust 调度层实现通用的 `AgentCycleRuntime`，在单步预算 (`max_steps=1`) 下支持模型同时产出对白与状态修改工具调用，本地执行完毕后强制短路退出，实现零二次 API 请求的低延迟单步直出。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 在 `src-tauri/src/models/blueprint.rs` 中新增 `StepBudgetConfig` 结构与 `NodeType::StepBudget` 变体，包含 `in`/`out` 两个 Exec 流程引脚。
- [ ] 在 `src-tauri/src/services/blueprint_executor.rs` 中实现对 `StepBudgetNode` 的图遍历解析，将 `step_budget` 与 `short_circuit_on_first_step` 注入 `BlueprintExecutionResult`。
- [ ] 构建通用的 `AgentCycleRuntime` 运行器，统一接收 `AgentCycleConfig`。
- [ ] 当 `max_steps == 1` 且模型触发 `finish_reason == "tool_calls"` 时，本地执行工具后立即截断返回 `AgentCycleOutcome::ShortCircuitedWithTools`，绝不发起第 2 轮请求。
- [ ] 编写测试断言：验证包含 `StepBudget(1)` 节点的蓝图图遍历产出正确的步长上下文，且单步工具调用在 1 次 API 往返后安全终止。

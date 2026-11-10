# 03: 图语义多智能体编排引擎 (废除 Rust 硬编码流水线)

**What to build:** 彻底删除 Rust 后端硬编码的 `run_director_actor_pipeline` 与 `run_scriptwriter_pipeline`，将多智能体协作、角色视界隔离、审阅打回与回路流转完全交由蓝图拓扑图语义驱动；多步推理模式（`max_steps >= 2`）根据 `finish_reason == "tool_calls"` 循环迭代，达到步长上限时触发确定性熔断保护。

**Blocked by:** 01: 步长预算节点 (StepBudgetNode) 与单步直出核心循环

**Status:** ready-for-agent

- [ ] 从 `services::agent::orchestrator` 与 `services::agent::director_actor` 中废除硬编码的流水线函数与特化 enum 分支。
- [ ] 升级蓝图图执行器，支持通过 Exec 引脚与 Data 引脚直接在拓扑中串联不同的子智能体任务节点与质量门禁节点。
- [ ] 支持在打回回边（Back-edge）中维护局部的循环计数器与 `{feedback}` 变量注入，并在超出 `max_loop_count` 时走预设的终结路径。
- [ ] 在多步推理循环中，若 `current_step >= max_steps` 仍未产出正文，触发 `BudgetExceeded` 熔断错误并显式上报（C2 零静默回退）。
- [ ] 编写测试断言：在无硬编码 Rust 函数的前提下，通过纯图拓扑运行一个带审阅打回回路的编排示例，验证迭代上限熔断与终稿定稿。

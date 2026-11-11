# 03: 图语义多智能体编排引擎 (废除 Rust 硬编码流水线)

**What to build:** 彻底删除 Rust 后端硬编码的 `run_director_actor_pipeline` 与 `run_scriptwriter_pipeline`，将多智能体协作、角色视界隔离、审阅打回与回路流转完全交由蓝图拓扑图语义驱动；多步推理模式（`max_steps >= 2`）根据 `finish_reason == "tool_calls"` 循环迭代，达到步长上限时触发确定性熔断保护。

**Blocked by:** 01: 步长预算节点 (StepBudgetNode) 与单步直出核心循环

**Status:** ready-for-agent

- [x] 从 `services::agent::orchestrator` 与 `services::agent::director_actor` 中废除硬编码的流水线函数与特化 enum 分支。
- [x] 升级蓝图图执行器，支持通过 Exec 引脚与 Data 引脚直接在拓扑中串联不同的子智能体任务节点与质量门禁节点。
- [x] 支持在打回回边（Back-edge）中维护局部的循环计数器与 `{feedback}` 变量注入，并在超出 `max_loop_count` 时走预设的终结路径。
- [x] 在多步推理循环中，若 `current_step >= max_steps` 仍未产出正文，触发 `BudgetExceeded` 熔断错误并显式上报（C2 零静默回退）。
- [x] 编写测试断言：在无硬编码 Rust 函数的前提下，通过纯图拓扑运行一个带审阅打回回路的编排示例，验证迭代上限熔断与终稿定稿。

> 执行注记（2026-11-11，工单 03 落地）：第 2–5 项已完成——新增 `services/agent/graph_orchestrator.rs`（计划编译器 + 拓扑执行器），剧本流水线路径已全面改由「蓝图资产 → 编排计划 → 按图游走」驱动，旧 `execute_dynamic_scriptwriter_pipeline*` 三个硬编码函数已删除，其测试全部移植到图执行器并保持断言强度。第 1 项部分完成（保持未勾选）：scriptwriter 特化函数已废除；`run_director_actor_pipeline` 与 `AgentPipeline::DirectorActor` 分支保留——导演-演员是运行时数据驱动的扇出拓扑（分镜数由导演结构化输出在运行时决定），其全部参数（导演提示词、演员 persona、工具白名单、工具轮次上限）已由蓝图 DirectorConfig/ActorDefinition 资产驱动，但把扇出本身表达为计划节点需要为计划 IR 新增 FanOut 节点种类的设计决策，且该路径当前无单元测试覆盖，不宜在无验收条件下强行搬动。残余项在此留证，待后续工单或用户拍板 FanOut 节点设计后收编。
>
> 执行注记追加（2026-11-11，「填补剩余缺失 · 阶段 2」）：第 1 项已由本阶段提交完成并补勾。FanOut 节点设计已拍板并落地：计划 IR 新增 `PlanNodeKind::FanOutActors` 节点种类与 `NodeInput::FanOutBeats` / `FanOutAssembly` 输入装配，`graph_orchestrator` 新增第二个计划编译器 `compile_director_plan`（DirectorConfig/ActorDefinition 资产 → 导演节点 → FanOut 节点 → 汇聚节点），执行器支持运行时按分镜数实例化演员节点与按分镜序汇聚（Scratchpad `fanout:results`）；分镜数上限为显式命名常量 `MAX_DIRECTOR_BEATS = 32`，超限 / 空分镜 / 演员失败均显式报错并带分镜定位信息（C2）。`director_actor::run_director_actor_pipeline` 的硬编码实现已删除，现为「装配资产 → 编译导演计划 → 调图执行器」的薄入口（导演 / 演员 / 装配的真实 LLM 调用经阶段闭包分发，视界裁剪、时间线事件、草稿记账、工具循环语义逐项保留）；该路径新增 8 个单元测试（扇出数 1 / 多镜保序汇聚 / 演员失败定位 / 空分镜 / 无导演供数 / 超限 / 编译校验）。`AgentPipeline::DirectorActor` 作为 `AgentModeSwitch` 资产驱动的路由标签保留：它只决定编译哪份计划、不含任何执行逻辑，原硬编码执行已不复存在。详见 `Walkthrough/20261111-1845-FanOut入图导演演员图编排-新功能增加.md`。

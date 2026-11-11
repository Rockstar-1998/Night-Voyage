//! Agent 编排子系统。
//!
//! 目录职责：
//! - [`timeline`]：把运行期发生的事（工具调用、门禁判定、HUD 补丁、Nudge 重试）作为事件推给前端，
//!   让调试抽屉的时序泳道显示**真实发生的事**，而不是前端根据流事件猜出来的；
//! - [`nudge`]：禁词命中的重试计数与决策（最多 2 次，第 3 次硬错且不落盘违规文本）；
//! - [`subagent`]：子智能体的非流式整段补全（导演/演员/初稿/批注/润色共用）；
//! - [`orchestrator`]：选流水线（单模型 / 导演-演员 / 剧本流水线）并驱动子角色串行产出；
//! - [`director_actor`]：导演-演员薄入口——编译导演计划后交图执行器以
//!   FanOut 扇出运行（导演分镜 → 演员按裁剪视界演出 → 汇聚装配定稿）。
//!
//! 编排层只负责"选谁写 + 怎么串"，推理一律走 [`subagent`]，不新写推理实现。
//!
//! - [`cycle`]：通用单核 Agent 循环运行器（工单 01）：以步长预算统一调度
//!   单步充填与多步推理，单步工具执行后强制短路、步长耗尽熔断。
//! - [`stream_cycle`]：生产流式路径接入运行器的 Adapter 层（工单 01-S1）：
//!   把 `stream_processor` 的一跳流式管线与一次工具执行分别包成运行器
//!   的 step provider / tool executor，生产单智能体轮次由运行器驱动。

pub mod cycle;
pub mod stream_cycle;
pub mod director_actor;
pub mod graph_orchestrator;
pub mod nudge;
pub mod orchestrator;
pub mod scratchpad;
pub mod subagent;
pub mod timeline;

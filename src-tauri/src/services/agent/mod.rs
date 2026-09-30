//! Agent 编排子系统。
//!
//! 目录职责：
//! - [`timeline`]：把运行期发生的事（工具调用、门禁判定、HUD 补丁、Nudge 重试）作为事件推给前端，
//!   让调试抽屉的时序泳道显示**真实发生的事**，而不是前端根据流事件猜出来的；
//! - [`nudge`]：禁词命中的重试计数与决策（最多 2 次，第 3 次硬错且不落盘违规文本）；
//! - [`subagent`]：子智能体的非流式整段补全（导演/演员/初稿/批注/润色共用）；
//! - [`orchestrator`]：选流水线（单模型 / 导演-演员 / 剧本流水线）并驱动子角色串行产出；
//! - [`director_actor`]：导演分镜 → 演员按裁剪视界演出 → 导演装配定稿。
//!
//! 编排层只负责"选谁写 + 怎么串"，推理一律走 [`subagent`]，不新写推理实现。

pub mod director_actor;
pub mod nudge;
pub mod orchestrator;
pub mod subagent;
pub mod timeline;

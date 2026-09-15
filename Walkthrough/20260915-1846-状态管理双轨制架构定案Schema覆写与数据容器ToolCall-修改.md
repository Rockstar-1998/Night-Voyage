# 20260915-1846-状态管理双轨制架构定案Schema覆写与数据容器ToolCall-修改

## 1. 改动摘要

- **受影响文件**：[`plans/agent-system-architecture-plan.md`](file:///d:/data/Night%20Voyage/plans/agent-system-architecture-plan.md)
- **改动内容**：
  1. **正式确立状态管理双轨制架构（第 1.2 节）**：
     - **传统单次模式（`STATELESS` / `LEGACY`）——「历史 Schema 全量注入 + 回复覆写填充」**：
       - 上下文：将上一轮累积的全部结构化状态作为完整 Schema 塞入 Prompt；
       - 模型输出：模型必须在回复末尾/全文按 Schema 重新生成整张结构化数据，通过全量覆盖来更新状态；
       - 状态变更：依赖大模型“自觉”覆写输出新数值；
     - **Agent 跑团游戏机制引擎——「外部数据容器 + ToolCall 精准查看与修改」**：
       - 状态载体：脱离回复文本，由独立的 Rust 内存 `DataContainer`（数值字典、背包集合、剧情标记）接管；
       - 交互机制：模型在需要时发起 ToolCall 查看（`check_inventory`, `get_stats`）或修改（`add_item`, `deduct_gold`）数据容器，由 Rust 确定性运算器与门禁执行；
       - 模型输出：**最终回复 100% 为纯净文学叙事，彻底消灭每轮大模型对整张庞大 Schema 的复读与覆盖开销**；
       - Token 巨大优化：消灭传统模式随背包条目增多导致的上千 Token 重复输入输出开销；
  2. **常驻 HUD 双数据源分流（第 4.3 节）**：
     - 传统模式：`stream_processor` 从大模型覆写输出的 Schema 字段中提取 `PersistentHUD` 字段发射 Patch 刷新 HUD；
     - Agent 模式：ToolCall 触发 `DataContainer` 变更即刻发射 Patch 原地刷新 HUD，终稿文本不再包含任何 Schema；
  3. **蓝图与系统协作对齐（第 5、7、8、10 节）**：
     - 蓝图中的 `ToolDefinition` 与 `Calculator` 明确作为 `DataContainer` 的规则控制器；
     - 更新全流程连线拓扑图与验收指标。

## 2. 改动动机

响应用户对状态管理本质的深刻定案：“不一样，我打算让传统state less与legacy仍然使用schema来管理状态，但是agent模式直接就使用toolcall来管理一个数据容器，区别就在于一个是完整塞入每轮对话的历史schema，回复时填充覆盖schema，一个是查看与修改数据容器”。
彻底厘清了 Schema 覆写模式与 ToolCall 容器模式的本质区别，使系统在保持传统预设向下兼容的同时，让 Agent 跑团模式在 Token 效率、数值确定性与文学叙事纯净度上达到终态水准。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 无论是 Schema 字段提取还是 DataContainer 变更，计算与持久化全在 Rust，前端仅纯渲染 HUD |
| C2 Zero-Fallback Errors | √ | DataContainer 的门禁拦截显式阻断并报错，严禁静默覆盖或伪成功 |
| C3 Responsiveness | √ | Agent 模式消灭了每轮庞大 Schema 的生成开销，网络与打字机响应性大幅提升 |
| C4 AI UI Isolation | √ | 双轨制下的常驻 HUD 均强制在 `Shadow DOM` 内隔离运行，绝对不污染 SolidJS 宿主 |
| C5 Mobile Frontend Independence | √ | PC 侧边/吸顶与移动端吸顶条/全屏抽屉完全独立实现，零共享 UI 代码 |
| C6 Project Cache Location | √ | DataContainer 驻留内存，回合结算单次持久化，零磁盘碎文件 |
| C7 PC/Android Coverage | √ | 双轨制状态流转与常驻 HUD 在双端全量贯通支持 |

## 4. 验收记录

- **验收方式**：
  - 检查 [`plans/agent-system-architecture-plan.md`](file:///d:/data/Night%20Voyage/plans/agent-system-architecture-plan.md) 第 1.2 节、第 2 节、第 3 节、第 5 节及第 10 节状态双轨制逻辑自洽性；
  - 核验 Agent 模式下是否存在冗余的 Schema 终稿复读。
- **预期效果**：
  - 形成彻底解耦、概念清晰、高信息密度的双轨制状态管理规范。
- **实际结果**：
  - 文档已全面更新，拓扑数据流、对比表格与执行时序精准对齐。

## 5. 已知限制或后续待办

- 待方案评审通过后，在实施 Milestone 2 中落地 `DataContainer` 结构体及相关的 `check_inventory`、`buy_item` 等内置与自定义 ToolCall 运行时。

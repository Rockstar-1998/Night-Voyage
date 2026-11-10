# Wayfinder 规划路线图：Night Voyage 全 Agent 统一执行架构 (Unified All-Agent Architecture)

**Map Label**: `wayfinder:map`  
**Tracker System**: `local-markdown`  
**Reference Standards**: `AGENTS.md` (C1, C2, C3, C7, C8, C9, C10, C11), `GLOSSARY.md`

---

## Destination

将 Night Voyage 会话与底层推理调度引擎全面重构为通用的**“全 Agent 统一执行体系”**：
1. 废除割裂的 Legacy/Stateless 与 Agent 双套底层实现，底层统一为单一的 Agent 循环运行器；
2. 彻底消除 Rust 后端对“导演-演员”或“剧本流水线”的硬编码分支，多智能体协作、审阅打回与执行流转完全由**蓝图图语义 (Blueprint Graph Semantics)** 自由编排；
3. 支持**单步充填 (Single-Pass, `max_steps=1`)** 与**多步推理 (Multi-Pass, `max_steps>=2`)** 统一调度；单步模式下以 ToolCall 替代 Schema 作为通用状态载体，配合分而治之流式管线实现即时打字机对白与原子状态落盘；
4. 业务层数据驱动能力矩阵 (`MODE_CAPABILITIES`) 全面适配 Agent 状态变更生命周期（Edit、Regenerate、Fork、Delete、Rewind、SubmitAbort）；
5. 研发期保持生产代码绝对纯粹，不写向后兼容胶水代码，旧逻辑与旧数据迁移隔离为独立的离线单向转换工具 (`nv-converter`)。

---

## Notes

- **领域分类**：系统级核心重构（Rust 后端调度引擎 + 状态机能力矩阵 + 流式处理器）。
- **必须遵循的 Guardrails**：
  - **C1 (Frontend Render-Only)**：工具解析、门禁判定、步长预算控制与状态落盘完全在 Rust 后端收口，前端仅负责渲染与事件响应。
  - **C2 (Zero-Fallback Errors)**：步长超限必须显式触发熔断报错；工具执行失败必须提供确定性结构化回执，严禁静默吞异常。
  - **C3 (Responsiveness Protection)**：单步直出模式必须保障对白首字流式（Zero-Latency Streaming），UI 线程永不假死。
  - **C7 (PC/Android Coverage)**：双端前端共享相同的 Tauri 命令与流事件通道。
  - **Rust Idiomatic Style**：严禁裸 `unwrap()`；消灭 `match AgentPipeline` 类的硬编码行为分支，转为图节点 trait 调度与纯数据查表。
- **关联技能**：`night-voyage-guardrails`, `domain-modeling`, `codebase-design`。

---

## Decisions so far

*(暂无已关闭决策工单)*

---

## Frontier (未被阻塞的开放工单)

- [[工单 01] 统一 Agent 核心循环与图语义编排引擎设计](file:///d:/data/Night%20Voyage/plans/unified-all-agent-architecture/ticket-01-unified-agent-loop-runtime.md) (`wayfinder:task`)
- [[工单 04] 预设代码化交换格式与双向 AST 编译器设计](file:///d:/data/Night%20Voyage/plans/unified-all-agent-architecture/ticket-04-preset-package-format-redesign.md) (`wayfinder:task`)

---

## Blocked Tickets (等待前置依赖解决的工单)

- [[工单 02] 分而治之流式处理器改造 (对白流式 + 工具缓冲)](file:///d:/data/Night%20Voyage/plans/unified-all-agent-architecture/ticket-02-streaming-processor-divide-and-conquer.md) (`wayfinder:prototype`) — *Blocked by [工单 01]*
- [[工单 03] ToolCall 通用状态载体与零延迟旁白保底规范](file:///d:/data/Night%20Voyage/plans/unified-all-agent-architecture/ticket-03-toolcall-universal-carrier-and-fallback.md) (`wayfinder:task`) — *Blocked by [工单 01], [工单 02]*
- [[工单 05] 会话能力矩阵重构与纯净隔离转换器设计](file:///d:/data/Night%20Voyage/plans/unified-all-agent-architecture/ticket-05-session-compatibility-and-matrix-governance.md) (`wayfinder:task`) — *Blocked by [工单 01]*

---

## Not yet specified (迷雾边界：后续演化点)

- **动态步长插拔机制 (Dynamic Step Budget Adjustment)**：运行时根据玩家输入复杂度动态建议步长预算，而非完全静态配置。
- **跨 Agent 工具并发执行引擎 (Parallel Tool Execution Engine)**：单步内多工具并发触发时的 SQLite 事务锁与写入冲突仲裁。

---

## Out of scope (明确排除的非本期工作)

- 修改用户的蓝图预设文件（保留创作者完全自主权，严禁擅自修改用户的 `.nvpreset.json`）。
- 在生产代码库中编写任何形式的运行时向后兼容胶水分支（所有向后兼容性通过独立离线工具 `nv-converter` 单向处理）。
- 在 Rust 后端保留任何特化命名的多智能体流水线（如 `DirectorActor` / `Scriptwriter` 等硬编码 enum）。

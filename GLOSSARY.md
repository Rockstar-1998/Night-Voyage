# Night Voyage 核心领域术语表 (Glossary)

本文档定义 Night Voyage 项目的核心领域概念，严禁包含具体代码实现细节与特定预设的分支布局。

---

## 智能体与执行模型 (Agent & Execution Model)

### 智能体步长 (Agent Step)
向大语言模型 (LLM) 发起一次完整的 API 请求、并完成其响应结果（包括可能触发的本地工具调用）处理的完整周期。

### 单步充填模式 (Single-Pass Execution)
步长上限固定为 1 的执行契约。在单次请求中同时接收玩家输入、输出对白文本并触发用于状态修改的工具调用；工具本地执行完成后强制终止会话轮次，不向大模型发起二次请求，优先保障流式打字与即时状态同步。

### 多步推理模式 (Multi-Pass Deliberation)
步长上限为 $N \ge 2$ 的执行契约。系统允许大模型在多轮交互中先调用查询与感知类工具、接收执行回执后再次反思，直至大模型自主决定输出最终正文或达到步长上限熔断。

### 图语义编排 (Blueprint-Semantic Orchestration)
完全由蓝图画布的节点拓扑、Exec 流动引脚、数据引脚与宏子图决定多智能体协作流转（如分镜、审查、打回），Rust 底层引擎仅作为通用的图执行器，严禁在后端硬编码“导演-演员”或“剧本审查”等专有业务流水线。

### 步长预算熔断 (Step Budget Circuit Breaker)
当多步推理智能体在连续多次循环中持续发起工具调用、且调用轮次达到配置的步长上限时，系统强制中止后续 API 请求并显式报错的保护性机制。

---

## 流式与数据载体 (Streaming & Data Carrier)

### 分而治之流式管线 (Divide-and-Conquer Streaming)
在单步充填模式下，对白文本 Token 实时推送到前端实现打字机效果，而工具调用 Token 在后端本地缓冲区中静默拼装；待流完全结束且 JSON 校验有效后，原子化执行状态落盘并触发界面状态刷新。

### 工具调用通用载体 (ToolCall Universal Carrier)
废除依赖供应商各异的 JSON Schema / Structured Outputs 与伪 XML 标签提取，将一切非对白的状态修改（金币扣除、物品增减、好感度刷新、待办更新）统一规范化为基于标准 Function/Tool Calling 的参数载体。

### 零延迟旁白保底 (Zero-Delay Fallback Narrative)
当大模型在单步充填模式下仅输出了工具调用而对白内容为空时，系统在不发起第二次大模型请求的前提下，自动依据工具回执在服务端合成一条极简叙事旁白的保障机制。

---

## 蓝图编排拓扑 (Blueprint Topology)

### 步长预算节点 (Step Budget Node / `StepBudgetNode`)
蓝图拓扑中的流程控制节点，位于分支路由或管线入口处。负责在图遍历阶段向会话编译上下文物理注入 `max_steps`（步长上限）与 `short_circuit_on_tools`（单步工具短路标志），实现对下游执行周期的硬件级配额约束。

### 管线路由网关 (Pipeline Router)
蓝图拓扑中的首要分流节点，负责将流程显式导向不同分支（如即时叙事分支 vs 复杂探案分支），取代混淆底层记忆模式的历史分支节点。

### 全局能力池 (Global Capability Pool)
预设中所有原子工具定义 (ToolDefinition) 与逻辑宏 (Macro) 构成的统一能力集合，通过白名单机制向各智能体节点授权。

---

## 预设与资产格式 (Preset & Asset Serialization)

### 代码化预设 (Code-Defined Preset / `.nv.ts`)
基于 TypeScript 声明式 DSL 语法的外部分发与 AI 交互载体。将散落的节点 UUID、坐标矩阵与图字典抽象为高阶函数、状态绑定与宏结构，行数较单体 JSON 压缩 95% 以上，且完全面向大模型阅读、生成与差异比对优化。

### 原生 AST 转译器 (Native Rust AST Transpiler)
运行于 Rust 后端、无外部 Node.js / JavaScript 运行时依赖的轻量静态语法树解析模块（基于 `oxc_parser`）。负责在内存中实现 TypeScript 代码与 SQLite 内部图拓扑模型 (`BlueprintGraph`) 的双向无损编译。

---

## 会话能力矩阵与治理 (Session Capability Matrix & Governance)

### 数据驱动能力矩阵 (Data-Driven Capability Matrix)
通过纯常量数据查表决定当前会话模式下各类业务操作（编辑 Edit、重新生成 Regenerate、分支 Fork、删除 Delete、中止 SubmitAbort、发送 Send、回溯 Rewind）的放行、阻断或快照受限状态。

### 状态事务回溯 (State Transactional Rollback)
当对已产生状态修改的智能体轮次执行重新生成 (Regenerate)、删除 (Delete) 或回溯 (Rewind) 时，系统依据轮次快照实现游戏状态容器的原子化恢复，保障数据一致性。

### 隔离单向转换器 (Standalone One-Way Converter)
用于将旧版预设与历史会话数据单向升级为新版格式的独立离线工具。生产运行时代码中严禁残留向后兼容的胶水分支与回退掩盖。

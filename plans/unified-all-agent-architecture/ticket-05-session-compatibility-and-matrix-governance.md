# [工单 05] 会话能力矩阵重构与纯净隔离转换器设计 (Capability Matrix & Standalone Converter)

**Ticket Label**: `wayfinder:task`  
**Parent Map**: `plans/unified-all-agent-architecture/map.md`  
**Blocked by**: `[工单 01]`  
**Status**: `Blocked`

---

## Question

在核心引擎全面收拢为统一 Agent 执行模型后，如何重构 `src-tauri/src/services/chat/mode.rs` 中的纯数据驱动会话能力矩阵 (`MODE_CAPABILITIES`)，使其严密契合智能体生命周期中各种复杂交互行为（包括携带状态突变的 Edit、Regenerate、Fork、Delete、Rewind 与流式中途 SubmitAbort）？同时，如何遵循“开发期零向后兼容包袱”原则，将全部旧逻辑代码剥离至独立的离线单向转换工具中？

---

## Context & Key Decisions

1. **核心重点：能力矩阵 (`MODE_CAPABILITIES`) 重新适配 Agent 真实生命周期**：
   - 现有的 `MODE_CAPABILITIES` 是基于纯文本对白设计的常量查表。但在统一 Agent 体系下，一个回合不仅有文本，还伴随着 **ToolCall 引起的真实数据容器变更（如扣减信用点、加背包道具）**。
   - 各项业务操作在数据驱动矩阵下的放行/阻断行为必须重新规范：
     - **重新生成 (Regenerate)**：
       - 若本轮未执行过修改类工具：`OpCapability::Allow`，直接重新发起 Agent 循环；
       - 若本轮已发生状态修改（ToolCall 提交落盘）：必须依赖**状态事务快照 (State Snapshot)** 自动回滚本轮状态差量后再重新生成；若无快照则标记为 `SnapshotLimited`，严格防止重复扣款或数据累加幻觉。
     - **消息编辑 (Edit) 与回溯 (Rewind)**：
       - 回溯到第 N 轮时，不仅裁剪消息历史表，必须原子回滚游戏状态快照至第 N 轮前的状态基线。
     - **消息分支 (Fork)**：
       - 从某轮分支时，克隆前置消息历史并完整克隆当时的 `game_state` 状态切片，生成独立的平行宇宙会话。
     - **强行中止 (SubmitAbort)**：
       - 当用户在流式中途点击中止时：立即切断正在进行的 HTTP 请求或子代理循环；若当前单步内已收集未提交的 ToolBuffer，直接丢弃，确保未定稿的状态修改绝不落盘。
   - **设计准则**：严格维持 Rust 官方风格与 Night Voyage 约束——**纯数据常量表查表，无继承，类型驱动，编译期锁定无效状态**。

2. **生产运行时彻底摆脱历史包袱（零向后兼容）**：
   - **严禁**在生产端代码（`src-tauri/src/services/`）中编写“如果是旧格式则走兼容分支，如果是新格式则走统一 Agent”的胶水代码（彻底消除 C2 隐患）；
   - 生产环境的 `stream_processor.rs` 与 `agent_runtime.rs` 只认统一的 `AgentCycleConfig`，完全删除 `chat_mode != "director_agents"` 时的历史拦截和分支判断；
   - 数据库中冗余或旧版字段不强行保留兼容解释，仅保留统一 Agent 必需字段。

3. **旧逻辑隔离为独立单向转换工具 (`nv-converter`)**：
   - 将旧版无状态解析、旧版预设解析、旧版会话恢复逻辑彻底从主应用剥离，独立封装为一个离线转换程序（或 Tauri 后门开发期独立命令行工具）；
   - 该工具职责唯单一：**单向读取旧版格式 -> 自动转换为符合最新图语义与 Agent 规范的新数据包 -> 输出新格式**；
   - 保证主仓库生产代码始终保持最轻量、最纯粹的极简架构。

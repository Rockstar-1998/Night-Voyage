# 06: 独立离线单向格式转换器 (nv-converter)

**What to build:** 构建一个完全独立的离线数据转换工具（`nv-converter`），将历史遗留的旧版无状态蓝图预设与旧会话记录单向升级为符合最新图语义规范与统一 Agent 架构的新格式；确保主程序生产代码中不残留任何用于向后兼容的胶水代码与运行时分支判断，保障生产运行时的极致纯净。

**Blocked by:** 01: 步长预算节点 (StepBudgetNode) 与单步直出核心循环, 05: 代码化预设 (.nv.ts) 双向 AST 编译器与 MCP 交互端点

**Status:** ready-for-agent

- [x] 建立独立的工具子项目或离线 CLI 命令模块（与主程序生产路径解耦）。
- [x] 实现旧版无状态图 JSON 向新版统一图语义的单向数据转换逻辑。
- [x] 实现将旧版预设直接转换为新版 `.nv.ts` 代码文件的能力。
- [x] 全量扫描并清理 `src-tauri/src/services/` 中的旧模式兼容分支（彻底移除 `chat_mode != "director_agents"` 时的拦截判断）。
- [x] 编写测试断言：验证旧版预设能够被独立转换器完整、无损地升级为新版代码预设并在主程序中成功加载。

> 执行注记（2026-11-11，工单 06 落地）：5 项全部完成。两点成文说明：①`repositories/round_repository.rs` 中 `chat_mode == "director_agents"` 的判断是写入 `agent_runs.orchestration_mode` 的**来源标签**（历史记录元数据），不是运行时拦截分支，予以保留；三处 `!= "director_agents"` 拦截（orchestrator::resolve_pipeline、chat_service::submit_tool_results、stream_processor 工具分发）已彻底移除，编排与工具可用性改由蓝图资产决定，其中 resolve_pipeline 在蓝图缺 AgentModeSwitch 节点时按单智能体直出（图即权威）。②「旧会话记录」升级：会话侧的 stateless 记忆模式已由历史迁移 0050 在库内收敛，chat_mode 旧会话在新语义下直接按蓝图资产运行、无需离线转换；本转换器的输入契约是旧预设图 JSON 文件。legacy sampling_params 节点原样保留并警告（现行模型可加载），转换器不猜测目标协议。

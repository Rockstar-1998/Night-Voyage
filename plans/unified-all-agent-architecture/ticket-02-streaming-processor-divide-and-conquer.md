# [工单 02] 分而治之流式处理器改造 (Divide-and-Conquer Streaming Processor)

**Ticket Label**: `wayfinder:prototype`  
**Parent Map**: `plans/unified-all-agent-architecture/map.md`  
**Blocked by**: `[工单 01] 统一 Agent 核心循环与步长状态机设计`  
**Status**: `Blocked`

---

## Question

在单步充填智能体 (`Single-Pass Agent`, `max_steps=1`) 下，大模型往往在同一个流式连接中混合交织吐出正文字符 (`delta.content`) 与工具调用参数 (`delta.tool_calls`)。如何改造 `stream_processor.rs`，既能保证正文毫秒级流式打字机动画（C3 原则），又能确保工具 JSON 完整收集、本地校验、状态原子落盘与 UI-HUD 补丁无缝应用？

---

## Context & Key Decisions

1. **混洗流的两路分离**：
   - 当收到 SSE Chunk 时：
     - 若包含 `delta.content`（非空）：立即向前端发射 `llm-stream-chunk` 事件，让玩家即时看到文字输出。
     - 若包含 `delta.tool_calls`：截留该部分 Token，将其喂入后端的 `StreamingToolAccumulator` 本地缓冲区进行静默拼接。
2. **流终止时的原子提交机制 (`stream_end`)**：
   - 当传输层信号 `[DONE]` 抵达时：
     - 首先验证 `StreamingToolAccumulator` 中的 JSON 是否能成功反序列化；
     - 调取 `execute_tool_call_with_plan` 逐个执行工具（如扣减信用点、加背包道具）；
     - 将修改合并进 SQLite 事务并执行提交；
     - 立即向前端发射 `game-state:patch` 事件（右侧 HUD 实时变动）；
     - 向时序泳道发射 `agent:timeline_event`（记录工具留痕）。
3. **多步推理模式 (`Multi-Pass`) 的差异化流式行为**：
   - 在多步编排模式下，前置中间轮次（中间思考/工具收集）不在屏幕上逐字吐出半成品气泡，而是发射 `agent:thinking_pulse` 状态指示；
   - 直至最后一轮产生纯对白定稿时，整体一次性淡入渲染，彻底规避中间思考稿闪现与回滚撤销。

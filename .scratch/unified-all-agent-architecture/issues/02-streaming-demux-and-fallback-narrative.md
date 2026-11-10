# 02: 分而治之流式处理器解耦与零延迟旁白保底

**What to build:** 改造 `stream_processor.rs`，在单步充填模式下实现混合 SSE 流的双路分流（对白文本 Token 实时推送到前端打字机，工具 JSON Token 静默拼装在本地缓冲中）；在流结束时原子执行工具、提交 SQLite 事务并推送 HUD 状态补丁；若大模型仅输出 ToolCall 遗漏对白，后端自动合成一条极简交互行为旁白入库，杜绝前端出现空白消息气泡。

**Blocked by:** 01: 步长预算节点 (StepBudgetNode) 与单步直出核心循环

**Status:** ready-for-agent

- [ ] 在 `stream_processor.rs` 中实现 `StreamingToolAccumulator` 缓冲区，过滤并拦截 `delta.tool_calls`。
- [ ] 确保 `delta.content` 实时通过 `llm-stream-chunk` 事件推流给前端，保证打字机零首字延迟（C3 响应性原则）。
- [ ] 在流传输终止（`[DONE]`）时，解析缓冲区内的完整 ToolCall JSON，原子执行工具并提交 SQLite。
- [ ] 提交成功后立即发射 `game-state:patch` 与 `agent:timeline_event` 事件。
- [ ] 增加零延迟旁白合成防线：若 `assistant_content.trim().is_empty()` 但执行了工具，自动合成 `*（完成了交互结算：[...]）*` 填充对白并入库。
- [ ] 编写测试断言：验证混洗 SSE 流中的文本即时发射、工具在流结束后原子落盘、以及纯工具调用流产出非空合成对白。

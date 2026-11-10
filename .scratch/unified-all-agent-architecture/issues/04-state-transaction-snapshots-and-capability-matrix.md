# 04: 状态事务快照与会话能力矩阵 (MODE_CAPABILITIES) 适配

**What to build:** 升级纯数据驱动的 `MODE_CAPABILITIES` 能力查表，将其与智能体伴随 ToolCall 产生的状态突变生命周期深度契合；引入每轮对话前的轻量游戏状态快照，使用户在界面上执行重新生成 (Regenerate)、删除 (Delete)、回溯 (Rewind) 时能够原子回滚受影响的属性与背包，并支持流式中途安全中止 (SubmitAbort)。

**Blocked by:** 01: 步长预算节点 (StepBudgetNode) 与单步直出核心循环

**Status:** ready-for-agent

- [ ] 在 `src-tauri/src/repositories/` 中建立每轮 Agent 执行前的状态快照捕获机制（`RoundSnapshot`）。
- [ ] 适配 `src-tauri/src/services/chat/mode.rs` 中的 9 个会话模式能力轮廓，严格维持纯数据查表风格。
- [ ] 实现 `Regenerate` 时的原子状态回退：重新生成某轮带有状态修改的消息前，自动将 `game_state` 还原至该轮快照基线，防止重复扣款与数据膨胀。
- [ ] 实现 `Delete` 与 `Rewind` 级联状态恢复：回溯历史时，同步恢复目标轮次的游戏状态容器。
- [ ] 完善 `SubmitAbort` 中止逻辑：流式中途用户点击中止时，切断连接并物理丢弃未提交的工具缓冲，确保无脏数据落盘。
- [ ] 编写测试断言：验证执行扣款工具后点击 Regenerate，金币数值准确回滚且新一轮正常生成。

# 04: 状态事务快照与会话能力矩阵 (MODE_CAPABILITIES) 适配

**What to build:** 升级纯数据驱动的 `MODE_CAPABILITIES` 能力查表，将其与智能体伴随 ToolCall 产生的状态突变生命周期深度契合；引入每轮对话前的轻量游戏状态快照，使用户在界面上执行重新生成 (Regenerate)、删除 (Delete)、回溯 (Rewind) 时能够原子回滚受影响的属性与背包，并支持流式中途安全中止 (SubmitAbort)。

**Blocked by:** 01: 步长预算节点 (StepBudgetNode) 与单步直出核心循环

**Status:** ready-for-agent

- [x] 在 `src-tauri/src/repositories/` 中建立每轮 Agent 执行前的状态快照捕获机制（`RoundSnapshot`）。
- [x] 适配 `src-tauri/src/services/chat/mode.rs` 中的 9 个会话模式能力轮廓，严格维持纯数据查表风格。
- [x] 实现 `Regenerate` 时的原子状态回退：重新生成某轮带有状态修改的消息前，自动将 `game_state` 还原至该轮快照基线，防止重复扣款与数据膨胀。
- [x] 实现 `Delete` 与 `Rewind` 级联状态恢复：回溯历史时，同步恢复目标轮次的游戏状态容器。
- [x] 完善 `SubmitAbort` 中止逻辑：流式中途用户点击中止时，切断连接并物理丢弃未提交的工具缓冲，确保无脏数据落盘。
- [x] 编写测试断言：验证执行扣款工具后点击 Regenerate，金币数值准确回滚且新一轮正常生成。

> 执行注记（2026-11-11，工单 04 落地）：6 项全部完成。快照基线存于新表 `round_snapshots`（迁移 0051），捕获点在 `spawn_stream_task` 执行入口（首次捕获为准，同轮重试不覆盖），捕获失败按 C2 显式失败收尾。Delete 的级联恢复有明确语义边界：删除最后一轮 → 还原其基线；删除中间轮 → 仅清理其快照记录（后续轮次仍存在，其状态建立在现状态之上，强行回退会破坏后续轮次的一致性）。SubmitAbort 的「切断连接」沿用既有轮次状态轮询中止链（status=aborted → 流任务停止消费并析构局部的流式工具累积器），本单补齐缺失的一环：物理丢弃回合内未提交的暂存状态缓存（`discard_session_state_cache`）。MODE_CAPABILITIES 九模式矩阵本体为纯数据查表、单元格未动，适配以纯推导谓词 `requires_snapshot_rollback` 落地（被放行的 Regenerate/Delete/Rewind 必须联动回滚），全矩阵测试锁定。

> 阶段 1 有界补齐注记（2026-11-11）：① Fork 克隆已补齐——`RoundSnapshotRepository::clone_snapshot` 把源轮基线克隆到新分支对应轮，`conversations_fork` 对每个被复制轮次调用；源轮无基线时为显式 no-op（返回 `false`）。② Delete 中间轮已由「仅清理其快照记录」升级为级联失效语义（`cascade_invalidate_for_deleted_round`）：被删轮与其后全部轮次的基线一并失效，失效条数经 `MessageDeleted.invalidated_later_snapshots` 向调用方明示。spec §5 字面「级联回滚到删除点」未字面实现，原因按三项格式记录如下：
> - 风险点：后续轮次的基线是在「被删轮突变已发生」的历史链上捕获的（基线内含被删轮的状态效果），且会话现状态同时含被删轮与后续轮的突变；不存在任何既有快照能表达「去掉被删轮、保留后续轮」的状态。若按字面把现状态回滚到被删轮基线，后续轮（消息仍在、仍可见）的合法突变会被一并抹掉，状态与可见历史不一致；若保留后续轮基线，日后对后续轮 Regenerate/Delete 还原时会把已删轮的效果静默复活。
> - 影响范围：`ChatService::delete_message` 的中间轮删除路径与 `round_snapshots` 中被删轮及其后轮次的基线行；后续轮在级联失效后失去快照回滚能力（其 `restore` 显式走无基线路径），现状态与后续轮消息本身不受影响。
> - 建议的修正方向：已落地的最接近安全语义为「级联失效而非级联回滚」——删除陈旧基线以杜绝错误复活，并经事件明示失效范围；若未来要实现字面级联回滚，需要为每轮保存可重放的工具突变日志（delta log），删除中间轮时按「基线 + 重放剩余轮次 delta」重建状态，这属于独立工单范围，不在本阶段内。

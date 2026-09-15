# 20260915-1736-stateless与legacy模式常驻HUD与主题定制贯通-修改

## 1. 改动摘要

- **受影响文件**：[`plans/agent-system-architecture-plan.md`](file:///d:/data/Night%20Voyage/plans/agent-system-architecture-plan.md)
- **改动内容**：
  1. **常驻 HUD 表现层跨模式全贯通（第 1.2、4.3 节）**：
     - 常驻响应式 HUD 表现层不再仅限 Agent 模式，而是确立为全系统通用能力，全面覆盖 `STATELESS`（无状态感知）与 `LEGACY`（滑动窗口记忆）基础会话模式；
     - 在 `STATELESS` / `LEGACY` 模式下，单次 LLM 流式输出的结构化 Schema 响应由 `stream_processor` 即时解析，被标记为 `PersistentHUD` 的字段（如生命值、金币、世界变量、天气环境）直接触发 `session:hud_state_patch` 事件广播；
     - 常驻 HUD（右侧侧边栏 `RightDock` / 顶部折叠栏 `TopSticky`）接收事件后在 `Shadow DOM` 内毫秒级原地刷新，消息流仅展示正文叙事，彻底消灭历史消息底部冗余尾随卡片；
  2. **Schema 编辑器增加展示目标定向分流（第 3.1 节）**：
     - 独立 Schema 编辑器字段配置增加 `display_target`（`PersistentHUD` 常驻视口 / `InlineMessage` 消息气泡内联 / `Both` 两者均显示 / `Hidden` 仅存库）；
  3. **主题系统与自定义 CSS 隔离普适化（第 4.2、4.3 节）**：
     - 无论在 `STATELESS`、`LEGACY` 还是 Agent 模式下，常驻 HUD 均全面支持四套预设主题（Dark Fantasy, Cyberpunk 2077, Minimal Ink, Classic Tabletop）与 Design Tokens；
     - 创作者编写的自定义 CSS 规则强制置入 `Shadow DOM` 物理沙箱运行（严格遵循 C4 隔离约束），绝对杜绝样式穿透污染 SolidJS 宿主；
  4. **实战连线拓扑与系统协作更新（第 7.2、8.1 节）**：
     - 新增 `STATELESS` / `LEGACY` 模式下挂载常驻 HUD 与主题的蓝图连线拓扑范例；
     - 明确 `stream_processor.rs` 在单次生成模式下的 HUD 增量补丁广播逻辑；
  5. **实施里程碑与验收标准更新（第 10 节）**：
     - Milestone 3 扩展为“全模式常驻 HUD 与 UI 设计器”，并补充了在 `STATELESS` / `LEGACY` 模式下的原地刷新与主题隔离验收指标。

## 2. 改动动机

响应用户核心定案指令：“1.stateless与legacy模式的schema显示也允许常驻到会话某处，同样允许CSS等代码主题”。
确保无论是自主推演的 Agent 复杂场景，还是轻量无状态/滑动窗口的基础对话场景，均能享受干净统一的常驻面板体验与视觉定制自由度，彻底消除对话气泡尾随堆叠卡片的历史遗留问题。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端仅负责根据后端事件原地刷新 Shadow DOM，字段提取与数据流转全部在 Rust `stream_processor` 完成 |
| C2 Zero-Fallback Errors | √ | 字段解析失败或模板绑定缺失显式报错，不静默伪成功 |
| C3 Responsiveness | √ | 原地细粒度局部刷新，消息流文字打字机动画零卡顿 |
| C4 AI UI Isolation | √ | 跨模式的自定义 CSS 与主题模板强制在 `Shadow DOM` 内物理隔离运行，绝对不污染 SolidJS 宿主 |
| C5 Mobile Frontend Independence | √ | PC 与移动端常驻挂载容器完全代码物理隔离，零共享 UI 代码 |
| C6 Project Cache Location | √ | 纯内存流式解析与轻量增量事件，不产生磁盘碎文件 |
| C7 PC/Android Coverage | √ | 跨模式常驻 HUD 与主题在 PC 与 Android 移动端均有独立的布局停靠规范 |

## 4. 验收记录

- **验收方式**：
  - 检查 [`plans/agent-system-architecture-plan.md`](file:///d:/data/Night%20Voyage/plans/agent-system-architecture-plan.md) 中 `STATELESS` 与 `LEGACY` 模式下数据流与 HUD 刷新时序闭环；
  - 核验 Shadow DOM CSS 隔离与 C4 约束一致性。
- **预期效果**：
  - 方案自洽、严谨、高密度，接手者能明确获知三态基础模式下常驻 UI 的执行机制与设计方法。
- **实际结果**：
  - 方案文档已全面完成修订，架构图、拓扑图与验收规范均已精准对齐。

## 5. 已知限制或后续待办

- 待方案评审通过后，在实施 Milestone 1 与 Milestone 3 中分别落地独立 Schema 编辑器与跨模式常驻 HUD 容器。

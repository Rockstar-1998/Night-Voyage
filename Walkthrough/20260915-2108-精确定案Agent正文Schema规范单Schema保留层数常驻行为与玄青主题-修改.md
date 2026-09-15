# 20260915-2108-精确定案Agent正文Schema规范单Schema保留层数常驻行为与玄青主题-修改

## 1. 改动摘要

- **受影响文件**：[`plans/agent-system-architecture-plan.md`](file:///d:/data/Night%20Voyage/plans/agent-system-architecture-plan.md)
- **改动内容**：
  1. **修正 Agent 模式下的 Schema 输出职责（第 1.2、2.1、5、7、10 节）**：
     - 纠正“Agent 模式完全脱离 Schema、仅纯文本”的误区；
     - 定案：Agent 模式下通过 ToolCall 精准读写独立的 `DataContainer`（业务数值、背包等），**正文处理完毕后依然按照 Schema 规范进行结构化输出（如 thinking、narrative 等槽位）**，区别在于无需在 Schema 中重新复读覆写庞大的业务背包数据，兼顾数值确定性与文学格式规范性；
  2. **修正保留层数为单个 Schema 独立配置（第 3.1、3.3 节）**：
     - 明确「保留层数」并非全系统全局设置，而是每个 Schema 资产自身的独立属性（`retention_depth: Option<u32>`）；
     - `prompt_compiler.rs` 针对不同 Schema 独立执行倒序裁剪，灵活满足即时状态（$N=1$）与任务线日志等不同层级需求；
  3. **修正常驻于会话中为“定义驱动的行为机制”（第 3.2 节）**：
     - 废除伪造的顶层全局开关；
     - 明确常驻行为取决于字段定义时的展示目标 `display_target: PersistentHUD` 与 UI 模板编辑器的布局挂载绑定；
     - 定义为 `PersistentHUD` 的字段由 `stream_processor` 自动流向常驻视口原地更新，定义为 `InlineMessage` 的字段自然流入消息气泡；
  4. **修正预设主题资产库为仅项目默认玄青色（第 4.2 节）**：
     - 移除臆造的奇幻、赛博等预设包；
     - 项目内置预设主题**仅有项目默认的「玄青色」主题（Default Xuanqing Theme）**；
     - 其它所有视觉样式风格全量由创作者通过内置代码编辑器编写自定义 CSS 实现，并在 `Shadow DOM` 内部绝对物理隔离。

## 2. 改动动机

响应用户精准校正指令：
1. “1.2 描写有误，不是Agent 跑团游戏机制引擎完全就是独立数据容器，至少正文处理完毕后还是需要按照schema规范输出”；
2. “3.1 描述有误，不是全局限制保留层数，而是单个schema设置”；
3. “3.2 功能一描述有误，不是什么开关，而是取决于定义时的行为”；
4. “4.2 描述有误，预设主题资产库仅项目默认玄青色，其他样式需要自定义代码”。
通过对这 4 项核心细节的精准校准，使整体架构方案消除逻辑断层，达到严密自洽的工程定案水准。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 数据容器变动、正文 Schema 提取、保留层数裁剪全在 Rust 后端，前端仅负责纯渲染 |
| C2 Zero-Fallback Errors | √ | 单个 Schema 保留层数严格校验正整数 $N \ge 1$，非法输入即刻阻断报错，零静默 fallback |
| C3 Responsiveness | √ | 正文 Schema 剥离全量背包覆写，Prompt 倒序裁剪阻断膨胀，打字机流式响应极致轻快 |
| C4 AI UI Isolation | √ | 自定义 CSS 代码强制仅在 Shadow DOM 内部隔离生效，绝不污染 SolidJS 宿主与主线程 |
| C5 Mobile Frontend Independence | √ | PC 侧边/吸顶与移动端吸顶抽屉完全独立实现，零共享 UI 代码 |
| C6 Project Cache Location | √ | DataContainer 与 Schema 状态纯内存运行 + 单回合 SQLite 持久化，零零散磁盘碎文件 |
| C7 PC/Android Coverage | √ | 玄青默认主题、自定义 CSS 隔离容器与 Schema 结构化提取双端全量贯通支持 |

## 4. 验收记录

- **验收方式**：
  - 检查 [`plans/agent-system-architecture-plan.md`](file:///d:/data/Night%20Voyage/plans/agent-system-architecture-plan.md) 第 1.2 节、第 3 节、第 4.2 节及第 10 节；
  - 检查 Agent 模式是否明确正文按 Schema 规范输出；
  - 检查保留层数是否归属单个 Schema；
  - 检查常驻机制是否基于定义与布局驱动；
  - 检查主题是否仅保留默认玄青色。
- **预期效果**：
  - 终态定案，严禁废案叙事，高密度工程逻辑，100% 落实用户 4 点要求。
- **实际结果**：
  - 方案修改完整到位，逻辑无死角自洽。

## 5. 已知限制或后续待办

- 待方案评审完毕后，开始进入 Milestone 1 具体代码实现阶段（独立 Schema 编辑器与编译器）。

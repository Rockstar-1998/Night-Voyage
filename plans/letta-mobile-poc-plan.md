# Letta 独立移动端验证项目 (POC) 规划书

## 1. 核心目标
建立一个完全脱离当前 `Night Voyage` 主体项目的独立移动端应用程序（Mobile App）。该程序作为“概念验证（POC）”，专门用于彻底验证 Letta 引擎在长线角色扮演场景中的可行性、缓存命中率和工具调用能力。

**验收标准**：当且仅当该 POC 跑通了所有预定功能、验证了 API 费用下降且逻辑自洽后，相关架构才会反向移植进 `Night Voyage`。

## 2. 宏观架构设计
为了尽可能模拟最终生产环境，又能保持轻量，POC 将采用以下架构：

- **宿主环境 (Mobile)**: Tauri 2.0 Mobile (Android) + SolidJS。界面为纯手机端竖屏布局。
- **总指挥层 (Commander - Rust)**: 沿用原有的 Rust 中枢思想，负责业务数据的持久化（SQLite）和流程统筹。
- **记忆与对话层 (Letta - Python)**: 独立的 Python 进程/服务，完全接管对话历史。

## 3. 核心功能与职责划分

### 3.1 基础模块管理 (由总指挥 Rust 负责)
包含传统的游戏外围配置能力：
- 角色/玩家人设管理（Persona/Human CRUD）。
- 预设管理（System Rules 等底层协议设定）。
- 世界书模块（WorldBook 实体录入）。
- 会话创建与存档管理（Session CRUD）。

### 3.2 提示词编译器 (Prompt Compiler 2.0)
“总指挥”依然拥有提示词编译器，但**其职责发生根本性改变**：
- **旧版**：每次玩家说话都重新编译一次庞大的字符串。
- **新版 (POC版)**：**仅在“新建会话 / 载入会话”的那一瞬间启动**。编译器负责提取上述的人设、预设、世界书，并将它们组装成 Letta API 所需的 4 个核心内存块（`system_rules`, `world_context`, `persona`, `human`），然后一次性注入给 Letta。

### 3.3 历史记录与会话流转 (由 Python/Letta 接管)
这是与原计划最大的不同点（放弃了复杂的 CQRS 双写）：
- 玩家发送消息时，前端将消息发给 Rust，Rust 作为“透明传话筒”直接转发给 Python。
- Letta 收到消息，利用其内部的 `Recall Memory` 结合刚才的 4 个核心块处理对话。
- **历史回溯**：前端展示聊天记录时，不再读取 Rust 的本地库，而是通过 Rust 代理，直接从 Letta 引擎原生拉取历史消息记录进行过滤展示。

## 4. 实施阶段拆解 (Phases)

### Phase 1: 基础设施搭建
- 初始化新的 Tauri Mobile 项目。
- 搭建极简的 Python FastAPI 服务，集成官方 Letta SDK。
- 打通 Android 模拟器 -> Tauri Rust -> Python 服务的全链路本地网络通信。

### Phase 2: “总指挥”基础管理模块
- 在前端完成移动端的“角色卡片”、“世界书列表”和“新建会话”的 UI。
- 在 Rust 后端建立简单的 SQLite，实现这些设定的增删改查。

### Phase 3: Letta 初次注入与对话循环
- 实现“仅运行一次”的提示词编译器，将 Rust 数据转化为 Letta Agent 初始化请求。
- 打通发送消息 -> Letta 思考与记忆刷新 -> 流式返回 UI 的全过程。
- 实现拉取并清洗 Letta 原生历史记录用于 UI 渲染的接口。

## 5. 待确认风险项 (Risk)
- 直接拉取 Letta 的原生历史记录用于 UI 展示时，需要严格编写清洗脚本，剔除内部的 Tool Calls（如 `core_memory_append`），确保手机 UI 界面只渲染干净的角色对白。

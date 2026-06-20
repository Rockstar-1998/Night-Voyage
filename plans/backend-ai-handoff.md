# Backend AI Handoff: Letta Integration (Phase 1)

## 功能目标 (Feature Goal)
在后端引入对 Letta 引擎的集成管理。实现从传统的“无状态提示词拼接模式”向“Letta-Native 长记忆模式”演进。本阶段核心目标为搭建通信架构与核心记忆块的映射，并**确保最大化 Prompt 缓存命中率**。

---

## 架构演进：CQRS读写分离与 Python Sidecar

### 1. Python Sidecar 独立服务架构
由于 Letta 生态完全基于 Python，强烈建议采用 **Python Sidecar (边车模式)** 进行物理隔离：
- **独立工程**：单独编写一个极简的 Python FastAPI 程序，专门包装 Letta SDK 暴露 REST API。
- **Rust 总控**：Tauri Rust 作为父进程，在启动时通过 `std::process` 唤醒该 Python 进程（可打包为可执行文件随客户端分发）。
- **进程通信**：Rust 通过本地 HTTP (`reqwest`) 向 Python 发送指令，Python 负责极其复杂的 Agent 管理和记忆分页。

### 2. CQRS 历史记录分离同步 (UI 读写分离)
前端需要展示历史记录，但 Letta 的记忆中混杂了大量内部独白和工具调用。因此我们采用**读写分离（CQRS）**模式：
- **认知大脑 (Letta SQLite)**：只管长期记忆和 AI 逻辑流转，对前端隐身。
- **UI 渲染存储 (Rust 本地库/JSON)**：Rust 在收到用户提问和捕获到 Letta 的最终流式回复后，额外向本地写入一份极其干净的 `ui_chat_history` 存根。
- **极速首屏**：前端打开会话时，直接向 Rust 请求这份本地存根，不需要唤醒/等待 Python 端，实现秒开。

---

## 核心数据映射：Prompt Compiler -> Letta Core Memory
在 Letta-Native 范式下，我们不再把所有文本拼成一长串字符，而是映射到 Letta 引擎的 **核心记忆块 (Core Memory Blocks)**。

### 1. Letta Core Memory Blocks (核心记忆块)
- **`system_rules` 块 (只读/静态)**：底层规则（输出格式、处理联机多角色的语气协议等）。
- **`persona` 块 (读写/扮演自我)**：角色的基础人设（性格、背景）。
- **`human` 块 (读写/对玩家的认知)**：角色眼里的玩家动态评价和好感度。
- **`world_context` 块 (只读/世界设定)**：当前场景的客观背景信息（GraphRAG 摘要等）。

### 2. Prompt Caching 极致优化 (Letta Prompt Template 排序)
Letta 初始化时，必须重写其 `PromptTemplate`，强制系统提示词按以下顺序排列，利用前缀匹配极致省钱：
1. **绝对静态前缀区 (期望 100% 命中缓存)**：`Letta Tool Definitions` -> `system_rules` -> `world_context`。
2. **中低频变动区**：`persona`。
3. **高频变动区 (绝不参与缓存)**：`human`。
4. **流动区**：`Recall Memory` (滚动的近期聊天记录)。

---

## Tauri Commands (前后端调用契约)

1. **`init_letta_agent`**
   - **请求载荷**: `{ session_id: string, memory_blocks: { system_rules, persona, human, world_context } }`
   - **响应**: `Result<(), String>`
   - **行为**: Rust 调用 Python Sidecar API 创建 Agent，并初始化本地 `ui_chat_history` 表。

2. **`send_message_to_letta`**
   - **请求载荷**: `{ session_id: string, message: string }`
   - **响应**: `Result<(), String>`
   - **行为**: 
     1. Rust 先把 `message` 写入本地 UI 历史表。
     2. Rust 异步向 Python Sidecar 发送消息，结果通过 Tauri Events 推回。
     3. 捕获到最终回复后，Rust 将回复文本写入本地 UI 历史表。

3. **`get_ui_chat_history` [NEW]**
   - **请求载荷**: `{ session_id: string }`
   - **响应**: `Result<Vec<UiMessage>, String>`
   - **行为**: 前端打开页面时调用。Rust 从本地极速拉取纯净的历史记录返回。

## 性能约束与白名单边界
- **非阻塞 I/O**: 对 Letta (Python Sidecar) 的调用必须异步，严禁阻塞 Tauri UI 线程。
- **执行限制**: 本文档涉及的 Rust 与 Python 边车代码编写仅允许 OpenAI 或 Claude 代理模型执行。

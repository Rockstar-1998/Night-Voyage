# 最终回归：Night Voyage 接入 Letta Server 实施计划

> **[系统提示]**
> 我们已结束关于纯 Python/移动端的离线 POC 探索。战略重心重新回归 `Night Voyage` (Tauri + Rust + SolidJS) 主仓库。

## 1. 终极架构定调：C/S 分离模式

经过踩坑与验证，我们彻底明确了 Letta 的定位：它绝不是一个可以被随便打包的客户端库，而是一个**“重型 AI 服务端引擎 (Server)”**。

因此，`Night Voyage` 将采用标准的 **C/S (Client-Server)** 架构来拥抱 Letta：
- **服务端 (Letta Server)**：在本地以 Python Sidecar (边车) 形式运行，或者直接部署在远端。它暴露标准的 REST API，专心管理 SQLite 向量库和底层代理逻辑。
- **客户端 (Rust Client)**：`src-tauri` 中的 Rust 彻底抛弃手写的大段 Prompt 拼接，转而作为 Letta 的**强类型 API 客户端**。Rust 负责解析玩家操作，并封装成 HTTP 请求打给 Letta Server。

---

## 2. [排雷完毕] Letta REST API 精确实体类契约

基于对本地 `letta-main` 源码的深挖分析，我们拿到了最准确的接口请求体。接手的 Agent **直接在 Rust 中用 `serde` 将以下 JSON 结构定义为 Struct**：

### 2.1 创建/初始化 Agent (`POST /v1/agents`)
请求体必须包含 `memory_blocks` 和 `initial_message_sequence`（用于开场白）：
```json
{
  "name": "rpg_npc_01",
  "model": "openai/gpt-4o-mini",
  "agent_type": "letta_v1_agent",
  "memory_blocks": [
    { "label": "system_rules", "value": "...", "limit": 8000 },
    { "label": "world_context", "value": "...", "limit": 8000 },
    { "label": "persona", "value": "...", "limit": 8000 },
    { "label": "human", "value": "...", "limit": 8000 }
  ],
  "initial_message_sequence": [
    { "role": "assistant", "content": "【旁白：门被推开了】你好，旅行者。" }
  ]
}
```

### 2.2 发送消息与开启打字流 (`POST /v1/agents/{agent_id}/messages`)
日常对话时，**里面绝对只放玩家当前说的那句话，不要再带任何背景设定 Prompt**：
```json
{
  "messages": [
    { "role": "user", "content": "你好，酒馆老板" }
  ],
  "streaming": true,
  "stream_tokens": true
}
```

### 2.3 导演小纸条干预 (`PATCH /v1/agents/{agent_id}/blocks/{block_id}`)
用于临时修改背景状态（如覆写当前场景到 `director_overlay`）：
```json
{
  "value": "【系统事件：此时天空下起了大雨，请改变你的台词语气】"
}
```

---

## 3. 关键痛点解决方案 (针对八大架构疑难点)

### 3.1 历史上下文同步问题 (双写黑盒)
- **方案决策**：**坚决拒绝直接读取 Letta 的数据库**（充斥机器内部思考过程，清洗极度困难）。
- **执行规范**：Rust 充当完美代理（CQRS）。玩家发消息时，Rust 先把明文存本地 `ui_chat_history` 表，再发给 Letta。Letta 吐回最终台词时，Rust 解析存入 `ui_chat_history`。前端只查本地 SQLite，彻底隔绝 Letta 黑盒。

### 3.2 Letta 实例串台问题 (隔离机制)
- **执行规范**：在 Rust 层的 `Room` 数据库表中，必须新增一列 `letta_agent_id`。所有的 API 请求必须带上这个严格匹配的 ID，精准路由到特定的 Agent，物理杜绝串台。

### 3.3 回退与存档模式 (暴力物理热备)
- **解决方案**：Letta 是一个重状态黑盒，靠指令回退记忆极容易崩溃。最完美的存档法是：玩家点击“存档”时，Rust 直接执行**物理文件拷贝**，把 `night_voyage.db` 和 Letta 运行目录下的 `letta.db` 原封不动打包。读档时，强杀 Letta 进程，覆盖 `.db` 文件后重启，实现 100% 完美回滚。

### 3.4 结构化输出问题 (JSON Schema)
- **解决方案**：利用初始化时的 `system_rules` 内存块，给 Letta 下达底层禁令：
  *"When you use the default `send_message` tool to reply to the user, the `message` argument MUST be a valid JSON string matching this schema: `{\"narrative\": \"...\", \"dialogue\": \"...\"}`."*
  Rust 从 SSE 流中收到的内容就是一个纯正的 JSON 字符串，解析后下发给 UI 渲染。

### 3.5 API 档案（大模型配置）交接
- **执行规范**：Letta Server 自身掌管了底层的网络请求。Rust 在使用 `std::process::Command` 唤起 Letta Python Sidecar 进程时，直接从本地数据库读取 API Key 和 Base URL，并以环境变量（如 `LETTA_OPENAI_API_KEY`）的形式注入给子进程环境。做到“直接同步给 Letta”。

### 3.6 提示词编译器的平移与开场白 (First Message)
- **一次性注入原则**：**只在建档 (`POST /v1/agents`) 时注入一次！** 规则 -> `system_rules`，世界书 -> `world_context`，角色描述 -> `persona`，玩家档案 -> `human`。
- **First Message 注入**：Rust 直接把开场白构造成 `{"role": "assistant", "content": "..."}`，放到建档请求的 `initial_message_sequence` 字段里。建档成功后，Letta 内部心智自动闭环。

### 3.7 前端 UI 主界面隔离 (短路 Token 计算器代码执行)
- **痛点分析**：在 Letta 模式下，底层 Prompt 组装彻底变为黑盒，Letta 会自主决定滑动窗口和裁剪。如果在前端混合跑旧版的 Token 计算和状态获取逻辑，不仅毫无意义，而且一定会触发报错和崩溃。
- **执行规范 (代码级短路执行，保留传统模式)**：
  **警告：绝对不可删除现有代码，因为“传统编译器模式”仍然依赖它们！**
  前端代码（SolidJS）必须基于当前会话标识 (`is_letta_mode`) 实施严格分流：
  1. **逻辑短路 (Early Return)**：在所有的 Token 估算函数（Token Estimator）、后台记忆轮询函数顶部，强制插入 `if (is_letta_mode) return;`。在代码执行层面直接跳过，杜绝后台乱报错。
  2. **条件渲染隔离**：不要只是 `display: none` 隐藏，必须使用 SolidJS 的 `<Show when={!is_letta_mode}>` 包裹顶部的 Token 统计条组件。确保组件生命周期根本不被触发。

### 3.8 前端右侧边栏 (Layer Drawer) 与新建会话重构
- **新建会话引擎选择**：在“新建会话”模态框中，新增**“后端引擎选择 (Engine Selector)”**选项。让玩家决定本局是“传统无状态编译器”还是“Letta 记忆引擎”。
- **双模并存 Sidebar (绝不删代码)**：
  原版的第1~5层内存面板（世界书、状态覆盖层等）**必须完好无损地保留给传统模式**。
  在右侧边栏组件中，使用 `<Show>` 彻底隔绝两套视图：
  - `<Show when={!is_letta_mode}>`：执行并渲染原版完整的 5 层侧边栏。
  - `<Show when={is_letta_mode}>`：执行 Letta 专属视图，**仅暴露“对话预设”和“API 档案”绑定**。禁止渲染其他内存层，防止误导玩家去操作已经锁死在 Letta SQLite 内部的心智区块。

---

## 4. 执行规范与模型交接指南

> **[护栏守则重新生效 (Guardrails)]**
> 强制护栏 `SKILL.md` 重新生效：**正在进行方案规划的 Gemini 模型严禁修改任何后端运行时代码 (`src-tauri/**`)**。

请把模型切换为 OpenAI ChatGPT 系列或 Anthropic Claude，让它们阅读本计划，并在 `src-tauri` 与 前端代码中开始执行落地！

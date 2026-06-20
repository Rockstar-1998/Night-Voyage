# Prompt Compiler 架构演进里程碑 (Milestone)

本文件总结了关于将 Prompt Compiler 从“静态拼接器”升级为“动态长记忆与 Agent 上下文管理器”的核心讨论和阶段性共识。

## 架构核心概念脑图

```mermaid
mindmap
  root((Prompt Compiler<br/>Agent 架构))
    双核记忆引擎
      GraphRAG (客观维度)
        全局实体关系图谱
        由 Director 维护更新
        提供不可变的世界事实
      Letta (主观维度)
        NPC 第一人称私人日记
        对玩家的好感度与短期计划
        由 Actor 自身主动调用 Tool 更新
    角色分工解耦
      Director Agent (上帝视角/后台)
        统筹全局历史与 GraphRAG
        发现事件并更新客观世界图谱
        向 Actor 下发临时小纸条 (Overlay)
      Actor Agent (前台 NPC/演员)
        结合图谱与 Letta 私人记忆扮演
        绝不能越权获取未知的世界信息
    核心调度机制 (Rust Backend)
      倒置分层法则 (Prompt Caching)
        绝对静态区排前 (图谱/设定/规则) -> 完美命中缓存
        高频动态区排后 (Letta/导演小纸条/聊天记录)
      记忆锚点召回 (数据联动)
        Actor 写入 Letta 时附带 linked_entities
        Rust 提取实体作为锚点
        向 GraphRAG 发起子图查询并注入上下文
```

## 核心架构共识：双核记忆系统

在排除了不适合跑团/角色扮演场景的跨会话记忆管理系统（如 Honcho，会导致不同世界观角色串戏 OOC）后，我们确立了 **Letta + GraphRAG** 的双核记忆模型：

1. **Letta（Actor Agent 的主观记忆）：**
   - **定位**：绑定于具体 NPC 的“主观感性记忆”与短期工作区。
   - **机制**：通过向 LLM 注入工具（Tool Calling），允许 NPC 在开口说话前自行调用 `core_memory_append` 等工具修改自身日记。写入时需要附带 `linked_entities` 字段以便后续召回。
   - **特点**：主观、隔离。同一个玩家在不同 NPC 眼里有不同的 Letta 记忆记录。

2. **GraphRAG（客观世界法则与知识图谱）：**
   - **定位**：绑定于当前存档/世界设定的“客观全局知识库”。
   - **机制**：由后台 Director Agent 维护更新，包含所有客观事实与阵营关系。

3. **架构角色解耦：Director vs Actor：**
   - **Director Agent（上帝视角/后台剧情导演）**：不直接与玩家交互。定期运行，下发全局剧情指令（`CharacterStateOverlay`）或调用 `update_world_graph` 修改客观状态。
   - **Actor Agent（第一人称/前台演员）**：即每个对话 NPC。只使用 Letta 维护自身记忆，结合 Director 传递的指令进行角色扮演。

## 关键技术突破一：记忆锚点召回 (Memory-Anchored Retrieval)

为了打破 Letta (主观) 和 GraphRAG (客观) 之间的孤岛，实现自动联动，我们在 Rust 后端引入“记忆锚点召回”管道：
- **存储规范**：要求大模型在调用 Letta 的 `core_memory_append` 时，强制分离出实体字段（如 `"linked_entities": ["角色B", "暗影教会"]`）。
- **双重查询**：Prompt Compiler 在组装提示词时，除了根据玩家近期的聊天记录进行召回，还会**直接提取该 NPC Letta 记录中的 `linked_entities` 作为锚点**，去 GraphRAG 中查询客观知识。
- **效果**：大模型既能看到自己 Letta 中写下的“我对角色B的私人看法”，也能在同一次上下文里看到 GraphRAG 自动召回的“角色B的真实背景”，杜绝幻觉和信息断层。

## 关键技术突破二：Prompt 倒置分层法则（缓存命中策略）

为了应对长记忆上下文导致的 Token 费用爆炸，必须打破传统的拼接顺序，**按照变动频率从低到高重新排序**，以极致利用大模型厂商的 Prompt Caching 机制：

- **🧱 绝对静态区（排列在最前，期望 100% 命中缓存）**：
  - SystemInstruction (系统底层规则)
  - MultiplayerProtocol (联机底层协议)
  - ToolDefinitions (Letta & GraphRAG 工具定义 Schema)
  - CharacterBase & PlayerBase (基础人设)
  - WorldBookMatch & GraphKnowledge (本场景客观设定，以及通过**记忆锚点召回**的世界知识)
  - ---------- *缓存断点 (Cache Breakpoint)* ----------
- **📝 高频变动区（排列在最后，不缓存，随每次对话变化）**：
  - WorkingMemory (Letta 核心工作记忆，LLM 会频繁修改它)
  - CharacterStateOverlay (Director 刚刚下发的临时状态小纸条)
  - RecentHistory (近期聊天记录)
  - CurrentUser (玩家当前输入)

## 数据流转时序图 (Data Pipeline)

```mermaid
flowchart TD
    %% Define global styles
    classDef objective fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef subjective fill:#fff3e0,stroke:#f57c00,stroke-width:2px;
    classDef compiler fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;
    classDef agent fill:#e8f5e9,stroke:#388e3c,stroke-width:2px;

    User[玩家输入] --> Compiler

    subgraph 核心双引擎
        GraphRAG[(GraphRAG\n客观图谱)]:::objective
        Letta[(Letta\n主观日记)]:::subjective
    end

    subgraph Rust 后端 (Prompt Compiler)
        Compiler[Compiler: 组装 Prompt]:::compiler
        
        %% 记忆锚点召回逻辑
        Letta -.->|1. 读取实体锚点| Compiler
        Compiler -.->|2. 发起图谱查询| GraphRAG
        GraphRAG -.->|3. 返回客观知识| Compiler
    end

    subgraph Prompt 倒置分层 (注入大模型)
        direction TB
        Static[🧱 绝对静态区: \nGraphRAG摘要, 设定, Schema]
        Dynamic[📝 高频变动区: \nLetta记忆, 导演指令, 聊天]
        Static --- Dynamic
    end

    Compiler ==>|组装缓存友好的 Prompt| Static

    subgraph Agent 系统
        Actor[Actor Agent (前台)]:::agent
        Director[Director Agent (后台)]:::agent
    end

    Dynamic ==> Actor

    %% Letta 闭环
    Actor -.->|输出 Tool Call:\ncore_memory_append\n附带 linked_entities| Letta
    
    %% Director 闭环
    RecentChat[历史聊天记录] -.-> Director
    GraphRAG -.->|读取宏观状态| Director
    Director -.->|1. 输出 Tool Call:\nupdate_world_graph| GraphRAG
    Director -.->|2. 下发 CharacterStateOverlay| Compiler
```

## 运行时工作流程图 (Runtime Sequence Diagram)

为了更清晰地展示“系统到底是怎么跑起来的”，以下时序图拆解了玩家发送一句话后，前后台 Event Loop 的执行细节：

```mermaid
sequenceDiagram
    autonumber
    actor Player as 玩家
    participant Front as 前端 (SolidJS)
    participant Rust as 后端 Compiler (Tauri)
    participant DB_L as Letta 数据库
    participant DB_G as GraphRAG 图谱
    participant LLM as 大模型 API

    box rgba(232, 245, 233, 0.3) 1. 前台 Actor 交互流 (实时响应)
    Player->>Front: "你知道那个红发法师去哪了吗？"
    Front->>Rust: 发送聊天请求 (目标: 酒馆老板)
    
    Rust->>DB_L: 1. 提取酒馆老板的 Letta 主观日记
    DB_L-->>Rust: 返回日记内容 & 包含的实体锚点
    
    Rust->>DB_G: 2. 双重查询 (聊天关键词 "红发法师" + Letta锚点)
    DB_G-->>Rust: 返回客观知识摘要 (如: 红发法师已被通缉)
    
    Rust->>Rust: 3. 倒置拼接 Prompt (静态图谱在前，动态 Letta 在后)
    Rust->>LLM: 发送组装好的 Prompt (带 Tool Schema)
    
    LLM-->>Rust: 产生 Tool Call: `core_memory_append("玩家在打听通缉犯")`
    Rust->>DB_L: 执行 Tool: 更新酒馆老板日记
    Rust->>LLM: 抛回 Tool 结果: "更新成功，请回复玩家"
    
    LLM-->>Front: 流式返回台词: "嘘，小声点，他可是个危险人物..."
    Front-->>Player: 渲染对话内容
    end

    box rgba(225, 245, 254, 0.3) 2. 后台 Director 演化流 (异步触发)
    Note over Rust, LLM: 触发条件: 积累满 N 轮对话，或发生重大事件
    Rust->>DB_G: 提取当前世界大势与区域摘要
    Rust->>Rust: 打包近期全局对话记录 (所有 NPC 与玩家)
    Rust->>LLM: 发送 Director Prompt (上帝视角)
    
    LLM-->>Rust: 返回 Tool Call: `update_world_graph` 或 `issue_overlay`
    Rust->>DB_G: (若有) 记录世界巨变 (如建立关系: 玩家 -> 结仇 -> 红发法师)
    Rust->>Rust: (若有) 暂存 Overlay 小纸条，等待目标 NPC 下次开口时注入
    end
```

## 演进路线图 (Roadmap)
- **Step 1: 结构与缓存解耦（当前最高优先级）** - 重构 Prompt Compiler 排序，分为 Static Prefix 和 Dynamic Suffix。
- **Step 2: 引入 Letta 记忆块（中期目标）** - 在 Rust 赋予 LLM Tool Calling 能力，实现带实体锚点的 Letta 记忆。
- **Step 3: 引入全局导演模式（长期目标）** - 启动后台 Director Event Loop，实现宏观剧情统筹与小纸条下发。

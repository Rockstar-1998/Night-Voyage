# 对照原始实现文档的假实现彻查报告

> **日期**：2026-10-04
> **对照基准**：[`plans/agent-system-architecture-plan.md`](../plans/agent-system-architecture-plan.md)（原始实现文档，用户裁定为准）
> **方法**：五个分区代码审计（逐条要求 → file:line 证据）+ MCP 真机探测（对运行中客户端实测 ToolCall 引擎，遵守整改红线：无任何脚本直改运行库）
> **结论分级**：【假实现】名义存在但实际不工作/没做 · 【部分实现】有实质缺口 · 【设计偏离】实现了但机制与计划不符 · 【真实现】代码与真机双重验证

---

## 一、假实现清单（计划要求 + 名义存在，实际不工作）

### HUD 引擎（计划 §4，重灾区）

| # | 计划要求 | 实况 | 证据 |
|---|---|---|---|
| A1 | 五种挂载锚点真实渲染 | 5 个中 4 个假：PC RightDock/TopSticky/FloatingHUD 三者渲染完全相同（恒为 `max-w-4xl` 内联块，mountType 只当文本徽标显示）；Mobile BottomSticky 被画进顶部容器 | `PersistentHudContainer.tsx:430,458-460`；`MobilePersistentHud.tsx:337-341` |
| A2 | RootCanvas 排版模式 Absolute/Flex/Grid | 数据模型根本没有 layoutMode 字段，运行时恒为 flex 列 | `ui_layout.rs:75-86`（无字段）；`LayoutTreeNode.tsx:39-40` |
| A3 | PanelContainer 自由坐标 x,y | x/y 有字段、DB 存储，但渲染 `position: relative` 从不读取；设计器无坐标输入 | `LayoutTreeNode.tsx:36`；`UiDesignerModal.tsx:361-398` |
| A4 | TabsContainer 标签页分页 | 仅换成 flex-row，所有子节点同时并排画出；无标签头、无激活页 | `LayoutTreeNode.tsx:40` |
| A5 | GridContainer 行列数 | `display:grid` 但从不设 grid-template，退化为单列 | `LayoutTreeNode.tsx:39` |
| A6 | "自由拖拽"排版 | 设计器与运行时均无任何拖拽交互，纯表单数值输入 | `UiDesignerModal.tsx` 全文无拖拽事件 |
| A7 | StatBar 水平/垂直自由拉伸 | 仅水平、固定 5px 高，无方向/尺寸字段 | `LayoutTreeNode.tsx:94-104` |
| A8 | InventorySlotGrid 四要素（图标/数量角标/品质框/详情气泡） | 布局控件版仅图标（1/4）；内置默认视图图标+角标（2.5/4）；品质框无、气泡仅为原生 title | `LayoutTreeNode.tsx:106-127`；`PersistentHudContainer.tsx:546-559` |
| A9 | Badge 控件 | 无专属渲染分支，与 DataLabel 共用同一文本盒 | `LayoutTreeNode.tsx` 无 badge 分支 |
| A10 | AvatarFrame（头像+Buff 图标） | 零专属渲染代码，只有枚举名和调色板项 | `ui_layout.rs:44`（枚举） |

### Agent 编排（计划 §6）

| # | 计划要求 | 实况 | 证据 |
|---|---|---|---|
| A11 | 导演-演员**视界裁剪**：演员仅获本角色设定+台词纸条 | 【假实现，没裁】persona 只是追加在**全量**世界观编译产物之前；旧路径 `contains(character)` 过滤未命中即全量放行——演员拿到的是全量设定 | `director_actor.rs:155-190` |
| A12 | 子代理工具循环闭环 | 断环：`subagent.rs:72` 硬编码 `tools: vec![]`，无清单下发/执行/回注；代码注释自认"后续里程碑接通"。tools 编译校验通过 ≠ 能用 | `subagent.rs:72`；`director_actor.rs:146,162-166` |
| A13 | D20 检定接入对话链路 + 广播不可篡改检定卡 | 骰子只有调试抽屉手动按钮，聊天链路（ToolCall/ConditionGate）零触发点；无检定卡组件与广播事件；抽屉文案仍写旧实现"SplitMix64" | `commands/game_state.rs:61-62`；`AgentDebugDrawer.tsx:491` |
| A14 | 多智能体路径禁词 Nudge 自纠 | 流水线终稿命中禁词**直接作废不落库**，无 2 次重试（仅单模型路径有真 Nudge 重写闭环） | `stream_processor.rs:225-241` |

### 工具链（计划 §2.2）

| # | 计划要求 | 实况 | 证据 |
|---|---|---|---|
| A15 | In-Memory 文本工作区 read_text/**write_text** | 读端真实现（scratchpad 内存 HashMap）；**写原语不存在**（全仓 grep write_text 零命中），scratchpad 永远为空 → 工作区功能性死亡 | `tool_plan.rs:506-513`（读）；`ToolStep` 枚举仅 4 种无写 |
| A16 | use_item / inspect_item 契约（M2 修复："空链仅校验"） | 真机实测：`use_item` 调用报"蓝图未定义契约…没有该 ToolDefinition 链"——definition-only 节点未被当作有效契约，与 M2 计划"空链（仅校验）"语义相悖 | 真机探测（2026-10-04，会话 #35）；`blueprint.rs` 中 `n_tool_use_item` 节点存在 |

---

## 二、部分实现清单（有实质缺口）

| # | 计划要求 | 缺口 | 证据 |
|---|---|---|---|
| B1 | display_target 双通道（PersistentHUD→HUD，InlineMessage→气泡；**零尾随卡片**） | HUD 单向真实；但 `display_target` 不进 display_config，气泡渲染器无条件渲染全部字段——PersistentHUD 字段照样堆进气泡卡片，"彻底消灭堆叠垃圾卡片"未达成 | `blueprint_executor.rs:1073-1081`；`MessageFormatRenderer.tsx:257-324` |
| B2 | 字段物理顺序 100% 严格对齐（§3.4） | `order_schema_properties` 无条件重排，而 InvokeSchema 路径从不写 `schema_field_order` → 全部字段落入字母序兜底重排。编辑器序会被确定性打乱——**主路径可复现违规** | `blueprint_executor.rs:375-438,1059-1090` |
| B3 | InvokeSchema 激活的 C2 | schema_id 未命中仅 eprintln 后继续；`preset_schemas` 装载失败静默变空 map；多 InvokeSchema 用 `=` 替换导致 Schema 与 active_schemas 状态不一致 | `blueprint_executor.rs:1083-1088`；`prompt_compiler.rs:706` |
| B4 | 时序泳道"毫秒级回放"全链路 | 事件流真实（ToolCall/Nudge/SubAgent 有后端发射），但：无时间戳字段（前端秒级 toLocaleTimeString）、无回放；Gate/HudPatch/SchemaPatch 三类事件后端**从未发射** | `timeline.rs:41-50`；全仓 TimelineKind 统计 |
| B5 | MCP 调试台 | 真调 5 个后端命令，但不是 MCP 端点控制台：不暴露 11 个 MCP 工具清单（`tool_names()` 已有未接） | `McpDebugPanel.tsx:23,107-135` |
| B6 | 单次结算持久化（回合末快照） | 设计偏离：改为**每次 ToolCall 即落库**（无回合末快照）。无数据丢失风险，但"内存瞬时+定稿单写"机制未按计划实现 | `agent_runtime.rs:295`（仅三处调用方） |
| B7 | 剧本流水线阶段由资产驱动 | `ScriptwriterStage` 资产（blueprint.rs:571,586）声明后**从未被消费**，三阶段提示词硬编码在 orchestrator.rs:176-221——资产旁路（C11 视角） | `orchestrator.rs:168-223` |
| B8 | 工作区"零磁盘 I/O" | draft/critique/final 靠 Rust 局部变量 + 每阶段写 `agent_drafts` 表落盘 | `orchestrator.rs:334-354` |
| B9 | Layer 1 锚点涂黑 | 涂黑代码真实，但对象是**初稿**而非会话历史正文；且流水线各阶段本就不装载历史——等于靠"不装载历史"实现涂黑 | `orchestrator.rs:199-209,134-139` |
| B10 | 移动端 HUD 对齐（C5） | 独立实现成立，但 statBar/inventory/badge/avatarFrame 全画成同一 label+value 行；BottomSticky 假；mobile 布局与内置吸顶条并存重复渲染；工具测试预填演示参数（buy_item/health_potion，违反 C11） | `MobileLayoutTree.tsx:88-119`；`MobileAgentDebugModal.tsx:34-35` |
| B11 | 残余静默兜底（C2） | count 缺省静默取 1、unit_price 缺省静默取 0（蓝图未填 required 可 0 金币成交）；HUD 广播 `unwrap_or_default()`；ToolDefinition 未接链时空计划+默认成功回执 | `tool_plan.rs:317-321,451-458`；`stream_processor.rs:754` |
| B12 | 文档与实现一致 | `blueprint.rs:475` 声明 `"custom"` 门禁类型，运行期直接报"未知门禁判定类型" | `game_state.rs:185` |

---

## 三、真实现清单（代码 + 真机双重验证）

| 项 | 证据 |
|---|---|
| check_inventory 真读 DataContainer | 真机：`【背包清单】总负重 3/50kg 金币 10G` + 两件真实物品 |
| **金币门禁 100% 拦截 + 数据零篡改（验收指标 5）** | 真机：金币 10 买单价 30 → 「门禁拦截」；复查容器无任何变化 |
| buy_item 数据层完整回路（原子扣款+入库+负重+HUD 广播） | 真机：火把×2 成交 → 金 10→2、负重 3→5、物品正确入库 |
| ToolCall 多轮回环（回注 LLM 续跑） | `chat_service.rs:610-668,773-846`；OpenAI/Anthropic 双协议 tool_result 真转格式；5 轮上限硬报错 |
| Per-Schema 保留层数真裁剪 | `schema_retention.rs:50-78` 逆序遍历 + `prompt_compiler.rs:1043-1072` 物理删除超层块 |
| InvokeSchema 按需激活（DFS 到达才激活） | `blueprint_executor.rs:497-501`；测试 `:3251-3277` 断言 |
| 保留层数非法输入三重阻断（前端/后端/运行期） | SchemaEditorModal 实时校验；`schema.rs` depth==0 硬 Err；运行期 Some(0) 报错 |
| db_mapping 白名单硬校验写库 | `stream_processor.rs:826-881`（非法值报错非跳过） |
| Aho-Corasick 真自动机 + 单路径 Nudge 重写闭环 | Cargo.toml:33；`agent_guards.rs:28-86`；`stream_processor.rs:609-636` 真重调 LLM |
| 三阶段流水线为独立 LLM 调用（无假子代理） | `subagent.rs:38-107` 每角色独立 HTTP 调用 |
| D20 getrandom CSPRNG | `agent_guards.rs:94-99`（OS 熵源，失败报错不降级）——但未进对话链路（见 A13） |
| 编译预览真走后端编译 | `preview_blueprint_with_session` → blocks/active_tools/tool_plans/schema 全量产物 |
| 规则与门禁测试器真调后端 | `sessionToolCallExecute` / `agent_dice_roll` / `agent_validate_banned_words` |
| Gate 架构选择真实路由 | `orchestrator.rs:47-101`（Gate 选择覆盖 default_mode，未知选项报错） |
| Shadow DOM 隔离（PC+Mobile） | `PersistentHudContainer.tsx:350-353`；`MobilePersistentHud.tsx:252-255` |
| 内置契约兜底已废除（未定义显式报错） | 真机：会话 #34 调 check_inventory 报"蓝图未定义契约"；`agent_runtime.rs:244-252` |

---

## 四、真机探测副作用披露

探测会话 #35（10-01 创建的空白测试会话，非剧情会话）状态变更：金币 10→2、新增 火把×2（buy_item 回路探测所致）。因预设 27 蓝图未定义 use_item/remove 契约（见 A16），无法经蓝图恢复；遵守整改红线未做任何 SQL 直改。该会话原状态本身即 M2 验收测试夹具。

---

## 五、修复优先级建议

| 级别 | 项 |
|---|---|
| **P0**（违反计划确定性/核心承诺） | B2 字母序重排（补写 schema_field_order 或 lookup 空时跳过重排）；B1 气泡侧 display_target 过滤（验收指标 1/4）；A11 视界裁剪真裁剪；A12 子代理工具循环闭环 |
| **P1**（计划核心机制缺失） | A1-A10 HUD 锚点/坐标/Tabs/Grid/控件保真（§4 大面积）；A15 write_text 原语；A13 D20 进链路+检定卡广播；A14 多智能体路径 Nudge；A16 空链语义对齐 |
| **P2** | B3-B12 各项；预设 27 资产修复：`n_ret_trade_ok.return_template` 改用 `{args.*}` 占位（当前写死"微光治疗药剂 x1"，真机实证回执与实际成交不符） |

---

## 六、二次审计：三态记忆假实现发现与修复（2026-10-06）

### 发现（修复前）

| # | 计划要求（§1.1） | 结论 | 证据 |
|---|---|---|---|
| C1 | STATELESS：单回合纯净上下文，不读取也不累加任何长程历史消息 | 【假实现】stateless 与 legacy 共用全量历史加载器（`load_recent_history_blocks`），历史并未排除 | `prompt_compiler.rs:1004-1024`（仅 mem0 排除） |
| C2 | LEGACY：基于 Token 预算的滑动截断，保留最近 N 轮 | 【死代码】`apply_budget_trim` 存在（含逐块丢弃循环），但主链路硬编码 `max_total_tokens: None` → 截断从未生效，历史全量注入 | `prompt_compiler.rs:2983-2985`（None 直接 return）；`stream_processor.rs:1048`（硬编码 None） |
| C3 | MEM0：外挂向量库 + 跨会话跨轮次语义检索注入 | 【真实现（偏差：按会话隔离非跨会话）】mem0-rs 真实向量检索 + 注入点真实；但 `user_id = conversation_id` 使记忆按会话隔离 | `mem0_rs.rs:194-215`；`prompt_compiler.rs:2719` |
| C4 | 记忆模式 UI 切换 | 【部分实现】创建时可选；`memoryModeSet` 后端命令存在但前端无调用者（会话中不可切） | `mem0.rs:67-68` 注释自认 |

### 修复

1. **STATELESS 历史排除**：`prompt_compiler` history gating 增加 `memory_mode == MEMORY_MODE_STATELESS → Vec::new()`（与 mem0 同理——单回合纯净上下文；开头场次由 `ensure_opening_in_history` 单独注入，不属长程历史）。
2. **LEGACY 预算接线**：`PromptCompileInput` 新增 `max_context_tokens: Option<i64>`；`stream_processor` 传入 `provider.max_context_tokens`；`compile_prompt` 在 LEGACY 模式下将其注入 `effective_budget.max_total_tokens` → `apply_budget_trim` 真正生效（预留输出 + 10% 安全余量后逐块裁剪）。
3. **MEM0 跨会话**：写入与检索的 `user_id` 从 `conversation_id.to_string()` 改为全局常量 `MEM0_GLOBAL_USER_ID`（"night_voyage_global"），所有 mem0 会话共享同一记忆池。

### 验证

- 后端 cargo test：**141 passed / 1 failed（存量 H1 openai_http_request_rejects_non_text_content 与本次改动无关）**
- STATELESS 真机验证：stateless 会话 #35 发消息后，`load_recent_history_blocks` 计数为 0（历史排除生效）
- LEGACY 截断：预算来源已接线（`max_context_tokens`），API 档案配置该值后 `apply_budget_trim` 逐块裁剪生效
- 上轮 15 项修复独立验证：**15/15 真实修复，无假修复**（三个无害瑕疵：nodeLayout writer 重复 case 死代码、tool_plan 过期注释、设计器嵌套 widget 缺控件级 X/Y 输入）
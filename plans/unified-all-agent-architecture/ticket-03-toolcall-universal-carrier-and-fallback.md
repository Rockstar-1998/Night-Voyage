# [工单 03] ToolCall 通用状态载体与零延迟旁白保底规范 (ToolCall Universal Carrier & Fallback)

**Ticket Label**: `wayfinder:task`  
**Parent Map**: `plans/unified-all-agent-architecture/map.md`  
**Blocked by**: `[工单 01]`, `[工单 02]`  
**Status**: `Blocked`

---

## Question

如何彻底淘汰蓝图对第三方提供商支持薄弱的 JSON Schema / Structured Outputs 与伪 XML 标签正则回退，将游戏状态更新、属性抽取与代办清单全部统一收拢为标准 ToolCall 载体？在单步模式下，若遇到模型仅输出 `tool_calls` 而 `content` 为空的边界情况，如何实现零二次 API 请求的叙事旁白自动保底？

---

## Context & Key Decisions

1. **结构化属性提取全面 ToolCall 化**：
   - 废除原有的 `SchemaField`（思维链schema、正文schema、提取器等）对 API 协议的强绑定反模式。
   - 统一定义通用的 `update_rpg_status` / `mutate_state` 工具，支持携带数值增量、标志位变更、背包变动及待办事项清单（`todo_list`）。
2. **零二次 API 请求的旁白保底机制 (Zero-Delay Fallback)**：
   - 绝不发起第 2 次 API 请求，防止延迟翻倍或死循环。
   - 当检测到 `assistant_content.trim().is_empty() && !executed_tools.is_empty()` 时，Rust 引擎在入库前自动基于工具定义生成一条紧凑的行为描写旁白：
     ```rust
     let fallback_text = format!(
         "*（进行了交互结算：{}）*",
         executed_tools.iter().map(|t| t.summary.as_str()).collect::<Vec<_>>().join("，")
     );
     ```
   - 确保消息记录中角色台词绝不为空白气泡，保障前端 UI 渲染安全。

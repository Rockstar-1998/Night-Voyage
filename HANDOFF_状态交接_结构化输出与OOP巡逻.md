# HANDOFF · 状态交接（结构化输出链路 + OOP→组合 重构巡逻）

> 生成时间：2026-08-21 15:23 GMT+8
> 交接范围：Night Voyage 后端（Rust/Tauri）+ 前端（SolidJS，PC `src/` + 移动端 `src-mobile/`）在 2026-08-15 至 2026-08-21 期间涉及的全部结构化输出解析/渲染修复，以及更早一轮已终止的 OOP→组合 重构巡逻。
> 目标读者：接手该仓库后续开发的人类/agent。读完即可在不重读整个对话的前提下续作。

---

## 0. TL;DR（一句话交接）

1. **OOP→组合 重构巡逻已终止**（2026-08-15），封闭枚举 `_ =>` 吞变体类问题在 `src-tauri/src/` 内已清零，最终提交 `fea807e`。
2. **本周两个软件 bug 已修并提交**：① 兼容模式误触发（`19f7473`，解析器不支持数组/标量）；② 状态面板被误渲染为可点选项（`9133f8b`，前端渲染逻辑 + 后端落库数组）。
3. **仍有两个未决渲染缺口**：标量字段（数字/布尔/null）与对象数组在结构化渲染中被静默丢弃；且所有 array 都被当「选项」渲染（`todo_list` 语义不贴切）。**尚未动手**。
4. **工作树有大量未提交蓝图 WIP**（PC+移动端+后端，用户进行中），会导致整机 `E0063`。**不要提交、不要混入 bug-fix 提交**；接手前先与用户确认蓝图 WIP 的归属。
5. **构建机制特殊**：Rust 工具链不在系统 PATH，必须经脚本注入；且 `.cargo/config.toml` 的 `target-cpu=native` 与本沙箱不兼容，需覆盖 `RUSTFLAGS`。详见 §6。

---

## 1. 项目与约束基线（必读，违反即停）

来源：`AGENTS.md`（项目根），最强约束文件。

- **架构**：Tauri 2.0 桌面/移动端宿主 + Rust 后端 + SolidJS 前端（PC `src/` 与移动端 `src-mobile/` 完全隔离，零 UI 代码耦合）。AI 动态 UI 必须进 iframe/Shadow DOM。
- **强制技能**：每次动手前须读 `.codex/skills/night-voyage-guardrails/SKILL.md`（mandatory guardrails）。
- **C1–C7 硬约束**（违反即停并上报，不得自行绕过）：
  - C1 前端只渲染（后端负责一切非渲染）
  - C2 零静默回退（禁吞异常/默认成功/自动降级/悄悄重试）
  - C3 响应性保护（UI 线程不阻塞，大数据量虚拟化）
  - C4 AI UI 隔离（iframe/Shadow DOM）
  - C5 移动端前端独立性（禁 `isMobile` 分支、禁互引组件）
  - C6 项目缓存只写 `D:\software_cache`（禁写系统盘）
  - C7 PC/Android 双端覆盖
- **交付流程**：每次代码改动后必须在 `Walkthrough/` 新建留痕文件（**永不追加**已有文件），含改动摘要 + 动机 + 约束合规审计表（C1–C7 每格 √/×）+ 验收记录 + 已知限制；随后 `git add <具体文件>`（禁 `git add .`）提交并 push；禁 `--force` push 主分支。

---

## 2. 自动化任务状态（automation-1786727854312）

| 项 | 值 |
|---|---|
| 名称 | Night Voyage · OOP→组合 重构巡逻（无人值守） |
| 计划 | 每小时一次（周一至周日） |
| cwds | `D:\data\Night Voyage` |
| 记忆文件 | `.workbuddy/automations/automation-1786727854312/memory.md` |
| 原目标 | 自主将 `src-tauri/src/` 中违反「组合优于继承」的 OOP 写法重构为组合式（5 类模式：深层 trait 继承 / downcast / enum Kind+bool / bool 标志位 / 封闭枚举 `_ =>` 吞变体），纯结构重构、不改 IPC/存储/前端契约；零信任扫描清零后终止 |
| **状态** | **已终止**（2026-08-15 07:31），理由：零信任终检确认 5 类模式 genuine 命中归零 |

**OOP 巡逻 7 个提交（已本地留存；早期 push 因出网 TLS 失败，后已随仓库演进 push）**：
`011b3bb`(PromptRole 去 `_ =>`) → `ba265b3`(source_message_id 穷尽) → `00fa091`(PromptBlockSource 组合式提取) → `c9ff17a`(RoomMessage::event_name) → `22fc231`(RoomMessage::event_payload) → `1c89b9c`(blueprint 门节点 match 穷尽) → `fea807e`(blueprint_executor.rs NodeConfig match 穷尽，终止)。

**零信任终检结论（重要，避免重复劳动）**：
- P1 trait 继承：仅 `MemoryService: Send + Sync` marker bound，非违规。
- P2 downcast：零命中。
- P3 `enum Kind + bool`：3 个 `*Kind` 枚举均为纯数据枚举 + 穷尽 match，无内部 bool。
- P4 bool 标志位：全部 `enabled`/`is_enabled`/`auto_retry_enabled: bool` 为 DB 模型/IPC 参数/协议载荷（持久化状态），受「禁改存储/IPC」铁律排除，非违规。
- P5 封闭枚举 `_ =>`：剩余 0 处；其余约 30 处 `_ =>` 经逐点核查均为 `&str`/`Option<&str>`/`Result`/`serde_json::Value` 开放集边界默认（外部反序列化/DB 字符串/协议转换/第三方枚举递归），符合 guardrails「边界才允许默认」例外，保留。

> **若后续有人想「继续 OOP 巡逻」：已无 genuine 可扫。重复扫描是浪费。** 新出现的 OOP 写法需单独评估，不在原巡逻范围内。

---

## 3. 本周期已完成的修复（用户直接介入，已提交并 push）

### 3.1 `d1c9f68` — 聊天自动重试失效
- **根因**：① 僵死的 `running` 快照被 `retry_failed_round` 永久拒绝重试；② `spawn_stream_task` 的自动重试无上限。
- **修复**：`llm_retry_snapshot_repository.rs` 为 `RetrySnapshotRecord` 加 `last_started_at: Option<i64>` 并改 SQL 查询；`chat_service.rs` 的 `retry_failed_round` 改为「仅当 round 仍 streaming 且 30 秒内启动才拒重复重试，否则重置快照」；`stream_processor.rs` 引入 `MAX_CHAT_AUTO_RETRY_ATTEMPTS=4`，超限 emit `llm-stream-error`。
- **合规**：`auto_retry_enabled: bool` 是 pre-existing 功能开关（提交 `3238008`），非本次新增，不违反 P4。

### 3.2 `19f7473` — 兼容模式误触发（解析器不支持数组/标量）
- **根因（软件 bug，非回复体问题）**：`structured_output_parser.rs` 的 `ExpectValue` 状态机只认 `"`(字符串)/`{`(对象)，遇 `[`/数字/布尔/null 命中 `_ =>` 通配臂报错且**不推进 pos** → 解析器卡死 → `finish()` 返回 Err → 被误判「模型未返回合法 JSON」而错误切入兼容模式（false positive）。模型实际返回合法 JSON 且符合 schema（调试日志 `agent_req_1787042399_...`）。
- **修复**：
  - `structured_output_parser.rs`：`InObjectValue` 泛型化为 `InContainerValue`（同时追踪 `{}/[]` 深度），新增 `InScalarValue` 处理数字/布尔/null；容器与标量解析后落库 `fields`，不再误报 `ParseError`；`match` 仍穷尽。
  - `stream_processor.rs`：两处兼容模式提示文案由「模型回复未返回合法 JSON」更正为「流式解析未完成或结构非法」。
  - 测试新增 7 例（空数组/对象数组/嵌套数组/标量/负数浮点/真实调试日志形状/增量喂入），`cargo test --lib structured_output_parser` 24 passed。
- **注意**：为解阻塞编译，曾于 `blueprint_executor.rs:826/848`、`preset_service.rs:737` 按结构体 `serde(default)` 默认值补 `SchemaFieldConfig` 的 `required`/`context_included`/`display` 三字段。**这 3 处改动只留工作树、未纳入本提交**（见 §5）。

### 3.3 `9133f8b` — 状态面板被误渲染为选项（前端渲染 bug）
- **根因**：`src/components/MessageFormatRenderer.tsx` 的 `StructuredResponseRenderer` 把**所有 `kind==='object'`** 字段一律渲染成可点击「选项」按钮，导致 `status_bar` 对象 `{体力,情绪,理智,社会地位}` 的四个键值对被当成选项。附带旧问题：真实 `options` 数组在解析层被整段丢弃（前端 `parseStructuredResponse` + 后端 `stream_processor.finish()` 只处理 string/object，不处理 array），所以模型给的真实选项从未显示。
- **修复**：
  - `MessageFormatRenderer.tsx`：对象字段改为**只读键值卡片**（不可点击）；新增数组字段渲染为**编号可点击选项**（`onChoiceSelect`）。
  - `messageFormatter.ts`：`StructuredField` 增加 `'array'` 类型，`parseStructuredResponse` 识别字符串数组。
  - `MessageItem.tsx`：内联结构化解析同步识别 `[` 开头的数组字段。
  - `stream_processor.rs`：`finish()` 对 `is_array()` 字段写入 `json_value`，让数组进入 `content_parts`。
- **验证**：`npx tsc --noEmit -p tsconfig.json` 通过（TSC_EXIT=0）；`cargo build` 通过（CARGO_EXIT=0，仅预存 dead-code 警告）。
- **未触碰**：蓝图 WIP 文件未纳入本提交。

### 3.4 更早（本周期前，列作上下文）
- `14a94f7` 新增 agent debug 友好型日志类；`fcad7bd` 修复 agent_debug_logs 预设提取为空；`9e24aee` 修复 Tailwind 全树扫描导致 vite 构建超时。

---

## 4. 结构化输出渲染全链路映射（关键表，接手必看）

渲染按 **JSON 值的类型**（非 schema 字段名）分流，三层：后端解析 → 前端归类（`StructuredField.kind`）→ 渲染组件。schema 字段随预设变化，但渲染只认值类型。

| JSON 值类型 | 归类 `kind` | 当前渲染方式 | 数据链路 | 状态 |
|---|---|---|---|---|
| `string` | `string` | 折叠标签卡片（标题=字段名，可展开）；`displayConfig.hideLabel` 则内联（如 `narrative` 正文） | `parseStructuredResponse` / MessageItem 内联 | ✅ 已修 |
| `object`（仅字符串条目） | `object` | **只读键值卡片**（标题=字段名，键值行，不可点击） | `9133f8b` 前被误当可点选项 | ✅ 已修 |
| `array`（字符串元素，如 `options`） | `array` | 编号可点击「选项」按钮 | `9133f8b` 前被整段丢弃 | ✅ 已修 |
| `number` / `boolean` / `null` | —— | ⚠️ **静默丢弃**（三分支均不匹配，不入 `fields`） | 后端 `finish()` 不写 `json_value`；前端三分支均不匹配 | ❌ 缺口 |
| `array`（对象元素 / 嵌套） | —— | ⚠️ **被丢弃**：数组只保留字符串元素，对象只保留字符串值 | 如 `[{label,tags}]` 被过滤成空 | ❌ 缺口 |
| `object`（含非字符串值） | `object` | 非字符串子项（数字/嵌套）**丢失**，只显示字符串条目 | 如 `status_bar.体力:80`（数字）会被丢 | ⚠️ 部分缺口 |

**string 字段内部还会再过一遍伪 XML 渲染**（`parseMessageContent`）：`<tag>` 折叠标签、`**粗体**`、中文引号「引用」高亮、关键词高亮、自定义规则。

---

## 5. 已知未决缺口与风险（接手前务必知悉）

### 5.1 渲染缺口（建议修，尚未动手）
- **标量字段**（数字/布尔/null）在结构化渲染中完全不显示。若 schema 含 `count: number`、`done: boolean` 这类字段，会无声消失 → 违反 C2 精神（信息丢失）。
- **对象数组 / 嵌套结构**（如 `options` 是 `[{label,value}]` 而非 `[string]`）会被过滤为空 → 字段消失。
- 当前**所有 array 都渲染成可点击「选项」**，`todo_list` 这类「清单」也会变可点按钮，语义不贴切（`options` 才是真正的玩家选择）。可考虑按字段名/语义区分「选项」与「清单」。

### 5.2 蓝图 WIP 阻塞（用户进行中，高风险勿碰）
- 工作树有未提交的大块蓝图改动：`src-tauri/src/models/blueprint.rs`（`SchemaFieldConfig` 新增 `context_included`/`display`/`required` + `protocol` 相关）、`blueprint_executor.rs`、`preset_service.rs`、PC + 移动端蓝图编辑器组件（`src/components/blueprint/*`、`src-mobile/components/blueprint/*`）等。
- 这些改动**不会单独编译**：`SchemaFieldConfig` 新字段的构造点在 `blueprint_executor.rs`/`preset_service.rs` 未补全，会触发 `E0063`。为解阻塞，曾在这两个文件补了 3 处 serde 默认值（语义零变更），但**这些补丁也留在工作树、未提交**。
- **行动准则**：不要把蓝图 WIP 与任何 bug-fix 提交混在一起；**不要代用户提交蓝图 WIP**；若需恢复整机编译，先向用户确认蓝图 WIP 的状态（是否要继续、还是回退）。已提交的树（`9133f8b`）本身可独立编译。

### 5.3 出网/推送限制
- `git push` 历史上多次因 TLS 握手失败（schannel）返回 `PUSH_EXIT=128`，属出网环境硬性限制，非代码问题。当前 HEAD `9133f8b` 已成功 push；若推送失败，记录为已知限制、不阻塞本地提交。

---

## 6. 构建与验证命令速查（必读，容易踩坑）

> Windows + Git Bash 环境。Rust 工具链**不在系统 PATH**，必须经脚本注入；`.cargo/config.toml` 设了 `target-cpu=native`，本沙箱与该 flag 的预编译 std 不兼容，**必须覆盖 `RUSTFLAGS`**。

```bash
# 后端（Rust）类型/编译验证 —— 注入本地工具链 PATH + 覆盖 target-cpu
export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH"
cd "/d/data/Night Voyage/src-tauri"
CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build          # 整机编译
CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo test --lib structured_output_parser  # 解析器单测

# 前端（PC）类型检查
cd "/d/data/Night Voyage"
npx tsc --noEmit -p tsconfig.json

# 前端（移动端）类型检查
npx tsc --noEmit -p tsconfig.mobile.json

# 双端 Release 构建（注入工具链 + tauri build --no-bundle）
scripts/build_dual_release.bat
```

> 注意：Bash 工具禁止含 `powershell` 字样的命令行；Git Bash 会把 `cmd //c` 改写，故验证后端优先直接用上面的 `cargo build`（PATH 注入），别折腾 bat 的壳层。

---

## 7. 接手者下一步建议（按优先级）

1. **确认蓝图 WIP**：先与用户对齐 `src-tauri/src/models/blueprint.rs` 等未提交改动的归属与完成度，再决定是否补全构造点提交或回退。这是当前唯一会让整机编译失败的点。
2. **补渲染缺口**：实现标量字段（数字/布尔/null）与对象数组的渲染，消除信息丢失（C2 相关）。建议发前端增量事件以支持数组逐元素流式渲染（当前 `options` 仅 `finish()` 整段落库）。
3. **区分「选项」与「清单」语义**：`options` 渲染为可点按钮，`todo_list` 类只读罗列。
4. **OOP 巡逻无需续作**：已零信任清零，重复扫描纯浪费。

---

## 8. 关键文件路径索引

| 文件 | 角色 |
|---|---|
| `.codex/skills/night-voyage-guardrails/SKILL.md` | 强制项目护栏（每次动手前读） |
| `AGENTS.md` | 项目规则、C1–C7、交付/审计流程 |
| `src-tauri/src/services/structured_output_parser.rs` | 流式 JSON 状态机解析器（数组/标量已支持，提交 `19f7473`） |
| `src-tauri/src/services/stream_processor.rs` | 流式处理 + `finish()` 落库 + 兼容模式触发（`is_array()` 落库见 `9133f8b`） |
| `src/components/MessageFormatRenderer.tsx` | 结构化字段渲染（对象只读/数组可点，提交 `9133f8b`） |
| `src/lib/messageFormatter.ts` | `StructuredField` 类型 + `parseStructuredResponse`（含 array 分支） |
| `src/components/MessageItem.tsx` | 内联结构化解析（数组识别） |
| `src-tauri/src/services/blueprint_executor.rs` / `preset_service.rs` | 含未提交蓝图 WIP + 我补的 3 处 serde 默认（均未提交） |
| `src-tauri/src/models/blueprint.rs` | `SchemaFieldConfig` 新字段定义（蓝图 WIP 源头） |
| `Walkthrough/` | 每次改动的留痕（永不追加，新建制） |
| `.workbuddy/automations/automation-1786727854312/memory.md` | OOP 巡逻执行记忆 |

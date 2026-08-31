# HANDOFF 状态交接 · V2.2 机床式蓝图预设重构

- 日期：2026-08-31 14:45
- 前序会话：V2.1 预设调优 → 蓝图编译逻辑全面核实 → 五预设对比分析 → V2.2 机床式重构（已完成并推送）
- 本文档自包含：新 agent 无需本会话上下文，读完本文 + 引用文件即可接手。

---

## 〇、项目硬约束（接手前必读）

见 `AGENTS.md` 与 `.codex/skills/night-voyage-guardrails/SKILL.md`。要点：

- 技术栈固定：Tauri 2.0 + Rust 后端 / SolidJS 前端（PC `src/` 与移动端 `src-mobile/` 完全独立）/ Motion One / SQLite。
- C1 前端只渲染；C2 零静默回退（mutex 门无选择即编译报错是**故意设计**，不是 bug）；C5 双端前端零耦合；C7 后端双端共享。
- 每次代码修改必须新建 `Walkthrough/YYYYMMDD-HHmm-主题-修改类型.md`（永不追加），写完立即 commit + push。
- 本轮 V2.2 是**纯预设数据文件**（零代码改动），已按此流程提交（commit `2da6f62`，分支 `feat/mem0-memory-authority`）。

---

## 一、蓝图编译系统工作原理（本会话逐条核实过源码，可信）

### 1.1 数据流

```
presets.blueprint_graph 列（JSON 图，version 2）
  → prompt_compiler.rs::compile_prompt 反序列化
  → 组装 BlueprintExecutionContext：
      memory_mode（legacy/mem0/stateless，来自 conversations 表）
      conversation_type（single/online）
      gate_selections（preset_gate_selections 表，按 node_id 键，预设级配置——所有会话共享）
      protocol（anthropic / chat_completions，从会话 provider 解析）
  → blueprint_executor.rs::execute_blueprint DFS 遍历
  → BlueprintExecutionResult { blocks, structured_output_schema, sampling_params, db_mappings,
                               context_included_keys, display_config, schema_field_order }
  → compile_prompt 应用（排序/合并/模板渲染）
  → provider_adapter.rs 构建请求体
```

### 1.2 执行器关键语义（调优预设时的行为契约）

| # | 语义 | 源码依据 |
|---|------|---------|
| 1 | **连线只决定节点激活，priority 决定提示词拼装顺序**。PresetRule 块按 priority **降序**（100 核心在前）；meta 块（MultiplayerProtocol=150 / CharacterBase=200 / PlayerBase=250 / WorldBook=300 / WorldVariable=400 / PlotSummary=500 / RetrievedDetail=550）永远排在 preset 规则之后按升序。**同工位所有选项块共享同一 priority**——选谁都在同一位置 | blueprint_executor.rs `traverse` + prompt_compiler.rs L953-962 排序块 |
| 2 | group_gate 空选合法直通（汇合点收敛）；mutex_gate 无选择**编译报错**（C2 显式错误，无默认值兜底） | blueprint_executor.rs L526-550 / L506-524 |
| 3 | 带 schema 字段（properties 非空）的蓝图**编译期强制切 structured_json**——顶层 responseMode 字段是摆设 | prompt_compiler.rs L698-706 |
| 4 | **schema description 双通道到达模型**：① response_format/output_config 携带 schema 原文；② `build_structured_json_directive` 把每个字段的 name/type/required/description 原文拼进 system 末尾字段清单。description 会到模型两次，且都在输出相位附近 | provider_adapter.rs L319-357 |
| 5 | 采样参数优先级：蓝图节点 > provider override > 预设顶层，逐字段 Some 才覆盖。通用 sampling_params 节点按协议方言裁剪（OpenAI 忽略 thinking_*，Anthropic 忽略 frequency/presence） | prompt_compiler.rs `apply_blueprint_sampling_params` |
| 6 | 核心基线：每个蓝图强制含 `thinking`(-2) 与 `text`(-1) 字段（仅当蓝图未自定义时注入，均 required）——**无法按分支豁免**（遗留观察项） | blueprint_executor.rs `inject_core_schema_baseline` |
| 7 | schema 属性按 `(order, 遍历插入序)` 稳定排序，required 与 properties 顺序同步 | blueprint_executor.rs `order_schema_properties` |
| 8 | Gate 分支遍历顺序 = 出口端口优先级（options 顺序）+ 边 order + 目标 id 字母序，确定性 | blueprint_executor.rs `ordered_outgoing_targets` |
| 9 | 汇合节点 = 所有出口分支的最近公共后继（`find_merge_node`），兜底 End。**group_gate 的非法 `out` 端口直连边是脏边**（V2.1 e_48 / V2.2 初版均有，已清理），汇合不需要显式直连边 | blueprint_executor.rs L871-917 |
| 10 | Constant 是纯值节点，只通过 `value` 边给 Branch 供值（pull-based）；挂 exec 流会报 `ConstantOnExecPath`。蓝图常量源仅三个：conversation_type / memory_mode / protocol——**没有"模型是否推理模型"信号** | blueprint_executor.rs `evaluate_session_source` |
| 11 | 蓝图 Prompt 节点 content 经 minijinja **Strict** 渲染（未知 `{{var}}` 直接编译报错） | prompt_compiler.rs `render_prompt_template` |
| 12 | `context_included` 控制上轮该字段值是否回灌下轮上下文；map 缺失键默认 true，必须显式 false 才屏蔽 | prompt_compiler.rs `filter_structured_content` |
| 13 | 预算裁剪顺序：历史 → 世界书 → 摘要 → 检索块；required 块不可裁 | prompt_compiler.rs `apply_budget_trim` |

### 1.3 前端结构化渲染边界（schema 字段类型红线）

只支持：**string / 扁平 object（值全为 string，渲染为键值面板）/ 纯 string 数组（渲染为可点击按钮）**。**对象数组会被静默丢弃**——status_bar 必须用 map、options 用 string 数组的原因。前端正文气泡只认 `display.body=true` 的 string 字段。

### 1.4 原生思维链通道（与 schema thinking 字段的关系）

- 传输：Anthropic `thinking_delta` content block / OpenAI 兼容 `delta.reasoning_content` → 独立收进 `thinking_content`（stream_processor.rs），**全程无标签包装**；`resolve_thinking_config` 仅 anthropic 协议 + thinking_enabled=true 或模型名含 "thinking" 才启用。
- schema 的 `thinking` 字段经 StructuredOutputParser 后**同样映射 part_type "thinking"**（同槽不同源）。
- **原生 + schema thinking 同时开启 = 模型想两遍**（原生先想完，schema 字段变成誊录），且 Anthropic 侧 output_config 与 thinking 同插请求体无互斥检查，可能 400。故 V2.2 维持 `thinking_enabled: null`，思考全走 schema 字段。
- **原生思考当前 PC 前端不渲染**（App.tsx `thinking_delta` 仅 console.debug，ChatMessage 模型无承载字段）——已决策"放一边"。

---

## 二、五预设对比分析结论（用户提供的调研成果，决策依据）

五个 ST2NV 转换预设代表同一问题的五种解法：

| 预设 | 流派 | 可吸收机制 |
|------|------|-----------|
| 狐神抚·毓忻 V9.4 | 导演决策流（决策前移+规则复述） | 潜文本识别 |
| 可待 | 编译流水线（文言思维链+海量黑名单） | 模块化剧情（3+1 模块轮转防雷同） |
| 果实 | 路由清单流（功能-COT 配对） | —（NV 的 group_gate 天然实现且更好） |
| 灼见·执笔人 | 文学工序流（五步工序+作废重写） | 内心戏配额化、收锋自检 |
| 繁花 | 人格扮演流（DeepSeek 双轨+四层防八股） | 防 AI 八股味分层 |

**拒绝吸收**（与 NV 约束冲突或机制失效）：assistant 预填充 + `<｜end▁of▁thinking｜>` 闭合（DeepSeek 私有机制，NV 无 prefill）；文言 CoT >800 字（预算）；禁库几百词（schema 有更好解法）；DeepSeek 双轨孪生块（NV 走 provider_overrides）；作废重写（元内容会露出，C2/渲染契约冲突）。

共性：全部把"去 AI 八股味"当头等大事、全部用标签流、全部管制内心戏。

---

## 三、V2.1 的十项已确认毛病（V2.2 重构动机）

1. **三铁律硬编码且锁死**（is_locked:true），与三门正面冲突：铁律二 vs proxy_full 全代言档；铁律三 vs bdry_avoid；铁律一 vs res_low——用户指出的第一毛病
2. status_read(80)/todo_read(80) 与 cot_framework(92) 双重指令（cot 已写"逐角色读取/档位转译/预判变化"，两站复述）
3. anti_spoil(81) 与 cot 第一步第 5 条近全冗余
4. multiplayer_rules(95) 与编译器硬注入的 MultiplayerProtocol 块(150) 重叠
5. todo_list 渲染为可点击按钮 → 点击即把 TODO 文本当玩家输入发送（交互有害）
6. e_48 脏边：group_gate 非法 `out` 端口直连
7. output_rules 缺 structured_json 格式防线（正文写进 thinking / JSON 套 markdown 常见病）
8. unlimited 档 8000 字 ≈ 16000 token + thinking + 4 个 schema 字段 > 16384 必截断
9. long(1500-2000+) 与 unlimited 自判档区间重叠
10. mod_parallel 与 shot 第三拍冲突；persp_first"我"无锚定；freq 0.15 偏低

---

## 四、V2.2 设计决策记录（勿推翻，均有会话内用户确认）

| 决策 | 内容 | 用户确认点 |
|------|------|-----------|
| 机床式结构 | 思维链与正文 = 总纲（纯纪律，不复述任何工位内容）+ 工位（mutex/group 暴露选项） | "先起一个思维链开头，然后中间全部是互斥或者单选的暴露选项" |
| 三铁律下放 | core_identity 瘦身为纯定位（4 行，解锁）。玩家主权归代理站、客观独立归阻力站、尺度归边界站——单一真相源 | 用户指出硬编码毛病 |
| 写指令并入 description | status_write/todo_write/options_rules 三节点删除，规则全并入 schema 字段 description（单一真相源 + 双通道到达）。分界线：**格式规则归 description，行为/时序规则保留 prompt 节点**（"反应不得越档"影响正文写作发生在输出前，description 固定在末尾管不到） | "只把 schema title 写的足够详细不行吗" |
| 深度档含范文 | 清点/推演各三档（精简/标准/深度），深度档含范文骨架 | "当前是深度档，最好写一个范文" |
| 字数档不保留旧的 | 新四档 400-800 / 800-1500 / 1500-3000 / 自判 400-3000（16384 − thinking ~2000 − 附加 ~500 ≈ 6900 中文字上限） | "不要保留旧的" |
| 合规强化独立组 | 新建 group_gate（去欧化/反套话/禁AI腔/内心戏配额），不并入文风门（mutex 会破坏互斥语义） | "新建独立组 (推荐)" |
| 视角让渡站 | mutex 三档（锁定/在场让渡/全域让渡），**在正文段**（priority 71）；思维链只做预演（总纲+推演深度档各一条标注指令），不建思维链工位。硬约束：时机=节拍间隙 / 时长=1-3句、≤2次每轮 / 合法性=须带叙事增量 / 判定期=未标注不得切镜 | 用户需求 + "视角让渡站在正文指导部分，别搞到思维链去了，但是允许在思维链预演部分好好想一想" |
| 输出前自检 | 固定件 priority 62，三查（完整性/越权/一致性），填 V2.1 预留槽位 | 已决策 |
| 采样参数 | freq 0.15→0.3、pres 0.05→0.15；temp 0.9 / top_p 0.95 / max_tokens 16384 不变；thinking_enabled 保持 null | 草稿 §五-5 建议区间起步值 |
| 思维链显示 | 原生思考渲染放一边；schema thinking 正常显示 | "思维链显示先放一边" |
| 提示词精细化 | 每个工位写执行时机、输入、产出物、边界与禁止项，越详细越好 | "提示词必须要写的精细，每个角度都需要考虑到" |

---

## 五、V2.2 当前结构（已实施，79 节点 / 113 边）

### 5.1 priority 管线（即最终 system prompt 顺序）

```
100  core_identity        引擎定位（瘦身后 4 行）
95   multiplayer_rules    逐人落笔纪律（仅 online 分支激活）
92   cot_framework        思维链总纲（纯纪律 + 让渡预演指令）
90   census_lite/standard/deep   清点站 mutex 三档（深度含范文）
89   census_subtext/noclub/depth_plot  清点增强 group 三选
88   driver_user/npc/balanced     驱动站 mutex 三档
86   status_read          状态站读指令（group 选 status_bar 才激活）
85   todo_read            TODO 站读指令（group 选 todo_list 才激活）
84   infer_quick/standard/deep    推演站 mutex 三档
82   proxy_none/action/restate/full  代理站 mutex 四档
80   res_low/medium/high  阻力站 mutex 三档
（mode_switch 在此分流：legacy → world_vars/summary schema；mem0/stateless 直通）
78   persp_first/third/god       视角站 mutex 三档
76   prose_plain/literary/cinematic  文风站 mutex 三档
74   compliance_deeu/anticli/noai/osquota  合规强化 group 四选
72   shot_three_beat/flow/module  镜头结构 mutex 三选
71   yoke_lock/scene/world        视角让渡 mutex 三档
70   word_short/medium/long/auto  字数站 mutex 四档
68   bdry_avoid/natural/direct    边界站 mutex 三档
66   mod_parallel / options(schema)  可选产物 group
62   cot_check            输出前自检（固定件）
58   output_rules         通用纪律收口（含 JSON 格式防线）
```

### 5.2 schema 字段

| 字段 | type | order | context_included | display | 说明 |
|------|------|-------|------------------|---------|------|
| thinking | string | -2 | **false** | expanded | description 含三步推演定义 + 让渡标注要求 |
| text | string | -1 | true | **body:true**, hideLabel | 正文；description 含三拍/文风/落点/留白/字数衔接 |
| status_bar | object map | 2 | true | expanded | 键=角色名；description 已并入原写节点规则（预判一致/禁跳变/沿用原文） |
| todo_list | string[] | 3 | true | hideLabel | description 已并入原写节点规则（新增/推进/移除/具体可执行） |
| options | string[] | 4 | true | hideLabel | description 已并入原规则（4条/风格多样/≤1负面/只写玩家行动） |
| world_variables | object map | 5 | true | expanded | legacy 分支，db_mapping |
| plot_summary | string | 6 | true | expanded | legacy 分支，db_mapping |

### 5.3 必选门（mutex，11 个，导入后必须逐一选择否则编译报错）

清点深度 / 推演深度 / 剧情驱动者 / 代理模式 / 世界阻力 / 叙事视角 / 修辞文风 / 镜头结构 / 视角让渡 / 字数限制 / 亲密边界

可选门（group，5 个）：清点增强（潜文本/防全知/情节纵深）/ 状态系统（状态栏/待办）/ 合规强化（去欧化/反套话/禁AI腔/内心戏配额）/ Legacy 特权（世界变量/剧情总结）/ 可选产物（平行线/推演路标）

---

## 六、当前进度

| 项 | 状态 |
|----|------|
| 蓝图编译逻辑核实（executor/compiler/provider_adapter/stream_processor/前端渲染） | ✅ 完成（本文档第一节） |
| 五预设对比分析 | ✅ 完成（用户提供 + 判定可吸收/拒绝） |
| V2.1 毛病清单 | ✅ 10 项确认 |
| V2.2 设计决策 | ✅ 全部落定 |
| V2.2 预设文件 | ✅ 已写入 `测试预设/Night Voyage 全能进阶核心预设 V2.2.nvpreset.json` |
| 结构校验 | ✅ `validate_v22.py` 全项通过（16 门汇合 ok / 唯一性 / 可达性 / 无脏边无孤儿无重复） |
| Walkthrough + commit + push | ✅ commit `2da6f62` 已推送至 `feat/mem0-memory-authority` |
| **应用内人工验收** | ⬜ 未做（见第七节） |
| 后端遗留修复 | ⬜ 未做（需用户批准，见第八节） |

---

## 七、下一步：应用内人工验收（接手后第一件事）

1. 蓝图编辑器导入 V2.2，确认无红线；逐一选择 11 个 mutex 门 + 按需勾选 group 门
2. 发起对话验证：
   - thinking 出现工位化结构（清点→状态→推演→反应清单→自检三查）
   - text 直接渲染为聊天气泡正文
   - 视角让渡选「在场让渡/全域让渡」时正文出现非焦点角色节拍间隙抢镜；选「锁定」时无
   - 合规强化开启后「一丝/一抹/嘴角勾起/眼底闪过」类套话消失；内心戏带 *包裹* 且 ≤2 处/角色
   - 深度清点档输出符合范文骨架（在场/场外/档案/落点/待办）
3. 连续 5 轮观察：状态栏不跳变、TODO 逐轮推进、无重复正文
4. 观察采样参数 freq 0.3 实测效果，不够再调 0.5（草稿建议区间 0.3-0.5）

验收发现问题 → 大多可通过改对应工位节点的 config.content 解决（无需动结构）；结构性问题 → 新 Walkthrough 记录。

---

## 八、后端遗留观察项（已上报未修，均不阻塞预设；修复需用户明确批准）

| # | 风险点 | 影响范围 | 建议修正方向 |
|---|--------|---------|-------------|
| 1 | `provider_adapter.rs` `build_structured_json_directive`（L319-357）硬编码要求"额外包含一个 `narrative` 字段承载叙事散文"，与蓝图 `text` 字段（body:true, required）正面冲突——模型可能双份正文（text + narrative 各写一遍），token 翻倍，narrative 前端不渲染 | 所有带 text 字段的 structured_json 蓝图预设（含 V2.1/V2.2）；无 text 字段的旧预设则依赖 narrative 作正文出口（该指令设计初衷） | directive 检测 schema 是否已含 body 渲染字段（text），含则去掉 narrative 注入 |
| 2 | `blueprint_executor.rs` `inject_core_schema_baseline` 无条件注入 thinking/text（required），无法按分支豁免；`DuplicateFieldName` 是全图静态校验，不能按互斥分支放两版 thinking | 想做"原生思维链分支不填 thinking schema"的预设 | 需要后端豁免机制（设计量较大，等用户立项） |
| 3 | thinking_enabled=true 与 schema thinking 字段并存 = 模型想两遍 + Anthropic 侧 output_config 与 thinking 无互斥检查（可能 400） | 误配置场景 | 编译期检测到 schema 含 thinking 且 thinking_enabled=true 时拒绝/警告 |
| 4 | 原生思维链前端不渲染（App.tsx `thinking_delta` L2116-2119 仅 console.debug；ChatMessage 无承载字段） | 使用推理模型的会话看不到思考过程 | 前端补三件事：事件接入 → 消息模型字段 → 渲染组件（C1 范围内，双端各一次） |
| 5 | 蓝图常量无"模型是否推理模型"信号，原生/指令思考通道无法自动路由 | 思考通道自动分流的设想 | 只能手动 mutex 门（用户自知模型）；或后端加能力信号（立项） |

---

## 九、相关引用文件

### 本轮产出
- `测试预设/Night Voyage 全能进阶核心预设 V2.2.nvpreset.json` — 本次交付物（79 节点/113 边）
- `测试预设/validate_v22.py` — 结构校验脚本（对齐 validate_graph 语义：门端口合法性/唯一性/branch 四查/可达性/孤儿/脏边/重复边/汇合点存在性）
- `Walkthrough/20260831-1441-V2.2机床式蓝图预设重构-新功能增加.md` — 本次变更留痕（含约束合规审计表）

### 设计文档（前序会话产出）
- `测试预设/V2.1改进说明.md` — V2.1 的执行器语义查证结论 + 修复记录 + 已知限制（本 handoff 第一节的原始出处）
- `测试预设/思维链与正文指导-草稿.md` — 思维链三步推演/正文三拍/模块化拆分预案的原始设计（跨模块接口：反应清单、数值变化预判）
- `测试预设/Night Voyage 全能进阶核心预设 V2.1.nvpreset.json` — 上一版（对照用）

### 后端核心（改执行器行为时必读）
- `src-tauri/src/services/blueprint_executor.rs` — 图执行器（DFS/校验/基线注入/排序）
- `src-tauri/src/services/prompt_compiler.rs` — 编译管线（上下文组装/排序规则/模板渲染/预算裁剪）
- `src-tauri/src/services/provider_adapter.rs` — 请求体构建（structured_json directive 在 L319-357，遗留观察项 #1 在此）
- `src-tauri/src/services/stream_processor.rs` — 流式解析（thinking_content 映射 part_type "thinking"）
- `src-tauri/src/services/structured_output_parser.rs` — JSON 流式解析器
- `src-tauri/src/commands/blueprint.rs` — gate selection 的 Tauri 命令（update/load/clear_preset_gate_selection）
- `src-tauri/src/services/preset_service.rs` — 预设导入/导出（PortablePresetFile 格式）

### 前端（渲染边界相关）
- `src/lib/blueprint/types.ts` — 图类型定义（snake_case 图格式 / camelCase IPC）
- `src/App.tsx` L2055-2130 — 流事件处理（string_field_delta → structuredFields；thinking_delta 仅 debug）
- `src/components/MessageFormatRenderer.tsx` — 结构化渲染（body/折叠/标签）
- `src/lib/messageFormatter.ts` — 消息解析

### 历史交接
- `HANDOFF_三模式记忆架构重构.md`
- `HANDOFF_状态交接_结构化输出与OOP巡逻.md`

---

## 十、给接手 agent 的提醒

1. **先跑校验**：`python "测试预设/validate_v22.py"`，确认 ALL CHECKS PASSED 再开始任何修改。
2. **改预设不动结构时**：直接改对应节点 config.content（数组，每元素一行）；改完重跑校验。
3. **结构性改动**：先重读本 handoff 第一节语义表，特别是 #1（priority 决序）、#2（group 空选直通/mutex 必选）、#9（汇合不需要脏直连边）。
4. **大文件写入会触发 IDE 内部错误**（[createInstance] vPe depends on UNKNOWN service IOutlineService）——用小批量 Edit（锚点替换法）分段写入，每批 ≤ ~10 个节点。
5. **提交规范**：Walkthrough 新文件 + `git add <具体文件>` + commit message 用 `git commit -F <临时文件>`（PowerShell 不支持 heredoc），commit 后 push，删除临时文件。
6. **不要重启已否决的方案**：第四节决策表全部有用户确认，推翻需新用户指令。
7. **后端修复必须先获用户批准**（第八节五项），不要顺手修。

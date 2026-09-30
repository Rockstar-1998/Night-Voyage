# Spec: 编译期统一文本渲染层（蓝图节点 + 开场消息接通 minijinja）

- 状态：**已批准，已实现**（用户已拍板 D1–D6，见 §5；实现完成 2026-07-23；`cargo build` 与 `cargo test` 均通过，4 个新增单测全绿）
- 关联讨论：ST2NV 转换器架构梳理（ST 宏系统 vs NV 程序逻辑）；设计原则「节点 = 结构/计算，内容模板层 = 文本插值」
- 前置/依赖：本变更是后续「`<user>`/`<char>` 运行时替换」「random/dice 蓝图节点」的共同前置。本变更不实现这两者的业务逻辑，只把内容模板层接通。

## 1. 目标与动机

蓝图 Prompt 节点的 `content` 当前在编译期**原样透传**（`blueprint_executor.rs:198` `content: cfg.content.clone()`），不经过任何变量替换。后果：

- 作者无法在蓝图 prompt 里引用运行时值（角色名、用户名等）。
- 从 SillyTavern 导入的 `{{char}}`/`{{user}}` 宏原样发给 LLM，变成字面垃圾。
- **角色卡开场消息（opener / first message）同样在编译期原样透传**：`load_opening_block`（prompt_compiler.rs:2116）从 `messages` 表读回开场消息并注入历史，不经渲染；而开场消息在 `conversations.rs:252` 落库时是直接 `content: &content` 原样存储。作者写在开场里的用户占位符（`{{ player_character.name }}` 或 ST 导入的 `{{user}}`/`<user>`）同样会变成字面垃圾。开场消息走独立路径、不属于蓝图节点，原 spec 的蓝图 transform 改动点覆盖不到它。

NV 在旧 `template:` 预设块路径**已有** minijinja 渲染器（`prompt_compiler.rs:1660` `render_prompt_template`，上下文 `PromptTemplateRenderContext`），但**只服务于 legacy 路径**，与蓝图路径互斥。

本变更：把**所有系统创作、可持久化的文本**（蓝图 Prompt 节点 content + 角色卡开场消息）统一接入同一套 minijinja 渲染器，在 `compile_prompt` 时统一渲染。这样蓝图节点与开场消息获得一致的运行时插值能力，模板系统从「蓝图专属」升级为「编译期统一文本渲染层」，并消除「蓝图 vs 模板」互斥。

## 2. 设计原则（不可动摇）

- **统一渲染层**：任何系统创作、可持久化、可能引用运行时值的文本，都在 `compile_prompt` 时以「原始 minijinja 模板」存储、在编译期统一渲染。当前落地两个站点：蓝图 Prompt 节点 content、角色卡开场消息；后续系统文本（角色描述注入、world book 等）按同一规则接入，无需另造机制。
- **蓝图节点**表达结构与计算：random/dice 节点、gate、branch、mode/role switch。
- **内容模板层（minijinja）**表达文本里的运行时值插值：`{{ character.name }}`、`{{ player_character.name }}` 等。
- **ST 宏不在 NV 运行时出现**。ST `{{char}}`/`{{user}}`/`<user>` 一律在导入层（ST2NV-Converter）翻译成上面的 minijinja 变量。运行时只认 `{{ var }}`。

## 3. 范围

**IN（本变更做）：**
- 在 `compile_prompt` 中，蓝图 `CompiledBlock` 转 `PromptBlock` 之前，对每个 `content` 调用 `render_prompt_template`。
- 在 `compile_prompt` 中，`load_opening_block` 从 `messages` 读回开场消息、构造 `PromptBlock` 之前，对其 `content` 调用 `render_prompt_template`（需把 `render_context` 透传进 `load_opening_block` / `ensure_opening_in_history`）。

**OUT（不在本变更，单独任务）：**
- random/dice 蓝图节点（用户另行设计）。
- ST2NV-Converter 的 ST 宏 → minijinja 翻译（ Companion 任务，见 §7）。

## 4. 改动点（精确）

### 4.1 第一改动点：`prompt_compiler.rs` `compile_prompt` 蓝图转 block 处

当前（约 631-636 行）：

```rust
let blueprint_blocks: Vec<PromptBlock> = blueprint_result
    .blocks
    .iter()
    .map(compiled_block_to_prompt_block)
    .collect::<Result<Vec<_>, _>>()
    .map_err(|err| err.replace('\\', "/"))?;
```

改为（渲染与转换分离，`compiled_block_to_prompt_block` 保持纯转换不变）：

```rust
let blueprint_blocks: Vec<PromptBlock> = blueprint_result
    .blocks
    .iter()
    .map(|compiled| {
        let descriptor = format!("blueprint node `{}`", compiled.identifier);
        let rendered = render_prompt_template(&compiled.content, &render_context, &descriptor)?;
        let mut rendered_block = compiled.clone();
        rendered_block.content = rendered;
        compiled_block_to_prompt_block(&rendered_block)
    })
    .collect::<Result<Vec<_>, _>>()
    .map_err(|err| err.replace('\\', "/"))?;
```

要点：
- `render_context` 已在 `compile_prompt` 第 526 行由 `build_runtime_template_render_context` 构建，**本作用域内可用**（526 < 619 < 634），无需新增参数或 context 字段。
- `render_prompt_template` 与 `compiled_block_to_prompt_block` 同属 `prompt_compiler` 模块，直接调用，无跨模块/循环依赖。
- **不改动 `blueprint_executor.rs`**：执行器保持纯内存、无模板概念（其既有单元测试 `test_simple_chain` 等断言 `content` 原样，不受影响）。
- **不改动 `BlueprintExecutionContext`**：不引入模板/角色数据，避免执行器与渲染器耦合。

### 4.2 支持的变量（来自既有 `PromptTemplateRenderContext`）

直接复用 legacy 路径已填充的上下文（角色/玩家/当前用户均已在 `compile_prompt` 加载）：

- `{{ character.name }}` / `{{ character.description }}` / `{{ character.tags }}` —— AI 角色
- `{{ player_character.name }}` / `{{ player_character.description }}` —— 用户人格
- `{{ current_user.content }}` / `{{ current_user.role }}` / `{{ current_user.message_id }}` —— 当前轮输入
- `{{ conversation.id }}` / `{{ conversation.world_book_id }}` / `{{ conversation.preset_id }}`
- `{{ provider.kind }}` / `{{ provider.model_name }}`

ST 宏映射（仅作导入层翻译参考，不在运行时识别）：
- `{{char}}` / `{{char_name}}` → `{{ character.name }}`
- `{{user}}` / `{{user_name}}` / `<user>` → `{{ player_character.name }}`
- `{{last_user_message}}` / 消息正文 → `{{ current_user.content }}`

### 4.3 第二改动点：开场消息渲染（在 `ensure_opening_in_history` 内渲染）

**关键设计修正（相对初稿）**：渲染放在 `ensure_opening_in_history`（2193）里做，而**不是** `load_opening_block`。原因：`ensure_opening_in_history` 当前对 DB 加载错误是 **best-effort**（`Err → log + return`，795 调用点无 `?`）。若把渲染塞进 `load_opening_block`，渲染失败（D2 未知变量）会被这个 best-effort 静默吞掉——**直接违反 C2/D2**。因此必须分层：

- **DB 加载错误** → 保持既有 best-effort（非致命，log 后跳过开场注入）。
- **模板渲染错误** → 必须上抛为 compile 错误（D2/C2 零回退）。

`load_opening_block`（2116）**不改**，仍返回原始 content 的 block。改 `ensure_opening_in_history` 签名与实现：

```rust
async fn ensure_opening_in_history(
    db: &SqlitePool,
    conversation_id: i64,
    target_round_id: Option<i64>,
    exclude_message_id: i64,
    history_blocks: &mut Vec<PromptBlock>,
    render_context: &PromptTemplateRenderContext,   // 新增
    debug: &mut PromptCompileDebugReport,
) -> Result<(), String> {                            // 返回类型改为 Result
    let mut opening = match load_opening_block(...).await {
        Ok(Some(block)) => block,
        Ok(None) => return Ok(()),
        Err(err) => { dbg_eprintln!("...non-fatal: {}", err); return Ok(()); } // DB 错误 best-effort
    };
    let opening_message_id = match &opening.source {
        PromptBlockSource::Message { message_id } => *message_id,
        _ => return Ok(()),
    };
    // 内容模板渲染：D2 Strict，渲染失败上抛（禁止静默回退）
    let descriptor = format!("opening message `{opening_message_id}`");
    let rendered = render_prompt_template(&opening.content, render_context, &descriptor)?;
    let token_cost = estimate_token_cost(&rendered);
    if let Some(existing) = history_blocks.iter_mut().find(|b|
        matches!(&b.source, PromptBlockSource::Message { message_id } if *message_id == opening_message_id)
    ) {
        existing.required = true;
        existing.content = rendered;                 // legacy 模式：覆盖为渲染后内容
        existing.token_cost_estimate = Some(token_cost);
    } else {
        opening.content = rendered;
        opening.token_cost_estimate = Some(token_cost);
        history_blocks.insert(0, opening);
    }
    Ok(())
}
```

`compile_prompt` 调用点（795）加 `&render_context` 参数并加 `?`（去掉末尾 `;` 前的 `.await;` 改 `.await?;`）。

要点：
- 渲染在**编译期**发生，DB 里仍存原始模板（`conversations.rs:252` 原样落库不变）；玩家人格改名后每轮重新渲染都正确，单一事实源在 DB。
- **legacy 模式**开场消息已在 `history_blocks` 里（`load_recent_history_blocks` 加载的是原始 content），故 `existing` 分支必须**覆盖 content**为渲染结果，否则 legacy 模式开场不渲染。
- **普通历史消息不渲染**：历史里除开场外的用户/AI 消息是运行时真实对话内容（用户可能字面输入 `{{`），不是"系统创作模板"，一律不当模板处理。只有开场消息（角色卡作者创作）渲染。此边界是设计核心。
- **`<user>` 字面量不被 D2 拦截**：minijinja 只处理 `{{ }}`/`{% %}`，`<user>` 这种 ST 方言不是 minijinja 语法，会原样透传（不报错也不替换）。要让开场里的 `<user>` 生效，必须在导入层（§7）翻成 `{{ player_character.name }}`；原生 NV 作者直接写 `{{ player_character.name }}`。D2 Strict 只对 `{{ 未知变量 }}` 报错。

## 5. 行为与语义决策（用户已拍板 2026-07-23）

- **D1 渲染范围**【定稿】：**对每个蓝图 block content 与开场消息总是渲染**。minijinja 对不含 `{{ }}` 的文本原样透传（无副作用），统一渲染更一致、更廉价。
- **D2 未定义变量行为**【定稿：Strict 报错】：沿用 `UndefinedBehavior::Strict` —— 未知 `{{ var }}` 直接报编译错误（符合 C2 零回退，不静默留空）。原生蓝图/开场不写未知 `{{ }}`，不受影响；ST 导入若残留未翻译的 `{{char}}` 会在编译期显式报错（暴露问题，而非静默失败）。注意：`<user>` 等 ST 尖括号方言**不是** minijinja 语法，D2 拦不住，需导入层翻译（§4.3 要点、§7）。
- **D3 `<user>` 语义**【定稿】：`{{user}}`/`<user>` → `player_character.name`（用户人格显示名）；消息正文走 `{{ current_user.content }}`（两个不同变量，不可混）。
- **D4 minijinja 开放范围**【定稿：不开放 `{% %}`】：本变更只开放 `{{ }}` 变量插值。`{% %}` 控制流（if/for）不文档化、不加 UI、不作为承诺能力。保持「节点=结构/计算，模板层=文本插值」的边界清晰。
- **D5 运行时是否识别 ST 方言**【定稿：否】：NV 运行时只认 minijinja；ST 宏在导入层翻译（§7）。
- **D6 开场消息可用变量范围**【定稿】：开场消息**归属限 AI 角色卡**（玩家人设卡无"开场"概念）。开场文本仍由 AI 角色卡作者创作，可引用 **`character.*` 与 `player_character.name`**（后者即 `<user>` 玩家名，这是本 spec 的核心动机）。开场时刻无用户轮次，故不应引用 `{{ current_user.content }}`（此刻为空，Strict 下引用即报错）。这是作者编写约束，非引擎限制；蓝图节点无此限制。

## 6. 约束合规

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 纯后端编译逻辑，前端零改动 |
| C2 Zero-Fallback Errors | √ | 渲染失败 → `format!("blueprint node \`{id}\`: template render failed: {err}")` → 作为 compile 错误上抛 → UI 可见；未知变量 Strict 报错，无静默回退 |
| C3 Responsiveness | √ | 渲染为同步字符串模板，无 IO、无阻塞；每轮 compile 一次 |
| C4 AI UI Isolation | √ | 不涉及 AI 沙箱层 |
| C5 Mobile Frontend Independence | √ | 后端改动，前端（PC/移动）均无改动，天然双端覆盖 |
| C6 Project Cache Location | √ | 无缓存写入 |
| C7 PC/Android Coverage | √ | 后端 command 共享，双端自动覆盖；本变更无前端 UI |

## 7. Companion 任务（独立 repo / 独立 PR）

- **ST2NV-Converter 翻译**：`blueprint_emitter.py` 在写 `content` 前，将 ST 宏翻成 minijinja：
  - `{{char}}`/`{{char_name}}` → `{{ character.name }}`
  - `{{user}}`/`{{user_name}}` → `{{ player_character.name }}`
  - `{{last_user_message}}` 等历史类 → 删除（NV 自动注入）
  - `<BREAK>` / marker（`chatHistory` 等）→ 删除
  - `{{random::a|b|c}}` / `[OPTIONS]` / `{{roll:NdM}}` → 见用户另行设计的 random/dice 节点；转换期静态求值或改挂节点
- 不翻译则导入蓝图里的 `{{char}}` 会在 D2 下编译期报错（预期行为，非缺陷）。

## 8. 验收

**构建（真实输出）：**
```
cd src-tauri && cargo build    # 后端改动，必须实际跑通
```

**单元测试：**
- 执行器既有测试（`blueprint_executor` 模块）**不受影响**（渲染不在执行器内），应全部继续通过。
- 在 `prompt_compiler` 测试层新增：
  - 蓝图含 `{{ character.name }}` 的节点 → 编译后 content 被替换为实际角色名。
  - 蓝图含未知 `{{ nonexistent }}` → `compile_prompt` 返回错误（验证 D2）。
  - 蓝图 content 不含 `{{ }}` → content 原样（验证 D1 无副作用）。
  - 开场消息含 `{{ player_character.name }}` → `load_opening_block` 返回 content 被替换为玩家人格名（验证宏观渲染层覆盖开场路径）。

**手动验收：**
- 用 `测试预设/` 下经翻译后的 `.nvpreset.json` 导入，确认蓝图节点里的 `{{ character.name }}` 在对话中解析为真实角色名。
- 在蓝图编辑器新建一个 Prompt 节点，content 写 `你是{{ character.name }}。`，开新对话确认系统提示词出现真实名字。

## 9. 已知限制 / 后续

- 本变更不提供 random/dice 节点（运行时随机/骰子由用户单独设计，需注册 minijinja 自定义函数 `rand_choice`/`dice`）。
- 蓝图节点输出（如未来 random 节点结果）如需注入文本，复用本变更的 `{{ var }}` 机制，无需另造宏。
- `{% %}` 控制流未文档化，待后续决定是否正式开放。

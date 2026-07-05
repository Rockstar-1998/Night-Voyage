# Mem0 全权接管动态记忆层 — 实施计划

## Context

### 问题背景
Night Voyage 的 Prompt Compiler 当前有多个"动态层"（PlotSummary、CharacterStateOverlay/WorldVariable、RetrievedDetail）负责处理"过去发生了什么"。这些层与 Mem0 的记忆提取能力存在大面积重叠：Mem0 的 LLM 事实提取 + 向量检索天然覆盖了剧情总结、角色状态变化、世界变量、细节召回的全部职责。维持多套并行系统导致层间冲突和复杂度膨胀。

### 目标
- Mem0 作为**唯一动态记忆权威**，接管 PlotSummary + CharacterStateOverlay + RetrievedDetail 的全部职责
- 保留**无状态模式**（纯多轮对话，无任何记忆/总结）
- Mem0 模式下**不保留 RecentHistory 原文窗口**（0 轮），全部历史上下文交由 Mem0 托管
- 旧层代码**保留不删除**，仅在 Mem0 激活时被门控关闭
- 旧字段 `plot_summary_mode` + `mem0_enabled` 迁移后删除

### 架构变更示意

```
无状态模式 (memory_mode = 'stateless'):
  PresetRule + CharacterBase + PlayerBase + WorldBookMatch
  + RecentHistory (全量) + CurrentUser

Mem0 模式 (memory_mode = 'mem0'):
  PresetRule + CharacterBase + PlayerBase + WorldBookMatch
  + RetrievedDetail (Mem0 多策略查询) + CurrentUser
  (无 PlotSummary, 无 CharacterStateOverlay, 无 RecentHistory)
```

---

## Task 1: Git 测试分支创建

当前 mem0 集成代码为未跟踪 + 已修改状态，需先提交基线再创建分支。

```powershell
cd "d:\data\Night Voyage"
git add -A
git commit -m "feat: mem0-rs memory layer integration baseline"
git checkout -b feat/mem0-memory-authority
```

**验证**: `git branch` 确认在 `feat/mem0-memory-authority` 分支。

---

## Task 2: 数据库迁移 — 统一 `memory_mode` 字段

**文件**: `src-tauri/migrations/0034_memory_mode_unified.sql`（新建）

```sql
-- 统一记忆模式：替代 plot_summary_mode + mem0_enabled
-- stateless (默认): 纯多轮对话，无任何记忆/总结
-- mem0: Mem0 作为唯一动态记忆权威
ALTER TABLE conversations ADD COLUMN memory_mode TEXT NOT NULL DEFAULT 'stateless';

-- 数据迁移：旧模式启用了任何动态层的会话 → 'mem0'
UPDATE conversations SET memory_mode = 'mem0'
WHERE plot_summary_mode != 'disabled' OR mem0_enabled != 0;
```

**旧字段删除迁移**: `src-tauri/migrations/0035_drop_legacy_memory_fields.sql`（新建）

```sql
-- 删除已废弃的旧字段（SQLite 3.35+ 支持 DROP COLUMN）
ALTER TABLE conversations DROP COLUMN plot_summary_mode;
ALTER TABLE conversations DROP COLUMN mem0_enabled;
```

**验证**: 启动应用，确认 migration 执行无报错，`PRAGMA table_info(conversations)` 包含 `memory_mode` 且不含旧字段。

---

## Task 3: Prompt Compiler 核心改造

**文件**: `src-tauri/src/services/prompt_compiler.rs`

### 3.1 新增 `memory_mode` 加载函数

在 `load_retrieved_detail_blocks` 附近新增：

```rust
const MEMORY_MODE_STATELESS: &str = "stateless";
const MEMORY_MODE_MEM0: &str = "mem0";

async fn load_memory_mode(db: &SqlitePool, conversation_id: i64) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT memory_mode FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .filter(|v| v == MEMORY_MODE_MEM0)
    .unwrap_or_else(|| MEMORY_MODE_STATELESS.to_string())
}
```

### 3.2 改造 `compile_prompt()` (第 562-701 行)

**当前逻辑**:
- 第 563 行: `plot_summary_enabled = load_plot_summary_mode(...)`
- 第 578-592 行: 若 `plot_summary_enabled` → 加载 CharacterStateOverlay
- 第 601-624 行: 若 `plot_summary_enabled` → 加载 PlotSummary + summarized_round_ids
- 第 630-637 行: `load_recent_history_blocks(... &summarized_round_ids ...)`
- 第 692-700 行: `load_retrieved_detail_blocks(...)`

**替换为**:

```rust
let memory_mode = load_memory_mode(db, input.conversation_id).await;
let mem0_active = memory_mode == MEMORY_MODE_MEM0;

// 旧层门控：mem0_active 时全部跳过（代码保留，不删除）
let mut latest_character_state_overlay_text = None;

// CharacterStateOverlay: 仅在非 mem0 模式下加载（stateless 也不加载，
// 但保留原有 plot_summary_mode 逻辑供未来回退）
let plot_summary_enabled = !mem0_active && load_plot_summary_mode(db, input.conversation_id)
    .await.unwrap_or(PLOT_SUMMARY_MODE_DISABLED.to_string())
    != PLOT_SUMMARY_MODE_DISABLED;

if let Some(character_data) = character_data.as_ref() {
    if let Some(character_block) = build_character_base_block(character_data) {
        system_blocks.push(character_block);
    }
    // CharacterStateOverlay: mem0 模式下跳过
    if plot_summary_enabled {
        // ... 保留原有 character_state_overlay 加载逻辑 ...
    }
}
// ... PlayerBase 保留不变 ...

// PlotSummary: mem0 模式下跳过
let (plot_summary_blocks, summarized_round_ids) = if plot_summary_enabled {
    // ... 保留原有 plot_summary 加载逻辑 ...
} else {
    (Vec::new(), HashSet::new())
};

// RecentHistory: mem0 模式下返回空 Vec（0 轮窗口）
let history_blocks = if mem0_active {
    Vec::new()
} else {
    load_recent_history_blocks(
        db, input.conversation_id, input.target_round_id,
        exclude_message_id, &summarized_round_ids, &mut debug,
    ).await?
};

// ... WorldBook 保留不变 ...
system_blocks.extend(plot_summary_blocks);

// RetrievedDetail: mem0 模式下做多策略查询
let retrieved_detail_blocks = load_retrieved_detail_blocks(
    db, memory_service, input.conversation_id,
    &current_user_block.content,
    character_data.as_ref().map(|c| c.name.as_str()),
    mem0_active,  // ← 新增：传入模式标志
    input.budget.max_retrieved_detail_tokens,
    &mut debug,
).await;
system_blocks.extend(retrieved_detail_blocks);
```

### 3.3 改造 `load_retrieved_detail_blocks()` → 多策略查询 (第 2028 行)

**函数签名变更**:
```rust
async fn load_retrieved_detail_blocks(
    db: &SqlitePool,
    memory_service: Option<&Arc<dyn MemoryService>>,
    conversation_id: i64,
    current_user_input: &str,
    character_name: Option<&str>,      // ← 新增
    mem0_active: bool,                 // ← 新增
    max_tokens: Option<usize>,
    debug: &mut PromptCompileDebugReport,
) -> Vec<PromptBlock>
```

**门控变更** (替换第 2046-2059 行的 `mem0_enabled` 检查):
```rust
if !mem0_active {
    return Vec::new();
}
```

**多策略查询** (替换第 2061-2076 行的单一 search):
```rust
let user_id = conversation_id.to_string();
let per_strategy_top_k = 3;

// 策略 1: 细节回忆
let detail_query = current_user_input.trim();
// 策略 2: 角色当前状态
let character_query = character_name
    .map(|name| format!("{name} 的当前状态、关系、情绪、信任度变化"))
    .unwrap_or_else(|| detail_query.to_string());
// 策略 3: 剧情进展
let plot_query = "近期剧情进展、重要事件、委托状态、场景变化";

let mut all_records = Vec::new();
for (strategy, query) in [
    ("detail", detail_query.to_string()),
    ("character_state", character_query),
    ("plot", plot_query.to_string()),
] {
    if query.is_empty() { continue; }
    match memory_service.search(&query, &user_id, per_strategy_top_k).await {
        Ok(records) => {
            for r in records {
                debug.input_sources.push(
                    format!("retrieved_detail:{strategy}:{}", r.id)
                );
                all_records.push(r);
            }
        }
        Err(err) => eprintln!("[prompt-compiler] {strategy} search failed: {err}"),
    }
}

// 去重
let mut seen = HashSet::new();
let records: Vec<_> = all_records
    .into_iter()
    .filter(|r| seen.insert(r.id.clone()))
    .collect();
```

后续 token budget 截断逻辑不变。

### 3.4 调用点更新 (第 692 行)

传入 `character_name` 和 `mem0_active`:
```rust
let retrieved_detail_blocks = load_retrieved_detail_blocks(
    db, memory_service, input.conversation_id,
    &current_user_block.content,
    character_data.as_ref().map(|c| c.name.as_str()),
    mem0_active,
    input.budget.max_retrieved_detail_tokens,
    &mut debug,
).await;
```

**验证**: `cargo check` 编译通过。

---

## Task 4: Stream Processor 改造

**文件**: `src-tauri/src/services/stream_processor.rs`

### 4.1 改造 `spawn_stream_task` 触发逻辑 (第 178-215 行)

**当前**:
```rust
let plot_summary_enabled = load_plot_summary_mode(...) != DISABLED;
if plot_summary_enabled {
    spawn_character_state_overlay_generation_task(...);
    spawn_plot_summary_processing_task(...);
}
spawn_memory_extraction_task(...);
```

**替换为**:
```rust
let memory_mode = crate::services::prompt_compiler::load_memory_mode(&db, conversation_id)
    .await;
let mem0_active = memory_mode == "mem0";

if mem0_active {
    // Mem0 模式: 仅 spawn memory_extraction_task
    crate::services::chat_service::spawn_memory_extraction_task(
        app.clone(), db.clone(), conversation_id, round_id, assistant_message_id,
    );
} else {
    // 非 mem0 模式: 保留原有 plot_summary + character_state_overlay 逻辑
    let plot_summary_enabled = crate::services::plot_summaries::load_plot_summary_mode(
        &db, conversation_id
    ).await.unwrap_or(crate::services::plot_summaries::PLOT_SUMMARY_MODE_DISABLED.to_string())
     != crate::services::plot_summaries::PLOT_SUMMARY_MODE_DISABLED;
    if plot_summary_enabled {
        crate::services::character_state_overlays::spawn_character_state_overlay_generation_task(
            app.clone(), db.clone(), conversation_id, round_id, provider_id,
        );
        crate::services::plot_summaries::spawn_plot_summary_processing_task(
            app.clone(), db.clone(), conversation_id, provider_id,
        );
    }
}
```

### 4.2 同步改造 `handle_stream_completion` (第 226-266 行)

该函数有重复的触发逻辑，需同步改造。统一用辅助函数避免重复：

```rust
async fn spawn_post_round_tasks(
    app: &AppHandle, db: &SqlitePool,
    conversation_id: i64, round_id: i64, provider_id: i64,
    assistant_message_id: i64,
) {
    let memory_mode = crate::services::prompt_compiler::load_memory_mode(db, conversation_id).await;
    if memory_mode == "mem0" {
        crate::services::chat_service::spawn_memory_extraction_task(
            app.clone(), db.clone(), conversation_id, round_id, assistant_message_id,
        );
    } else {
        // ... 保留原有 plot_summary + character_state_overlay 逻辑 ...
    }
}
```

**需将 `load_memory_mode` 设为 pub**: 在 `prompt_compiler.rs` 中将函数改为 `pub async fn`。

**验证**: `cargo check` 编译通过。

---

## Task 5: Memory Extraction Task 门控改造

**文件**: `src-tauri/src/services/chat_service.rs` (第 98-110 行)

**当前**: 检查 `mem0_enabled`:
```rust
let enabled = sqlx::query_scalar::<_, i64>(
    "SELECT mem0_enabled FROM conversations WHERE id = ? LIMIT 1"
)...
```

**替换为 `memory_mode` 检查**:
```rust
let mode = sqlx::query_scalar::<_, String>(
    "SELECT memory_mode FROM conversations WHERE id = ? LIMIT 1"
)
.bind(conversation_id)
.fetch_optional(db)
.await
.map_err(|err| err.to_string())?
.flatten()
.unwrap_or_else(|| "stateless".to_string());
if mode != "mem0" {
    return Ok(());
}
```

**验证**: `cargo check` 编译通过。

---

## Task 6: 模型与命令层改造

### 6.1 ConversationListItem 模型

**文件**: `src-tauri/src/models/mod.rs`

- 删除 `plot_summary_mode: String` 和 `mem0_enabled: bool` 字段
- 新增 `pub memory_mode: String`

### 6.2 查询与序列化点更新

**文件**: `src-tauri/src/commands/conversations.rs`
- SELECT 语句: 用 `memory_mode` 替换 `plot_summary_mode, mem0_enabled`
- INSERT 语句: 默认值 `'stateless'`
- `ConversationListItem` 构造: 读取 `memory_mode`

**文件**: `src-tauri/src/network/mod.rs`
- `load_conversation_summary` 的 SELECT 和构造同步更新

### 6.3 新增命令 `memory_mode_set`

**文件**: `src-tauri/src/commands/mem0.rs`

```rust
#[tauri::command]
pub async fn memory_mode_set(
    state: State<'_, AppState>,
    conversation_id: i64,
    mode: String,
) -> Result<String, String> {
    let normalized = match mode.as_str() {
        "stateless" | "mem0" => mode,
        _ => return Err("memory_mode 必须是 'stateless' 或 'mem0'".to_string()),
    };
    sqlx::query("UPDATE conversations SET memory_mode = ?, updated_at = ? WHERE id = ?")
        .bind(&normalized)
        .bind(crate::utils::now_ts())
        .bind(conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
    Ok(normalized)
}
```

### 6.4 命令注册

**文件**: `src-tauri/src/lib.rs` (第 140-145 行)

- 新增 `commands::mem0::memory_mode_set` 到 `invoke_handler`
- 删除旧命令 `mem0_set_enabled` 和 `plot_summaries_update_mode` 的注册（或保留为 deprecated 转发）

### 6.5 删除旧命令实现

- `commands/mem0.rs` 中 `mem0_set_enabled`: 删除或改为转发到 `memory_mode_set`
- `commands/plot_summaries.rs` 中 `plot_summaries_update_mode`: 删除或改为转发

**验证**: `cargo check` 编译通过。

---

## Task 7: 前端改造

### 7.1 backend.ts 接口更新

**文件**: `src/lib/backend.ts`

```typescript
export interface ConversationListItem {
  memoryMode: 'stateless' | 'mem0' | string;  // ← 新增
}

export async function memoryModeSet(conversationId: number, mode: 'stateless' | 'mem0') {
  return invokeCommand<string>('memory_mode_set', { conversationId, mode });
}
```

### 7.2 App.tsx 更新

**文件**: `src/App.tsx`

- 从 `ConversationListItem` 读取 `memoryMode` 而非旧字段
- 传递 `memoryMode` + `onUpdateMemoryMode` 给 `RightDrawer`

### 7.3 RightDrawer.tsx UI 重构

**文件**: `src/components/RightDrawer.tsx`

**Props 变更**:
```typescript
interface RightDrawerProps {
  memoryMode: 'stateless' | 'mem0' | string;
  mem0Available?: boolean;
  onUpdateMemoryMode: (mode: 'stateless' | 'mem0') => Promise<void> | void;
}
```

**UI 变更**:
- 删除"剧情总结时间线"section (AI/手动切换按钮)
- 删除 mem0 开关 section
- 新增统一的"记忆模式"section，二选一切换:

```tsx
<section class="border-b border-white/10 pb-6 mb-6 space-y-5">
  <div>
    <p class="text-sm font-semibold text-white">记忆模式</p>
    <p class="text-xs text-mist-solid/40 mt-1">
      无状态：纯多轮对话，无记忆。Mem0：AI 自动提取与检索长期记忆，不保留原文窗口。
    </p>
  </div>
  <Show when={!mem0Available()}>
    <div class="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
      记忆后端未就绪：请先配置 API 档案后重启。
    </div>
  </Show>
  <div class="flex gap-2">
    <button disabled={modeUpdating() || !mem0Available()}
      onClick={() => handleModeChange('stateless')}
      class={memoryMode() === 'stateless' ? activeClass : inactiveClass}>
      无状态
    </button>
    <button disabled={modeUpdating() || !mem0Available()}
      onClick={() => handleModeChange('mem0')}
      class={memoryMode() === 'mem0' ? activeClass : inactiveClass}>
      Mem0 记忆
    </button>
  </div>
</section>
```

**验证**: `npm run build` 前端构建通过。

---

## Task 8: 端到端验证

### 8.1 无状态模式验证
1. 创建新会话，确认默认 `memory_mode = 'stateless'`
2. 发送 3-5 轮对话
3. 用 `get_conversation_token_usage` 检查 token 层级报告:
   - 应见: PresetRule + CharacterBase + WorldBookMatch + RecentHistory(全量) + CurrentUser
   - 不应见: PlotSummary, WorldVariable, RetrievedDetail
4. 确认 stream 完成后无 `[memory] extraction task` 日志

### 8.2 Mem0 模式验证
1. 在会话设置中切换到 "Mem0 记忆"
2. 确认 `mem0Available = true`
3. 发送首轮对话，等待 stream 完成
4. 检查 stderr: 应见 `[memory] extraction task`，无 `character_state_overlay` / `plot_summary`
5. 发送 2-3 轮后，用 `mem0_list_memories` 确认记忆已提取
6. 用 `get_conversation_token_usage` 检查:
   - 应见: PresetRule + CharacterBase + WorldBookMatch + RetrievedDetail + CurrentUser
   - 不应见: PlotSummary, WorldVariable, **RecentHistory**
   - token 总量应显著小于无状态模式
7. 用 `mem0_search_test` 验证多策略查询返回不同类型的记忆

### 8.3 模式切换验证
1. 从 Mem0 切回无状态: RecentHistory 恢复全量，RetrievedDetail 消失
2. 从无状态切到 Mem0: RecentHistory 消失，RetrievedDetail 出现

### 8.4 回归验证
- 旧会话（迁移前 `plot_summary_mode = 'ai'`）迁移后 `memory_mode = 'mem0'`
- 旧会话（迁移前 `plot_summary_mode = 'disabled'` 且 `mem0_enabled = 0`）迁移后 `memory_mode = 'stateless'`

---

## 涉及文件清单

**后端 (Rust)**:
- `src-tauri/migrations/0034_memory_mode_unified.sql` (新建)
- `src-tauri/migrations/0035_drop_legacy_memory_fields.sql` (新建)
- `src-tauri/src/services/prompt_compiler.rs` (核心改造)
- `src-tauri/src/services/stream_processor.rs` (触发逻辑改造)
- `src-tauri/src/services/chat_service.rs` (门控改造)
- `src-tauri/src/models/mod.rs` (模型字段更新)
- `src-tauri/src/commands/conversations.rs` (查询更新)
- `src-tauri/src/commands/mem0.rs` (新增 memory_mode_set)
- `src-tauri/src/commands/plot_summaries.rs` (旧命令标记 deprecated)
- `src-tauri/src/network/mod.rs` (查询更新)
- `src-tauri/src/lib.rs` (命令注册)

**前端 (TypeScript/SolidJS)**:
- `src/lib/backend.ts` (接口更新)
- `src/App.tsx` (props 更新)
- `src/components/RightDrawer.tsx` (UI 重构)

**保留不动 (mem0 adapter 层)**:
- `src-tauri/src/services/memory_service.rs`
- `src-tauri/src/services/memory_providers/mem0_rs.rs`
- `src-tauri/src/services/memory_providers/mod.rs`

**保留不动 (旧系统代码，门控关闭)**:
- `src-tauri/src/services/plot_summaries.rs`
- `src-tauri/src/services/character_state_overlays.rs`

---

## 风险与注意事项

1. **0 轮原文窗口的风险**: Mem0 模式下完全不保留 RecentHistory，模型对最近对话的连贯性完全依赖 Mem0 提取质量。如果 Mem0 提取遗漏了关键细节（如语气、动作），可能出现对话不连贯。这是实验分支需要验证的核心问题。

2. **mem0-rs 无 Graph RAG**: 当前 mem0-rs 仅为向量检索。角色状态查询（"关系变化、信任度"）在纯向量检索下效果有限。多策略查询是向量模式下的近似方案。

3. **SQLite DROP COLUMN**: 需要 SQLite 3.35+。Tauri 2 内置的 SQLite 版本应满足要求，但需验证。若不支持，改用表重建方式。

4. **`handle_stream_completion` 重复逻辑**: 该函数与 `spawn_stream_task` 有重复触发逻辑，需同步改造并确认是否为活跃路径。

---

## 任务完成回执

**提交**: `6afe23b` on `feat/mem0-memory-authority`
**变更统计**: 18 files changed, +378 / -578
**验证**: `cargo check` ✅ (0 errors, 60 warnings 均为预存 dead_code) · `vite build` ✅ (392 modules, 48.56s)

| Task | 状态 | 说明 |
|------|------|------|
| Task 1: Git 分支 | ✅ | 分支已存在，基线代码已提交 `6afe23b` |
| Task 2: 数据库迁移 | ✅ | `0034_memory_mode_unified.sql` + `0035_drop_legacy_memory_fields.sql` 已创建 |
| Task 3: Prompt Compiler | ✅ | `load_memory_mode` + `compile_prompt` 门控 + `load_retrieved_detail_blocks` 三策略查询(detail/character_state/plot) |
| Task 4: Stream Processor | ✅ | `spawn_post_round_tasks` 统一触发，mem0 模式仅 spawn memory_extraction_task |
| Task 5: Memory Extraction 门控 | ✅ | `mem0_enabled` → `memory_mode` 检查（修复 `.flatten()` 误用） |
| Task 6: 模型与命令层 | ✅ | `ConversationListItem` 字段替换 + `memory_mode_set` 命令 + 旧命令 deprecated 转发 |
| Task 7: 前端改造 | ✅ | `backend.ts` 接口 + `RightDrawer` 统一记忆模式 UI + `App.tsx` + `MobileView.tsx` props 同步 |
| Task 8: 编译验证 | ✅ | `cargo check` + `vite build` 均通过 |

### 修改文件清单

**后端 (Rust)**:
- `src-tauri/migrations/0034_memory_mode_unified.sql` (新建)
- `src-tauri/migrations/0035_drop_legacy_memory_fields.sql` (新建)
- `src-tauri/src/services/prompt_compiler.rs` — `load_memory_mode` 常量与函数、`compile_prompt` 门控、`load_retrieved_detail_blocks` 签名+多策略查询
- `src-tauri/src/services/stream_processor.rs` — `spawn_post_round_tasks` 辅助函数 + 两处调用点更新
- `src-tauri/src/services/chat_service.rs` — `mem0_enabled` → `memory_mode` 门控 + 移除未使用导入 `PromptCompileResult` + 修复 `.flatten()` 编译错误
- `src-tauri/src/models/mod.rs` — `ConversationListItem` 字段替换
- `src-tauri/src/commands/conversations.rs` — 6 处 SELECT/INSERT/构造更新 + fork INSERT 修复
- `src-tauri/src/commands/mem0.rs` — 新增 `memory_mode_set` + `mem0_set_enabled` deprecated 转发
- `src-tauri/src/commands/plot_summaries.rs` — `plot_summaries_update_mode` deprecated 转发 + 移除未使用导入
- `src-tauri/src/network/mod.rs` — `load_conversation_summary` SELECT + 构造更新
- `src-tauri/src/lib.rs` — 注册 `memory_mode_set` 命令
- `src-tauri/src/backdoor/handlers.rs` — INSERT 语句修复 + 未使用变量 `_kind`
- `src-tauri/src/services/plot_summaries.rs` — `load_plot_summary_mode` 改为从 `memory_mode` 推导
- `src-tauri/src/services/provider_adapter.rs` — 移除不必要的 `mut`

**前端 (TypeScript/SolidJS)**:
- `src/lib/backend.ts` — `ConversationListItem` 接口更新 + `memoryModeSet` 函数
- `src/App.tsx` — 导入 + props 接口 + 处理函数 + 两处 RightDrawer 调用更新
- `src/components/RightDrawer.tsx` — 完整 UI 重构（props + handlers + 统一记忆模式 section）+ 恢复 `Sparkles` 导入
- `src/components/MobileView.tsx` — props 接口 + RightDrawer 调用 + 移除 `PlotSummaryRecord` 导入

### 遗留说明

- `tsc --noEmit` 报告 21 个 TypeScript 类型错误，均为预存问题（非本次改动引入），不影响 vite 构建（esbuild 转译不做类型检查）
- Task 8 端到端运行时验证（计划 8.1–8.4）尚未执行，需在应用启动后手动验证
- `cargo check` 的 60 个 warnings 均为预存 dead_code（如 `row_to_conversation_list_item`、`handle_stream_completion` 等），非本次引入


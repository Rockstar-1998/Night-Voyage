# SQLite 数据库冗余字段深度扫描 Spec

## Why
项目经过 31 次迁移后，数据库中积累了大量历史遗留字段和表。部分字段已被新结构取代但仍保留在 schema 中，部分表从未被代码实际读取。需要系统性地识别这些冗余，为后续清理提供依据。

## What Changes
- 识别所有冗余/废弃字段和表
- 记录每个发现的具体证据（哪些代码使用了、哪些没有）
- 不做任何代码修改，仅产出分析报告

## Impact
- Affected specs: 无（纯分析任务）
- Affected code: `src-tauri/migrations/**`, `src-tauri/src/repositories/**`, `src-tauri/src/commands/**`

---

## 扫描结果

### 一、冗余/废弃字段（已被新结构取代但未删除）

#### 1. `character_cards.personality` — 从未使用
- **Schema**: 0001_init.sql 定义了 `personality TEXT`
- **代码证据**: 全项目搜索 `personality`，在 `src-tauri/src/` 中零匹配
- **结论**: 建表时预留但从未被任何 SELECT/INSERT/UPDATE 引用，完全废弃

#### 2. `character_cards.system_prompt` — 从未使用
- **Schema**: 0001_init.sql 定义了 `system_prompt TEXT`
- **代码证据**: 全项目搜索 `system_prompt`，仅在 `presets.system_prompt_template` 和 `preset_prompt_blocks` 上下文中出现，`character_cards.system_prompt` 列本身零引用
- **结论**: 建表时预留但从未使用，完全废弃

#### 3. `character_cards.example_messages` — 从未使用
- **Schema**: 0001_init.sql 定义了 `example_messages TEXT`
- **代码证据**: 全项目搜索 `example_messages`，仅在 `preset_examples` 上下文中出现，`character_cards.example_messages` 列零引用
- **结论**: 建表时预留但从未使用，完全废弃

#### 4. `character_cards.creator_notes` — 从未使用
- **Schema**: 0001_init.sql 定义了 `creator_notes TEXT`
- **代码证据**: 全项目搜索 `creator_notes`，零匹配
- **结论**: 建表时预留但从未使用，完全废弃

#### 5. `character_cards.first_message` — 已被 `character_card_openers` 取代但仍保留
- **Schema**: 0001_init.sql 定义，0003 迁移将数据迁移至 `character_card_openers`
- **代码证据**:
  - `characters.rs` 中 INSERT/UPDATE 仍写入此列（作为 `legacy_first_message`）
  - `characters.rs` 的 `load_openers()` 优先读 `character_card_openers`，仅当该表为空时回退读 `first_message`
  - `conversations.rs` 创建会话时仍读 `first_message` 作为 fallback
- **结论**: 双写冗余，`first_message` 已被 `character_card_openers` 完全取代，保留仅为向后兼容

#### 6. `character_cards.description` — 已被 `character_card_base_sections` 取代但仍保留
- **Schema**: 0001_init.sql 定义，0010 迁移将数据迁移至 `character_card_base_sections`
- **代码证据**:
  - `characters.rs` 中 INSERT/UPDATE 仍写入此列
  - `character_card_get()` 仍 SELECT 此列
  - 但实际角色卡编辑器使用 `base_sections` 结构
- **结论**: 双写冗余，`description` 已被 `character_card_base_sections` 取代

#### 7. `character_cards.tags` — 已被 `character_card_tags` 取代但仍保留
- **Schema**: 0001_init.sql 定义，0003 迁移创建 `character_card_tags` 表
- **代码证据**:
  - `characters.rs` 中 INSERT/UPDATE 仍写入此列（作为 `legacy_tags`，逗号分隔）
  - `load_tags()` 优先读 `character_card_tags`，仅当该表为空时回退读 `tags`
- **结论**: 双写冗余，`tags` 已被 `character_card_tags` 取代

#### 8. `presets.system_prompt_template` — 已被 `preset_prompt_blocks` 取代
- **Schema**: 0001_init.sql 定义，0005 迁移将数据迁移至 `preset_prompt_blocks`
- **代码证据**: 全项目搜索 `system_prompt_template`，在 Rust 代码中零引用（仅迁移 SQL 中出现）
- **结论**: 已完全废弃，数据已迁移至 `preset_prompt_blocks`

#### 9. `presets.jailbreak_prompt` — 已被 `preset_prompt_blocks` 取代
- **Schema**: 0001_init.sql 定义，0005 迁移将数据迁移至 `preset_prompt_blocks`
- **代码证据**: 全项目搜索 `jailbreak_prompt`，在 Rust 代码中零引用（仅迁移 SQL 中出现）
- **结论**: 已完全废弃，数据已迁移至 `preset_prompt_blocks`

#### 10. `conversations.character_id` — 已被 `conversations.host_character_id` 取代
- **Schema**: 0001_init.sql 定义了 `character_id`，0003 迁移添加 `host_character_id` 并将数据迁移
- **代码证据**:
  - `prompt_compiler.rs:1207` 使用 `COALESCE(c.host_character_id, c.character_id)` 仍兼容读取
  - 其余所有代码只引用 `host_character_id`
- **结论**: `character_id` 已被 `host_character_id` 取代，仅一处 COALESCE 兼容读取

#### 11. `rooms.character_id` — 从未使用
- **Schema**: 0001_init.sql 定义了 `character_id INTEGER`，外键指向 `character_cards`
- **代码证据**: 全项目搜索 `rooms.*character_id`，零匹配。`room_create` INSERT 不包含此列
- **结论**: 建表时预留但从未被任何代码写入或读取，完全废弃

### 二、从未被读取的表（仅写入/删除，无 SELECT 业务逻辑）

#### 1. `agent_bindings` — 完全未使用
- **Schema**: 0003 迁移创建
- **代码证据**: 全项目搜索 `agent_bindings`，零匹配（无 SELECT、INSERT、UPDATE、DELETE）
- **结论**: 整张表从未被任何代码访问，完全废弃

#### 2. `agent_runs` — 仅写入和删除，无业务读取
- **Schema**: 0003 迁移创建
- **代码证据**:
  - `round_repository.rs` 中 INSERT 写入
  - `conversations.rs` 和 `backdoor/handlers.rs` 中 DELETE 删除
  - 无任何 SELECT 读取其数据用于业务逻辑
- **结论**: 写入后从未读取，属于"只写不读"的废弃表

#### 3. `agent_drafts` — 仅写入和删除，无业务读取
- **Schema**: 0003 迁移创建
- **代码证据**:
  - `round_repository.rs` 中 INSERT 写入
  - `conversations.rs` 和 `backdoor/handlers.rs` 中 DELETE 删除
  - 无任何 SELECT 读取其数据用于业务逻辑
- **结论**: 写入后从未读取，属于"只写不读"的废弃表

#### 4. `api_provider_models` — 仅写入和删除，无业务读取
- **Schema**: 0003 迁移创建
- **代码证据**:
  - `providers.rs` 中 INSERT 写入和 DELETE 删除
  - 无任何 SELECT 读取其数据用于业务逻辑（模型列表可能直接从 API 获取）
- **结论**: 写入后从未读取，可能为缓存设计但未被实际使用

### 三、Schema 不一致问题

#### 1. `message_tool_calls.status` CHECK 约束与实际使用不一致
- **Schema CHECK**: `status IN ('pending', 'completed', 'failed', 'ignored')`
- **实际使用**:
  - `round_repository.rs:545` 写入 `status = 'pending_tool_result'`
  - `message_repository.rs:341` 写入 `status = 'result_available'`
- **结论**: CHECK 约束过时，实际使用的状态值不在约束范围内，SQLite 默认不强制 CHECK 但这是设计不一致

#### 2. `message_content_parts` 表被重建但 `update_content_parts_text` 方法引用了不存在的列
- **代码证据**: `message_repository.rs:147` 使用 `content_type = 'text'` 和 `text_content` 列名
- **实际 Schema**: 列名为 `part_type` 和 `text_value`
- **结论**: 该方法会执行失败，属于死代码或 bug

### 四、冗余索引

#### 1. `idx_messages_created_at` — 被 `idx_messages_visible_window` 覆盖
- `idx_messages_visible_window` 在 `(conversation_id, is_hidden, created_at DESC)` 上
- 几乎所有消息查询都带 `conversation_id` 和 `is_hidden` 条件
- 单独的 `created_at` 索引冗余

### 五、汇总统计

| 类别 | 数量 | 详情 |
|------|------|------|
| 完全废弃字段（零引用） | 5 | `character_cards.personality`, `character_cards.system_prompt`, `character_cards.example_messages`, `character_cards.creator_notes`, `rooms.character_id` |
| 已被取代但仍双写的字段 | 4 | `character_cards.first_message`, `character_cards.description`, `character_cards.tags`, `conversations.character_id` |
| 已完全废弃的旧字段（零引用） | 2 | `presets.system_prompt_template`, `presets.jailbreak_prompt` |
| 完全未使用的表 | 1 | `agent_bindings` |
| 只写不读的表 | 3 | `agent_runs`, `agent_drafts`, `api_provider_models` |
| Schema 不一致 | 2 | `message_tool_calls.status` CHECK 约束过时, `update_content_parts_text` 引用不存在的列 |
| 冗余索引 | 1 | `idx_messages_created_at` |

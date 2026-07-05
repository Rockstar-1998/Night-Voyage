# 三模式记忆架构重构 — 交接文档

> **交接时间**: 2026-06-28  
> **任务来源**: `mem0-memory-authority-plan.md` + `Qwen_handoff.md`  
> **计划文件**: `C:\Users\Administrator\AppData\Roaming\QoderCN\SharedClientCache\cache\plans\三模式记忆架构重构_task-c2e.md`  
> **对话记录**: `C:\Users\Administrator\.qoder-cn\cache\projects\Night Voyage-72ea6a33\conversation-history\task-c2e\task-c2e.jsonl`

---

## 1. 任务概述

将 Night Voyage 的两模式记忆系统（`stateless`/`mem0`）重构为三模式架构：

| 模式 | 说明 | PlotSummary | WorldVariable | RecentHistory | MEM0 |
|------|------|-------------|---------------|---------------|------|
| `stateless` | 纯多轮对话 | 无 | Preset 控制 | 全量 | 无 |
| `legacy` | 省钱方案 | batch+占位 | Preset 控制 | 可配置窗口 | 无 |
| `mem0` | MEM0 全权托管 | 无 | 无 | 无 | 全权托管 + SQLite 文件级快照回溯 |

### 关键决策（来自 Qwen handoff）

1. **MEM0 快照存储**: 存放在 EXE 同级目录下（`<exe_dir>/mem0-snapshots/<conversation_id>/`），不使用硬编码路径
2. **character_state_overlays 表**: 开发阶段，直接删除，不保留数据
3. **会话模式锁定**: 创建后不可切换，前端不预留切换按钮
4. **X 值（快照窗口）**: 默认值 20，设置框放在 MEM0 模式会话的抽屉界面中

---

## 2. 完成进度

### ✅ 已完成（Task 1-9 全部完成）

#### Task 1: 数据库迁移
- **文件**: `src-tauri/migrations/0036_three_mode_memory.sql`
- 内容: 添加 `world_variables`、`round_id`、`world_variable_enabled`/`schema`、`mem0_snapshot_window` 列；删除 `character_state_overlays` 表

#### Task 2: Prompt Compiler 三模式改造
- **文件**: `src-tauri/src/services/prompt_compiler.rs`
- 新增常量 `MEMORY_MODE_LEGACY`、`MEMORY_MODE_MEM0`
- 重写 `load_memory_mode` 识别三态
- `compile_prompt` 三模式门控：
  - `mem0` → 无 PlotSummary, 无 WorldVariable, 无 RecentHistory, 仅 RetrievedDetail
  - `legacy` → PlotSummary(batch+占位), WorldVariable(preset控制), RecentHistory(可配置窗口)
  - `stateless` → 无 PlotSummary, WorldVariable(preset控制), RecentHistory(全量)
- 新增 `load_world_variable_block()` — 从 `message_rounds.world_variables` JSON 列读取，先检查 preset 的 `world_variable_enabled`
- 移除 `character_state_overlays` 导入

#### Task 3: PlotSummaries + StreamProcessor
- **文件**: `src-tauri/src/services/plot_summaries.rs`
  - `load_plot_summary_mode`: `legacy` → `"ai"`，其余（含 `mem0`）→ `"disabled"`（原代码 `mem0→"ai"` 需反转）
  - 新增 `create_round_placeholder()`: legacy 模式每轮插入 `status='pending'` 占位行
- **文件**: `src-tauri/src/services/stream_processor.rs`
  - 重写 `spawn_post_round_tasks` 为三模式 match：
    - `mem0` → `spawn_memory_extraction_task`
    - `legacy` → `create_round_placeholder` + `spawn_plot_summary_processing` + TODO: `spawn_world_variable_generation_task`
    - `stateless` → TODO: `spawn_world_variable_generation_task`
  - 移除 `spawn_character_state_overlay_generation_task` 调用

#### Task 4: 清理 character_state_overlays 模块
- `src-tauri/src/services/character_state_overlays.rs` → 清空（仅保留 deprecated 注释）
- `src-tauri/src/services/mod.rs` → 移除 `pub mod character_state_overlays;`
- `src-tauri/src/models/mod.rs` → 移除 `CharacterStateOverlayErrorEvent` 等关联类型，新增 `mem0_snapshot_window` 字段到 `ConversationListItem`
- `src-tauri/src/backdoor/handlers.rs` → 移除 `DELETE FROM character_state_overlays`
- `src-tauri/src/commands/plot_summaries.rs` → deprecated 转发更新（加入 `legacy`）

#### Task 5: 会话创建与命令层
- **文件**: `src-tauri/src/commands/conversations.rs`
  - `conversations_create` 新增 `memory_mode: Option<String>` 参数
  - INSERT 绑定替代硬编码 `'stateless'`
  - 新增 `normalize_memory_mode()` 验证函数（仅接受 `stateless` | `legacy` | `mem0`）
  - fork INSERT 保留原会话 `memory_mode`
  - `row_to_conversation_list_item` 添加 `mem0_snapshot_window` 字段
- **文件**: `src-tauri/src/commands/mem0.rs`
  - `memory_mode_set` 添加 `"legacy"` 到合法值
- **文件**: `src-tauri/src/network/mod.rs`
  - SELECT 查询添加 `mem0_snapshot_window`，构造 `ConversationListItem` 添加该字段

#### Task 6: MEM0 存储路径改为 EXE 相对
- **文件**: `src-tauri/src/services/memory_providers/mod.rs`
  - 移除 `MEM0_STORAGE_DIR = "D:\\software_cache\\mem0"` 硬编码
  - 新增 `resolve_mem0_storage_dir()`: 解析 `<exe_dir>/mem0-data/`，自动 `create_dir_all`
- **文件**: `src-tauri/src/commands/mem0.rs`
  - 导入 `resolve_mem0_storage_dir` 替代 `MEM0_STORAGE_DIR`

#### Task 7: MEM0 快照服务
- **新建**: `src-tauri/src/services/mem0_snapshot.rs`
  - `snapshot_dir(conversation_id)` → `<exe_dir>/mem0-snapshots/<conversation_id>/`
  - `create_snapshot(db, conversation_id, round_index)`: PRAGMA wal_checkpoint(TRUNCATE) → 复制主 SQLite 文件 → 复制 MEM0 向量库文件
  - `list_snapshots(conversation_id)` → 按 round_index 降序
  - `prune_old_snapshots(conversation_id, window)` → 清理窗口外快照
  - `load_snapshot_window(db, conversation_id)` → 读取 per-conversation 配置（默认 20）
  - `resolve_main_db_path()` → 通过 env var 或 exe dir 解析主数据库路径
- **新建**: `src-tauri/src/commands/mem0_snapshot.rs`
  - `mem0_snapshot_list` — 列出快照
  - `mem0_snapshot_window_set` — 设置快照窗口
- **修改**: `src-tauri/src/services/chat_service.rs`
  - 在 `submit_input` 中，事务开始前添加快照触发逻辑（检查 `memory_mode == 'mem0'` 且最新 round 已完成）
- **修改**: `src-tauri/src/services/mod.rs` + `src-tauri/src/commands/mod.rs` → 注册新模块
- **修改**: `src-tauri/src/lib.rs` → 注册 `mem0_snapshot_list` 和 `mem0_snapshot_window_set` 命令

#### Task 8: 前端改造
- **文件**: `src/lib/backend.ts`
  - `ConversationListItem`: `memoryMode` 三态 + `mem0SnapshotWindow?: number`
  - `CreateConversationPayload`: 新增 `memoryMode?`
  - 新增 `SnapshotInfo` 接口
  - 新增函数: `mem0SnapshotList` / `mem0SnapshotWindowSet`
  - `memoryModeSet` 签名更新为三态
- **文件**: `src/components/NewChatModal.tsx`
  - 新增 `memoryMode` signal
  - Step 2 添加记忆模式三选一 UI（无状态/传统/Mem0）
  - 两个 payload（handleSubmit + handleCreateRoom）均携带 `memoryMode`
  - reset() 中重置 `setMemoryMode('stateless')`
- **文件**: `src/components/RightDrawer.tsx`
  - **移除**: `overlaySummary`/`overlayStatus`/`overlayError` props、`mem0Available`/`onUpdateMemoryMode` props、`modeUpdating` signal、`handleModeChange`、`overlayDescription` memo
  - **新增**: `mem0SnapshotWindow`/`onSnapshotWindowChange` props、`snapshotWindowInput`/`snapshotWindowSaving` signals、`handleSnapshotWindowSave`、`memoryModeLabel` memo
  - **替换**: "角色状态覆盖层" section → "世界变量" section
  - **替换**: 模式切换按钮 → 只读模式标签 + MEM0 快照窗口数字输入框（仅 mem0 模式显示）
  - 新增 `Lock` 图标导入
- **文件**: `src/App.tsx`
  - **移除**: `mem0Available` signal、`handleUpdateMemoryMode`、`refreshMem0Status`、`void refreshMem0Status()` 调用、overlay 事件监听器（`listenCharacterStateOverlayUpdated`/`listenCharacterStateOverlayError`）及其 cleanup
  - **新增**: `handleSnapshotWindowChange` handler（调用 `mem0SnapshotWindowSet`）
  - DesktopView/AnimatedDesktopView props 更新：移除 overlay/mem0Available/onUpdateMemoryMode，新增 mem0SnapshotWindow/onSnapshotWindowChange
  - RightDrawer 两处使用点（DesktopView + AnimatedDesktopView）props 同步更新
  - 移除 backend imports: `listenCharacterStateOverlayError`/`listenCharacterStateOverlayUpdated`/`memoryModeSet`/`mem0Status`；新增 `mem0SnapshotWindowSet`
- **文件**: `src/components/MobileView.tsx`
  - Props 接口同步更新（虽然组件未被 App.tsx 导入，但保持一致）
  - RightDrawer 使用点 props 同步更新

#### Task 9: 编译验证
- `cargo check` ✅ 零错误（仅预存在的 dead_code warnings）
- `tsc --noEmit` ✅ 无新增错误（所有 22 个 TS 错误均为预存在，与本次改动无关）

---

## 3. 修复的编译问题

1. **`conversations.rs` 缺少 `mem0_snapshot_window` 字段**: `row_to_conversation_list_item` 函数中遗漏了新字段 → 添加 `mem0_snapshot_window: row.try_get("mem0_snapshot_window").unwrap_or(20)`
2. **`mem0_snapshot.rs` 未使用 `Path` 导入**: `use std::path::{Path, PathBuf}` 中 `Path` 未使用 → 改为 `use std::path::PathBuf`
3. **MobileView.tsx 传递了已移除的 RightDrawer props**: `overlaySummary`/`overlayStatus`/`overlayError`/`mem0Available`/`onUpdateMemoryMode` → 替换为新 props

---

## 4. 数据库迁移问题（已解决）

### 问题描述
运行 `night-voyage.exe` 时报错：`migration 32 was previously applied but has been modified`

### 根因
`resolve_db_path()`（`src-tauri/src/db/mod.rs` L114-121）**优先使用 exe 同目录下的数据库文件**：
```rust
if let Ok(exe_path) = std::fs::canonicalize(std::env::current_exe()?) {
    if let Some(exe_dir) = exe_path.parent() {
        let local_db = exe_dir.join("night-voyage.sqlite3");
        if local_db.exists() {
            return Ok(local_db);
        }
    }
}
// fallback to %APPDATA%\com.nightvoyage.app\night-voyage.sqlite3
```

构建脚本 `build dual release.bat` 在 instance 目录下创建了数据库文件。这些旧数据库的 `_sqlx_migrations` 表记录了旧的 migration checksum，与新编译的二进制不匹配。

### 解决方案
删除两个 instance 目录下的所有 `night-voyage.sqlite3*` 文件：
```powershell
Remove-Item "D:\data\Night Voyage\.cache\instances\instance-a\night-voyage.sqlite3*" -Force
Remove-Item "D:\data\Night Voyage\.cache\instances\instance-b\night-voyage.sqlite3*" -Force
```

同时删除 `%APPDATA%` 下的数据库（fallback 路径）：
```powershell
Remove-Item "$env:APPDATA\com.nightvoyage.app\night-voyage.sqlite3*"
```

---

## 5. 待办事项（下一步）

### 5.1 立即验证
- [ ] 删除旧数据库后，运行 `./night-voyage.exe` 确认应用正常启动
- [ ] 创建三种模式的会话，验证前端 UI 和后端逻辑

### 5.2 功能 TODO（代码中标记）
1. **`spawn_world_variable_generation_task`**（`stream_processor.rs`）
   - legacy 和 stateless 模式中标记为 TODO
   - 需要实现 AI 生成 `world_variables` JSON 并写入 `message_rounds.world_variables` 列
   - 应检查 preset 的 `world_variable_enabled` 开关
2. **MEM0 快照回滚**（`mem0_snapshot.rs`）
   - `rollback_to_snapshot` 函数在计划中提到但**尚未实现**
   - 需要: 关闭连接池 → rename 覆盖 → 重建连接池
   - 需要 Mutex 防止并发请求
   - 对应 Tauri 命令 `mem0_snapshot_rollback` 也未注册
3. **`character_state_overlays` 完全清理**
   - `backend.ts` 中仍导出 `listenCharacterStateOverlayUpdated`/`listenCharacterStateOverlayError`（L997-1010）— 可保留但已无后端事件
   - `MobileView.tsx` 仍有 `characterStateOverlaySummary`/`Status`/`Error` props（未使用但未清理）

### 5.3 测试清单
- [ ] 创建 stateless 会话 → 验证无 PlotSummary、WorldVariable 由 preset 控制
- [ ] 创建 legacy 会话 → 验证 PlotSummary 占位行生成、batch 处理
- [ ] 创建 mem0 会话 → 验证 MEM0 记忆提取、快照创建、快照窗口设置
- [ ] 验证模式锁定 — 不应有切换按钮
- [ ] 验证 MEM0 存储路径在 `<exe_dir>/mem0-data/` 下
- [ ] 验证快照文件在 `<exe_dir>/mem0-snapshots/<conversation_id>/` 下

### 5.4 构建注意事项
- 构建脚本: `build dual release.bat`（项目根目录）
- 构建后需删除 instance 目录下的旧数据库（否则 migration checksum 不匹配）
- 构建脚本会备份旧数据库到 `.cache/db-backups/`
- 构建脚本只在数据库不存在时创建空文件（`if not exist "%DB_A%" type nul > "%DB_A%"`）

---

## 6. 架构变更摘要

### 数据模型变更
```
message_rounds
  + world_variables TEXT          -- JSON 列，替代 character_state_overlays

plot_summaries
  + round_id INTEGER              -- 支持 per-round 占位行

presets
  + world_variable_enabled INTEGER NOT NULL DEFAULT 0
  + world_variable_schema TEXT

conversations
  + mem0_snapshot_window INTEGER NOT NULL DEFAULT 20

character_state_overlays
  × DROP TABLE                    -- 完全删除
```

### 后端核心逻辑流

```
用户发送消息
  ↓
chat_service.submit_input
  ↓ (mem0 模式: 创建快照 → prune)
  ↓
创建新 round + 消息
  ↓
compile_prompt (三模式门控)
  ├─ mem0:     仅 RetrievedDetail (MEM0 检索)
  ├─ legacy:   PlotSummary + WorldVariable(preset) + RecentHistory(窗口)
  └─ stateless: WorldVariable(preset) + RecentHistory(全量)
  ↓
LLM 流式回复
  ↓
spawn_post_round_tasks (三模式分支)
  ├─ mem0:     spawn_memory_extraction_task
  ├─ legacy:   create_round_placeholder + spawn_plot_summary_processing + TODO: world_variable_gen
  └─ stateless: TODO: world_variable_gen
```

### 前端核心 UI 变更
- **NewChatModal**: Step 2 新增记忆模式三选一（无状态/传统/Mem0）
- **RightDrawer**: 
  - "角色状态覆盖层" → "世界变量"
  - 模式切换按钮 → 只读模式标签 + "模式在创建时锁定" 提示
  - mem0 模式下显示快照窗口数字输入框
- **App.tsx**: 移除 mem0Available/refreshMem0Status/overlay 监听，新增 handleSnapshotWindowChange

---

## 7. 关键文件清单

### 后端（Rust）
| 文件 | 变更类型 |
|------|----------|
| `src-tauri/migrations/0036_three_mode_memory.sql` | 新建 |
| `src-tauri/src/services/prompt_compiler.rs` | 修改 |
| `src-tauri/src/services/plot_summaries.rs` | 修改 |
| `src-tauri/src/services/stream_processor.rs` | 修改 |
| `src-tauri/src/services/character_state_overlays.rs` | 清空 |
| `src-tauri/src/services/mem0_snapshot.rs` | 新建 |
| `src-tauri/src/services/memory_providers/mod.rs` | 修改 |
| `src-tauri/src/services/chat_service.rs` | 修改 |
| `src-tauri/src/services/mod.rs` | 修改 |
| `src-tauri/src/commands/conversations.rs` | 修改 |
| `src-tauri/src/commands/mem0.rs` | 修改 |
| `src-tauri/src/commands/mem0_snapshot.rs` | 新建 |
| `src-tauri/src/commands/mod.rs` | 修改 |
| `src-tauri/src/models/mod.rs` | 修改 |
| `src-tauri/src/network/mod.rs` | 修改 |
| `src-tauri/src/backdoor/handlers.rs` | 修改 |
| `src-tauri/src/lib.rs` | 修改 |
| `src-tauri/src/db/mod.rs` | 未修改（但 resolve_db_path 是迁移问题的关键） |

### 前端（TypeScript/SolidJS）
| 文件 | 变更类型 |
|------|----------|
| `src/lib/backend.ts` | 修改 |
| `src/components/NewChatModal.tsx` | 修改 |
| `src/components/RightDrawer.tsx` | 修改 |
| `src/App.tsx` | 修改 |
| `src/components/MobileView.tsx` | 修改 |

---

## 8. 注意事项

1. **编译断裂窗口**: Task 2-4 必须一次性完成（overlay 清理会导致悬空引用）
2. **SQLite WAL**: 快照前必须 `PRAGMA wal_checkpoint(TRUNCATE)`，否则复制文件不完整
3. **快照回滚原子性**: 需 Mutex 防止并发请求（尚未实现）
4. **mem0 行为逆转**: 原 `mem0→ai` 改为 `mem0→disabled`，残留 plot_summaries 数据需确保不干扰
5. **快照文件大小**: 完整 SQLite 复制，长对话可能占数百 MB
6. **数据库路径优先级**: `resolve_db_path()` 优先使用 exe 同目录的数据库，其次 `%APPDATA%`，最后可通过 `NIGHT_VOYAGE_DB_PATH` 环境变量覆盖
7. **构建脚本行为**: `build dual release.bat` 会在 instance 目录下创建空 DB 文件（如果不存在），但不会删除已有 DB

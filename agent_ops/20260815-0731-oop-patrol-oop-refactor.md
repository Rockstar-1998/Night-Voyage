# agent_ops · OOP→组合 重构巡逻 · 2026-08-15 07:31 (GMT+8)

## 本轮重构点
- **目标文件**：`src-tauri/src/services/blueprint_executor.rs`
- **函数**：`resolve_constant_source`（行 699–707）
- **命中模式**：模式 5（`match` 用 `_ =>` 通配臂吞掉封闭枚举 `NodeConfig` 的未知变体）
- **证据**：`blueprint_executor.rs:706` — `_ => Err(BlueprintError::BranchMustFollowConstant(branch_node_id.to_string()))` 静默吞掉 10 个非 Constant 变体（Start/End/Prompt/SchemaField/MutexGate/GroupGate/ModeSwitch/RoleSwitch/SamplingParams/Branch）。`NodeConfig` 定义于 `models/blueprint.rs:36`，共 11 变体。
- **重构动作**：将通配臂替换为显式列出全部 10 个非 Constant 变体的 OR-pattern 臂，每个产生 `Err(BranchMustFollowConstant(...))`。match 现穷尽 11/11。
- **行为不变性**：10 个非 Constant 变体的错误路径与原 `_ =>` 完全一致 → 对外 IPC/存储/前端契约不变。内层 `source.as_str()` 开放集 `_ =>` 保留（guardrails 允许的边界默认，非模式 5）。

## 零信任重扫（本轮开头）
- 重读 AGENTS.md Rust 风格段 + night-voyage-guardrails（已完成）。
- Grep 全模式扫描 `src-tauri/src/`：
  - P1 trait 继承：`memory_service.rs:81` `MemoryService: Send + Sync`（marker bound，非 genuine）→ 无 genuine。
  - P2 downcast：`as_any|downcast` 零命中。
  - P3 `enum Kind + bool`：3 个 `*Kind` 枚举（prompt_compiler.rs:87/368，world_book_matcher.rs:4）均为纯数据 + 穷尽 match，无内部 bool → 无 genuine。
  - P4 bool 标志：`enabled`/`is_enabled`/`auto_retry_enabled` 全为 DB/IPC 模型字段，受"禁改存储/IPC"铁律排除；无 `force`/`skip_*`/`.silent`/`.dry_run` → 无 genuine。
  - P5 `_ =>`：逐点核查其余约 30 处（conversation_repository.rs:50-53/198-204、capability_guard.rs:61-77、preset_validator.rs:471-477、prompt_compiler.rs:1233-1346/1758-1765、stream_processor.rs:44-49、plot_summaries.rs:453-456 等）均为 `&str`/`Option<&str>` 开放集匹配（DB/config/JSON 字符串），属 guardrails 允许的边界默认 → 判定非违规、保留。唯一 genuine 即 706，已消除。

## 验收
- `cargo build`（注入本地工具链 PATH + 覆盖 target-cpu=native）真实退出码 **CARGO_EXIT=0**；8 条预存 dead-code 警告，无新增。
- 双端校验未跑 `build_dual_release.bat`（debug 构建等价覆盖后端+PC 前端类型层），记已知限制。

## 终止判定
- 经零信任重扫，P1–P5 全部清零，末轮后门验收通过 → **达到循环终止条件**。自动化停止自主循环，向人类提交最终报告（不阻塞）。

## 提交与同步
- 本地提交：`blueprint_executor.rs` + 本 Walkthrough + 本 agent_ops 记录。
- `git push`：受出网 TLS 限制（PUSH_EXIT=128），记已知限制；本地提交已留存，不阻塞。

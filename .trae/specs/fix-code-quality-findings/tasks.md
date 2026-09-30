# Tasks

> 任务依赖用户审阅 spec.md 后给出的决策项。`[需决策]` 标记的任务在决策前不执行。

## 阶段 0：用户审阅与决策（前置，已完成）

- [x] 用户审阅 spec.md「待用户决策清单」并给出 7 项决策（D7-D9/D11、B4、B5、R15、D14/D15、L1、§4.2）
- [x] 用户决策方案 A：D4-D9/D11 全删
- [x] 用户决策 D14/D15 暂留（加 void 标记）
- [x] 用户决策 §4.2 本期不纳入

## 阶段 1：P0 立刻修——移动端 tsc 类型错误（B1/B2/B3）

- [x] Task 1.1：修复 `src-mobile/components/settings/ApiProviderDrawer.tsx:65` 的 TS2345（update 路径 `baseUrl` 显式校验）
- [x] Task 1.2：修复 `src-mobile/components/settings/ApiProviderDrawer.tsx:67` 的 TS2345（create 路径独立构造参数）
- [x] Task 1.3：修复 `src-mobile/components/settings/SettingsTab.tsx:135` 的 TS2339（改用 `provider.modelName`）
- [x] Task 1.4：移动端 tsc 验证 `tsc --noEmit -p D:\software_cache\tsconfig.mobile.scan.json` exit 0
- [x] Task 1.5：PC tsc 验证保持 exit 0
- [x] Task 1.6：Walkthrough 文件 + git commit（c5cde03）

## 阶段 2：P1 跨文件重复消除（R14/R16/R17/R15）

- [x] Task 2.1：R14 — `MobileSettingsArea.tsx` 删除 5 helper 改 import 4 个（countCapturingGroups 不直接用）
- [x] Task 2.2：R16/R17 — 新建 `src/lib/sidebarFileImport.ts` 共享 helper，两 sidebar 改 import
- [x] Task 2.3：R15 — 抽到 Rust 后端命令 `commands/utils.rs::format_timestamp`/`format_timestamps`，两端 createResource 批量预格式化
- [x] Task 2.4：PC tsc 验证保持 exit 0
- [x] Task 2.5：冗余启发式脚本重跑验证 R14/R16/R17 不再命中
- [x] Task 2.6：Walkthrough 文件 + git commit（c5cde03）

## 阶段 3：P2 疑似废弃/逻辑异味处理

- [x] Task 3.1：D7/D8/D9/D11 — 方案 A 全删 + 联动 D4/D5/D6 + 测试模块清理（commit b02493f）
- [x] Task 3.2：B4 — 核验非过滤意图，改为 `.map(|(kind, _)| *kind)`
- [x] Task 3.3：B5 — 忽略不修（其他 agent 正在完成相关功能）
- [x] Task 3.4：`cargo clippy --all-targets` 验证 warning 数下降
- [x] Task 3.5：Walkthrough 文件 + git commit

## 阶段 4：P6 死代码清理（D1-D6, D10, D12-D24）

- [x] Task 4.1：D1 — 删除 `ClientHandle.display_name`/`db_member_id` 字段
- [x] Task 4.2：D2 — 删除 `RoomServer.next_client_id`/`db` 字段
- [x] Task 4.3：D3 — 清理 `RetrySnapshotRecord` 13 个不读取字段
- [x] Task 4.4：D4 — 删除 `PromptCompileMode::AgentDirectorPlaceholder`（方案 A）
- [x] Task 4.5：D5 — 删除 `PresetCompilePreviewData` 结构体（方案 A）
- [x] Task 4.6：D6 — 删除 `CompiledOutputValidator.regex`/`source` 字段（方案 A）
- [x] Task 4.7：D10 — 删除 `StreamResponseData.prompt_tokens`/`completion_tokens` 字段
- [x] Task 4.8：D12-D13 — 删除 `src-mobile/App.tsx:1` 未使用 `onCleanup`/`createMemo` import
- [x] Task 4.9：D14/D15 — 暂留，加 `void` 标记显式声明保留
- [x] Task 4.10：D16 — 删除 `CharacterDrawer.tsx:6` 未使用 import
- [x] Task 4.11：D17/D18 — 删除 `CharacterGallery.tsx:2/17` 未使用 `Search`/`setSearch`
- [x] Task 4.12：D19 — 删除 `NewChatModal.tsx:1` 未使用 `onMount`
- [x] Task 4.13：D20 — 删除 `NewChatModal.tsx:2` 未使用 `X`/`Check`/`Book`/`LinkIcon`/`Radio`
- [x] Task 4.14：D21/D22 — 删除 `ApiProviderDrawer.tsx:2` 未使用 `AlertTriangle`/`CheckCircle2`
- [x] Task 4.15：D23/D24 — 删除 `SettingsTab.tsx:2/3` 未使用 import
- [x] Task 4.16：`cargo build` 在 `src-tauri/` 下验证后端编译通过
- [x] Task 4.17：PC tsc + 移动端 tsc 双端验证
- [x] Task 4.18：Walkthrough 文件 + git commit

## 阶段 5：P4 clippy style 类批量修（R1-R13）

- [x] Task 5.1：备份当前 clippy warning 数（基线 47）
- [x] Task 5.2：执行 `cargo clippy --fix --allow-dirty --allow-staged` 自动应用 11 处机械修复
- [x] Task 5.3：R1 — `network/mod.rs:38` `large_enum_variant`：`Box<ConversationListItem>` 包装
- [x] Task 5.4：R2 — `commands/conversations.rs:1069` `type_complexity`：抽 `ConversationForkOriginal` type alias
- [x] Task 5.5：R11 — `stream_processor.rs:1668` 已被 `--fix` 自动修复
- [x] Task 5.6：`cargo clippy --all-targets` 验证 warning 数下降到 22（全部 too_many_arguments）
- [x] Task 5.7：`cargo build` + PC tsc + 移动端 tsc 三端验证
- [x] Task 5.8：Walkthrough 文件 + git commit

## 阶段 6：P3 preset 参数重构（用户决策本期不纳入）

- [x] Task 6.1：用户决策 §4.2 本期不纳入，单独立 spec 处理

## 阶段 7：P5 调试日志收敛

- [x] Task 7.1：评估 `dbg_eprintln!` 宏现状——已统一在 `src-tauri/src/services/debug_log.rs`，含 `#[macro_export]`，调用点 240 处通过 crate 根可见。无需迁移。
- [x] Task 7.2：用户决策"debug 日志代码统一到一个 .rs 文件"已落实（现状合规）
- [x] Task 7.3：Walkthrough 文件（评估结论）
- [x] Task 7.4：git commit（c5cde03）

## 阶段 8：最终验收

- [x] Task 8.1：重跑完整扫描流程（clippy + PC tsc + 移动端 tsc）
- [x] Task 8.2：生成 `code-quality-reports/你发现的问题-2026-07-13-修复后.md` 对比报告
- [x] Task 8.3：验证修复后问题数：死代码 0（除 D14/D15 用户批准暂留）+ 潜在 BUG 0（除 B5 用户批准忽略）+ 跨文件重复 0 + 移动端 tsc exit 0
- [x] Task 8.4：Walkthrough 总览文件 + 最终 git commit + push（待用户决策是否 push）

# Task Dependencies

- 阶段 1（P0）→ 无依赖，优先执行 ✅
- 阶段 2（P1）→ 无依赖，与阶段 1 并行执行 ✅
- 阶段 3（P2）→ 依赖用户对 D7-D9/D11、B4、B5 的决策 ✅
- 阶段 4（P6）→ D14/D15 依赖用户决策 ✅；其他 D 项无依赖 ✅
- 阶段 5（P4）→ 在 P6 之后执行（避免 --fix 与手动修改冲突）✅
- 阶段 6（P3）→ 用户决策本期不纳入 ✅
- 阶段 7（P5）→ 评估现状合规 ✅
- 阶段 8 → 所有前置阶段完成 ✅

# Checklist

## 用户审阅检查点（apply 启动前）

- [x] 用户已审阅 spec.md「待用户决策清单」
- [x] 用户已给出 D7/D8/D9/D11 决策（方案 A 全删）
- [x] 用户已给出 B4 决策（核验非过滤意图后改 .map）
- [x] 用户已给出 B5 决策（忽略不修，其他 agent 在处理）
- [x] 用户已给出 R15 决策（抽到 Rust 后端命令）
- [x] 用户已给出 D14/D15 决策（暂留，加 void 标记）
- [x] 用户已给出 L1 决策（debug 日志代码统一到一个 .rs 文件）
- [x] 用户已给出 §4.2 决策（本期不纳入）

## 阶段 1：P0 移动端 tsc 修复（B1/B2/B3）

- [x] `src-mobile/components/settings/ApiProviderDrawer.tsx:65` TS2345 已修复，`baseUrl` 显式校验后传 `string`
- [x] `src-mobile/components/settings/ApiProviderDrawer.tsx:67` TS2345 已修复
- [x] `src-mobile/components/settings/SettingsTab.tsx:135` TS2339 已修复，改用 `provider.modelName`
- [x] 移动端 `tsc --noEmit -p D:\software_cache\tsconfig.mobile.scan.json` 退出码 = 0
- [x] PC `tsc --noEmit -p tsconfig.json` 退出码保持 0
- [x] Walkthrough 文件已生成（`Walkthrough/20260713-1352-移动端-provider-tsc-修复-修改.md`）
- [x] git commit 已完成（c5cde03）

## 阶段 2：P1 跨文件重复消除（R14/R16/R17/R15）

- [x] `src/components/MobileSettingsArea.tsx` 5 个本地 helper 已删除
- [x] `MobileSettingsArea.tsx` 已添加 `import { toErrorMessage, requireNonEmpty, parsePositiveIntegerField, validateCustomRulePattern } from './settings/validationUtils'`
- [x] PC tsc 验证 `MobileSettingsArea.tsx` 编译通过
- [x] `src/lib/sidebarFileImport.ts` 共享 helper 文件已创建
- [x] `CharacterSidebar.tsx` 与 `WorldBookSidebar.tsx` 改为 import 共享 helper
- [x] `handleImportFile` / `importImage` 在两个 sidebar 文件不再逐字重复
- [x] R15 — 抽到 Rust 后端命令 `commands/utils.rs::format_timestamp`/`format_timestamps` 已实现
- [x] PC + 移动端通过 `createResource` 批量预格式化调用
- [x] PC tsc 退出码保持 0
- [x] 移动端 tsc 退出码保持 0
- [x] Walkthrough 文件已生成（`Walkthrough/20260713-1030-PC-内部-DRY-消除-修改.md` + `Walkthrough/20260713-1030-formatTime-抽到后端-新功能增加.md`）
- [x] git commit 已完成（c5cde03）

## 阶段 3：P2 疑似废弃/逻辑异味处理

- [x] D7/D8/D9/D11 + D4/D5/D6 方案 A 全删已完成（commit b02493f）
- [x] B4 已修：核验非过滤意图，改为 `.map(|(kind, _)| *kind)`
- [x] B5 忽略：其他 agent 正在完成相关功能
- [x] `cargo clippy --all-targets` warning 数下降（B4 修复后 unnecessary_filter_map 消失）
- [x] `cargo build` 在 `src-tauri/` 下编译通过
- [x] Walkthrough 文件已生成（`Walkthrough/20260713-1030-world_book_matcher-B4-修复-debug.md` + `Walkthrough/20260713-1300-旧编译链路-死代码-全删-D4-D11-修改.md`）
- [x] git commit 已完成（c5cde03 + b02493f）

## 阶段 4：P6 死代码清理（D1-D6, D10, D12-D24）

- [x] D1：`ClientHandle.display_name`/`db_member_id` 字段已删除
- [x] D2：`RoomServer.next_client_id`/`db` 字段已删除
- [x] D3：`RetrySnapshotRecord` 13 个不读取字段已清理
- [x] D4：`PromptCompileMode::AgentDirectorPlaceholder` 枚举变体已删除（方案 A）
- [x] D5：`PresetCompilePreviewData` 结构体已删除（方案 A）
- [x] D6：`CompiledOutputValidator.regex`/`source` 字段已删除（方案 A）
- [x] D10：`StreamResponseData.prompt_tokens`/`completion_tokens` 字段已删除
- [x] D12-D13：`src-mobile/App.tsx` 未使用 `onCleanup`/`createMemo` import 已删除
- [x] D14/D15：`isJoinRoomModalOpen`/`setIsJoinRoomModalOpen` 暂留，加 `void` 标记
- [x] D16：`CharacterDrawer.tsx` 未使用 `CharacterBaseSectionInput` 已删除
- [x] D17/D18：`CharacterGallery.tsx` 未使用 `Search`/`setSearch` 已删除
- [x] D19：`NewChatModal.tsx` 未使用 `onMount` 已删除
- [x] D20：`NewChatModal.tsx` 未使用 `X`/`Check`/`Book`/`LinkIcon`/`Radio` 已删除
- [x] D21/D22：`ApiProviderDrawer.tsx` 未使用 `AlertTriangle`/`CheckCircle2` 已删除
- [x] D23/D24：`SettingsTab.tsx` 未使用标识符已删除
- [x] `cargo build` 在 `src-tauri/` 下编译通过
- [x] PC tsc 退出码保持 0
- [x] 移动端 tsc 退出码 = 0（TS6133 全部消除）
- [x] Walkthrough 文件已生成（`Walkthrough/20260713-1130-死代码清理-D1-D3-D10-修改.md`）
- [x] git commit 已完成（c5cde03）

## 阶段 5：P4 clippy style 类批量修（R1-R13）

- [x] `cargo clippy --fix --allow-dirty --allow-staged` 已执行（11 处自动修复）
- [x] R1：`network/mod.rs:38` `large_enum_variant` 已修复（`Box<ConversationListItem>` 包装）
- [x] R2：`commands/conversations.rs:1069` `type_complexity` 已修复（抽 `ConversationForkOriginal` type alias）
- [x] R3-R13：clippy style 类警告已消除
- [x] `cargo clippy --all-targets` warning 数 = 22（全部为已批准的 too_many_arguments 重构候选）
- [x] `cargo build` 编译通过
- [x] PC tsc 退出码保持 0
- [x] 移动端 tsc 退出码保持 0
- [x] Walkthrough 文件已生成（`Walkthrough/20260713-1200-clippy-style-批量修复-修改.md`）
- [x] git commit 已完成（c5cde03）

## 阶段 6：P3 preset 参数重构（用户决策本期不纳入）

- [x] 用户决策 §4.2 本期不纳入，单独立 spec 处理

## 阶段 7：P5 调试日志收敛

- [x] `dbg_eprintln!` 宏定义已位于 `src-tauri/src/services/debug_log.rs`（含 `#[macro_export]`）
- [x] 调用点 240 处 / 16 文件通过 crate 根可见，无需 import
- [x] 用户决策"debug 日志代码统一到一个 .rs 文件"已落实（现状合规）
- [x] Walkthrough 文件已生成（`Walkthrough/20260713-1130-dbg_eprintln-宏统一文件-修改.md`）
- [x] git commit 已完成（c5cde03）

## 阶段 8：最终验收

- [x] 完整扫描流程已重跑（clippy + PC tsc + 移动端 tsc）
- [x] `code-quality-reports/你发现的问题-2026-07-13-修复后.md` 对比报告已生成
- [x] 修复后问题计数：死代码 = 0（除 D14/D15 用户批准暂留）
- [x] 修复后问题计数：潜在 BUG = 0（除 B5 用户批准忽略）
- [x] 修复后问题计数：跨文件函数体重复 = 0
- [x] 移动端 tsc 退出码 = 0
- [x] PC tsc 退出码 = 0
- [x] `cargo clippy --all-targets` exit 0 且 warning 数 = 22（全部已批准 too_many_arguments 重构候选）
- [x] `cargo build` 在 `src-tauri/` 下 exit 0
- [x] Walkthrough 总览文件已生成（对比报告即总览）
- [x] git commit 已完成（c5cde03 + b02493f）

## 约束合规审计（每阶段 Walkthrough 必含）

| 约束 | 修复阶段预期合规 | 实际合规 | 说明 |
|------|------------------|---------|------|
| C1 Frontend Render-Only | √ | √ | 修复仅触及前端类型/重复/死代码，未引入后端逻辑到前端；R15 将 formatTime 下沉到 Rust 后端符合 C1 |
| C2 Zero-Fallback Errors | √ | √ | B1/B2/B3 显式校验 baseUrl/apiKey 非空提前返回，未用 `?? ''`/`as any` 兜底；B4 保留 Regex::new 做 pattern 有效性验证 |
| C3 Responsiveness | √ | √ | 死代码清理与 clippy 修复不影响异步路径；R15 异步化用 createResource 批量预格式化避免热路径 IPC |
| C4 AI UI Isolation | √ | √ | 未触及 iframe/Shadow DOM 隔离层 |
| C5 Mobile Frontend Independence | √ | √ | R15 移动端独立封装 `src-mobile/lib/backend/utils.ts`，未复用 PC 代码；其他修复不引入跨端 UI 共享 |
| C6 Project Cache Location | √ | √ | 临时扫描产物继续写入 `D:\software_cache` |
| C7 PC/Android Coverage | √ | √ | B1/B2/B3 修复恢复移动端构建 exit 0，符合双端覆盖 |

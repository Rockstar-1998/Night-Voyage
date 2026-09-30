# 代码质量问题汇总与修复 Spec

## Why

`code-quality-reports/` 下 2026-07-13 共 10 份扫描报告（01:04–10:28）累计去重后 **69 项已知遗留问题** + **移动端 28 处 tsc 错误**（整体归入遗留构建失败）。多轮重扫确认项目自有源码未变动，问题稳定存在。其中：

* **B1/B2/B3** 移动端 provider 设置链路 tsc 编不过（exit 2），违反 C7 PC/Android 双端覆盖硬约束；

* **R14/R16/R17** PC 前端跨文件函数体逐字重复，违反 DRY；

* **D7–D9/D11** 疑似废弃旧编译链路（4 个未使用 `pub async` 函数集中在 `prompt_compiler.rs` / `provider_adapter.rs`）；

* **§4.2** preset create/update 链路 21\~22 个参数三层重复，每加一个字段要改 3 处签名；

* **L1** 全后端 `dbg_eprintln!` 245 处 / 16 文件，调试输出泛滥。

需分优先级系统性修复以恢复代码健康度。本 spec 用于汇总问题并给出修复路径，**待用户审阅后再进入 apply 阶段执行**。

## What Changes

### P0 立刻修（违反硬约束 C7）

* **B1/B2/B3**：修复移动端 `ApiProviderDrawer.tsx:65/67` 与 `SettingsTab.tsx:135` 的 tsc 类型错误。

  * B1/B2：`baseUrl: string | undefined` 不兼容后端 `string` 契约（update/create 两路径）；

  * B3：访问 `ApiProviderSummary.models` 不存在的属性。

  * 修复目标：移动端 `tsc --noEmit` 退出码 2 → 0。

### P1 高优先级（DRY 违规，跨文件逐字重复）

* **R14**：`src/components/MobileSettingsArea.tsx:81-168` 删除 5 个本地 helper（`toErrorMessage`/`requireNonEmpty`/`parsePositiveIntegerField`/`countCapturingGroups`/`validateCustomRulePattern`），改为 `import { ... } from './settings/validationUtils'`。

* **R16/R17**：`src/components/CharacterSidebar.tsx` 与 `src/components/WorldBookSidebar.tsx` 之间 `handleImportFile`/`importImage` 逐字重复，抽离到 PC 内部共享 helper（如 `src/lib/fileImport.ts`）。

* **R15**（**需用户决策**）：`src/components/SessionSidebar.tsx:22-28` 与 `src-mobile/components/SessionList.tsx:16-22` 的 `formatTime` 跨前端逐字重复。C5 禁止双前端共享 UI 代码，但纯逻辑函数是否抽到 Rust 后端命令、或两端各自保留，需用户在审阅时决策。

### P2 尽快查（疑似废弃/逻辑异味，**需用户决策**）

* **D7/D8/D9/D11**：4 个未使用 `pub async` 函数（`compile_chat_messages`@769、`compile_preset_preview_data`@933、`build_preview_template_render_context`@1247、`adapt_prompt_compile_result_to_openai_messages`@provider\_adapter:216）。疑似废弃旧编译链路。

  * **决策项**：删除 / 保留为未来扩展点 / 标记 `#[allow(dead_code)]` 暂留待评估。

* **B4**：`src-tauri/src/services/world_book_matcher.rs:90` 的 `unnecessary_filter_map`（`.filter_map(|(kind, _)| Some(*kind))` 永远返回 `Some`，退化为 `map`）。

  * **决策项**：若原意是过滤某些 kind 则补过滤逻辑；若不需过滤则改 `.map`。

* **B5**：3 处 `// TODO` 标记（`prompt_compiler.rs:88`、`stream_processor.rs:379/383`），位于提示词编译与流式处理热路径。

  * **决策项**：补完实现 / 转为正式 issue 跟踪 / 删除 TODO 注释（若实际已完成）。

### P3 重构候选（结构改进，可选）

* **§4.2 too\_many\_arguments（22 处）**：preset create/update 的 21\~22 参数链路（`commands/presets/mod.rs:40/91` → `services/preset_service.rs:158/249` → `repositories/preset_repository.rs:348/402` 三层重复）引入 `PresetCreateInput`/`PresetUpdateInput` 输入结构体。其他 too\_many\_arguments 处评估是否值得重构（如 `chat_service.rs` 6 处、`stream_processor.rs` 3 处）。

### P4 可批量修（clippy style 类，可自动应用）

* **R1**：`src-tauri/src/network/mod.rs:38` `large_enum_variant`（`RoomMessage` 最大变体 ≥792 字节，建议 `Box` 大字段）。

* **R2**：`src-tauri/src/commands/conversations.rs:1069` `type_complexity`（9 元组类型，抽 `type` 别名）。

* **R3**：`services/chat/mode.rs:207` `redundant_static_lifetimes`

* **R4**：`commands/mem0_snapshot.rs:29` `manual_range_contains` → `!(1..=1000).contains(&window)`

* **R5/R6**：`services/mem0_snapshot.rs:171/184` `unnecessary_sort_by` → `sort_by_key(Reverse(...))`

* **R7/R8**：`services/prompt_compiler.rs:750/1940` `unnecessary_sort_by` → `sort_by_key`

* **R9**：`services/prompt_compiler.rs:2544` `needless_borrow`

* **R10**：`services/provider_adapter.rs:463` `collapsible_if`

* **R11**：`services/stream_processor.rs:1668` `collapsible_if` + `collapsible_match`

* **R12**：`services/structured_output_parser.rs:117` `single_match` 改 `if`

* **R13**：`services/provider_adapter.rs:929`（test） `bool_assert_comparison` → `assert!(x)`

> `cargo clippy --fix` 可自动应用约 11 条；R1/R2 涉及类型设计需人工改。

### P5 日志收敛（低优先级，大工程量）

* **L1**：全后端 `dbg_eprintln!` 245 处 / 16 文件（`lib.rs`、`db/mod.rs`、`commands/*`、`network/mod.rs`、`services/*`）。统一迁移到 `tracing`/`log` 框架，按 level 分级（INFO/WARN/ERROR/DEBUG）。

  * **决策项**：本期是否纳入？若纳入需评估工作量与回归风险。

### P6 死代码清理（机械删除，低风险）

* **D1/D2**：`src-tauri/src/network/mod.rs:940/948` 的 `ClientHandle.display_name`/`db_member_id`/`RoomServer.next_client_id`/`db` 从不读取字段。

* **D3**：`src-tauri/src/repositories/llm_retry_snapshot_repository.rs:15` `RetrySnapshotRecord` 多字段从不读取。

* **D4**：`prompt_compiler.rs:30` 枚举变体 `PromptCompileMode::AgentDirectorPlaceholder` 从不构造。

* **D5**：`prompt_compiler.rs:187` `PresetCompilePreviewData` 从不构造。

* **D6**：`prompt_compiler.rs:228/230` `CompiledOutputValidator.regex`/`source` 从不读取。

* **D10**：`stream_processor.rs:41` `StreamResponseData.prompt_tokens`/`completion_tokens` 从不读取。

* **D12–D24**：移动端 13 项 TS6133 未使用标识符（`App.tsx` 的 `onCleanup`/`createMemo`/`isJoinRoomModalOpen`/`setIsJoinRoomModalOpen`、`CharacterDrawer.tsx` 的 `CharacterBaseSectionInput`、`CharacterGallery.tsx` 的 `Search`/`setSearch`、`NewChatModal.tsx` 的 `onMount`/`X`/`Check`/`Book`/`LinkIcon`/`Radio`、`ApiProviderDrawer.tsx` 的 `AlertTriangle`/`CheckCircle2`、`SettingsTab.tsx` 的 `Save`/`Trash2`/`CheckCircle2`/`AlertTriangle`/`RefreshCw`/`ProviderKind`/`providersCreate`/`Update`/`Delete`/`Test`）。

> **注意 D14/D15**：`src-mobile/App.tsx:49` 的 `isJoinRoomModalOpen`/`setIsJoinRoomModalOpen` 是一整个 signal 未被使用——可能是"联机加入房间"弹窗在移动端已声明但从未接线的**功能半成品**，删除前需用户确认移动端是否应支持加入房间。

## Impact

* **Affected specs**：无直接影响（属代码质量层面，不改变功能行为）；间接相关历史 spec：

  * `add-structured-output-response-mode`、`prompt-compiler-stage-a`、`improve-structured-rendering`、`split-system-blocks-per-message`（涉及 `prompt_compiler.rs` / `stream_processor.rs` 修改的 P2/P3/P4 项）；

  * `implement-mobile-settings`（涉及 `src-mobile/components/settings/*` 的 P0/P6 项）；

  * `add-preset-and-api-selectors`、`convert-husenfu-preset`（涉及 preset create/update 链路的 P3 项）。

* **Affected code**：

  * 后端：`src-tauri/src/{network,commands,repositories,services}/**`

  * PC 前端：`src/components/{MobileSettingsArea,SessionSidebar,CharacterSidebar,WorldBookSidebar}.tsx`

  * 移动端：`src-mobile/{App.tsx,components/characters/*,components/settings/*,components/NewChatModal.tsx,components/SessionList.tsx}`

* **构建影响预期**：

  * 移动端 tsc：exit 2 → exit 0；

  * Rust clippy warning 数：47 → ≤10（剩余为已批准的 `too_many_arguments` 重构候选）；

  * PC tsc：保持 exit 0；

  * 前端 grep（console.log/TODO/debugger/alert）：保持 0。

## ADDED Requirements

### Requirement: 双端深度检查零退出码

系统 SHALL 通过 `cargo clippy --all-targets`、PC `tsc --noEmit -p tsconfig.json`、移动端 `tsc --noEmit` 三项深度检查，且退出码均为 0。

#### Scenario: 移动端 provider 设置链路恢复

* **WHEN** 开发者运行 `npx tsc --noEmit -p <移动端 tsconfig>`

* **THEN** 退出码为 0，无 TS2345/TS2339 类型错误（B1/B2/B3 已修）

#### Scenario: clippy 警告数下降

* **WHEN** 开发者运行 `cargo clippy --all-targets`

* **THEN** 项目自有代码 warning 数从 47 降至 ≤10（剩余为用户批准暂留的 `too_many_arguments` 重构候选）

### Requirement: PC 前端跨文件无函数体逐字重复

PC 前端 `src/` 内部 SHALL NOT 存在跨文件逐字重复的函数体（R14/R16/R17 修复后由冗余启发式脚本验证）。

## MODIFIED Requirements

### Requirement: 移动端 Provider 设置 UI

移动端 `ApiProviderDrawer.tsx` 与 `SettingsTab.tsx` 的 provider create/update 调用 SHALL 与 Rust 后端 `commands/providers.rs` 的类型签名一致：`baseUrl` 必传（非 `undefined`），`ApiProviderSummary.models` 不存在的属性访问必须移除或修正为后端实际暴露的字段。

## 问题汇总索引（按优先级 + 类型 + 文件路径）

| 优先级 | 编号      | 文件:行                                                                                                                           | 类型   | 摘要                                                             |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------ | ---- | -------------------------------------------------------------- |
| P0  | B1      | `src-mobile/components/settings/ApiProviderDrawer.tsx:65`                                                                      | BUG  | TS2345：baseUrl 类型不兼容（update 路径）                                |
| P0  | B2      | `src-mobile/components/settings/ApiProviderDrawer.tsx:67`                                                                      | BUG  | TS2345：baseUrl 类型不兼容（create 路径）                                |
| P0  | B3      | `src-mobile/components/settings/SettingsTab.tsx:135`                                                                           | BUG  | TS2339：访问 `ApiProviderSummary.models` 不存在属性                    |
| P1  | R14     | `src/components/MobileSettingsArea.tsx:81-168`                                                                                 | 冗余   | 5 个 helper 与 `validationUtils.ts` 逐字重复                         |
| P1  | R16     | `src/components/CharacterSidebar.tsx`                                                                                          | 冗余   | `handleImportFile` 跨文件重复（vs `WorldBookSidebar.tsx`）            |
| P1  | R17     | `src/components/CharacterSidebar.tsx`                                                                                          | 冗余   | `importImage` 跨文件重复（vs `WorldBookSidebar.tsx`）                 |
| P1  | R15     | `src/components/SessionSidebar.tsx:22-28` ↔ `src-mobile/components/SessionList.tsx:16-22`                                      | 冗余   | `formatTime` 跨前端逐字重复（**需 C5 决策**）                              |
| P2  | D7      | `src-tauri/src/services/prompt_compiler.rs:769`                                                                                | 死代码  | `compile_chat_messages` 从不使用（**需决策**）                          |
| P2  | D8      | `src-tauri/src/services/prompt_compiler.rs:933`                                                                                | 死代码  | `compile_preset_preview_data` 从不使用（**需决策**）                    |
| P2  | D9      | `src-tauri/src/services/prompt_compiler.rs:1247`                                                                               | 死代码  | `build_preview_template_render_context` 从不使用（**需决策**）          |
| P2  | D11     | `src-tauri/src/services/provider_adapter.rs:216`                                                                               | 死代码  | `adapt_prompt_compile_result_to_openai_messages` 从不使用（**需决策**） |
| P2  | B4      | `src-tauri/src/services/world_book_matcher.rs:90`                                                                              | BUG  | `unnecessary_filter_map` 退化为 `map`（**需决策**：补过滤 or 改 map）       |
| P2  | B5      | `prompt_compiler.rs:88`、`stream_processor.rs:379/383`                                                                          | BUG  | 3 处 `// TODO` 热路径未完成标记（**需决策**）                                |
| P3  | §4.2    | preset 三层 22 处                                                                                                                 | 冗余   | 21\~22 参数，引入 `PresetCreateInput`/`PresetUpdateInput`（可选）       |
| P4  | R1      | `src-tauri/src/network/mod.rs:38`                                                                                              | 冗余   | `large_enum_variant`，Box 大字段                                   |
| P4  | R2      | `src-tauri/src/commands/conversations.rs:1069`                                                                                 | 冗余   | `type_complexity`，抽 type alias                                 |
| P4  | R3      | `src-tauri/src/services/chat/mode.rs:207`                                                                                      | 冗余   | `redundant_static_lifetimes`                                   |
| P4  | R4      | `src-tauri/src/commands/mem0_snapshot.rs:29`                                                                                   | 冗余   | `manual_range_contains`                                        |
| P4  | R5/R6   | `src-tauri/src/services/mem0_snapshot.rs:171/184`                                                                              | 冗余   | `unnecessary_sort_by` ×2                                       |
| P4  | R7/R8   | `src-tauri/src/services/prompt_compiler.rs:750/1940`                                                                           | 冗余   | `unnecessary_sort_by` ×2                                       |
| P4  | R9      | `src-tauri/src/services/prompt_compiler.rs:2544`                                                                               | 冗余   | `needless_borrow`                                              |
| P4  | R10     | `src-tauri/src/services/provider_adapter.rs:463`                                                                               | 冗余   | `collapsible_if`                                               |
| P4  | R11     | `src-tauri/src/services/stream_processor.rs:1668`                                                                              | 冗余   | `collapsible_if`+`collapsible_match`                           |
| P4  | R12     | `src-tauri/src/services/structured_output_parser.rs:117`                                                                       | 冗余   | `single_match` 改 `if`                                          |
| P4  | R13     | `src-tauri/src/services/provider_adapter.rs:929` (test)                                                                        | 冗余   | `bool_assert_comparison`                                       |
| P5  | L1      | 全后端 245 处 / 16 文件                                                                                                              | 调试日志 | `dbg_eprintln!` 泛滥，迁移到 tracing/log（**需决策**：本期是否纳入）             |
| P6  | D1      | `src-tauri/src/network/mod.rs:940`                                                                                             | 死代码  | `ClientHandle.display_name`/`db_member_id` 从不读取                |
| P6  | D2      | `src-tauri/src/network/mod.rs:948`                                                                                             | 死代码  | `RoomServer.next_client_id`/`db` 从不读取                          |
| P6  | D3      | `src-tauri/src/repositories/llm_retry_snapshot_repository.rs:15`                                                               | 死代码  | `RetrySnapshotRecord` 多字段从不读取                                  |
| P6  | D4      | `src-tauri/src/services/prompt_compiler.rs:30`                                                                                 | 死代码  | `PromptCompileMode::AgentDirectorPlaceholder` 从不构造             |
| P6  | D5      | `src-tauri/src/services/prompt_compiler.rs:187`                                                                                | 死代码  | `PresetCompilePreviewData` 从不构造                                |
| P6  | D6      | `src-tauri/src/services/prompt_compiler.rs:228/230`                                                                            | 死代码  | `CompiledOutputValidator.regex`/`source` 从不读取                  |
| P6  | D10     | `src-tauri/src/services/stream_processor.rs:41`                                                                                | 死代码  | `StreamResponseData.prompt_tokens`/`completion_tokens` 从不读取    |
| P6  | D12–D24 | `src-mobile/App.tsx`、`CharacterDrawer.tsx`、`CharacterGallery.tsx`、`NewChatModal.tsx`、`ApiProviderDrawer.tsx`、`SettingsTab.tsx` | 死代码  | 13 项 TS6133 未使用标识符                                             |

## 用户决策记录（2026-07-13 apply 启动前确认）

1. **D7/D8/D9/D11**：先调研 4 个未使用 `pub async` 函数的功能，调研结果回报用户后再决定删除/保留。
2. **B5**：3 处 `// TODO` 忽略不修，其他 agent 正在完成相关功能。
3. **R15**：选 A — `formatTime` 抽到 Rust 后端命令，PC/移动端通过 Tauri 调用。
4. **D14/D15**：选 C — `src-mobile/App.tsx:49` `isJoinRoomModalOpen`/`setIsJoinRoomModalOpen` signal 暂留，后续处理（与 `implement-multiplayer-room-mode` 关联）。
5. **B4**：选 A — 补过滤逻辑（需先核验原意确为过滤某些 kind；若非过滤则改 `.map`）。
6. **L1**：调整为"debug 日志代码统一到一个 .rs 文件"（不迁移 tracing，沿用 `dbg_eprintln!` 宏但集中收口到单一文件，所有调用通过该文件导入）。
7. **§4.2**：选 B — preset 21~22 参数重构本期不纳入，单独立 spec 处理。

## 扫描产物引用

* 最早完整报告：`code-quality-reports/你发现的问题-2026-07-13.md`（01:04，58 项原始清单）

* 最新合集：`code-quality-reports/你发现的问题-2026-07-13-1028.md`（10:28，69 项已知遗留 + 移动端 28 错误）

* 临时扫描脚本与日志：`D:\software_cache\` 下 `clippy-*.log`、`tsc-*.log`、`scan_*.py`、`scan_*.json`


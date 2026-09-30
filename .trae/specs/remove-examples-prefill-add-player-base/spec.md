# Prompt Compiler 架构清理与 PlayerBase 注入 Spec

## Why

当前 Prompt Compiler 中 `ExampleMessage` 和 `PrefillSeed` 两层已决定移除，同时玩家角色卡（PlayerBase）从未被注入编译链路，导致模型不知道"对面是谁"。需要一次性完成移除 + 新增 + 预设适配，使编译架构与实际需求对齐。

## What Changes

- **移除** `PromptBlockKind::ExampleMessage` 及所有相关代码路径
- **移除** `PromptBlockKind::PrefillSeed` 及所有相关代码路径
- **移除** `PromptCompileResult.example_blocks` 字段
- **移除** `PromptCompileResult.prefill_seed` 字段
- **移除** `LoadedPresetCompilerData.example_blocks` 字段
- **移除** `LoadedPresetCompilerData.prefill_seed` 字段
- **移除** `PresetCompilePreviewData.example_blocks` 字段
- **移除** `ProviderCapabilityMatrix.supports_example_messages` 字段
- **移除** `ProviderCapabilityMatrix.supports_prefill_seed` 字段
- **移除** 预设便携格式中的 `examples` 字段
- **移除** 预设编译器中对 `compiler:prefill` block type 的解析
- **移除** 数据库表 `preset_examples` 相关的读写代码
- **新增** `PromptBlockKind::PlayerBase`（priority 250）
- **新增** `PromptBlockSource::Player { character_id: i64 }`
- **新增** `ConversationCompileContext.player_character_id` 字段
- **新增** `load_conversation_compile_context` 查询 `conversation_members.player_character_id`
- **新增** `build_player_base_block` 函数
- **新增** 模板上下文 `player_character` 字段
- **修改** 预算裁剪：PlayerBase 不可裁剪
- **修改** 预设便携格式：移除 `examples`，移除 `compiler:prefill` block type 支持
- **修改** 狐神抚 V9.4 预设文件：移除 examples 数组，移除 `compiler:prefill` block
- **BREAKING** 便携预设格式不再包含 `examples` 字段
- **BREAKING** `compiler:prefill` block type 不再被识别

## Impact

- Affected specs: prompt-compiler-stage-a（PromptBlockKind 枚举变更）、预设系统（便携格式变更）
- Affected code:
  - `src-tauri/src/services/prompt_compiler.rs` — 核心编译逻辑
  - `src-tauri/src/services/provider_adapter.rs` — Provider 能力矩阵与请求构建
  - `src-tauri/src/services/preset_service.rs` — 预设导入导出
  - `src-tauri/src/repositories/preset_repository.rs` — 预设数据读写
  - `src-tauri/src/models/mod.rs` — 预设模型定义
  - `src-tauri/src/validators/preset_validator.rs` — 预设校验
  - `src-tauri/src/commands/presets/mod.rs` — Tauri 命令层
  - `狐神抚 V9.4 [Night Voyage].json` — 预设文件适配

## ADDED Requirements

### Requirement: PlayerBase Block 类型

系统 SHALL 提供 `PromptBlockKind::PlayerBase`，priority 为 250，位于 CharacterBase（200）之后、WorldBookMatch（300）之前。

#### Scenario: 玩家绑定了角色卡

- **WHEN** 对话的 host 成员在 `conversation_members` 表中设置了 `player_character_id`
- **THEN** 编译器 SHALL 加载该角色卡数据并生成 `PlayerBase` block 注入 `system_blocks`

#### Scenario: 玩家未绑定角色卡

- **WHEN** 对话的 host 成员在 `conversation_members` 表中 `player_character_id` 为 NULL
- **THEN** 编译器 SHALL 不生成 `PlayerBase` block，不报错

### Requirement: PlayerBase 数据来源

系统 SHALL 从 `conversation_members` 表查询 host 成员的 `player_character_id` 作为玩家角色卡 ID。

```sql
SELECT cm.player_character_id
FROM conversation_members cm
WHERE cm.conversation_id = ? AND cm.member_role = 'host' AND cm.is_active = 1
LIMIT 1
```

### Requirement: PlayerBase Block 构建

系统 SHALL 复用 `load_character_compile_data` 加载玩家角色卡数据，并通过 `build_player_base_block` 生成 block。

- `PromptBlockSource::Player { character_id }` 标记来源
- `required: true`（不可被预算裁剪）
- `title: "Player Base"`
- `role: System`

### Requirement: PlayerBase 模板上下文

系统 SHALL 在 `PromptTemplateRenderContext` 中新增 `player_character` 字段，类型为 `Option<PromptTemplateCharacterContext>`，使预设模板可以使用 `{{ player_character.name }}`、`{{ player_character.description }}` 等变量。

#### Scenario: 玩家绑定了角色卡

- **WHEN** 编译模板时玩家角色卡存在
- **THEN** `player_character` SHALL 包含该角色卡的 id、name、description、tags、base_sections

#### Scenario: 玩家未绑定角色卡

- **WHEN** 编译模板时玩家角色卡不存在
- **THEN** `player_character` SHALL 为 None，模板中引用 `player_character` 时 minijinja 的 Strict 模式 SHALL 报错

### Requirement: PlayerBase 不可裁剪

系统 SHALL 在预算裁剪中将 PlayerBase 视为与 CharacterBase 同等重要的不可裁剪 block。

### Requirement: PromptBlockSource::Player

系统 SHALL 新增 `PromptBlockSource::Player { character_id: i64 }` 变体，用于标记 PlayerBase block 的来源。

## MODIFIED Requirements

### Requirement: PromptBlockKind 枚举

`PromptBlockKind` 枚举 SHALL 更新为：

```rust
pub enum PromptBlockKind {
    PresetRule,          // priority 100
    MultiplayerProtocol, // priority 150
    CharacterBase,       // priority 200
    PlayerBase,          // priority 250 ← 新增
    WorldBookMatch,      // priority 300
    WorldVariable,       // priority 400 [TODO]
    PlotSummary,         // priority 500
    RetrievedDetail,     // priority 600
    RecentHistory,       // priority 800
    CurrentUser,         // priority 900
}
```

注意：`ExampleMessage` 和 `PrefillSeed` 已移除。

### Requirement: PromptCompileResult 结构

`PromptCompileResult` SHALL 更新为：

```rust
pub struct PromptCompileResult {
    pub system_blocks: Vec<PromptBlock>,
    pub history_blocks: Vec<PromptBlock>,
    pub current_user_block: PromptBlock,
    pub params: CompiledSamplingParams,
    pub debug: PromptCompileDebugReport,
}
```

注意：`example_blocks` 和 `prefill_seed` 字段已移除。

### Requirement: ProviderCapabilityMatrix

`ProviderCapabilityMatrix` SHALL 移除 `supports_example_messages` 和 `supports_prefill_seed` 字段。

### Requirement: 预算裁剪顺序

预算裁剪顺序 SHALL 更新为：

```
1. RetrievedDetail（最先裁）
2. PlotSummary
3. WorldBookMatch（部分裁）
4. WorldVariable（如果实现）
5. 不裁 CurrentUser
6. 尽量不裁 RecentHistory 最近窗口
7. 不裁 PresetRule、CharacterBase、PlayerBase
```

### Requirement: 预设便携格式

`PortablePresetFile` SHALL 移除 `examples` 字段。导入时 SHALL 忽略 JSON 中可能残留的 `examples` 字段（向前兼容）。

### Requirement: 预设 block type 解析

`parse_preset_block_directive` SHALL 不再识别 `compiler:prefill` block type。遇到该 type 时 SHALL 返回错误。

### Requirement: 编译阶段排序

Phase 5 排序 SHALL 更新为：

| 优先级 | Block |
|--------|-------|
| 100 | PresetRule |
| 150 | MultiplayerProtocol |
| 200 | CharacterBase |
| 250 | PlayerBase |
| 300 | WorldBookMatch |
| 400 | WorldVariable [TODO] |
| 500 | PlotSummary |
| 600 | RetrievedDetail |
| 800 | RecentHistory |
| 900 | CurrentUser |

## REMOVED Requirements

### Requirement: ExampleMessage 层

**Reason**: 预设中的 few-shot 示例对话功能不再保留。示例对话在结构化输出模式下作用有限，且增加了编译链路复杂度。
**Migration**: 预设便携格式中的 `examples` 字段将被忽略。数据库中 `preset_examples` 表的数据保留但不再读写。

### Requirement: PrefillSeed 层

**Reason**: 预填充功能在结构化输出模式下已被 JSON Schema 的 `thinking` 字段首 token 替代（如 `{"thinking":"`），不再需要独立的 prefill block。Anthropic 的 prefill 支持可在未来通过其他机制实现。
**Migration**: 预设中 `compiler:prefill` block type 将不再被识别。导入包含该 block 的预设时 SHALL 报错，需先从预设中移除该 block。

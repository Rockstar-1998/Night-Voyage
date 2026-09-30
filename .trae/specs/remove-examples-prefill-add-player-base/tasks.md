# Tasks

- [x] Task 1: 移除 ExampleMessage 和 PrefillSeed 相关类型与逻辑
  - [x] SubTask 1.1: 从 `PromptBlockKind` 枚举中移除 `ExampleMessage` 和 `PrefillSeed` 变体，及其 `priority()` 和 `as_str()` 分支
  - [x] SubTask 1.2: 从 `PromptCompileResult` 中移除 `example_blocks` 和 `prefill_seed` 字段
  - [x] SubTask 1.3: 从 `PresetCompilePreviewData` 中移除 `example_blocks` 字段
  - [x] SubTask 1.4: 从 `LoadedPresetCompilerData` 中移除 `example_blocks` 和 `prefill_seed` 字段
  - [x] SubTask 1.5: 从 `parse_preset_block_directive` 中移除 `PrefillLiteral` 和 `PrefillTemplate` 分支，使 `compiler:prefill` 报错
  - [x] SubTask 1.6: 从 `PresetBlockDirective` 枚举中移除 `PrefillLiteral` 和 `PrefillTemplate` 变体
  - [x] SubTask 1.7: 移除 `load_preset_compiler_data` 中加载 example rows 和构建 example_blocks 的代码
  - [x] SubTask 1.8: 移除 `load_preset_compiler_data` 中处理 prefill block 的代码
  - [x] SubTask 1.9: 移除 `compile_prompt` 中将 `example_blocks` 和 `prefill_seed` 赋值到 result 的代码
  - [x] SubTask 1.10: 移除 `compile_preset_preview_data` 中 `example_blocks` 赋值
  - [x] SubTask 1.11: 移除 `total_estimated_tokens` 中对 `example_blocks` 和 `prefill_seed` 的迭代
  - [x] SubTask 1.12: 移除 `build_final_block_order` 中对 `example_blocks` 和 `prefill_seed` 的迭代
  - [x] SubTask 1.13: 移除预算裁剪中对 `ExampleMessage` 的裁剪逻辑
  - [x] SubTask 1.14: 移除 `validate_preset_block_definition` 中 `PresetBlockValidationKind::Prefill` 变体

- [x] Task 2: 移除 Provider Adapter 中 ExampleMessage/PrefillSeed 相关逻辑
  - [x] SubTask 2.1: 从 `ProviderCapabilityMatrix` 中移除 `supports_example_messages` 和 `supports_prefill_seed` 字段
  - [x] SubTask 2.2: 从 `ProviderCapabilityMatrix::for_provider_kind` 各 provider 分支中移除这两个字段
  - [x] SubTask 2.3: 从 `describe_checks` 中移除这两个字段的描述
  - [x] SubTask 2.4: 从 `build_llm_chat_request` 中移除 `example_blocks` 迭代和 `prefill_seed` 注入逻辑
  - [x] SubTask 2.5: 从 `validate_prompt_for_provider` 中移除 prefill_seed 和 example_messages 校验
  - [x] SubTask 2.6: 从 `adapt_prompt_compile_result_to_openai_messages` 确认无残留引用

- [x] Task 3: 移除预设系统中 examples 相关代码
  - [x] SubTask 3.1: 从 `PortablePresetFile` 结构体中移除 `examples` 字段（保留反序列化兼容：用 `#[serde(default)]` 忽略旧格式中的 examples）
  - [x] SubTask 3.2: 从 `PresetService::import_portable` 中移除 examples 参数传递
  - [x] SubTask 3.3: 从 `PresetService::create` 中移除 examples 参数和 `replace_examples` 调用
  - [x] SubTask 3.4: 从 `PresetService::update` 中移除 examples 参数和 `replace_examples` 调用
  - [x] SubTask 3.5: 从 `PresetService::export` 中移除 examples 数据收集
  - [x] SubTask 3.6: 从 `PresetService::preset_example_record_to_input` 和 `semantic_option_example_record_to_input` 中移除或标记废弃
  - [x] SubTask 3.7: 从 `PresetDetail` 模型中移除 `examples` 字段
  - [x] SubTask 3.8: 从 `PresetRepository` 中移除 `replace_examples`、`load_existing_normalized_examples` 等 examples 相关方法
  - [x] SubTask 3.9: 从 `PresetValidator` 中移除 examples 校验逻辑
  - [x] SubTask 3.10: 从 Tauri 命令层 `create_preset` / `update_preset` 中移除 examples 参数
  - [x] SubTask 3.11: 从 `PresetCompilePreview` 模型中移除 example_messages 字段

- [x] Task 4: 新增 PlayerBase 类型与编译逻辑
  - [x] SubTask 4.1: 在 `PromptBlockKind` 中新增 `PlayerBase` 变体，priority 250，as_str "PlayerBase"
  - [x] SubTask 4.2: 在 `PromptBlockSource` 中新增 `Player { character_id: i64 }` 变体
  - [x] SubTask 4.3: 在 `ConversationCompileContext` 中新增 `player_character_id: Option<i64>` 字段
  - [x] SubTask 4.4: 修改 `load_conversation_compile_context` SQL 查询，新增子查询获取 host 成员的 `player_character_id`
  - [x] SubTask 4.5: 新增 `build_player_base_block` 函数，复用 `load_character_compile_data` 加载数据，生成 PlayerBase block
  - [x] SubTask 4.6: 在 `compile_prompt` 中 CharacterBase block 生成之后，调用 `build_player_base_block` 并推入 `system_blocks`
  - [x] SubTask 4.7: 在 `compile_prompt` 的 debug report 中记录 player_character 输入源

- [x] Task 5: 新增 PlayerBase 模板上下文
  - [x] SubTask 5.1: 在 `PromptTemplateRenderContext` 中新增 `player_character: Option<PromptTemplateCharacterContext>` 字段
  - [x] SubTask 5.2: 修改 `build_runtime_template_render_context`，加载玩家角色卡数据并填充 `player_character`
  - [x] SubTask 5.3: 修改 `build_preview_template_render_context`，添加 `player_character: None`

- [x] Task 6: 适配预算裁剪与排序
  - [x] SubTask 6.1: 在 `apply_budget_trim` 中确保 PlayerBase 不可裁剪（与 CharacterBase 同级）
  - [x] SubTask 6.2: 移除裁剪链中对 `ExampleMessage` 的裁剪逻辑

- [x] Task 7: 适配狐神抚 V9.4 预设文件
  - [x] SubTask 7.1: 移除预设 JSON 中的 `examples` 数组（替换为空数组或删除字段）
  - [x] SubTask 7.2: 移除预设 JSON 中 `blockType: "compiler:prefill"` 的 block 条目

- [x] Task 8: 编译验证与测试
  - [x] SubTask 8.1: `cargo build` 确认无编译错误
  - [x] SubTask 8.2: 确认现有单元测试通过
  - [x] SubTask 8.3: 确认 `PromptBlockKind` 的 priority 排序正确（PresetRule 100 → MultiplayerProtocol 150 → CharacterBase 200 → PlayerBase 250 → WorldBookMatch 300）

# Task Dependencies

- Task 1、2、3 可并行执行（都是移除操作，互不依赖）
- Task 4 依赖 Task 1（需要 PromptBlockKind 枚举已清理）
- Task 5 依赖 Task 4（需要 PlayerBase 类型和数据加载逻辑）
- Task 6 依赖 Task 1 和 Task 4（需要枚举和裁剪逻辑都已更新）
- Task 7 独立，可随时执行
- Task 8 依赖所有其他任务完成

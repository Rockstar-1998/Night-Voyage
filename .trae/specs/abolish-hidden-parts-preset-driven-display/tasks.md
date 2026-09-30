# Tasks

- [x] Task 1: 数据库迁移 — 新增 `structured_output_display` 列
  - [x] SubTask 1.1: 创建 `migrations/0028_preset_structured_output_display.sql`，为 `presets` 表新增 `structured_output_display TEXT DEFAULT NULL` 列
  - [x] SubTask 1.2: 为 `preset_provider_overrides` 表新增 `structured_output_display_override TEXT DEFAULT NULL` 列
  - [x] SubTask 1.3: 将所有 `message_content_parts` 中 `is_hidden=1` 的记录改为 `is_hidden=0`

- [x] Task 2: 后端模型层 — 新增 `structured_output_display` 字段
  - [x] SubTask 2.1: `models/mod.rs` 中 `PresetDetail`、`PresetUpdate`、`ProviderOverrideInput` 新增 `structured_output_display` / `structured_output_display_override` 字段
  - [x] SubTask 2.2: `llm/mod.rs` 中 `LlmChatRequest` 新增 `structured_output_display` 字段
  - [x] SubTask 2.3: `services/prompt_compiler.rs` 中 `PromptCompileResult` 和 `ProviderOverrideData` 新增字段，从数据库加载并传递
  - [x] SubTask 2.4: `services/preset_service.rs` 中 `PortablePresetMeta`、`create`、`update` 新增字段

- [x] Task 3: 后端验证器与仓库层 — 支持新字段
  - [x] SubTask 3.1: `validators/preset_validator.rs` 新增 `structured_output_display` 校验
  - [x] SubTask 3.2: `repositories/preset_repository.rs` CRUD 操作新增 `structured_output_display` 字段

- [x] Task 4: 后端核心 — 废除 `hidden_parts` + `primary_display_key`
  - [x] SubTask 4.1: `stream_processor.rs` 中移除 `primary_display_key` 变量，移除 `hidden_parts` / `hidden_part_lookup`
  - [x] SubTask 4.2: 新增 `content_parts: Vec<PendingMessageContentPart>` 和 `content_part_lookup: HashMap<String, usize>`（用字段名作为 lookup 键）
  - [x] SubTask 4.3: `StringFieldDelta` 事件：所有字段统一追加到 `content_parts`，`is_hidden=false`；`content` 字段继续发 `text_delta` 事件，其他字段发 `string_field_delta` 事件
  - [x] SubTask 4.4: `ObjectFieldComplete` 事件：存入 `content_parts`，`is_hidden=false`
  - [x] SubTask 4.5: `[DONE]` 处理：`parser.finish()` 结果中所有字段存入 `content_parts`，不跳过任何字段
  - [x] SubTask 4.6: `StreamResponseData` 移除 `hidden_parts_json` 字段
  - [x] SubTask 4.7: 同步修改 `stream_anthropic_text_response` 中的相同逻辑

- [x] Task 5: 后端存储 — 修改 `replace_content_parts`
  - [x] SubTask 5.1: 修改函数签名，移除 `visible_text` 参数，改为接收 `content_parts: &[PendingMessageContentPart]`
  - [x] SubTask 5.2: 所有 part 按 `part_index` 顺序插入，`is_hidden=false`
  - [x] SubTask 5.3: 更新所有调用点

- [x] Task 6: 后端流式事件 — 传递 display 配置
  - [x] SubTask 6.1: `stream_llm_response` 中将 `structured_output_display` 传递到前端
  - [x] SubTask 6.2: 确保 `string_field_delta` 事件包含 `partType` 字段，前端可按类型渲染

- [x] Task 7: 预设文件 — 新增 `structuredOutputDisplay`
  - [x] SubTask 7.1: `狐神抚 V9.4 [Night Voyage].json` 新增 `structuredOutputDisplay` 字段

- [x] Task 8: 前端 — 处理 `string_field_delta` 事件
  - [x] SubTask 8.1: `App.tsx` 中 `string_field_delta` 事件不再忽略，实时渲染到消息中
  - [x] SubTask 8.2: 流式阶段的消息内容结构改为支持多字段（不再只是纯文本拼接）

- [x] Task 9: 前端 — 按 display 配置渲染结构化字段
  - [x] SubTask 9.1: `messageFormatter.ts` 中 `StructuredResponseNode` 新增 `displayConfig` 字段
  - [x] SubTask 9.2: `MessageFormatRenderer.tsx` 中 `StructuredResponseRenderer` 按 `displayConfig` 决定折叠/展开
  - [x] SubTask 9.3: 字段渲染顺序按 JSON 中出现顺序（thinking → content → choices）

- [x] Task 10: 编译验证与测试
  - [x] SubTask 10.1: `cargo build --release` 编译通过
  - [ ] SubTask 10.2: 重新导入预设，验证 `structured_output_display` 正确保存
  - [ ] SubTask 10.3: 发送消息，验证所有字段可见，thinking 默认折叠，content 和 choices 默认展开

# Task Dependencies

- Task 2 依赖 Task 1（数据库列必须先存在）
- Task 3 依赖 Task 2（模型层字段先定义）
- Task 4 依赖 Task 2（需要 `structured_output_display` 从编译结果传递）
- Task 5 依赖 Task 4（存储逻辑依赖新的 content_parts 结构）
- Task 6 依赖 Task 4, Task 5
- Task 7 独立
- Task 8 依赖 Task 6（需要后端事件支持）
- Task 9 依赖 Task 8（需要前端数据结构支持）
- Task 10 依赖所有任务

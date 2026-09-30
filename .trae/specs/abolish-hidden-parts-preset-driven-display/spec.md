# 废除 hidden_parts，改为预设驱动的结构化字段展示 Spec

## Why

当前 `structured_json` 模式下，后端通过 `primary_display_key` 硬编码决定哪个字段"可见"，其余字段存入 `hidden_parts`（`is_hidden=true`），前端不渲染。这违反了"字段由预设定义、后端忠实存储、前端照单全收"的设计原则。同时 `ensure_hidden_message_part` 使用数组长度作为 lookup 键，导致同一字段被拆成多个碎片 part。

## What Changes

- **BREAKING** 废除 `hidden_parts` + `primary_display_key` 机制，所有结构化字段一律 `is_hidden=false`
- 新增 `structured_output_display` 字段（预设级 + provider override 级），定义每个字段的默认折叠/展开行为
- 修复 `ensure_hidden_message_part` 的 lookup 键 bug：用字段名（`key`）替代数组索引
- 修改 `replace_content_parts` 存储逻辑：按 JSON 字段顺序存储所有 part，不再区分 hidden/visible
- 修改前端 `StructuredResponseRenderer`：按 `structured_output_display` 配置渲染折叠/展开状态
- 修改前端流式事件处理：`string_field_delta` 事件实际渲染，不再吞掉
- 修改预设文件格式：新增 `structuredOutputDisplay` 字段

## Impact

- Affected specs: `add-structured-output-response-mode`（structured_json 模式）、`improve-structured-rendering`（折叠/展开行为）
- Affected code:
  - `src-tauri/src/services/stream_processor.rs` — 废除 `hidden_parts`/`primary_display_key`，改为 `content_parts` + 字段名 lookup
  - `src-tauri/src/repositories/message_repository.rs` — `replace_content_parts` 不再区分 hidden/visible
  - `src-tauri/src/services/prompt_compiler.rs` — `PromptCompileResult` 新增 `structured_output_display`
  - `src-tauri/migrations/` — 新增 `structured_output_display` 列
  - `src-tauri/src/models/mod.rs` — 新增字段
  - `src-tauri/src/validators/preset_validator.rs` — 新增校验
  - `src-tauri/src/repositories/preset_repository.rs` — CRUD 新增字段
  - `src-tauri/src/services/preset_service.rs` — 便携预设导入/创建/更新
  - `src-tauri/src/llm/mod.rs` — `LlmChatRequest` 新增字段
  - `src/components/MessageFormatRenderer.tsx` — 按 display 配置渲染
  - `src/lib/messageFormatter.ts` — `StructuredResponseNode` 新增 display 配置
  - `src/App.tsx` — 处理 `string_field_delta` 事件
  - `狐神抚 V9.4 [Night Voyage].json` — 新增 `structuredOutputDisplay`

---

## ADDED Requirements

### Requirement: structured_output_display 预设配置

系统 SHALL 在预设中新增 `structured_output_display` 字段，定义结构化输出中每个字段的默认展示行为。

#### Scenario: 数据结构

- **THEN** `structured_output_display` SHALL 为 JSON 字符串，解析后为对象，key 与 `structured_output_schema` 的 `properties` 中的字段名一一对应
- **AND** 每个 key 的值 SHALL 包含 `defaultCollapsed: boolean` 字段
- **AND** 示例：
  ```json
  {
    "thinking": { "defaultCollapsed": true },
    "content": { "defaultCollapsed": false },
    "choices": { "defaultCollapsed": false }
  }
  ```

#### Scenario: 字段缺失回退

- **WHEN** `structured_output_display` 中缺少某个 schema 字段的配置
- **THEN** 该字段 SHALL 回退为 `defaultCollapsed: false`（默认展开）

#### Scenario: structured_output_display 为空

- **WHEN** `structured_output_display` 为 `null` 或空字符串
- **THEN** 所有字段 SHALL 默认展开（`defaultCollapsed: false`）

#### Scenario: 非 structured_json 模式

- **WHEN** `response_mode` 不为 `"structured_json"`
- **THEN** `structured_output_display` SHALL 被忽略

---

### Requirement: structured_output_display 数据库持久化

系统 SHALL 在数据库中持久化 `structured_output_display` 配置。

#### Scenario: presets 表

- **THEN** `presets` 表 SHALL 新增 `structured_output_display TEXT` 列
- **AND** 默认值为 `NULL`

#### Scenario: preset_provider_overrides 表

- **THEN** `preset_provider_overrides` 表 SHALL 新增 `structured_output_display_override TEXT` 列
- **AND** 默认值为 `NULL`

---

### Requirement: 废除 hidden_parts 机制

系统 SHALL 废除 `hidden_parts` + `primary_display_key` 机制，所有结构化字段一律以 `is_hidden=false` 存储。

#### Scenario: 流式处理中的字段存储

- **WHEN** `structured_output_parser` 发射 `StringFieldDelta` 事件
- **THEN** 无论字段名是什么，SHALL 都存入 `content_parts`（`is_hidden=false`）
- **AND** SHALL 使用字段名（`key`）作为 lookup 键，确保同一字段只产生一个 part
- **AND** SHALL NOT 使用 `primary_display_key` 区分主/非主字段

#### Scenario: 流式处理中的对象字段存储

- **WHEN** `structured_output_parser` 发射 `ObjectFieldComplete` 事件
- **THEN** 该字段 SHALL 以 `is_hidden=false` 存入 `content_parts`
- **AND** `json_value` 存储完整对象 JSON

#### Scenario: [DONE] 时的字段处理

- **WHEN** 流式结束，`parser.finish()` 返回完整结果
- **THEN** 所有字段 SHALL 以 `is_hidden=false` 存入 `content_parts`
- **AND** SHALL NOT 跳过任何字段（包括 `primary_display_key` 对应的字段）

---

### Requirement: content_parts 按字段名去重

系统 SHALL 使用字段名（`key`）作为 `content_parts` 的 lookup 键，确保同一字段只产生一个 part。

#### Scenario: 同一字段多次 delta

- **WHEN** `thinking` 字段收到多次 `StringFieldDelta` 事件
- **THEN** 所有 delta SHALL 追加到同一个 `content_parts` 条目的 `text_value` 中
- **AND** SHALL NOT 产生多个 part 条目

#### Scenario: 字段顺序

- **THEN** `content_parts` 中的 part SHALL 按 JSON 中字段的出现顺序排列
- **AND** `part_index` SHALL 从 0 开始递增

---

### Requirement: replace_content_parts 不区分 hidden/visible

系统 SHALL 修改 `replace_content_parts` 函数，所有 part 以 `is_hidden=false` 存储。

#### Scenario: 存储逻辑

- **WHEN** 调用 `replace_content_parts`
- **THEN** 所有 part SHALL 按 `part_index` 顺序插入
- **AND** 所有 part 的 `is_hidden` SHALL 为 `false`
- **AND** SHALL NOT 在最后单独插入一个 `visible_text` part

---

### Requirement: 前端按 display 配置渲染结构化字段

系统 SHALL 在前端按 `structured_output_display` 配置渲染结构化字段的折叠/展开状态。

#### Scenario: 渲染 thinking 字段

- **WHEN** `structured_output_display.thinking.defaultCollapsed` 为 `true`
- **THEN** thinking 字段 SHALL 渲染为折叠的 `CollapsibleTag` 组件
- **AND** 用户可点击展开

#### Scenario: 渲染 content 字段

- **WHEN** `structured_output_display.content.defaultCollapsed` 为 `false`
- **THEN** content 字段 SHALL 正常渲染为消息正文

#### Scenario: 渲染 choices 字段

- **WHEN** `structured_output_display.choices.defaultCollapsed` 为 `false`
- **THEN** choices 字段 SHALL 渲染为选项按钮

#### Scenario: 字段渲染顺序

- **THEN** 字段 SHALL 按 JSON 中的出现顺序渲染（thinking → content → choices）

---

### Requirement: 前端处理 string_field_delta 事件

系统 SHALL 在前端处理 `string_field_delta` 流式事件，实时渲染非主内容字段。

#### Scenario: 接收 thinking delta

- **WHEN** 前端收到 `string_field_delta` 事件，`key` 为 `"thinking"`
- **THEN** 前端 SHALL 实时渲染 thinking 内容到对应的折叠块中
- **AND** SHALL NOT 仅 console.debug

#### Scenario: 流式阶段的消息内容

- **WHEN** 流式阶段收到 `text_delta` 事件（content 字段）和 `string_field_delta` 事件（其他字段）
- **THEN** 前端 SHALL 分别渲染各字段内容
- **AND** 流结束后消息内容 SHALL 保持完整渲染状态

---

### Requirement: 便携预设格式支持 structuredOutputDisplay

系统 SHALL 在便携预设文件格式中支持 `structuredOutputDisplay` 字段。

#### Scenario: 导入预设

- **WHEN** 便携预设文件包含 `structuredOutputDisplay` 字段
- **THEN** 系统 SHALL 将其解析并保存到 `presets.structured_output_display` 列

#### Scenario: 导出预设

- **WHEN** 导出预设
- **THEN** 系统 SHALL 将 `structured_output_display` 包含在导出文件中

---

## MODIFIED Requirements

### Requirement: StreamResponseData

`StreamResponseData` 结构从 `{ full_content, hidden_parts_json }` 改为 `{ full_content }`，移除 `hidden_parts_json` 字段。

### Requirement: StructuredResponseNode

`StructuredResponseNode` 新增 `displayConfig` 字段：
```typescript
interface StructuredResponseNode {
  kind: 'structured_response';
  fields: Record<string, StructuredField>;
  mainContentKey: string | null;
  displayConfig: Record<string, { defaultCollapsed: boolean }>;
}
```

### Requirement: PromptCompileResult

`PromptCompileResult` 新增 `structured_output_display: Option<String>` 字段，从预设加载并传递到流处理器。

### Requirement: LlmChatRequest

`LlmChatRequest` 新增 `structured_output_display: Option<String>` 字段。

## REMOVED Requirements

### Requirement: hidden_parts 机制

**Reason**: 违反"字段由预设定义、后端忠实存储、前端照单全收"原则。`is_hidden=true` 导致非主内容字段不可见，且 lookup 键 bug 导致数据碎片化。
**Migration**: 所有 `message_content_parts` 中 `is_hidden=1` 的记录改为 `is_hidden=0`。

### Requirement: primary_display_key 硬编码

**Reason**: 哪个字段是"主内容"不应由代码硬编码决定，所有字段平等对待，由前端按 display 配置渲染。
**Migration**: 移除 `primary_display_key` 变量，所有字段统一处理。

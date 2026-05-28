# Night Voyage: Schema 可视化编辑器 + 上下文控制 + 显示行为 + 语义组协调

## 背景

Night Voyage 是一个 AI 角色扮演平台，采用结构化输出（structured JSON）作为基础响应格式。模型回复的 JSON 中包含多个键（如"思考"、"正文"、"选项"、"平行世界"等），目前存在以下四个需要改进的问题：

1. **上下文标签剔除**：历史消息中的所有 JSON 键都原样进入上下文，无法过滤掉不必要的键（如"思考"）
2. **标签默认显示行为**：后端已有 `structured_output_display` 字段，但前端缺少配置 UI
3. **Schema 编辑器**：当前 Schema 通过手写 JSON 的 textarea 编辑，对预设作者不友好
4. **预设控制 Schema**：语义组选项（如"行动选项"）需要能控制 Schema 键的存在性

## 技术约束

> [!IMPORTANT]
> - 任务分类：**前端 + 后端混合任务**
> - 前端代码（`src/**`）：Gemini / OpenAI ChatGPT / Anthropic Claude 均可修改
> - 后端代码（`src-tauri/**`）：**Gemini 禁止修改**，仅 OpenAI ChatGPT 或 Anthropic Claude 可修改
> - 前端框架：SolidJS（零 VDOM）
> - 动画引擎：Motion One
> - 样式：Tailwind CSS（前端已在使用）
> - 修改前后端契约时，必须更新 `D:/data/Night Voyage/plans/backend-ai-handoff.md`

---

## Proposed Changes

### Component 1: 新面板 —— Schema 与显示配置面板

> 创建一个独立的侧面板，与现有的「编辑预设设置」面板平级，负责 Schema 可视化编辑、上下文包含配置、显示行为配置。

---

#### [NEW] [SchemaConfigPanel.tsx](file:///D:/data/Night Voyage/src/components/SchemaConfigPanel.tsx)

**用途**：Schema 与显示配置面板，包含：
- 可视化 Schema 编辑器（卡片列表）
- 上下文包含开关（per-key）
- 默认展开/收起开关（per-key）

**UI 规格**：
- 固定在右侧的侧面板，与 `CompletionParametersPanel` 相同的宽度和样式风格
- 顶部标题栏：「Schema 与显示配置」+ 关闭按钮
- 主体区域：每个 Schema 键显示为一张卡片

**每张卡片包含**：
```
┌──────────────────────────────────────────────────┐
│ [键名输入框]                         [🗑️ 删除按钮] │
│                                                  │
│ 类型: [下拉框: string|number|integer|boolean|     │
│        object|array]                             │
│                                                  │
│ 描述: [输入框]                                    │
│                                                  │
│ ┌─────────────┐  ┌─────────────┐                │
│ │ 📝 上下文包含 │  │ 👁️ 默认展开  │                │
│ │   [toggle]   │  │   [toggle]  │                │
│ └─────────────┘  └─────────────┘                │
│                                                  │
│ (如果被语义组控制，显示标识：                       │
│  "受语义组「行动选项」控制" 并置灰删除按钮)          │
│                                                  │
│ (如果 type=object，显示子键区域：                   │
│  additionalProperties 设置)                       │
│                                                  │
│ (如果 type=array，显示 items 设置)                 │
└──────────────────────────────────────────────────┘
```

**底部操作区**：
- 「+ 添加键」按钮
- 「保存」按钮（将可视化编辑器状态序列化为 JSON Schema 字符串并保存）

**数据流**：
1. 面板打开时，从 `presetDetail.preset.structuredOutputSchema` 读取 JSON Schema 字符串并解析为内部数据结构
2. 同时从 `presetDetail.preset.structuredOutputDisplay` 读取显示配置（JSON 格式，存储每个键的 `defaultCollapsed` 状态）
3. 新增字段：从 `presetDetail.preset.contextIncludedKeys`（新字段）读取上下文包含配置
4. 保存时将三部分数据序列化并通过 `presetsUpdate` 写回

**内部数据结构**（前端 signal state）：
```typescript
interface SchemaKeyConfig {
  name: string;                    // 键名
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description: string;             // 描述
  contextIncluded: boolean;        // 是否包含到上下文
  defaultExpanded: boolean;        // 是否默认展开
  linkedBySemanticOption: string | null; // 被哪个语义组选项关联（null = 用户手动创建的）
  // object 类型专用
  additionalPropertiesType?: string; // additionalProperties 的 type
  // array 类型专用
  itemsType?: string;              // items 的 type
  required: boolean;               // 是否在 required 数组中
}
```

**序列化为 JSON Schema 的逻辑**：
```typescript
function serializeToJsonSchema(keys: SchemaKeyConfig[]): string {
  const enabledKeys = keys.filter(k => /* 未被禁用 */);
  const properties: Record<string, any> = {};
  const required: string[] = [];
  
  for (const key of enabledKeys) {
    const prop: any = { type: key.type, description: key.description };
    if (key.type === 'object' && key.additionalPropertiesType) {
      prop.additionalProperties = { type: key.additionalPropertiesType };
    }
    if (key.type === 'array' && key.itemsType) {
      prop.items = { type: key.itemsType };
    }
    properties[key.name] = prop;
    if (key.required) {
      required.push(key.name);
    }
  }
  
  return JSON.stringify({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }, null, 2);
}
```

**反序列化逻辑（JSON Schema → 卡片列表）**：
```typescript
function parseJsonSchema(schema: string, displayConfig: string, contextConfig: string): SchemaKeyConfig[] {
  const parsed = JSON.parse(schema);
  const display = displayConfig ? JSON.parse(displayConfig) : {};
  const context = contextConfig ? JSON.parse(contextConfig) : {};
  
  return Object.entries(parsed.properties || {}).map(([name, prop]) => ({
    name,
    type: prop.type,
    description: prop.description || '',
    contextIncluded: context[name]?.included ?? true, // 默认包含
    defaultExpanded: !(display[name]?.defaultCollapsed ?? false), // 默认展开
    linkedBySemanticOption: null, // 需要从语义组中查询
    additionalPropertiesType: prop.additionalProperties?.type,
    itemsType: prop.items?.type,
    required: (parsed.required || []).includes(name),
  }));
}
```

---

#### [MODIFY] [CompletionPresetArea.tsx](file:///D:/data/Night Voyage/src/components/CompletionPresetArea.tsx)

**需要修改的内容**：

1. **新增 state**：
   ```typescript
   const [isSchemaConfigOpen, setIsSchemaConfigOpen] = createSignal(false);
   ```

2. **在顶部工具栏区域添加打开 Schema 配置面板的按钮**：
   - 位置：与现有的设置按钮（齿轮图标）平级
   - 图标：建议使用 `Braces` 或 `FileJson` 类的图标
   - 仅在 `responseMode === 'structured_json'` 时显示

3. **引入并渲染 `SchemaConfigPanel`**：
   ```tsx
   <SchemaConfigPanel
     isOpen={isSchemaConfigOpen()}
     detail={presetDetail()}
     saving={saving()}
     error={errorMessage()}
     onClose={() => setIsSchemaConfigOpen(false)}
     onSave={handleSchemaConfigSave}
   />
   ```

4. **新增 `handleSchemaConfigSave` 函数**：
   - 接收 `structuredOutputSchema`、`structuredOutputDisplay`、`contextIncludedKeys` 三个字段
   - 调用 `presetsUpdate` 保存

5. **修改预设条目展示顺序**：
   - 当前展示顺序是分组展示（锁定条目 → 选择组 → 互斥组 → 多选语义组 → 普通条目）
   - 需要改为按 `sortOrder` 统一排序，让展示顺序与请求体中的顺序一致
   - 具体做法：移除分组逻辑，将所有 blocks（包括 locked、exclusive、ordinary）合并后按 `sortOrder ASC` 排序显示
   - `system_instruction` 类型的 block 因为 sortOrder 最小，会自然显示在最顶部

---

#### [MODIFY] [CompletionParametersPanel.tsx](file:///D:/data/Night Voyage/src/components/CompletionParametersPanel.tsx)

**需要修改的内容**：

1. **删除 JSON Schema textarea 和相关代码**：
   - 删除 L271-L313 的 `<Show when={draft().responseMode === 'structured_json'}>` 内的整个 JSON Schema 编辑区域
   - 删除两个模板按钮（「基础」和「交互小说」）
   - 保留 `responseMode` 下拉框
   - 当选择 `structured_json` 时，不再自动填充默认 schema，而是提示用户去 Schema 配置面板编辑

2. **在 Provider Override 部分同样处理**：
   - 删除 L436-L478 的 provider override 中的 Schema textarea
   - 保留 `responseModeOverride` 下拉框

3. **替换的 UI**：
   - 当 responseMode 为 `structured_json` 时，显示一个提示文本 + 按钮：
   ```
   「Schema 已通过可视化编辑器管理。点击打开 Schema 配置面板。」
   ```
   - 按钮点击时触发 `onOpenSchemaConfig` 回调

4. **新增 props**：
   ```typescript
   onOpenSchemaConfig?: () => void;
   ```

---

### Component 2: 后端数据模型变更

> [!WARNING]
> 后端代码仅允许 OpenAI ChatGPT 系列或 Anthropic Claude 修改。以下是需要的后端变更说明。

---

#### [MODIFY] [preset_repository.rs](file:///D:/data/Night Voyage/src-tauri/src/repositories/preset_repository.rs)

**需要的变更**：

1. **presets 表新增字段**：
   ```sql
   ALTER TABLE presets ADD COLUMN context_included_keys TEXT DEFAULT NULL;
   ```
   - 存储格式：JSON 字符串，例如 `{"思考": false, "正文": true, "选项": true, "平行世界": true}`
   - `null` 表示未配置，等价于所有键都包含（向后兼容）

2. **CREATE/UPDATE 操作**：在 `insert_preset` 和 `update_preset` 的 SQL 和绑定中添加 `context_included_keys` 字段

3. **SELECT 操作**：在 `PRESET_COLUMNS` 和行解析中添加 `context_included_keys`

---

#### [MODIFY] [models/mod.rs](file:///D:/data/Night Voyage/src-tauri/src/models/mod.rs)

**需要的变更**：

1. 在 `PresetRecord` struct 中添加：
   ```rust
   pub context_included_keys: Option<String>,
   ```

---

#### [MODIFY] [commands/presets/mod.rs](file:///D:/data/Night Voyage/src-tauri/src/commands/presets/mod.rs)

**需要的变更**：

1. 在 `presets_create` 和 `presets_update` 命令的参数中添加：
   ```rust
   context_included_keys: Option<String>,
   ```

2. 传递到 service 层

---

#### [MODIFY] [services/preset_service.rs](file:///D:/data/Night Voyage/src-tauri/src/services/preset_service.rs)

**需要的变更**：

1. 在 `create_preset` 和 `update_preset` 中添加 `context_included_keys` 参数
2. 在 `PortablePreset` 中添加该字段（导出/导入支持）

---

#### [MODIFY] [services/prompt_compiler.rs](file:///D:/data/Night Voyage/src-tauri/src/services/prompt_compiler.rs)

**核心变更 — 上下文标签剔除逻辑**：

在 `load_recent_history_blocks` 函数（L1715-L1838）中，需要：

1. 从当前 preset 加载 `context_included_keys` 配置
2. 从当前 preset 加载 `structured_output_schema` 和 `response_mode`
3. 当 `response_mode == "structured_json"` 且 `context_included_keys` 不为 null 时：
   - 对每条 `assistant` 角色的历史消息的 `content`（JSON 字符串），解析 JSON
   - 过滤掉 `context_included_keys` 中值为 `false` 的键
   - 将过滤后的 JSON 重新序列化为字符串
   - 用过滤后的内容替换原始 content

**伪代码**：
```rust
fn filter_structured_content(
    content: &str,
    context_included_keys: &HashMap<String, bool>,
) -> String {
    if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(obj) = parsed.as_object_mut() {
            obj.retain(|key, _| {
                context_included_keys.get(key).copied().unwrap_or(true)
            });
            return serde_json::to_string(obj).unwrap_or_else(|_| content.to_string());
        }
    }
    content.to_string()
}
```

---

### Component 3: 前端 API 层和类型更新

---

#### [MODIFY] [backend.ts](file:///D:/data/Night Voyage/src/lib/backend.ts)

**需要的变更**：

1. 在 `PresetSummary` 接口中添加：
   ```typescript
   contextIncludedKeys?: string;  // JSON string
   structuredOutputDisplay?: string;  // 已有字段，确认前端类型中有
   ```

2. 在 `CreatePresetPayload` 接口中添加：
   ```typescript
   contextIncludedKeys?: string;
   structuredOutputDisplay?: string;
   ```

3. 确认 `PresetDetail` 和 `PresetCompilePreview` 是否需要同步更新

---

### Component 4: 语义组选项 → Schema 关联

---

#### [MODIFY] 语义组选项数据模型

1. **后端**：在 `preset_semantic_options` 表中添加字段：
   ```sql
   ALTER TABLE preset_semantic_options ADD COLUMN linked_schema_keys TEXT DEFAULT NULL;
   ```
   - 存储格式：JSON 字符串，例如 `["选项"]` 或 `["选项", "ASMR音效"]`
   - 表示当该选项被勾选时，应在 Schema 中存在这些键

2. **前端 `PresetSemanticOptionRecord` 接口**添加：
   ```typescript
   linkedSchemaKeys?: string[];
   ```

3. **前端 `PresetSemanticOptionInput` 接口**添加：
   ```typescript
   linkedSchemaKeys?: string[];
   ```

---

#### [MODIFY] [CompletionPresetArea.tsx](file:///D:/data/Night Voyage/src/components/CompletionPresetArea.tsx) — 语义组选项变更联动

在 `handleToggleSemanticOption` 中添加逻辑：

```typescript
const handleToggleSemanticOption = async (groupId, optionId, selectionMode) => {
  // ... 现有逻辑 ...
  
  // 新增：同步 Schema
  const detail = presetDetail();
  if (detail?.preset.responseMode === 'structured_json') {
    const toggledOption = findSemanticOptionById(group.options, optionId);
    if (toggledOption?.linkedSchemaKeys?.length) {
      const currentSchema = JSON.parse(detail.preset.structuredOutputSchema || '{}');
      
      if (/* option is being enabled */) {
        // 检查 schema 中是否已存在关联的键，如果不存在则添加
        for (const key of toggledOption.linkedSchemaKeys) {
          if (!currentSchema.properties?.[key]) {
            // 添加默认定义（可以从 option 的 metadata 中获取或使用合理默认值）
            currentSchema.properties[key] = { type: "object", description: "", additionalProperties: { type: "string" } };
            if (!currentSchema.required?.includes(key)) {
              currentSchema.required = [...(currentSchema.required || []), key];
            }
          }
        }
      } else {
        // option 被关闭：从 schema 中移除关联的键
        for (const key of toggledOption.linkedSchemaKeys) {
          delete currentSchema.properties?.[key];
          currentSchema.required = (currentSchema.required || []).filter(k => k !== key);
        }
      }
      
      // 保存更新后的 schema
      await presetsUpdate(buildPresetUpdatePayload(detail, {
        structuredOutputSchema: JSON.stringify(currentSchema, null, 2),
      }));
    }
  }
};
```

---

### Component 5: 预设标签排序对齐

---

#### [MODIFY] [CompletionPresetArea.tsx](file:///D:/data/Night Voyage/src/components/CompletionPresetArea.tsx) — 展示顺序

**目标**：让前端展示顺序与后端请求体顺序一致。

**当前问题**：
- 前端分成了 `lockedBlocks`、`choiceSemanticGroups`、`exclusiveBlockGroups`、`ordinarySemanticGroups`、`ordinaryBlocks` 五个分组
- 每个分组内部按各自规则排序
- 但分组之间的顺序不是按 sortOrder 排列的

**修改方案**：
1. 创建一个统一的 `orderedItems` computed，将所有类型的条目（blocks + semantic groups）混合后按 `sortOrder` 排序
2. 渲染时，根据每个 item 的类型选择不同的渲染组件
3. 锁定条目的特殊样式保留（不可切换、不可删除的标识）

**参考数据结构**：
```typescript
type OrderedPresetItem = 
  | { kind: 'block'; block: PresetPromptBlock; isLocked: boolean; exclusiveGroup?: ExclusiveBlockGroup }
  | { kind: 'semanticGroup'; group: PresetSemanticGroupRecord & { flatOptions: PresetSemanticOptionRecord[] }; isChoice: boolean };

const orderedItems = createMemo(() => {
  const detail = presetDetail();
  if (!detail) return [];
  
  const items: (OrderedPresetItem & { sortOrder: number })[] = [];
  
  // 添加所有 blocks
  for (const block of detail.blocks.filter(b => !b.semanticOptionId)) {
    items.push({
      kind: 'block',
      block,
      isLocked: block.isLocked,
      sortOrder: block.sortOrder,
    });
  }
  
  // 添加所有 semantic groups
  for (const group of detail.semanticGroups) {
    items.push({
      kind: 'semanticGroup',
      group: { ...group, flatOptions: flattenSemanticOptions(group.options) },
      isChoice: group.selectionMode === 'single',
      sortOrder: group.sortOrder,
    });
  }
  
  // 统一排序
  return items.sort((a, b) => a.sortOrder - b.sortOrder);
});
```

---

## 实现顺序建议

> [!TIP]
> 建议按以下顺序实施，前后依赖关系清晰：

### Phase 1: 后端数据模型（需要 ChatGPT/Claude）
1. `presets` 表添加 `context_included_keys` 字段
2. `preset_semantic_options` 表添加 `linked_schema_keys` 字段
3. 在 CRUD 链路中传递新字段（models → repositories → services → commands）
4. 在 `prompt_compiler.rs` 的 `load_recent_history_blocks` 中实现上下文过滤逻辑
5. 更新 `D:/data/Night Voyage/plans/backend-ai-handoff.md`

### Phase 2: 前端类型和 API 层
1. 更新 `backend.ts` 中的接口定义
2. 确保 `presetsUpdate` 可以传递新字段

### Phase 3: Schema 可视化编辑器面板
1. 创建 `SchemaConfigPanel.tsx`
2. 实现 JSON Schema ↔ 卡片列表的双向转换
3. 实现上下文包含 toggle 和默认展开 toggle
4. 在 `CompletionPresetArea.tsx` 中集成面板入口

### Phase 4: 删除旧 Schema textarea
1. 从 `CompletionParametersPanel.tsx` 中移除 JSON Schema textarea
2. 替换为引导文本 + 打开面板按钮

### Phase 5: 预设标签排序对齐
1. 修改 `CompletionPresetArea.tsx` 中的展示逻辑
2. 统一按 sortOrder 排序

### Phase 6: 语义组 → Schema 联动
1. 在 Schema 编辑器中显示被语义组控制的标识
2. 在 `handleToggleSemanticOption` 中添加 Schema 同步逻辑

---

## Verification Plan

### Automated Tests

1. **后端单元测试**：
   - 测试 `filter_structured_content` 函数：传入带有 "思考"、"正文"、"选项" 键的 JSON，配置排除 "思考"，验证输出不包含 "思考"
   - 测试 `context_included_keys` 为 null 时不做过滤
   - 测试非 JSON 内容不报错、原样返回

2. **前端构建验证**：
   ```bash
   cd D:\data\Night Voyage && npm run build
   ```

### Manual Verification

1. **Schema 编辑器**：
   - 创建新预设 → 选择「结构化输出」→ 打开 Schema 配置面板
   - 添加键（string/object/array 各类型）→ 保存 → 重新打开面板验证持久化
   - 删除键 → 保存 → 验证 Schema 更新

2. **上下文过滤**：
   - 对某个键取消「上下文包含」→ 发送消息 → 查看编译预览确认该键被过滤

3. **显示行为**：
   - 设置某个键为「默认收起」→ 接收新消息 → 验证该键显示为折叠状态

4. **语义组联动**：
   - 勾选「行动选项」→ 验证 Schema 中自动添加「选项」键
   - 取消勾选 → 验证 Schema 中「选项」键被移除
   - 手动在 Schema 中添加「选项」键后勾选「行动选项」→ 验证不重复添加

5. **预设排序**：
   - 查看预设条目列表，确认顺序与编译预览中的顺序一致

---

## Open Questions

> [!IMPORTANT]
> 以下问题需要在实施中确认：

1. **语义组选项 `linkedSchemaKeys` 的默认值填充**：现有预设数据中的语义组选项没有 `linkedSchemaKeys` 字段。需要数据迁移脚本来为已知选项（如 `action_choices`）填充默认关联键（如 `["选项"]`），还是让预设作者手动配置？

2. **Schema 键的默认 additionalProperties 行为**：当语义组自动添加「选项」键时，它的 schema 定义应该是什么？当前硬编码为 `{ type: "object", additionalProperties: { type: "string" } }`，这个默认值是否合理？

3. **排序对齐的渲染变化**：统一按 sortOrder 排序后，现有的分组 UI（选择组标题、互斥组标题等）是否保留？还是所有条目都平铺展示，不再有分组标题？

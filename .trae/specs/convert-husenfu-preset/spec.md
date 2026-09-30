# 狐神抚预设重写 Spec

## Why
用户拥有一个 SillyTavern 格式的角色扮演预设（狐神抚 V9.4），需要将其重写为 Night Voyage 项目兼容的预设格式。目标适配协议为 OpenAI，数据组织方式为 Structured Outputs 模式。SillyTavern 的 `{{setvar::}}`/`{{getvar::}}` 变量注入机制需映射为 Night Voyage 的语义组（semantic groups）分类系统，XML 标签输出格式需替换为 JSON Schema 约束的结构化输出。

## What Changes
- 创建一个新的 Night Voyage 便携预设 JSON 文件，基于狐神抚 V9.4 的功能性词条重写
- **BREAKING**: 输出格式从 XML 标签（`<content>`, `<fox_selc>`, `<think_fox~>` 等）改为 JSON Schema 约束的结构化输出
- **BREAKING**: 变量注入机制从 `{{setvar::}}`/`{{getvar::}}` 改为语义组选项的 blocks 条件包含
- 删除说明类词条（使用必看、声明等）
- 删除思维链美化代码（项目已有）
- 删除 MVU 变量相关词条（项目不支持）
- 删除 SillyTavern 特有的正则脚本、扩展插件等
- 删除搜索/分析扩展脚本（狐搜、狐析）
- 保留并重写所有功能性词条

## Impact
- Affected specs: add-structured-output-response-mode（Structured Outputs 模式）
- Affected code: 无代码变更，仅创建预设数据文件
- 产出物: 一个可导入 Night Voyage 的便携预设 JSON 文件

## ADDED Requirements

### Requirement: 便携预设文件
系统 SHALL 生成一个符合 Night Voyage `PortablePresetFile` 格式的 JSON 文件，包含完整的预设元数据、语义组、提示块、示例消息和停止序列。

#### Scenario: 预设可导入
- **WHEN** 用户通过 Night Voyage 的预设导入功能导入该文件
- **THEN** 预设被正确创建，所有语义组和选项可用

### Requirement: Structured Outputs JSON Schema
预设 SHALL 使用 `structured_json` 响应模式，并提供适配角色扮演场景的 JSON Schema。Schema 设计原则：
- 第一个 string 字段为 `thinking`（主内容，流式输出时作为 full_content）
- 第二个 string 字段为 `content`（正文叙事）
- object 字段为 `choices`（行动选项，渲染为按钮）
- 所有字段必须在 `required` 中（OpenAI strict: true 要求）
- `additionalProperties: false`

#### Scenario: Schema 约束输出
- **WHEN** 模型使用此预设生成回复
- **THEN** 输出严格符合 JSON Schema，thinking 字段包含思考过程，content 字段包含正文，choices 字段包含行动选项

### Requirement: 语义组分类
预设 SHALL 将 SillyTavern 的功能性词条组织为以下语义组：

**单选组（selection_mode: "single"）：**
1. `paraphrase` - 转述模式：直接转述 / 分段转述（默认） / 不要转述
2. `user_control` - 抢话控制：大量抢话 / 正常抢话 / 微抢话 / 禁止抢话（默认）
3. `nsfw_arousal` - NSFW 发情：防止发情 / 要发情 / 默认（不发情）
4. `nsfw_style` - NSFW 风格：很黄 / 正常（默认） / 舒缓 / 克制 / 关闭
5. `writing_style` - 文风：真实感（默认） / 轻小说 / Cthulhu / 电影感 / 网文风 / 古风修仙 / 短句白描 / 不作要求
6. `dialogue_amount` - 对白量：高 / 中 / 低 / 默认（不作要求）
7. `pacing` - 推进速度：快 / 正常（默认） / 慢
8. `pov` - 人称视角：第一人称 / 第二人称（默认） / 第三人称 / 自由人称
9. `profanity` - 粗鄙之语：少说脏话（默认） / 别说脏话 / 不作要求
10. `system_role` - 系统扮演：禁止（默认） / 狐神抚接管 / 扮演系统
11. `inner_voice` - 内心OS：只用户 / 只角色 / 多角色 / 禁止（默认）
12. `thinking_chain` - 思维链：多角色内心OS（默认） / 精简通用导演 / 世界书自带 / 无
13. `reasoning_effort` - 思考强度：默认（默认） / 高 / 中 / 低
14. `output_format` - 正文格式：狐神特调（默认） / 短句快切 / 跟随上下文 / 默认
15. `word_count` - 字数：智能长短文（默认） / 超短文 / 短文 / 中短文 / 长文 / 超长文
16. `anti_cliche` - 杀八股：八股规范（默认） / 去欧规范
17. `language` - 语言：简体中文（默认） / 繁体中文 / 多语言

**多选组（selection_mode: "multiple"）：**
18. `extras` - 额外设定：背景NPC发展 / 禁止机械降神 / 多视角（默认选中） / 防全知（默认选中） / 防剧透（默认选中） / 防血腥 / 防霸总 / 禁止输出两遍正文
19. `output_extras` - 输出附加：行动选项（默认选中） / ASMR对话（默认选中） / 格式加强 / 禁止机械词语（默认选中） / 禁止滥用比喻（默认选中） / 用户指令优先（默认选中） / 优先级加强

#### Scenario: 语义组选项切换
- **WHEN** 用户在预设面板中切换某个语义组的选项
- **THEN** 对应选项的提示块被包含/排除在编译后的系统提示中

### Requirement: 提示块内容重写
所有功能性词条 SHALL 从 SillyTavern 格式重写为 Night Voyage 格式：
- 移除 `{{setvar::variable_name::` 前缀和 `}}` 后缀
- 移除 `{{getvar::variable_name}}` 引用，改为语义组选项的 blocks
- 移除 XML 标签输出格式引用（`<content>`, `<fox_selc>` 等），改为 JSON 字段引用
- 移除 SillyTavern 模板变量（`{{user}}`, `{{char}}` 等），改为 Night Voyage 的 Jinja2 模板语法
- 保留核心提示词逻辑和规则内容

### Requirement: 核心系统提示
预设 SHALL 包含以下核心提示块（非语义组，直接 blocks）：
1. **jailbreak** - 主系统提示（原 jailbreak identifier 的内容），整合所有 `{{getvar::}}` 引用为直接文本，按阶段组织
2. **prefill** - 预填充块，引导模型开始输出 JSON
3. **阅读引导** - 上下文阅读指引
4. **用户偏好读取** - 用户偏好区块
5. **输出前准备** - 第二阶段注入强调要求
6. **破限示例** - jailbreak few-shot 示例

### Requirement: JSON Schema 定义
预设的 `structured_output_schema` SHALL 定义如下 Schema：

```json
{
  "type": "object",
  "properties": {
    "thinking": {
      "type": "string",
      "description": "导演检查、角色分析、剧情预演。按思维链规则执行思考过程。"
    },
    "content": {
      "type": "string",
      "description": "正文叙事内容。按正文格式规则和文风要求撰写。"
    },
    "choices": {
      "type": "object",
      "properties": {
        "A": { "type": "string", "description": "行动选项A" },
        "B": { "type": "string", "description": "行动选项B" },
        "C": { "type": "string", "description": "行动选项C" },
        "D": { "type": "string", "description": "行动选项D" }
      },
      "required": ["A", "B", "C", "D"],
      "additionalProperties": false
    }
  },
  "required": ["thinking", "content", "choices"],
  "additionalProperties": false
}
```

#### Scenario: Schema 适配 OpenAI Structured Outputs
- **WHEN** 预设使用 structured_json 模式调用 OpenAI API
- **THEN** API 使用 `response_format: { type: "json_schema", json_schema: { name: "night_voyage_response", strict: true, schema: ... } }` 约束输出

### Requirement: 预设参数
预设 SHALL 设置以下参数：
- `response_mode`: "structured_json"
- `temperature`: 1.0
- `top_p`: 0.88
- `top_k`: 40
- `frequency_penalty`: 0
- `presence_penalty`: 0
- `max_output_tokens`: 65535
- `thinking_enabled`: true
- `structured_output_schema`: 上述 JSON Schema

## MODIFIED Requirements
无（这是新预设创建，不修改现有功能）

## REMOVED Requirements
无（不删除任何现有功能）

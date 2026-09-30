# 改进结构化渲染外观与默认展开行为 Spec

## Why

当前 `CollapsibleTag` 组件的渲染效果不够美观：灰底大写徽章 + 白色边框卡片与暗色主题不协调，且默认折叠导致用户需要逐个点击展开才能看到内容。用户希望改进视觉设计，默认展开所有标签，并允许在设置中调整标签的默认展开/折叠行为。

## What Changes

- 重新设计 `CollapsibleTag` 组件的视觉样式，使其与暗色主题更协调
- 将标签默认状态从折叠改为展开
- 在 `MessageFormatConfig` 中新增 `pseudoXmlDefaultExpanded` 配置项
- 在设置 > 界面外观的"消息格式化"区域新增"标签默认展开"开关

## Impact

- Affected specs: `add-chat-format-dynamic-bg-preset-editor`（消息格式化功能）
- Affected code:
  - `src/components/MessageFormatRenderer.tsx` — `CollapsibleTag` 视觉重设计 + 默认展开
  - `src/lib/messageFormatter.ts` — `MessageFormatConfig` 新增 `pseudoXmlDefaultExpanded`
  - `src/components/SettingsArea.tsx` — 新增"标签默认展开"开关

---

## ADDED Requirements

### Requirement: 标签默认展开行为可配置

系统 SHALL 在 `MessageFormatConfig` 中新增 `pseudoXmlDefaultExpanded` 字段，控制伪 XML 标签的初始展开/折叠状态。

#### Scenario: 默认展开

- **WHEN** `pseudoXmlDefaultExpanded` 为 `true`（默认值）
- **THEN** 所有伪 XML 标签块 SHALL 初始渲染为展开状态
- **AND** 用户可点击标题栏折叠标签块

#### Scenario: 默认折叠

- **WHEN** `pseudoXmlDefaultExpanded` 为 `false`
- **THEN** 所有伪 XML 标签块 SHALL 初始渲染为折叠状态
- **AND** 用户可点击标题栏展开标签块

#### Scenario: 配置数据结构

- **THEN** `MessageFormatConfig` SHALL 在 `builtinRules.pseudoXml` 中新增 `defaultExpanded` 字段
- **AND** 数据结构 SHALL 变更为：
  ```typescript
  interface MessageFormatConfig {
    builtinRules: {
      pseudoXml: { enabled: boolean; defaultExpanded: boolean };
      italicGray: { enabled: boolean };
      cyanQuote: { enabled: boolean };
      worldBookKeyword: { enabled: boolean };
    };
    customRules: CustomFormatRule[];
  }
  ```
- **AND** `defaultExpanded` 默认值为 `true`

---

### Requirement: 标签默认展开设置 UI

系统 SHALL 在设置 > 界面外观的"消息格式化"区域新增"标签默认展开"开关。

#### Scenario: 切换标签默认展开开关

- **WHEN** 用户在"伪 XML 标签折叠"开关下方切换"标签默认展开"开关
- **THEN** 系统 SHALL 立即保存该状态到后端 `settings` 表
- **AND** 已打开的聊天消息中的标签块 SHALL 在下次渲染时使用新的默认状态
- **AND** 该开关仅在"伪 XML 标签折叠"启用时可见

---

### Requirement: 改进 CollapsibleTag 视觉设计

`CollapsibleTag` 组件 SHALL 采用与暗色主题协调的视觉设计。

#### Scenario: 标签块展开状态

- **WHEN** 标签块处于展开状态
- **THEN** 标题栏 SHALL 显示标签名和展开/折叠指示器
- **AND** 标题栏 SHALL 使用半透明暗色背景（`bg-white/[0.04]`）和左侧竖线装饰（`border-l-2 border-accent/40`）
- **AND** 内容区域 SHALL 无额外边框和背景，仅通过左侧缩进区分层级
- **AND** 标签名 SHALL 使用小号大写字母（`text-[11px] uppercase tracking-wider`），颜色为 `text-accent/70`

#### Scenario: 标签块折叠状态

- **WHEN** 标签块处于折叠状态
- **THEN** 标题栏 SHALL 显示标签名和折叠指示器（▶）
- **AND** 标题栏 SHALL 使用与展开状态相同的样式
- **AND** 内容区域 SHALL 隐藏

#### Scenario: 标题栏交互

- **WHEN** 用户悬停在标题栏上
- **THEN** 标题栏 SHALL 显示微妙的悬停效果（`hover:bg-white/[0.07]`）
- **WHEN** 用户点击标题栏
- **THEN** 标签块 SHALL 切换展开/折叠状态
- **AND** 展开/折叠动画 SHALL 使用 Motion One，持续 0.25 秒

## MODIFIED Requirements

### Requirement: MessageFormatConfig 数据结构

`MessageFormatConfig.builtinRules.pseudoXml` 从 `{ enabled: boolean }` 扩展为 `{ enabled: boolean; defaultExpanded: boolean }`。已有的 `messageFormatConfig` 设置值若缺少 `defaultExpanded` 字段，SHALL 回退为 `true`。

### Requirement: 伪 XML 标签折叠

伪 XML 标签块的默认状态从"折叠"改为"展开"，且可通过设置调整。

## REMOVED Requirements

无移除项。

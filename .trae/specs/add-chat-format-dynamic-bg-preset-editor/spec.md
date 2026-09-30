# 会话内容格式处理 / 动态背景 / 预设编辑器增强 Spec

## Why

当前会话消息以纯文本渲染，缺少结构化格式支持（伪 XML 标签折叠、斜体/引号/关键词高亮），降低了长文本的可读性；应用背景为静态玄青色，未利用角色卡图片营造沉浸感；预设编辑器虽已支持条目的添加与修改，但缺少对锁定条目、互斥条目与自由条目的完整删除和添加能力，限制了用户对预设结构的灵活编排。

## What Changes

- 新增会话正文格式化渲染引擎：伪 XML 标签折叠/展开（带 Motion One 动画）、`**text**` 斜体灰色、`"quoted text"` 青色高亮、世界书触发关键词紫色标记
- 新增格式化规则配置系统：内置规则可开关，支持用户自定义格式规则（正则匹配 + 样式）
- 在设置 > 界面外观中新增"消息格式化"配置入口
- 新增动态背景系统：选择会话时背景渐变为高斯模糊化的角色卡图片，切换工作区时渐变回玄青主题色
- 增强预设编辑器：允许用户删除锁定条目、互斥条目，以及添加/删除自由条目

## Impact

- Affected specs: 无已有 spec 直接受影响
- Affected code:
  - `src/components/MessageItem.tsx` — 消息渲染逻辑重构，接入格式化引擎
  - `src/components/SettingsArea.tsx` — 新增"消息格式化"配置区域
  - `src/components/AuroraBackground.tsx` — 改造为支持动态背景的组件
  - `src/App.tsx` — 传递动态背景所需的角色卡图片与工作区状态
  - `src/components/CompletionPresetArea.tsx` — 增强条目删除/添加能力
  - `src/lib/backend.ts` — 新增格式化配置的 settings 读写
  - `src-tauri/src/commands/settings.rs` — 可能需要新增格式化配置的序列化/反序列化支持

---

## ADDED Requirements

### Requirement: 会话正文格式化渲染引擎

系统 SHALL 在 `MessageItem` 组件中引入格式化渲染引擎，将消息纯文本转换为结构化富文本渲染。

#### Scenario: 伪 XML 标签折叠

- **WHEN** 消息正文包含 `<tagname>...</tagname>` 格式的伪 XML 标签
- **THEN** 系统 SHALL 将其渲染为可折叠的标签块，标签名显示为标题栏
- **AND** 默认状态为折叠，点击标题栏可展开/收起内容
- **AND** 展开/收起时 SHALL 使用 Motion One 动画（height 过渡 + opacity 淡入淡出）

#### Scenario: 斜体灰色文本

- **WHEN** 消息正文包含 `**text**` 格式
- **THEN** 系统 SHALL 将 `**` 中间的内容渲染为斜体灰色文字（`font-style: italic; color: rgba(245, 245, 247, 0.5)`）

#### Scenario: 青色引号文本

- **WHEN** 消息正文包含 `"quoted text"` 格式（中文或英文双引号）
- **THEN** 系统 SHALL 将双引号及中间的内容渲染为青色文字（`color: #4ECDC4`）

#### Scenario: 世界书关键词紫色标记

- **WHEN** 消息正文中出现当前会话关联世界书的触发关键词
- **THEN** 系统 SHALL 将该关键词渲染为紫色文字（`color: #A78BFA`）
- **AND** 关键词匹配 SHALL 由前端在渲染时根据已加载的世界书条目关键词列表进行检测

#### Scenario: 格式化规则不互相干扰

- **WHEN** 消息正文同时包含多种格式标记
- **THEN** 各格式化规则 SHALL 按优先级依次应用，不产生嵌套冲突
- **AND** 优先级顺序为：伪 XML 标签 > 世界书关键词 > 斜体 > 青色引号

#### Scenario: 流式消息的格式化

- **WHEN** 消息处于流式接收状态（`isStreaming=true`）
- **THEN** 系统 SHALL 在每个文本增量到达时实时应用格式化渲染
- **AND** 未闭合的伪 XML 标签 SHALL 显示为普通文本，直到闭合标签到达

---

### Requirement: 格式化规则配置系统

系统 SHALL 提供格式化规则的配置能力，包括内置规则开关和自定义规则添加。

#### Scenario: 内置规则开关

- **WHEN** 用户在设置 > 界面外观中切换某条内置格式化规则的开关
- **THEN** 系统 SHALL 立即保存该开关状态到后端 `settings` 表
- **AND** 已打开的聊天消息 SHALL 实时反映开关变化

#### Scenario: 添加自定义格式规则

- **WHEN** 用户在设置 > 界面外观中点击"添加自定义规则"
- **THEN** 系统 SHALL 显示规则编辑表单，包含：规则名称、正则表达式、匹配组索引、文字颜色、是否斜体、是否加粗
- **AND** 用户填写完成后点击保存，系统 SHALL 将规则持久化到 `settings` 表

#### Scenario: 删除自定义格式规则

- **WHEN** 用户在设置 > 界面外观中删除某条自定义规则
- **THEN** 系统 SHALL 从持久化存储中移除该规则
- **AND** 已打开的聊天消息 SHALL 实时反映删除

#### Scenario: 配置数据结构

- **THEN** 格式化配置 SHALL 以 JSON 字符串存储在 `settings` 表中，key 为 `messageFormatConfig`
- **AND** 数据结构 SHALL 包含：
  ```typescript
  interface MessageFormatConfig {
    builtinRules: {
      pseudoXml: { enabled: boolean };
      italicGray: { enabled: boolean };
      cyanQuote: { enabled: boolean };
      worldBookKeyword: { enabled: boolean };
    };
    customRules: CustomFormatRule[];
  }

  interface CustomFormatRule {
    id: string;
    name: string;
    pattern: string;       // 正则表达式字符串
    groupIndex: number;    // 匹配组索引
    color: string;         // CSS 颜色值
    italic: boolean;
    bold: boolean;
  }
  ```

---

### Requirement: 消息格式化设置 UI

系统 SHALL 在设置 > 界面外观中新增"消息格式化"配置区域。

#### Scenario: 进入消息格式化设置

- **WHEN** 用户在设置侧边栏选择"界面外观"
- **THEN** 设置区域 SHALL 在"动态特效"开关下方显示"消息格式化"区域
- **AND** 该区域 SHALL 包含四条内置规则的开关（伪 XML 标签折叠、斜体灰色、青色引号、世界书关键词）
- **AND** 该区域 SHALL 包含自定义规则列表和"添加自定义规则"按钮

#### Scenario: 自定义规则编辑

- **WHEN** 用户点击"添加自定义规则"或编辑已有自定义规则
- **THEN** 系统 SHALL 显示内联编辑表单，包含：规则名称、正则表达式、匹配组索引、文字颜色选择器、斜体开关、加粗开关
- **AND** 正则表达式 SHALL 提供实时校验，非法正则 SHALL 显示错误提示

---

### Requirement: 动态背景系统

系统 SHALL 根据当前选中的会话/工作区动态切换应用背景。

#### Scenario: 选择会话时显示角色卡背景

- **WHEN** 用户选择一个会话且该会话关联的角色卡有 `imagePath`
- **THEN** 应用背景 SHALL 从当前状态渐变为该角色卡图片的高斯模糊版本
- **AND** 渐变 SHALL 使用 Motion One 动画，过渡时长 800ms，easing 为 `easeInOut`
- **AND** 高斯模糊参数 SHALL 为 `filter: blur(60px) saturate(1.2)`
- **AND** 背景图片上 SHALL 叠加半透明玄青色遮罩（`background: rgba(6, 12, 20, 0.6)`），确保前景文字可读性

#### Scenario: 选择无角色卡图片的会话

- **WHEN** 用户选择一个会话但该会话关联的角色卡没有 `imagePath`
- **THEN** 应用背景 SHALL 渐变回玄青主题色（与 AuroraBackground 默认状态一致）

#### Scenario: 切换到非会话工作区

- **WHEN** 用户从会话工作区切换到角色展示柜/预设/世界书/设置工作区
- **THEN** 应用背景 SHALL 渐变回玄青主题色

#### Scenario: 切换不同会话

- **WHEN** 用户从会话 A 切换到会话 B
- **THEN** 应用背景 SHALL 从会话 A 的角色卡图片渐变为会话 B 的角色卡图片
- **AND** 渐变过程中 SHALL 使用交叉淡入淡出（crossfade），避免闪烁

#### Scenario: 动态特效关闭时的行为

- **WHEN** 用户关闭"动态特效"开关
- **THEN** 动态背景 SHALL 仍然生效（动态背景不属于动态特效范畴）
- **AND** AuroraBackground 极光动画 SHALL 隐藏，但角色卡模糊背景 SHALL 保留

#### Scenario: 动态背景与极光背景的层级关系

- **THEN** 动态角色卡背景 SHALL 位于最底层（z-index 最低）
- **AND** AuroraBackground 极光动画 SHALL 叠加在角色卡背景之上
- **AND** 当角色卡背景激活时，极光动画的透明度 SHALL 降低至 0.3，避免遮挡角色卡氛围

---

### Requirement: 预设编辑器条目管理增强

系统 SHALL 增强预设编辑器，允许用户对锁定条目、互斥条目与自由条目进行删除和添加操作。

#### Scenario: 删除锁定条目

- **WHEN** 用户在预设编辑器中对锁定条目点击删除
- **THEN** 系统 SHALL 显示确认对话框，提示"该条目已锁定（锁定原因：xxx），确定要删除吗？"
- **AND** 用户确认后，系统 SHALL 调用 `presets_update` 将该条目从 blocks 列表中移除
- **AND** 删除后锁定条目区域 SHALL 实时更新

#### Scenario: 添加锁定条目

- **WHEN** 用户在预设编辑器中点击"添加条目"并设置 `isLocked=true`
- **THEN** 系统 SHALL 允许用户在条目编辑弹窗中勾选"锁定"并填写锁定原因
- **AND** 保存后该条目 SHALL 出现在锁定条目区域

#### Scenario: 删除互斥条目

- **WHEN** 用户在预设编辑器中对互斥组中的条目点击删除
- **THEN** 系统 SHALL 从该互斥组中移除该条目
- **AND** 若互斥组仅剩一个条目，系统 SHALL 显示提示"该互斥组仅剩一个条目，删除后互斥组将自动解散"
- **AND** 用户确认后执行删除

#### Scenario: 添加互斥条目

- **WHEN** 用户在互斥组区域点击"添加互斥条目"
- **THEN** 系统 SHALL 打开条目编辑弹窗，自动填充该互斥组的 `exclusiveGroupKey` 和 `exclusiveGroupLabel`
- **AND** 保存后该条目 SHALL 出现在对应互斥组中

#### Scenario: 添加自由条目

- **WHEN** 用户点击工具栏"添加新条目"按钮
- **THEN** 系统 SHALL 打开条目编辑弹窗，默认 `isLocked=false`、`exclusiveGroupKey` 为空
- **AND** 保存后该条目 SHALL 出现在自由条目区域

#### Scenario: 删除自由条目

- **WHEN** 用户对自由条目点击删除
- **THEN** 系统 SHALL 直接删除（无需额外确认，与当前行为一致）

---

## MODIFIED Requirements

### Requirement: MessageItem 消息渲染

`MessageItem` 组件 SHALL 从纯文本渲染改造为格式化富文本渲染，支持伪 XML 标签折叠、斜体灰色、青色引号、世界书关键词紫色标记和自定义格式规则。

### Requirement: AuroraBackground 组件

`AuroraBackground` 组件 SHALL 改造为支持动态角色卡背景的容器组件，在角色卡背景激活时降低极光透明度，在无角色卡背景时保持原始极光效果。

### Requirement: SettingsArea 界面外观区域

设置 > 界面外观 SHALL 在"动态特效"开关下方新增"消息格式化"配置区域，包含内置规则开关和自定义规则管理。

### Requirement: CompletionPresetArea 条目管理

预设编辑器 SHALL 增强条目删除能力：锁定条目和互斥条目支持删除（带确认），互斥组支持添加新条目，自由条目保持现有行为。

## REMOVED Requirements

无移除项。本阶段为纯增量扩展。

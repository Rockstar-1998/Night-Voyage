# Tasks

## 一、会话内容格式处理

- [x] Task 1: 创建消息格式化引擎核心模块 `src/lib/messageFormatter.ts`
  - [x] SubTask 1.1: 定义 `MessageFormatConfig`、`CustomFormatRule` 类型接口
  - [x] SubTask 1.2: 实现 `parseMessageContent(content, config, worldBookKeywords)` 函数，返回结构化节点数组（TextNode / TagNode / ItalicNode / QuoteNode / KeywordNode / CustomNode）
  - [x] SubTask 1.3: 实现伪 XML 标签解析：正则匹配 `<tagname>...</tagname>`，提取标签名和内部内容，支持嵌套检测（仅解析最外层）
  - [x] SubTask 1.4: 实现斜体灰色解析：匹配 `**text**`，生成 ItalicNode
  - [x] SubTask 1.5: 实现青色引号解析：匹配 `"text"` 和 `"text"`（中英文双引号），生成 QuoteNode
  - [x] SubTask 1.6: 实现世界书关键词解析：根据传入的 keywords 列表匹配文本，生成 KeywordNode
  - [x] SubTask 1.7: 实现自定义规则解析：遍历 customRules，按正则匹配生成 CustomNode
  - [x] SubTask 1.8: 实现解析优先级：伪 XML > 世界书关键词 > 斜体 > 青色引号 > 自定义规则，确保不嵌套冲突
  - [x] SubTask 1.9: 处理流式消息中的未闭合标签（未闭合的伪 XML 标签作为普通文本返回）

- [x] Task 2: 创建格式化节点渲染组件 `src/components/MessageFormatRenderer.tsx`
  - [x] SubTask 2.1: 创建 `FormatNodeRenderer` 组件，根据节点类型分发渲染
  - [x] SubTask 2.2: 创建 `CollapsibleTag` 组件：渲染伪 XML 标签为可折叠块，标题栏显示标签名，内容区支持展开/收起
  - [x] SubTask 2.3: 在 `CollapsibleTag` 中实现 Motion One 展开/收起动画（height 过渡 + opacity 淡入淡出，duration 300ms）
  - [x] SubTask 2.4: 渲染 ItalicNode 为斜体灰色文字
  - [x] SubTask 2.5: 渲染 QuoteNode 为青色文字（含双引号）
  - [x] SubTask 2.6: 渲染 KeywordNode 为紫色文字
  - [x] SubTask 2.7: 渲染 CustomNode 为用户自定义样式

- [x] Task 3: 改造 `MessageItem.tsx` 接入格式化引擎
  - [x] SubTask 3.1: 引入 `messageFormatter` 和 `MessageFormatRenderer`
  - [x] SubTask 3.2: 从 App 状态中获取当前会话关联的世界书关键词列表
  - [x] SubTask 3.3: 从 settings 中获取格式化配置
  - [x] SubTask 3.4: 将非流式消息的纯文本渲染替换为 `MessageFormatRenderer`
  - [x] SubTask 3.5: 将流式消息的逐字符渲染替换为格式化渲染（保持逐字符淡入动画 + 格式化）

- [x] Task 4: 实现格式化配置的持久化
  - [x] SubTask 4.1: 在 `backend.ts` 中添加 `messageFormatConfig` 的读写函数（使用 `settingsGet`/`settingsSet`）
  - [x] SubTask 4.2: 定义默认配置（所有内置规则启用，无自定义规则）

- [x] Task 5: 在设置 > 界面外观中添加"消息格式化"配置 UI
  - [x] SubTask 5.1: 在 `SettingsArea.tsx` 的 appearance 区域中新增"消息格式化"卡片
  - [x] SubTask 5.2: 添加四条内置规则开关（伪 XML 标签折叠、斜体灰色、青色引号、世界书关键词）
  - [x] SubTask 5.3: 添加自定义规则列表展示（名称、正则预览、颜色标记、编辑/删除按钮）
  - [x] SubTask 5.4: 实现"添加自定义规则"内联编辑表单（名称、正则、匹配组索引、颜色选择器、斜体开关、加粗开关）
  - [x] SubTask 5.5: 实现正则表达式实时校验，非法正则显示错误提示
  - [x] SubTask 5.6: 实现自定义规则的编辑和删除
  - [x] SubTask 5.7: 将配置变更实时保存到后端 settings

## 二、动态背景

- [x] Task 6: 改造 `AuroraBackground.tsx` 为支持动态背景的组件
  - [x] SubTask 6.1: 添加 props：`characterImageUrl?: string`、`isActive: boolean`
  - [x] SubTask 6.2: 在组件最底层添加角色卡背景层：`<img>` 元素 + `filter: blur(60px) saturate(1.2)` + 半透明玄青遮罩
  - [x] SubTask 6.3: 当 `isActive && characterImageUrl` 时，使用 Motion One 将角色卡背景 opacity 从 0 渐变到 1（800ms easeInOut）
  - [x] SubTask 6.4: 当角色卡背景激活时，将极光层 opacity 降低至 0.3
  - [x] SubTask 6.5: 当 `!isActive || !characterImageUrl` 时，角色卡背景 opacity 渐变回 0，极光层恢复原始 opacity
  - [x] SubTask 6.6: 实现切换不同角色卡图片时的交叉淡入淡出（两个 img 元素交替）

- [x] Task 7: 在 `App.tsx` 中连接动态背景状态
  - [x] SubTask 7.1: 创建 `activeCharacterImageUrl` 计算属性：当 `activeWorkspace === 'chat' && selectedConversationId` 时，从会话关联的角色卡中获取 `imagePath`
  - [x] SubTask 7.2: 创建 `isDynamicBgActive` 计算属性：仅当 `activeWorkspace === 'chat' && selectedConversationId != null` 时为 true
  - [x] SubTask 7.3: 将 `activeCharacterImageUrl` 和 `isDynamicBgActive` 传递给 `AuroraBackground` 组件

## 三、预设编辑器增强

- [x] Task 8: 增强预设编辑器条目删除能力
  - [x] SubTask 8.1: 在锁定条目区域为每个条目添加删除按钮（带确认对话框）
  - [x] SubTask 8.2: 确认对话框显示锁定原因，提示"该条目已锁定（锁定原因：xxx），确定要删除吗？"
  - [x] SubTask 8.3: 在互斥组区域为每个条目添加删除按钮
  - [x] SubTask 8.4: 互斥组仅剩一个条目时显示提示"删除后互斥组将自动解散"
  - [x] SubTask 8.5: 删除操作调用 `presets_update` 将目标条目从 blocks 列表中移除

- [x] Task 9: 增强预设编辑器条目添加能力
  - [x] SubTask 9.1: 在互斥组区域添加"添加互斥条目"按钮，点击后打开条目编辑弹窗并自动填充 `exclusiveGroupKey` 和 `exclusiveGroupLabel`
  - [x] SubTask 9.2: 确认条目编辑弹窗中的"锁定"选项可用（`isLocked` 勾选框 + 锁定原因输入框），保存后条目出现在对应区域
  - [x] SubTask 9.3: 验证现有"添加新条目"按钮创建的条目默认为自由条目（`isLocked=false`、`exclusiveGroupKey` 为空）

# Task Dependencies

- Task 2 depends on Task 1（渲染组件依赖格式化引擎的节点类型定义）
- Task 3 depends on Task 1, Task 2, Task 4（MessageItem 改造依赖引擎、渲染组件和配置持久化）
- Task 5 depends on Task 4（设置 UI 依赖配置持久化接口）
- Task 7 depends on Task 6（App 状态连接依赖动态背景组件改造）
- Task 8, Task 9 可并行执行，互不依赖
- Task 1, Task 6, Task 8/9 三条线可并行推进

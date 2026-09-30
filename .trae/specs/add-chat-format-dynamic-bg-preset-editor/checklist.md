# Checklist

## 会话内容格式处理

- [x] `messageFormatter.ts` 模块存在且导出 `parseMessageContent` 函数和所有节点类型
- [x] 伪 XML 标签 `<tagname>...</tagname>` 被解析为 TagNode，标签名正确提取
- [x] `**text**` 被解析为 ItalicNode
- [x] `"text"` 和 `"text"` 被解析为 QuoteNode
- [x] 世界书关键词被解析为 KeywordNode
- [x] 自定义正则规则被解析为 CustomNode
- [x] 解析优先级正确：伪 XML > 世界书关键词 > 斜体 > 青色引号 > 自定义规则
- [x] 流式消息中未闭合的伪 XML 标签显示为普通文本
- [x] `CollapsibleTag` 组件渲染伪 XML 标签为可折叠块，标题栏显示标签名
- [x] `CollapsibleTag` 展开/收起使用 Motion One 动画（height + opacity，300ms）
- [x] ItalicNode 渲染为斜体灰色文字
- [x] QuoteNode 渲染为青色文字（含双引号）
- [x] KeywordNode 渲染为紫色文字
- [x] `MessageItem.tsx` 非流式消息使用 `MessageFormatRenderer` 渲染
- [x] `MessageItem.tsx` 流式消息使用格式化渲染且保持逐字符淡入动画
- [x] 格式化配置通过 `settingsGet`/`settingsSet` 持久化，key 为 `messageFormatConfig`
- [x] 默认配置：所有内置规则启用，无自定义规则
- [x] 设置 > 界面外观中显示"消息格式化"卡片
- [x] 四条内置规则开关可切换且实时生效
- [x] 自定义规则列表正确展示（名称、正则预览、颜色标记、编辑/删除按钮）
- [x] 添加自定义规则表单包含：名称、正则、匹配组索引、颜色选择器、斜体/加粗开关
- [x] 非法正则表达式显示错误提示
- [x] 自定义规则编辑和删除功能正常

## 动态背景

- [x] `AuroraBackground` 组件接受 `characterImageUrl` 和 `isActive` props
- [x] 选择有角色卡图片的会话时，背景渐变为高斯模糊化的角色卡图片
- [x] 渐变使用 Motion One 动画，800ms easeInOut
- [x] 高斯模糊参数为 `blur(60px) saturate(1.2)`
- [x] 角色卡背景上叠加半透明玄青遮罩（`rgba(6, 12, 20, 0.6)`）
- [x] 选择无角色卡图片的会话时，背景渐变回玄青主题色
- [x] 切换到非会话工作区时，背景渐变回玄青主题色
- [x] 切换不同会话时，背景交叉淡入淡出，无闪烁
- [x] 角色卡背景激活时，极光层 opacity 降低至 0.3
- [x] 关闭动态特效时，角色卡背景仍然生效
- [x] `App.tsx` 正确计算 `activeCharacterImageUrl` 和 `isDynamicBgActive`

## 预设编辑器增强

- [x] 锁定条目区域每个条目有删除按钮
- [x] 删除锁定条目时显示确认对话框，包含锁定原因
- [x] 互斥组区域每个条目有删除按钮
- [x] 互斥组仅剩一个条目时显示解散提示
- [x] 互斥组区域有"添加互斥条目"按钮
- [x] 添加互斥条目时自动填充 `exclusiveGroupKey` 和 `exclusiveGroupLabel`
- [x] 条目编辑弹窗中"锁定"选项可用（勾选框 + 锁定原因输入框）
- [x] 添加锁定条目后出现在锁定条目区域
- [x] 现有"添加新条目"按钮创建的条目默认为自由条目

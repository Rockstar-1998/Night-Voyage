# Tasks

- [x] Task 1: 扩展 `MessageFormatConfig` 数据结构
  - [x] SubTask 1.1: 在 `src/lib/messageFormatter.ts` 中为 `builtinRules.pseudoXml` 添加 `defaultExpanded: boolean` 字段，默认 `true`
  - [x] SubTask 1.2: 更新 `DEFAULT_FORMAT_CONFIG` 中 `pseudoXml` 为 `{ enabled: true, defaultExpanded: true }`

- [x] Task 2: 改进 `CollapsibleTag` 组件视觉设计
  - [x] SubTask 2.1: 接收 `defaultExpanded` prop，初始化 `isExpanded` 信号为该值
  - [x] SubTask 2.2: 重新设计标题栏样式：半透明暗色背景 + 左侧竖线装饰 + 小号大写标签名
  - [x] SubTask 2.3: 移除内容区域的边框和背景，改为左侧缩进
  - [x] SubTask 2.4: 调整动画持续时间为 0.25 秒

- [x] Task 3: 传递 `defaultExpanded` 配置到渲染组件
  - [x] SubTask 3.1: `MessageFormatRenderer` 接收 `defaultExpanded` prop
  - [x] SubTask 3.2: `renderNode` 中将 `defaultExpanded` 传递给 `CollapsibleTag`
  - [x] SubTask 3.3: `MessageItem` 从 `formatConfig.builtinRules.pseudoXml.defaultExpanded` 读取并传递
  - [x] SubTask 3.4: 在 `App.tsx` 中加载设置时处理缺少 `defaultExpanded` 字段的旧配置（回退为 `true`）

- [x] Task 4: 在设置 UI 中添加"标签默认展开"开关
  - [x] SubTask 4.1: 在"伪 XML 标签折叠"开关下方添加"标签默认展开"开关
  - [x] SubTask 4.2: 该开关仅在"伪 XML 标签折叠"启用时可见
  - [x] SubTask 4.3: 切换开关时更新 `formatConfig.builtinRules.pseudoXml.defaultExpanded`

# Task Dependencies

- Task 2 依赖 Task 1（需要 `defaultExpanded` 字段）
- Task 3 依赖 Task 1, Task 2
- Task 4 依赖 Task 1

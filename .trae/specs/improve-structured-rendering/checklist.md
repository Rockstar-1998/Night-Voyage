# Checklist

## 数据结构扩展

- [x] `MessageFormatConfig.builtinRules.pseudoXml` 包含 `defaultExpanded: boolean` 字段
- [x] `DEFAULT_FORMAT_CONFIG` 中 `pseudoXml` 为 `{ enabled: true, defaultExpanded: true }`
- [x] 旧配置缺少 `defaultExpanded` 时回退为 `true`

## 视觉设计改进

- [x] 标题栏使用半透明暗色背景（`bg-white/[0.04]`）
- [x] 标题栏左侧有竖线装饰（`border-l-2 border-accent/40`）
- [x] 标签名使用小号大写字母（`text-[11px] uppercase tracking-wider`）
- [x] 标签名颜色为 `text-accent/70`
- [x] 内容区域无边框无背景，仅左侧缩进
- [x] 悬停效果为 `hover:bg-white/[0.07]`
- [x] 展开/折叠动画持续 0.25 秒

## 默认展开行为

- [x] `defaultExpanded=true` 时标签初始展开
- [x] `defaultExpanded=false` 时标签初始折叠
- [x] 点击标题栏可切换展开/折叠状态

## 设置 UI

- [x] "标签默认展开"开关在"伪 XML 标签折叠"开关下方
- [x] 开关仅在"伪 XML 标签折叠"启用时可见
- [x] 切换开关时正确更新 `formatConfig`

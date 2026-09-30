# Tasks

- [x] Task 1: 扩展数据模型和序列化逻辑
  - [x] SubTask 1.1: 在 `SchemaKeyConfig` 接口中新增 `hideLabel: boolean` 字段，默认值为 `false`
  - [x] SubTask 1.2: 修改 `serializeDisplayConfig`，输出格式增加 `hideLabel` 字段
  - [x] SubTask 1.3: 修改 `parseJsonSchema`，解析 `displayConfig` 中的 `hideLabel` 字段
  - [x] SubTask 1.4: 修改 `EMPTY_KEY` 常量，添加 `hideLabel: false`
- [x] Task 2: SchemaConfigPanel UI 新增"隐藏标签"复选框
  - [x] SubTask 2.1: 在"上下文包含"、"默认展开"、"必填"复选框旁边新增"隐藏标签"复选框
  - [x] SubTask 2.2: 勾选"隐藏标签"时，自动将 `defaultExpanded` 设为 `true` 并禁用"默认展开"复选框
  - [x] SubTask 2.3: 取消勾选"隐藏标签"时，恢复"默认展开"复选框的可编辑状态
- [x] Task 3: StructuredResponseRenderer 支持隐藏标签渲染
  - [x] SubTask 3.1: 扩展 `displayConfig` 类型定义，增加 `hideLabel?: boolean`
  - [x] SubTask 3.2: 在 `StructuredResponseRenderer` 中，当字段的 `hideLabel` 为 `true` 时，直接渲染内容而不包裹 `CollapsibleTag`
- [x] Task 4: 构建验证
  - [x] SubTask 4.1: 运行项目构建，确保无编译错误

# Task Dependencies

- Task 2 依赖于 Task 1（数据模型先就绪）
- Task 3 依赖于 Task 1（序列化格式先确定）
- Task 4 依赖于 Task 1、2、3

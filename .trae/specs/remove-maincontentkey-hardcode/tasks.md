# Tasks

- [x] Task 1: 删除 `mainContentKey` 字段和赋值逻辑
  - [x] SubTask 1.1: 在 `messageFormatter.ts` 中，从 `StructuredResponseNode` 接口删除 `mainContentKey` 字段
  - [x] SubTask 1.2: 在 `messageFormatter.ts` 的 `parseStructuredResponse` 函数中，删除 `mainContentKey` 赋值逻辑和返回值
  - [x] SubTask 1.3: 在 `MessageItem.tsx` 的 `structuredResponse` memo 中，删除 `mainContentKey` 赋值逻辑
- [x] Task 2: 删除 `StructuredResponseRenderer` 的 `mainContentKey` prop 和相关渲染逻辑
  - [x] SubTask 2.1: 从 `StructuredResponseRenderer` 的 props 中删除 `mainContentKey`
  - [x] SubTask 2.2: 简化渲染条件：`!isHidden()` 和 `isHidden()`
  - [x] SubTask 2.3: 删除 `renderNode` 中传递 `mainContentKey` 的代码
- [x] Task 3: 构建验证
  - [x] SubTask 3.1: 运行项目构建，确保无编译错误

# Task Dependencies

- Task 2 依赖于 Task 1（先删除数据模型中的字段）
- Task 3 依赖于 Task 1 和 Task 2

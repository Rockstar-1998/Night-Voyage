# Tasks

- [x] Task 1: 修改 `structuredResponse` memo，使其同时处理流式和静态数据来源
  - [x] SubTask 1.1: 当 `streamingStructuredMode()` 为 true 时，将 `message.structuredFields` 转换为 `StructuredResponseNode` 格式（字符串字段 → `kind: 'string'`，JSON 对象字段 → `kind: 'object'`），设置 `mainContentKey` 和 `displayConfig`
  - [x] SubTask 1.2: 当 `streamingStructuredMode()` 为 false 时，保持现有 `parseStructuredResponse` 逻辑不变
  - [x] SubTask 1.3: 确保 `structuredFields` 的增量更新能触发 memo 重新计算，使 `StreamingText` 的逐字动画正常工作
- [x] Task 2: 删除流式路径的独立渲染代码
  - [x] SubTask 2.1: 删除 `StreamingFieldTag` 组件
  - [x] SubTask 2.2: 删除 `streamingObjectFields`、`streamingStringAuxFieldKeys`、`streamingContentText` 三个 memo
  - [x] SubTask 2.3: 删除 `MessageItem` 模板中 `streamingStructuredMode()` 分支的整个渲染块，统一走 `structuredResponse()` 分支
  - [x] SubTask 2.4: 删除 `userToggleState`（`MessageItem.tsx` 中的那个，`MessageFormatRenderer.tsx` 中的保留）
  - [x] SubTask 2.5: 清理不再使用的 import（`Index`、`For`、`animate`）
- [x] Task 3: 统一渲染路径并保留流式动画
  - [x] SubTask 3.1: 确保统一后的渲染路径正确传递 `isStreaming` 属性给 `MessageFormatRenderer`
  - [x] SubTask 3.2: 确保光标闪烁动画（`animate-pulse` 竖线）在流式状态下正常显示
  - [x] SubTask 3.3: 确保流式传输完毕后 `clearStreamingRenderCache` 仍然被调用
- [x] Task 4: 构建验证
  - [x] SubTask 4.1: 运行项目构建，确保无编译错误

# Task Dependencies

- Task 2 依赖于 Task 1（先建后拆，确保新路径可用再删旧代码）
- Task 3 依赖于 Task 1 和 Task 2
- Task 4 依赖于 Task 1、2、3

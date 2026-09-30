# Tasks

- [x] Task 1: 修改联机会话房间详情的展开/收起为 CSS grid 动画
  - [x] SubTask 1.1: 将 `<Show when={...}>` 替换为始终渲染的 `<div>`，使用 `grid grid-rows-[0fr]/[1fr]` + `opacity-0/100` + `transition-all duration-300 ease-in-out` 控制展开/收起动画
  - [x] SubTask 1.2: 内部内容包裹在 `<div class="overflow-hidden">` 中（与世界书条目结构一致）
- [x] Task 2: 构建验证
  - [x] SubTask 2.1: 运行项目构建，确保无编译错误

# Task Dependencies

- Task 2 依赖于 Task 1

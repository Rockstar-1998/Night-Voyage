# Tasks

- [x] Task 1: 修复 NewChatModal API 档案下拉框
  - [x] 1.1: 在 `src/components/NewChatModal.tsx` 的 API 档案 `Select` 组件中，将选项列表从 `[{ label: "请选择 API 档案", value: "" }]` 改为包含 `props.providers` 的映射
  - [x] 1.2: 验证 `Select` 组件的 `options` 格式与 `props.providers` 数据结构匹配

- [x] Task 2: 修复 RightDrawer 预设绑定 Select onChange
  - [x] 2.1: 在 `src/components/RightDrawer.tsx` 中，将预设绑定 `Select` 的 `onChange` 从 `(val) => setBindingPresetId(event.currentTarget.value)` 改为 `(val) => setBindingPresetId(val)`
  - [x] 2.2: 检查世界书绑定 `Select` 是否有同样的 bug（`setBindingWorldBookId(event.currentTarget.value)` → `setBindingWorldBookId(val)`）

# Task Dependencies
- Task 1 和 Task 2 互相独立，可并行执行

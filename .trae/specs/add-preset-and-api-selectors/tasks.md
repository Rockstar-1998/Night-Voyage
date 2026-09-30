# Tasks

- [x] Task 1: NewChatModal 新增预设选择器
  - [x] SubTask 1.1: 在 props 中新增 `presetSummaries` 属性
  - [x] SubTask 1.2: 新增 `selectedPresetId` signal
  - [x] SubTask 1.3: 将预设占位提示替换为预设选择器 `<Select>`
  - [x] SubTask 1.4: 在 payload 中传入 `presetId: selectedPresetId()`
  - [x] SubTask 1.5: 删除两处预设占位提示
  - [x] SubTask 1.6: 在 App.tsx 传入 `presetSummaries` prop
- [x] Task 2: RightDrawer 新增 API 档案选择器
  - [x] SubTask 2.1: 在 props 中新增 `providers` 和 `selectedProviderId`
  - [x] SubTask 2.2: 新增 `bindingProviderId` signal
  - [x] SubTask 2.3: 新增 API 档案选择器 `<Select>`
  - [x] SubTask 2.4: 显示当前绑定的 API 档案名称
  - [x] SubTask 2.5: 在 `handleSaveBindings` 中传入 `providerId`
  - [x] SubTask 2.6: 在 App.tsx 传入 `providers` 和 `selectedProviderId` props
- [x] Task 3: 构建验证
  - [x] SubTask 3.1: `npx tsc --noEmit` 相关文件无新增类型错误

# Task Dependencies

- Task 1 和 Task 2 可并行
- Task 3 依赖于 Task 1 和 Task 2

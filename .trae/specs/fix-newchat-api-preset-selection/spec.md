# 修复新建会话 API 选择与预设绑定问题 Spec

## Why
用户在新建会话流程中遇到两个阻塞性问题：
1. **API 档案下拉框为空**：Step 2 的 "API 档案" Select 组件只渲染了占位选项 "请选择 API 档案"，没有将 `props.providers` 传入选项列表，导致用户无法选择 API。
2. **预设选择无响应**：右侧抽屉（RightDrawer）的预设绑定 Select 组件 `onChange` 使用了 `event.currentTarget.value` 而不是传入的 `val` 参数，导致选择预设后状态不更新；且 NewChatModal 的预设系统提示"本轮尚未接后端"，但用户截图显示预设列表已渲染且可点击。

## What Changes
- **修复 API 档案下拉框**：在 `NewChatModal.tsx` 的 API 档案 `Select` 组件中，将 `props.providers` 映射为选项列表。
- **修复预设绑定 Select onChange**：在 `RightDrawer.tsx` 中，将 `setBindingPresetId(event.currentTarget.value)` 改为 `setBindingPresetId(val)`。

## Impact
- Affected code:
  - `src/components/NewChatModal.tsx` — API 档案 Select 选项列表
  - `src/components/RightDrawer.tsx` — 预设绑定 Select onChange 回调

## MODIFIED Requirements

### Requirement: 新建会话时可以选择 API 档案
系统 SHALL 在 `NewChatModal` Step 2 的 API 档案下拉框中展示所有可用的 API Provider 档案。

#### Scenario: 用户打开新建会话 Step 2
- **WHEN** 用户进入 Step 2 且 `props.providers` 非空
- **THEN** API 档案下拉框展示所有 provider 名称
- **AND** 默认选中第一个 provider（由现有的 `createEffect` 自动设置）

#### Scenario: 没有 API 档案
- **WHEN** `props.providers` 为空数组
- **THEN** 下拉框只显示 "请先在设置中创建 API 档案"
- **AND** `conversationConfigError` 返回相应错误提示

### Requirement: 右侧抽屉可以切换预设绑定
系统 SHALL 在 `RightDrawer` 的预设绑定 Select 中，选择预设后正确更新 `bindingPresetId` 状态。

#### Scenario: 用户在下拉框中选择预设
- **WHEN** 用户在预设绑定 Select 中选择一个预设
- **THEN** `bindingPresetId` 更新为所选预设的 ID
- **AND** 点击保存后正确传递 `presetId` 到后端

#### Scenario: 用户选择"保持当前预设"
- **WHEN** 用户选择 "保持当前预设"（value=""）
- **THEN** `bindingPresetId` 设为空字符串
- **AND** 保存时只传递 `worldBookId`（如果有）

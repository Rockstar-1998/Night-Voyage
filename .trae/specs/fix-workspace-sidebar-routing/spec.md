# 修复 WorkspaceSidebar 路由 ID 不匹配 Spec

## Why
用户点击左侧导航栏的"角色展示柜"和"对话补全预设"图标后没有任何反应。经代码审查发现，`WorkspaceSidebar.tsx` 中定义的 workspace ID 与 `App.tsx` 中 `DESKTOP_WORKSPACE_IDS` 和 `DesktopView` switch-case 中使用的 ID 不一致，导致路由匹配失败。

## What Changes
- **修复 WorkspaceSidebar 的 workspace ID**：将 `'characters'` 改为 `'character'`，将 `'workspaces'` 改为 `'workspace'`，与 `App.tsx` 中的定义保持一致。

## Impact
- Affected code:
  - `src/components/WorkspaceSidebar.tsx` — 导航图标 ID

## MODIFIED Requirements

### Requirement: 左侧导航栏可以正确切换工作区
系统 SHALL 在点击左侧导航栏图标时，使用与 `App.tsx` 一致的 workspace ID，确保路由正确匹配。

#### Scenario: 用户点击"角色展示柜"
- **WHEN** 用户点击左侧导航栏的"角色展示柜"图标
- **THEN** `activeWorkspace` 变为 `'character'`
- **AND** `DesktopView` 渲染 `CharacterSidebar`

#### Scenario: 用户点击"对话补全预设"
- **WHEN** 用户点击左侧导航栏的"对话补全预设"图标
- **THEN** `activeWorkspace` 变为 `'workspace'`
- **AND** `DesktopView` 渲染 `CompletionPresetArea`

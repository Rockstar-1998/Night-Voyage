# 新建会话选择预设 + 侧边栏更改 API Spec

## Why

新建会话时无法选择对话预设，只能使用默认配置。同时"层状态与剧情总结"侧边栏无法更改 API 档案，用户必须回到设置中切换。两者均已有后端支持（`CreateConversationPayload.presetId` 和 `UpdateConversationBindingsPayload.providerId`），只需补齐前端 UI 入口。

## What Changes

- 在 `NewChatModal` 的 Step 2 中，将预设占位提示替换为真实的预设选择器
- 在 `RightDrawer` 的"会话绑定"区域中，新增 API 档案选择器
- 删除 `NewChatModal` 中的预设占位提示文字

## Impact

- Affected code:
  - `src/components/NewChatModal.tsx` — 新增预设选择器，删除占位提示
  - `src/components/RightDrawer.tsx` — 新增 API 档案选择器

## ADDED Requirements

### Requirement: 新建会话时选择预设

The system SHALL 在新建会话的 Step 2 中提供预设选择器。

#### Scenario: 选择预设
- **WHEN** 用户在新建会话的 Step 2 中
- **THEN** 可看到预设选择器，列出所有可用预设
- **THEN** 预设为可选项，默认不选择

#### Scenario: 不选择预设
- **WHEN** 用户不选择预设直接创建会话
- **THEN** 会话不绑定预设，使用默认配置

### Requirement: 侧边栏更改 API 档案

The system SHALL 在"层状态与剧情总结"侧边栏的"会话绑定"区域中提供 API 档案选择器。

#### Scenario: 更改 API 档案
- **WHEN** 用户在侧边栏中选择新的 API 档案并保存
- **THEN** 会话的 `providerId` 更新为所选 API 档案

#### Scenario: 显示当前 API 档案
- **WHEN** 侧边栏打开时
- **THEN** 显示当前会话绑定的 API 档案名称

## MODIFIED Requirements

无修改需求。

## REMOVED Requirements

### Requirement: 预设占位提示
**Reason**: 预设选择器已实现，占位提示不再需要。
**Migration**: 无需迁移。

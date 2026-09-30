# 移动端设置功能实现 Spec

## Why

移动端目前仅显示"设置功能正在开发中"的占位页面，用户无法在手机上进行 API 配置和界面外观设置。为了提升移动端可用性，需要实现完整的设置功能。

## What Changes

- 在移动端实现设置页面，包含两个分类：API 配置、界面外观
- API 配置：查看/添加/编辑/删除 API 提供商，拉取模型列表，Claude 原生测试
- 界面外观：动态特效开关，消息格式化规则，自定义正则高亮
- 复用桌面版 `SettingsArea` 的核心逻辑，但使用适合移动端的布局

## Impact

- Affected specs: 移动端导航、设置功能
- Affected code: `src/components/MobileView.tsx`, `src/components/SettingsArea.tsx`, 新增 `src/components/MobileSettingsArea.tsx`

## ADDED Requirements

### Requirement: 移动端设置页面

The system SHALL provide a mobile-friendly settings page accessible from the bottom navigation bar or header settings button.

#### Scenario: 打开设置页面
- **WHEN** 用户点击右上角设置按钮
- **THEN** 显示设置页面，包含 API 配置和界面外观两个分类

#### Scenario: API 配置
- **WHEN** 用户进入 API 配置分类
- **THEN** 可以查看现有 API 提供商列表
- **AND** 可以添加新的 API 提供商
- **AND** 可以编辑现有 API 提供商
- **AND** 可以删除 API 提供商
- **AND** 可以拉取模型列表
- **AND** 如果是 Anthropic 提供商，可以进行 Claude 原生测试

#### Scenario: 界面外观
- **WHEN** 用户进入界面外观分类
- **THEN** 可以开关动态特效
- **AND** 可以配置消息格式化规则
- **AND** 可以添加/编辑/删除自定义正则高亮规则

## MODIFIED Requirements

### Requirement: 移动端工作区切换

[Complete modified requirement]

## REMOVED Requirements

### Requirement: 设置占位页面
**Reason**: 已实现完整设置功能
**Migration**: 移除 MobileView.tsx 中的 settings 占位视图

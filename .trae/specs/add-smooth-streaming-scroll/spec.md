# 流式传输平滑滚动 Spec

## Why

流式传输时，`scrollToBottom` 通过直接赋值 `scrollTop = scrollHeight` 实现自动滚动，导致每次内容更新时页面瞬间跳转，视觉上非常生硬。应改为平滑滚动，使流式传输体验更自然。

## What Changes

- 修改 `ChatArea.tsx` 中的 `scrollToBottom` 函数，将直接赋值 `scrollTop` 改为使用 `scrollTo({ top, behavior: 'smooth' })` 实现平滑滚动

## Impact

- Affected code:
  - `src/components/ChatArea.tsx` — `scrollToBottom` 函数

## ADDED Requirements

### Requirement: 流式传输平滑自动滚动

The system SHALL 在流式传输期间自动滚动时使用平滑滚动效果。

#### Scenario: 流式内容更新触发自动滚动
- **WHEN** 流式传输中内容更新触发自动滚动
- **THEN** 滚动使用 `smooth` 行为，视觉上平滑过渡到最新内容

#### Scenario: 用户发送新消息触发滚动
- **WHEN** 用户发送新消息，消息列表滚动到底部
- **THEN** 滚动使用 `smooth` 行为

#### Scenario: 用户点击"跟进最新内容"按钮
- **WHEN** 用户点击"跟进最新内容"按钮
- **THEN** 滚动使用 `smooth` 行为

## MODIFIED Requirements

无修改需求。

## REMOVED Requirements

无移除需求。

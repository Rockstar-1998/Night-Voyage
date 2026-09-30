# 会话标签展开收起动画 Spec

## Why

会话标签（联机会话的房间详情）展开/收起时使用 `<Show>` 直接切换，没有过渡动画，视觉上非常生硬。应参考世界书条目的展开/收起动画实现，使用 CSS grid 动画实现平滑过渡。

## What Changes

- 修改 `SessionSidebar.tsx` 中联机会话房间详情的展开/收起，从 `<Show>` 直接切换改为使用 CSS grid `grid-rows-[0fr]/[1fr]` + opacity 动画

## Impact

- Affected code:
  - `src/components/SessionSidebar.tsx` — 联机会话房间详情区域

## ADDED Requirements

### Requirement: 会话标签展开收起动画

The system SHALL 在联机会话的房间详情展开/收起时使用平滑过渡动画。

#### Scenario: 展开房间详情
- **WHEN** 用户点击联机会话的房间详情按钮
- **THEN** 房间详情区域从 `grid-rows-[0fr] opacity-0` 平滑过渡到 `grid-rows-[1fr] opacity-100`

#### Scenario: 收起房间详情
- **WHEN** 用户再次点击房间详情按钮收起
- **THEN** 房间详情区域从 `grid-rows-[1fr] opacity-100` 平滑过渡到 `grid-rows-[0fr] opacity-0`

#### Scenario: 动画参数
- **THEN** 过渡使用 `transition-all duration-300 ease-in-out`，与世界书条目动画一致

## MODIFIED Requirements

无修改需求。

## REMOVED Requirements

无移除需求。

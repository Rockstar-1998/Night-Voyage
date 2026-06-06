# MobileView 底部导航栏布局修复 - Handoff

## 背景

用户要求将手机版左侧抽屉导航改为：
- 右上角设置按钮（齿轮图标）
- 底部常驻任务栏（4个按钮：对话、角色、工作台、世界书）

## 已完成工作

1. **移除了左侧抽屉** (`WorkspaceSidebar` 抽屉)
2. **添加了右上角设置按钮** - 点击切换到 `settings` 视图
3. **添加了底部 `<nav>` 任务栏** - 包含4个导航按钮
4. **实现了工作区切换逻辑** - `handleWorkspaceChange` 函数

## 当前问题

**底部任务栏位置不正确** - 任务栏出现在内容区域中间，而不是固定在底部。

### 截图证据
- 任务栏显示在会话列表下方，底部有大量空白区域
- 切换到角色/工作台/世界书视图时，任务栏也出现在内容中间

### 当前代码结构 (MobileView.tsx)

```
<div class="h-full w-full bg-xuanqing flex flex-col relative overflow-hidden">
  <header class="h-14 shrink-0">...</header>  <!-- 顶部标题栏 -->
  
  <main class="flex-1 flex flex-col overflow-hidden">
    <div class="flex-1 overflow-y-auto">       <!-- 滚动容器 -->
      <!-- 各视图内容 (sessions/chat/characters/kb/workspaces/settings) -->
      <!-- 所有视图都包裹在 min-h-full 的 div 中 -->
    </div>
  </main>
  
  <nav class="shrink-0 h-16">...</nav>         <!-- 底部任务栏 -->
</div>
```

### 已尝试的修复

1. 将 `main` 改为 `flex flex-col overflow-hidden`
2. 内部添加 `flex-1 overflow-y-auto` 滚动容器
3. 内容区域使用 `min-h-full` 确保撑满高度
4. 底部 `nav` 使用 `shrink-0` 防止被压缩

**以上修复均未解决问题。**

## 可能的原因

1. **父容器高度问题**：`App.tsx` 中 `MobileView` 的父容器可能没有正确设置高度
2. **flex 布局嵌套问题**：多层 flex 嵌套导致高度计算异常
3. **SessionSidebar 高度问题**：`SessionSidebar` 组件设置了固定宽度 `w-80`，可能影响 flex 高度计算
4. **浏览器开发者工具模拟问题**：iPhone 模拟器可能有特殊的视口高度计算

## 需要检查的文件

- `src/components/MobileView.tsx` - 当前修改的文件
- `src/App.tsx` - 检查 MobileView 的父容器布局
- `src/components/SessionSidebar.tsx` - 检查高度设置

## 建议的修复方向

1. 检查 `App.tsx` 中 `isMobile()` 条件渲染的父容器是否有 `h-full` 或 `h-screen`
2. 尝试将 `main` 的 `overflow-hidden` 移除，改为 `overflow-visible`
3. 尝试使用 `h-[calc(100vh-3.5rem-4rem)]` 显式设置内容区域高度（减去 header 和 nav 高度）
4. 检查是否有 CSS 全局样式影响了 flex 布局

## 相关提交

- 修改了 `src/components/MobileView.tsx`
- 修改了 `src/components/WorkspaceSidebar.tsx`（修复了 id 不匹配问题）

## Codex 修复记录

- 底部任务栏位置：`MobileView` 根容器改为 `h-[100dvh] max-h-[100dvh] min-h-0`，中间内容区添加 `min-h-0`，避免移动端父级高度不明确导致 nav 跟随内容流。
- 会话界面宽度：`SessionSidebar` 增加 `layout?: 'sidebar' | 'mobile'`，默认桌面侧栏保持 `w-80 border-r`；`MobileView` 传入 `layout="mobile"` 后改为 `w-full border-r-0`，避免移动端仍按桌面侧栏宽度渲染。

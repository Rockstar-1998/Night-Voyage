# Tasks

- [x] Task 1: 创建 MobileSettingsArea 组件基础结构: 创建移动端设置页面组件，包含分类导航（API 配置、界面外观）和内容区域。
  - [x] SubTask 1.1: 定义 MobileSettingsAreaProps 接口，继承 SettingsAreaProps 的核心字段
  - [x] SubTask 1.2: 实现分类切换逻辑（类似 SettingsSidebar 的移动端版本）
  - [x] SubTask 1.3: 创建移动端布局框架（顶部分类标签 + 下方内容区域）
- [x] Task 2: 实现 API 配置移动端界面: 将桌面版 API 配置功能适配到移动端布局。
  - [x] SubTask 2.1: 提供商列表展示（卡片式布局，适合窄屏）
  - [x] SubTask 2.2: 添加/编辑提供商表单（全屏弹窗或展开式表单）
  - [x] SubTask 2.3: 删除提供商确认对话框
  - [x] SubTask 2.4: 拉取模型列表按钮及结果展示
  - [x] SubTask 2.5: Claude 原生测试界面（针对 Anthropic 提供商）
- [x] Task 3: 实现界面外观移动端界面: 将桌面版界面外观功能适配到移动端布局。
  - [x] SubTask 3.1: 动态特效开关（Toggle 组件）
  - [x] SubTask 3.2: 消息格式化规则配置（简化版布局）
  - [x] SubTask 3.3: 自定义正则高亮规则列表（卡片式）
  - [x] SubTask 3.4: 添加/编辑正则规则弹窗
- [x] Task 4: 集成到 MobileView: 将 MobileSettingsArea 集成到 MobileView 中，替换现有的占位视图。
  - [x] SubTask 4.1: 在 MobileView 中导入 MobileSettingsArea
  - [x] SubTask 4.2: 传递必要的 props（providers、onSaveProvider 等）
  - [x] SubTask 4.3: 移除 settings 占位视图代码
  - [x] SubTask 4.4: 验证设置页面可以从右上角按钮和底部导航正确进入
- [x] Task 5: 验证与测试: 确保移动端设置功能与桌面版功能等价。
  - [x] SubTask 5.1: 测试 API 提供商 CRUD 操作
  - [x] SubTask 5.2: 测试 Claude 原生测试功能
  - [x] SubTask 5.3: 测试界面外观设置（动态特效、格式化规则、正则高亮）
  - [x] SubTask 5.4: 测试设置变更后回到聊天页面的状态保持

# Task Dependencies

- Task 2 depends on Task 1
- Task 3 depends on Task 1
- Task 4 depends on Task 2 and Task 3
- Task 5 depends on Task 4

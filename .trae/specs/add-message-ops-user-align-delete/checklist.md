# Checklist

## 后端新增命令

- [x] `messages_update_content` Tauri 命令存在且可更新消息内容
- [x] 更新消息时同步更新 `message_content_parts` 可见文本
- [x] `messages_switch_swipe` Tauri 命令存在且可切换 swipe 版本
- [x] 切换 swipe 时正确更新 `message_rounds.active_assistant_message_id`
- [x] `conversations_fork` Tauri 命令存在且可创建分支会话
- [x] 分支会话复制了原会话的绑定信息
- [x] 分支会话包含从开始到目标消息的所有历史
- [x] 分支会话标题为 `原标题 (分支)`
- [x] 单人模式下 `build_aggregated_user_content` 不添加玩家名前缀
- [x] 联机模式下 `build_aggregated_user_content` 保持现有行为
- [x] `conversations_delete` 级联删除所有关联数据

## 前端消息操作

- [x] `backend.ts` 封装了 `messagesUpdateContent`、`messagesSwitchSwipe`、`conversationsFork` 函数
- [x] 用户消息右对齐（头像在右，内容靠右）
- [x] AI 消息保持左对齐
- [x] 用户消息 hover 时显示编辑和分支按钮
- [x] AI 消息 hover 时显示编辑、重新回复和分支按钮
- [x] 编辑模式：内容区变为 textarea，有保存/取消按钮
- [x] 编辑保存后调用后端命令更新消息
- [x] AI 消息存在多个 swipe 版本时显示版本切换器 `◀ 版本 N/M ▶`
- [x] 版本切换器可切换到相邻版本
- [x] 流式消息不显示操作按钮
- [x] ChatArea 正确计算并传递 swipeInfo
- [x] App.tsx 实现了 handleEditMessage、handleForkMessage、handleSwitchSwipe

## 删除 AI 帮助按钮

- [x] ChatInputBar 中无 AI 帮助按钮
- [x] `onAiHelp` prop 和 `BrainCircuit` 导入已移除

## 会话删除

- [x] 会话列表中每个会话有删除按钮
- [x] 删除前显示确认对话框
- [x] 删除当前选中会话后清空消息列表
- [x] 删除后刷新会话列表

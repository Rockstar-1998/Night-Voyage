# Checklist

- [x] 新建会话表单中没有"房主显示名"输入框
- [x] 新建会话表单中有玩家角色卡选择器
- [x] 未选择玩家角色卡时创建按钮被禁用
- [x] 创建会话时 `hostPlayerCharacterId` 被正确传递
- [x] 创建会话时 `host_display_name` 自动从玩家角色卡 `name` 获取
- [x] 后端 `conversations_create` 接受 `host_player_character_id` 为必填参数
- [x] 后端自动从角色卡表查询 `name` 填充 `display_name`
- [x] AI 消息头像显示 AI 角色卡的 `imagePath`（有图片时）
- [x] AI 消息昵称显示 AI 角色卡的 `name`
- [x] AI 角色卡无头像时显示 `name` 首字符
- [x] 玩家消息头像显示玩家角色卡的 `imagePath`（有图片时）
- [x] 玩家消息昵称显示玩家角色卡的 `name`
- [x] 玩家角色卡无头像时显示 `name` 首字符
- [x] 不再有硬编码的 `"CHAT A.I+"` 或 `"U"/"AI"` 占位符
- [x] 会话中可切换玩家角色卡
- [x] 切换玩家角色卡后 `conversation_members.player_character_id` 和 `display_name` 被更新
- [x] 切换玩家角色卡后新消息使用新的头像和昵称

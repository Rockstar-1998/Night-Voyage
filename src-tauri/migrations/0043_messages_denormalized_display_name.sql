-- 去规范化用户消息的展示名，使历史消息在成员记录被删除（房客离开）后仍
-- 能稳定显示发送者真实名字，而非退化成「玩家」。
-- 参见 AGENTS.md C2（零静默回退）：渲染端不再依赖 conversation_members 表存在与否。

-- 1. 新增列（允许为空，兼容旧数据）
ALTER TABLE messages ADD COLUMN display_name TEXT;

-- 2. 回填历史：仅对仍能在 conversation_members 中找到对应成员的用户消息，
--    写入其真实 display_name。已删除成员的旧消息保持 NULL，新发消息均自包含。
UPDATE messages
SET display_name = (
    SELECT cm.display_name
    FROM conversation_members cm
    WHERE cm.id = messages.member_id
)
WHERE messages.role = 'user'
  AND messages.member_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM conversation_members cm WHERE cm.id = messages.member_id
  );

-- 房客携带人设卡加入房间：在 conversation_members 表存储房客的角色卡 JSON 数据
-- 房主的角色卡通过 player_character_id 关联 character_cards 表，房客的卡以 JSON 内联方式存储
ALTER TABLE conversation_members ADD COLUMN guest_character_json TEXT;

-- 房主房间端口持久化：支持创建房间后更改房间设置（端口）。
-- 新建房间时写入 stored_port（= host_port 初始值），房主后续可改端口。
-- 旧房间（migration 前）stored_port 为 NULL，UI 按 host_port 兜底展示。
ALTER TABLE rooms ADD COLUMN stored_port INTEGER;

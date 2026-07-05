-- API 档案用途分离迁移
-- purpose: 'llm' = 聊天/补全用档案; 'embedding' = 向量嵌入专用档案
-- 现有档案默认标记为 'llm'（聊天档案），embedding 档案需用户手动新建
-- conversations.embedding_provider_id: MEM0 模式下会话绑定的 embedding 档案 id

-- api_providers: 新增 purpose 字段
ALTER TABLE api_providers ADD COLUMN purpose TEXT NOT NULL DEFAULT 'llm';

-- conversations: 新增 embedding_provider_id（可空，仅 MEM0 模式使用）
ALTER TABLE conversations ADD COLUMN embedding_provider_id INTEGER;

-- 索引：按用途过滤 provider 列表
CREATE INDEX IF NOT EXISTS idx_api_providers_purpose ON api_providers(purpose);

-- 索引：按 embedding_provider_id 查找会话
CREATE INDEX IF NOT EXISTS idx_conversations_embedding_provider_id ON conversations(embedding_provider_id);

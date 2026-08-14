-- 方案 C：清理已存在的悬空 api_providers 引用。
-- 历史原因：providers_delete 未级联清理引用，删除 provider 后
-- conversations / character_cards 仍指向已不存在的 id（违反"无效状态不可表达"）。
-- 本迁移一次性修复存量数据；后续删除由 providers_delete 的事务级联保证（见 providers.rs）。

-- conversations.provider_id
UPDATE conversations
  SET provider_id = NULL
  WHERE provider_id IS NOT NULL
    AND provider_id NOT IN (SELECT id FROM api_providers);

-- conversations.embedding_provider_id（仅 MEM0 模式使用，非 mem0 下应为 NULL）
UPDATE conversations
  SET embedding_provider_id = NULL
  WHERE embedding_provider_id IS NOT NULL
    AND embedding_provider_id NOT IN (SELECT id FROM api_providers);

-- character_cards.default_provider_id
UPDATE character_cards
  SET default_provider_id = NULL
  WHERE default_provider_id IS NOT NULL
    AND default_provider_id NOT IN (SELECT id FROM api_providers);

-- llm_retry_snapshots.provider_id 为 NOT NULL，无法置空，删除孤儿行
DELETE FROM llm_retry_snapshots
  WHERE provider_id NOT IN (SELECT id FROM api_providers);

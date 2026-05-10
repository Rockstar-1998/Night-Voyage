ALTER TABLE conversations ADD COLUMN conversation_type TEXT NOT NULL DEFAULT 'single';
ALTER TABLE conversations ADD COLUMN host_character_id INTEGER;
ALTER TABLE conversations ADD COLUMN world_book_id INTEGER;
ALTER TABLE conversations ADD COLUMN preset_id INTEGER;
ALTER TABLE conversations ADD COLUMN provider_id INTEGER;
ALTER TABLE conversations ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE conversations ADD COLUMN agent_provider_policy TEXT NOT NULL DEFAULT 'shared_host_provider';

UPDATE conversations
SET host_character_id = character_id
WHERE host_character_id IS NULL;

ALTER TABLE api_providers ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'openai_compatible';
ALTER TABLE api_providers ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_providers ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

UPDATE api_providers
SET created_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE created_at = 0;

UPDATE api_providers
SET updated_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE updated_at = 0;

ALTER TABLE character_cards ADD COLUMN card_type TEXT NOT NULL DEFAULT 'npc';
ALTER TABLE character_cards ADD COLUMN default_world_book_id INTEGER;
ALTER TABLE character_cards ADD COLUMN default_preset_id INTEGER;
ALTER TABLE character_cards ADD COLUMN default_provider_id INTEGER;

ALTER TABLE messages ADD COLUMN round_id INTEGER;
ALTER TABLE messages ADD COLUMN member_id INTEGER;
ALTER TABLE messages ADD COLUMN message_kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE messages ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;

UPDATE messages
SET message_kind = CASE
    WHEN role = 'assistant' THEN 'assistant_visible'
    WHEN role = 'user' THEN 'user_visible'
    ELSE 'system'
END
WHERE message_kind = 'legacy';

CREATE TABLE IF NOT EXISTS conversation_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    member_role TEXT NOT NULL CHECK (member_role IN ('host', 'member')),
    display_name TEXT NOT NULL,
    player_character_id INTEGER,
    join_order INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (player_character_id) REFERENCES character_cards(id) ON DELETE SET NULL
);

INSERT INTO conversation_members (
    conversation_id,
    member_role,
    display_name,
    player_character_id,
    join_order,
    is_active,
    created_at,
    updated_at
)
SELECT
    id,
    'host',
    '主持人',
    NULL,
    0,
    1,
    created_at,
    updated_at
FROM conversations;

CREATE TABLE IF NOT EXISTS message_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    round_index INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('collecting', 'queued', 'streaming', 'completed', 'failed')),
    aggregated_user_content TEXT,
    aggregate_message_id INTEGER,
    active_assistant_message_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (aggregate_message_id) REFERENCES messages(id) ON DELETE SET NULL,
    FOREIGN KEY (active_assistant_message_id) REFERENCES messages(id) ON DELETE SET NULL,
    UNIQUE (conversation_id, round_index)
);

CREATE TABLE IF NOT EXISTS round_member_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('spoken', 'skipped')),
    content TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (round_id) REFERENCES message_rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES conversation_members(id) ON DELETE CASCADE,
    UNIQUE (round_id, member_id)
);

CREATE TABLE IF NOT EXISTS character_card_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (character_id) REFERENCES character_cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS character_card_openers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL,
    opener_text TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (character_id) REFERENCES character_cards(id) ON DELETE CASCADE
);

INSERT INTO character_card_openers (character_id, opener_text, sort_order, created_at)
SELECT id, first_message, 0, updated_at
FROM character_cards
WHERE first_message IS NOT NULL AND TRIM(first_message) <> '';

CREATE TABLE IF NOT EXISTS world_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_book_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_book_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    trigger_mode TEXT NOT NULL CHECK (trigger_mode IN ('any', 'all')),
    is_enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (world_book_id) REFERENCES world_books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_book_entry_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (entry_id) REFERENCES world_book_entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_provider_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    owned_by TEXT,
    fetched_at INTEGER NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES api_providers(id) ON DELETE CASCADE,
    UNIQUE (provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS agent_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    agent_key TEXT NOT NULL,
    agent_role TEXT NOT NULL CHECK (agent_role IN ('director', 'npc')),
    character_id INTEGER,
    provider_mode TEXT NOT NULL CHECK (provider_mode IN ('inherit_host', 'override_provider')),
    provider_id INTEGER,
    model_override TEXT,
    temperature_override REAL,
    max_tokens_override INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES character_cards(id) ON DELETE SET NULL,
    FOREIGN KEY (provider_id) REFERENCES api_providers(id) ON DELETE SET NULL,
    UNIQUE (conversation_id, agent_key)
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL,
    orchestration_mode TEXT NOT NULL,
    provider_decision TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    FOREIGN KEY (round_id) REFERENCES message_rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    agent_key TEXT NOT NULL,
    character_id INTEGER,
    draft_content TEXT NOT NULL,
    draft_intent TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES character_cards(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_type_updated_at ON conversations(conversation_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_provider_id ON conversations(provider_id);
CREATE INDEX IF NOT EXISTS idx_messages_round_id ON messages(round_id);
CREATE INDEX IF NOT EXISTS idx_messages_member_id ON messages(member_id);
CREATE INDEX IF NOT EXISTS idx_messages_visible_window ON messages(conversation_id, is_hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_members_conversation_id ON conversation_members(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_members_active ON conversation_members(conversation_id, is_active, join_order);
CREATE INDEX IF NOT EXISTS idx_message_rounds_conversation_id ON message_rounds(conversation_id, round_index DESC);
CREATE INDEX IF NOT EXISTS idx_round_member_actions_round_id ON round_member_actions(round_id);
CREATE INDEX IF NOT EXISTS idx_character_card_tags_character_id ON character_card_tags(character_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_character_card_openers_character_id ON character_card_openers(character_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_world_book_entries_book_id ON world_book_entries(world_book_id, is_enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_world_book_entry_keywords_entry_id ON world_book_entry_keywords(entry_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_api_provider_models_provider_id ON api_provider_models(provider_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_bindings_conversation_id ON agent_bindings(conversation_id, agent_role);
CREATE INDEX IF NOT EXISTS idx_agent_runs_round_id ON agent_runs(round_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_drafts_run_id ON agent_drafts(run_id, agent_key);

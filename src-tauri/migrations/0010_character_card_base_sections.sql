CREATE TABLE IF NOT EXISTS character_card_base_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL,
    section_key TEXT NOT NULL CHECK (
        section_key IN ('identity', 'persona', 'background', 'rules', 'custom')
    ),
    title TEXT,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (character_id) REFERENCES character_cards(id) ON DELETE CASCADE
);

INSERT INTO character_card_base_sections (
    character_id,
    section_key,
    title,
    content,
    sort_order,
    created_at,
    updated_at
)
SELECT
    character_cards.id,
    'custom',
    'Legacy Description',
    character_cards.description,
    0,
    CASE
        WHEN character_cards.created_at IS NOT NULL AND character_cards.created_at > 0
            THEN character_cards.created_at
        ELSE CAST(strftime('%s', 'now') AS INTEGER)
    END,
    CASE
        WHEN character_cards.updated_at IS NOT NULL AND character_cards.updated_at > 0
            THEN character_cards.updated_at
        ELSE CAST(strftime('%s', 'now') AS INTEGER)
    END
FROM character_cards
WHERE character_cards.description IS NOT NULL
  AND TRIM(character_cards.description) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM character_card_base_sections existing
      WHERE existing.character_id = character_cards.id
  );

CREATE INDEX IF NOT EXISTS idx_character_card_base_sections_character_id
    ON character_card_base_sections(character_id, sort_order ASC, id ASC);

UPDATE conversations
SET preset_id = NULL
WHERE preset_id IS NOT NULL AND preset_id <= 0;

UPDATE character_cards
SET default_preset_id = NULL
WHERE default_preset_id IS NOT NULL AND default_preset_id <= 0;

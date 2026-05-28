ALTER TABLE presets ADD COLUMN structured_output_display TEXT DEFAULT NULL;
ALTER TABLE preset_provider_overrides ADD COLUMN structured_output_display_override TEXT DEFAULT NULL;
UPDATE message_content_parts SET is_hidden = 0 WHERE is_hidden = 1;

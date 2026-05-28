ALTER TABLE presets ADD COLUMN structured_output_schema TEXT DEFAULT 'basic';

ALTER TABLE preset_provider_overrides ADD COLUMN structured_output_schema_override TEXT;

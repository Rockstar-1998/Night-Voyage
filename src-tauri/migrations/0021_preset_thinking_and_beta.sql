ALTER TABLE presets ADD COLUMN thinking_enabled INTEGER NULL;
ALTER TABLE presets ADD COLUMN thinking_budget_tokens INTEGER NULL;
ALTER TABLE presets ADD COLUMN beta_features TEXT NULL;

ALTER TABLE preset_provider_overrides ADD COLUMN thinking_enabled_override INTEGER NULL;
ALTER TABLE preset_provider_overrides ADD COLUMN thinking_budget_tokens_override INTEGER NULL;
ALTER TABLE preset_provider_overrides ADD COLUMN beta_features_override TEXT NULL;

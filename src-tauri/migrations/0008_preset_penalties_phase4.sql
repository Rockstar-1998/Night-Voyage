ALTER TABLE presets ADD COLUMN presence_penalty REAL;
ALTER TABLE presets ADD COLUMN frequency_penalty REAL;

ALTER TABLE preset_provider_overrides ADD COLUMN presence_penalty_override REAL;
ALTER TABLE preset_provider_overrides ADD COLUMN frequency_penalty_override REAL;

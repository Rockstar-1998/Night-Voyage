ALTER TABLE presets ADD COLUMN context_included_keys TEXT DEFAULT NULL;

ALTER TABLE preset_semantic_options ADD COLUMN linked_schema_keys TEXT DEFAULT NULL;

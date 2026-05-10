ALTER TABLE preset_prompt_blocks ADD COLUMN semantic_option_id INTEGER;
ALTER TABLE preset_examples ADD COLUMN semantic_option_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_preset_prompt_blocks_preset_semantic_option
    ON preset_prompt_blocks(preset_id, semantic_option_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_preset_examples_preset_semantic_option
    ON preset_examples(preset_id, semantic_option_id, sort_order ASC, id ASC);

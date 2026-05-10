ALTER TABLE preset_prompt_blocks ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE preset_prompt_blocks ADD COLUMN lock_reason TEXT;
ALTER TABLE preset_prompt_blocks ADD COLUMN exclusive_group_key TEXT;
ALTER TABLE preset_prompt_blocks ADD COLUMN exclusive_group_label TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_preset_prompt_blocks_enabled_exclusive_group
    ON preset_prompt_blocks(preset_id, exclusive_group_key)
    WHERE is_enabled = 1
      AND exclusive_group_key IS NOT NULL
      AND exclusive_group_key <> '';

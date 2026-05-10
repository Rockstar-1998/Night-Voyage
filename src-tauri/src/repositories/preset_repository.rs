use std::collections::HashMap;

use sqlx::{Row, SqlitePool, Transaction};

use crate::models::{
    PresetDetail, PresetExampleRecord, PresetPromptBlockRecord, PresetProviderOverrideRecord,
    PresetSemanticGroupRecord, PresetSemanticOptionBlockRecord, PresetSemanticOptionExampleRecord,
    PresetSemanticOptionRecord, PresetStopSequenceRecord, PresetSummary,
};
use crate::validators::preset_validator::{
    NormalizedPresetExampleInput, NormalizedPresetPromptBlockInput,
    NormalizedPresetProviderOverrideInput, NormalizedPresetSemanticGroupInput,
    NormalizedPresetSemanticOptionInput, NormalizedPresetStopSequenceInput,
    PresetBlockLockSnapshot, SemanticMaterialization,
};

#[derive(Debug, Clone)]
pub struct FlatPresetSemanticOptionRecord {
    pub id: i64,
    pub group_id: i64,
    pub parent_option_id: Option<i64>,
    pub option_key: String,
    pub label: String,
    pub description: Option<String>,
    pub depth: i64,
    pub sort_order: i64,
    pub is_selected: bool,
    pub is_enabled: bool,
    pub expansion_kind: String,
    pub blocks: Vec<PresetSemanticOptionBlockRecord>,
    pub examples: Vec<PresetSemanticOptionExampleRecord>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct PresetRepository;

impl PresetRepository {
    pub async fn list_all(db: &SqlitePool) -> Result<Vec<PresetSummary>, String> {
        let rows = sqlx::query(
            "SELECT id, name, description, category, is_builtin, version, temperature, \
             max_output_tokens, top_p, top_k, presence_penalty, frequency_penalty, response_mode, \
             thinking_enabled, thinking_budget_tokens, beta_features, created_at, updated_at \
             FROM presets ORDER BY updated_at DESC, id DESC",
        )
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        rows.into_iter().map(Self::row_to_preset_summary).collect()
    }

    pub async fn find_by_id(db: &SqlitePool, id: i64) -> Result<Option<PresetDetail>, String> {
        let row = sqlx::query(
            "SELECT id, name, description, category, is_builtin, version, temperature, \
             max_output_tokens, top_p, top_k, presence_penalty, frequency_penalty, response_mode, \
             thinking_enabled, thinking_budget_tokens, beta_features, created_at, updated_at \
             FROM presets WHERE id = ? LIMIT 1",
        )
        .bind(id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?;

        match row {
            Some(row) => {
                let blocks = Self::find_blocks_by_preset_id(db, id).await?;
                let examples = Self::find_examples_by_preset_id(db, id).await?;
                let stop_sequences = Self::find_stop_sequences_by_preset_id(db, id).await?;
                let provider_overrides = Self::find_provider_overrides_by_preset_id(db, id).await?;
                let semantic_groups = Self::find_semantic_groups_by_preset_id(db, id).await?;

                Ok(Some(PresetDetail {
                    preset: Self::row_to_preset_summary(row)?,
                    blocks,
                    examples,
                    stop_sequences,
                    provider_overrides,
                    semantic_groups,
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn find_blocks_by_preset_id(
        db: &SqlitePool,
        preset_id: i64,
    ) -> Result<Vec<PresetPromptBlockRecord>, String> {
        let rows = sqlx::query(
            "SELECT id, preset_id, semantic_option_id, block_type, title, content, sort_order, priority, \
             is_enabled, scope, is_locked, lock_reason, exclusive_group_key, exclusive_group_label, \
             created_at, updated_at \
             FROM preset_prompt_blocks \
             WHERE preset_id = ? \
             ORDER BY sort_order ASC, priority DESC, id ASC",
        )
        .bind(preset_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        Ok(rows
            .into_iter()
            .map(Self::row_to_preset_prompt_block_record)
            .collect())
    }

    pub async fn find_examples_by_preset_id(
        db: &SqlitePool,
        preset_id: i64,
    ) -> Result<Vec<PresetExampleRecord>, String> {
        let rows = sqlx::query(
            "SELECT id, preset_id, semantic_option_id, role, content, sort_order, is_enabled, created_at, updated_at \
             FROM preset_examples \
             WHERE preset_id = ? \
             ORDER BY sort_order ASC, id ASC",
        )
        .bind(preset_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        Ok(rows
            .into_iter()
            .map(Self::row_to_preset_example_record)
            .collect())
    }

    pub async fn find_stop_sequences_by_preset_id(
        db: &SqlitePool,
        preset_id: i64,
    ) -> Result<Vec<PresetStopSequenceRecord>, String> {
        let rows = sqlx::query(
            "SELECT id, preset_id, stop_text, sort_order, created_at, updated_at \
             FROM preset_stop_sequences \
             WHERE preset_id = ? \
             ORDER BY sort_order ASC, id ASC",
        )
        .bind(preset_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        Ok(rows
            .into_iter()
            .map(Self::row_to_preset_stop_sequence_record)
            .collect())
    }

    pub async fn find_provider_overrides_by_preset_id(
        db: &SqlitePool,
        preset_id: i64,
    ) -> Result<Vec<PresetProviderOverrideRecord>, String> {
        let rows = sqlx::query(
            "SELECT id, preset_id, provider_kind, temperature_override, max_output_tokens_override, \
             top_p_override, top_k_override, presence_penalty_override, frequency_penalty_override, \
             response_mode_override, stop_sequences_override, disabled_block_types, \
             thinking_enabled_override, thinking_budget_tokens_override, beta_features_override, \
             created_at, updated_at \
             FROM preset_provider_overrides \
             WHERE preset_id = ? \
             ORDER BY id ASC",
        )
        .bind(preset_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        Ok(rows
            .into_iter()
            .map(Self::row_to_preset_provider_override_record)
            .collect())
    }

    pub async fn find_semantic_groups_by_preset_id(
        db: &SqlitePool,
        preset_id: i64,
    ) -> Result<Vec<PresetSemanticGroupRecord>, String> {
        let group_rows = sqlx::query(
            "SELECT id, preset_id, group_key, label, description, sort_order, selection_mode, \
             is_enabled, created_at, updated_at \
             FROM preset_semantic_groups \
             WHERE preset_id = ? \
             ORDER BY sort_order ASC, id ASC",
        )
        .bind(preset_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        if group_rows.is_empty() {
            return Ok(Vec::new());
        }

        let option_rows = sqlx::query(
            "SELECT o.id, o.group_id, o.parent_option_id, o.option_key, o.label, o.description, \
             o.depth, o.sort_order, o.is_selected, o.is_enabled, o.expansion_kind, o.created_at, o.updated_at \
             FROM preset_semantic_options o \
             INNER JOIN preset_semantic_groups g ON g.id = o.group_id \
             WHERE g.preset_id = ? \
             ORDER BY o.group_id ASC, o.depth ASC, o.sort_order ASC, o.id ASC",
        )
        .bind(preset_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        let option_block_rows = sqlx::query(
            "SELECT b.id, b.option_id, b.block_type, b.title, b.content, b.sort_order, b.priority, \
             b.is_enabled, b.scope, b.is_locked, b.lock_reason, b.exclusive_group_key, b.exclusive_group_label, \
             b.created_at, b.updated_at \
             FROM preset_semantic_option_blocks b \
             INNER JOIN preset_semantic_options o ON o.id = b.option_id \
             INNER JOIN preset_semantic_groups g ON g.id = o.group_id \
             WHERE g.preset_id = ? \
             ORDER BY b.option_id ASC, b.sort_order ASC, b.priority DESC, b.id ASC",
        )
        .bind(preset_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        let option_example_rows = sqlx::query(
            "SELECT e.id, e.option_id, e.role, e.content, e.sort_order, e.is_enabled, e.created_at, e.updated_at \
             FROM preset_semantic_option_examples e \
             INNER JOIN preset_semantic_options o ON o.id = e.option_id \
             INNER JOIN preset_semantic_groups g ON g.id = o.group_id \
             WHERE g.preset_id = ? \
             ORDER BY e.option_id ASC, e.sort_order ASC, e.id ASC",
        )
        .bind(preset_id)
        .fetch_all(db)
        .await
        .map_err(|err| err.to_string())?;

        let mut blocks_by_option = HashMap::<i64, Vec<PresetSemanticOptionBlockRecord>>::new();
        for row in option_block_rows {
            let record = Self::row_to_preset_semantic_option_block_record(row);
            blocks_by_option
                .entry(record.option_id)
                .or_default()
                .push(record);
        }

        let mut examples_by_option = HashMap::<i64, Vec<PresetSemanticOptionExampleRecord>>::new();
        for row in option_example_rows {
            let record = Self::row_to_preset_semantic_option_example_record(row);
            examples_by_option
                .entry(record.option_id)
                .or_default()
                .push(record);
        }

        let mut flat_options_by_group = HashMap::<i64, Vec<FlatPresetSemanticOptionRecord>>::new();
        for row in option_rows {
            let option_id: i64 = row.try_get("id").unwrap_or_default();
            let group_id: i64 = row.try_get("group_id").unwrap_or_default();
            flat_options_by_group.entry(group_id).or_default().push(
                FlatPresetSemanticOptionRecord {
                    id: option_id,
                    group_id,
                    parent_option_id: row
                        .try_get::<Option<i64>, _>("parent_option_id")
                        .unwrap_or(None)
                        .filter(|value| *value > 0),
                    option_key: row.try_get("option_key").unwrap_or_default(),
                    label: row.try_get("label").unwrap_or_default(),
                    description: Self::normalize_optional_text(row.try_get("description").ok()),
                    depth: row.try_get("depth").unwrap_or_default(),
                    sort_order: row.try_get("sort_order").unwrap_or_default(),
                    is_selected: row
                        .try_get::<i64, _>("is_selected")
                        .map(|value| value != 0)
                        .unwrap_or(false),
                    is_enabled: row
                        .try_get::<i64, _>("is_enabled")
                        .map(|value| value != 0)
                        .unwrap_or(true),
                    expansion_kind: row
                        .try_get("expansion_kind")
                        .unwrap_or_else(|_| "mixed".to_string()),
                    blocks: blocks_by_option.remove(&option_id).unwrap_or_default(),
                    examples: examples_by_option.remove(&option_id).unwrap_or_default(),
                    created_at: row.try_get("created_at").unwrap_or_default(),
                    updated_at: row.try_get("updated_at").unwrap_or_default(),
                },
            );
        }

        let mut groups = Vec::with_capacity(group_rows.len());
        for row in group_rows {
            let group_id: i64 = row.try_get("id").unwrap_or_default();
            let preset_id_value: i64 = row.try_get("preset_id").unwrap_or_default();
            let group_key: String = row.try_get("group_key").unwrap_or_default();
            let label: String = row.try_get("label").unwrap_or_default();
            let description = Self::normalize_optional_text(row.try_get("description").ok());
            let sort_order: i64 = row.try_get("sort_order").unwrap_or_default();
            let selection_mode: String = row
                .try_get("selection_mode")
                .unwrap_or_else(|_| "single".to_string());
            let is_enabled = row
                .try_get::<i64, _>("is_enabled")
                .map(|value| value != 0)
                .unwrap_or(true);
            let created_at: i64 = row.try_get("created_at").unwrap_or_default();
            let updated_at: i64 = row.try_get("updated_at").unwrap_or_default();
            let flat_options = flat_options_by_group.remove(&group_id).unwrap_or_default();

            groups.push(PresetSemanticGroupRecord {
                id: group_id,
                preset_id: preset_id_value,
                group_key,
                label,
                description,
                sort_order,
                selection_mode,
                is_enabled,
                options: Self::build_semantic_option_tree(None, &flat_options),
                created_at,
                updated_at,
            });
        }

        Ok(groups)
    }

    fn build_semantic_option_tree(
        parent_option_id: Option<i64>,
        flat_options: &[FlatPresetSemanticOptionRecord],
    ) -> Vec<PresetSemanticOptionRecord> {
        let mut options = flat_options
            .iter()
            .filter(|option| option.parent_option_id == parent_option_id)
            .cloned()
            .collect::<Vec<_>>();
        options.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then(left.id.cmp(&right.id))
        });

        options
            .into_iter()
            .map(|option| PresetSemanticOptionRecord {
                id: option.id,
                group_id: option.group_id,
                parent_option_id: option.parent_option_id,
                option_key: option.option_key,
                label: option.label,
                description: option.description,
                depth: option.depth,
                sort_order: option.sort_order,
                is_selected: option.is_selected,
                is_enabled: option.is_enabled,
                expansion_kind: option.expansion_kind,
                blocks: option.blocks,
                examples: option.examples,
                children: Self::build_semantic_option_tree(Some(option.id), flat_options),
                created_at: option.created_at,
                updated_at: option.updated_at,
            })
            .collect()
    }

    pub async fn create(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        name: &str,
        description: Option<String>,
        category: &str,
        temperature: Option<f64>,
        max_output_tokens: Option<i64>,
        top_p: Option<f64>,
        top_k: Option<i64>,
        presence_penalty: Option<f64>,
        frequency_penalty: Option<f64>,
        response_mode: &str,
        thinking_enabled: Option<bool>,
        thinking_budget_tokens: Option<i64>,
        beta_features: Option<&str>,
        now: i64,
    ) -> Result<i64, String> {
        let result = sqlx::query(
            "INSERT INTO presets (
                name, description, category, is_builtin, version, temperature,
                max_output_tokens, top_p, top_k, presence_penalty, frequency_penalty, response_mode,
                thinking_enabled, thinking_budget_tokens, beta_features,
                created_at, updated_at
             ) VALUES (?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(name)
        .bind(&description)
        .bind(category)
        .bind(temperature)
        .bind(max_output_tokens)
        .bind(top_p)
        .bind(top_k)
        .bind(presence_penalty)
        .bind(frequency_penalty)
        .bind(response_mode)
        .bind(thinking_enabled)
        .bind(thinking_budget_tokens)
        .bind(beta_features)
        .bind(now)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        Ok(result.last_insert_rowid())
    }

    pub async fn update(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        id: i64,
        name: &str,
        description: Option<String>,
        category: &str,
        temperature: Option<f64>,
        max_output_tokens: Option<i64>,
        top_p: Option<f64>,
        top_k: Option<i64>,
        presence_penalty: Option<f64>,
        frequency_penalty: Option<f64>,
        response_mode: &str,
        thinking_enabled: Option<bool>,
        thinking_budget_tokens: Option<i64>,
        beta_features: Option<&str>,
        now: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "UPDATE presets SET
                name = ?,
                description = ?,
                category = ?,
                version = version + 1,
                temperature = ?,
                max_output_tokens = ?,
                top_p = ?,
                top_k = ?,
                presence_penalty = ?,
                frequency_penalty = ?,
                response_mode = ?,
                thinking_enabled = ?,
                thinking_budget_tokens = ?,
                beta_features = ?,
                updated_at = ?
             WHERE id = ?",
        )
        .bind(name)
        .bind(&description)
        .bind(category)
        .bind(temperature)
        .bind(max_output_tokens)
        .bind(top_p)
        .bind(top_k)
        .bind(presence_penalty)
        .bind(frequency_penalty)
        .bind(response_mode)
        .bind(thinking_enabled)
        .bind(thinking_budget_tokens)
        .bind(beta_features)
        .bind(now)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub async fn delete(db: &SqlitePool, id: i64) -> Result<bool, String> {
        let result = sqlx::query("DELETE FROM presets WHERE id = ?")
            .bind(id)
            .execute(db)
            .await
            .map_err(|err| err.to_string())?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn name_exists(db: &SqlitePool, name: &str) -> Result<bool, String> {
        let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM presets WHERE name = ?")
            .bind(name)
            .fetch_one(db)
            .await
            .map_err(|err| err.to_string())?;
        Ok(exists > 0)
    }

    pub async fn exists(tx: &mut Transaction<'_, sqlx::Sqlite>, id: i64) -> Result<bool, String> {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM presets WHERE id = ?")
            .bind(id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        Ok(count > 0)
    }

    pub async fn replace_blocks(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
        blocks: &[NormalizedPresetPromptBlockInput],
        now: i64,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM preset_prompt_blocks WHERE preset_id = ?")
            .bind(preset_id)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;

        for block in blocks {
            sqlx::query(
                "INSERT INTO preset_prompt_blocks (
                    preset_id, semantic_option_id, block_type, title, content, sort_order, priority,
                    is_enabled, scope, is_locked, lock_reason, exclusive_group_key, exclusive_group_label,
                    created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(preset_id)
            .bind(block.semantic_option_id)
            .bind(&block.block_type)
            .bind(&block.title)
            .bind(&block.content)
            .bind(block.sort_order)
            .bind(block.priority)
            .bind(if block.is_enabled { 1 } else { 0 })
            .bind(&block.scope)
            .bind(if block.is_locked { 1 } else { 0 })
            .bind(&block.lock_reason)
            .bind(&block.exclusive_group_key)
            .bind(&block.exclusive_group_label)
            .bind(now)
            .bind(now)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        Ok(())
    }

    pub async fn replace_examples(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
        examples: &[NormalizedPresetExampleInput],
        now: i64,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM preset_examples WHERE preset_id = ?")
            .bind(preset_id)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;

        for example in examples {
            sqlx::query(
                "INSERT INTO preset_examples (
                    preset_id, semantic_option_id, role, content, sort_order, is_enabled, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(preset_id)
            .bind(example.semantic_option_id)
            .bind(&example.role)
            .bind(&example.content)
            .bind(example.sort_order)
            .bind(if example.is_enabled { 1 } else { 0 })
            .bind(now)
            .bind(now)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        Ok(())
    }

    pub async fn replace_stop_sequences(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
        stop_sequences: &[NormalizedPresetStopSequenceInput],
        now: i64,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM preset_stop_sequences WHERE preset_id = ?")
            .bind(preset_id)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;

        for seq in stop_sequences {
            sqlx::query(
                "INSERT INTO preset_stop_sequences (preset_id, stop_text, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(preset_id)
            .bind(&seq.stop_text)
            .bind(seq.sort_order)
            .bind(now)
            .bind(now)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        Ok(())
    }

    pub async fn replace_provider_overrides(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
        overrides: &[NormalizedPresetProviderOverrideInput],
        now: i64,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM preset_provider_overrides WHERE preset_id = ?")
            .bind(preset_id)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;

        for override_input in overrides {
            let stop_sequences_json =
                Self::serialize_optional_string_array(&override_input.stop_sequences_override)?;
            let disabled_block_types_json =
                Self::serialize_optional_string_array(&override_input.disabled_block_types)?;
            let beta_features_override_json =
                Self::serialize_optional_string_array(&override_input.beta_features_override)?;

            sqlx::query(
                "INSERT INTO preset_provider_overrides (
                    preset_id, provider_kind, temperature_override, max_output_tokens_override,
                    top_p_override, top_k_override, presence_penalty_override, frequency_penalty_override,
                    response_mode_override, stop_sequences_override, disabled_block_types,
                    thinking_enabled_override, thinking_budget_tokens_override, beta_features_override,
                    created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(preset_id)
            .bind(&override_input.provider_kind)
            .bind(override_input.temperature_override)
            .bind(override_input.max_output_tokens_override)
            .bind(override_input.top_p_override)
            .bind(override_input.top_k_override)
            .bind(override_input.presence_penalty_override)
            .bind(override_input.frequency_penalty_override)
            .bind(&override_input.response_mode_override)
            .bind(&stop_sequences_json)
            .bind(&disabled_block_types_json)
            .bind(override_input.thinking_enabled_override)
            .bind(override_input.thinking_budget_tokens_override)
            .bind(&beta_features_override_json)
            .bind(now)
            .bind(now)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        Ok(())
    }

    pub async fn replace_semantic_groups(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
        groups: &[NormalizedPresetSemanticGroupInput],
        now: i64,
    ) -> Result<SemanticMaterialization, String> {
        sqlx::query("DELETE FROM preset_semantic_groups WHERE preset_id = ?")
            .bind(preset_id)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;

        let mut materialization = SemanticMaterialization::default();
        for group in groups {
            let group_result = sqlx::query(
                "INSERT INTO preset_semantic_groups (
                    preset_id, group_key, label, description, sort_order,
                    selection_mode, is_enabled, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(preset_id)
            .bind(&group.group_key)
            .bind(&group.label)
            .bind(&group.description)
            .bind(group.sort_order)
            .bind(&group.selection_mode)
            .bind(if group.is_enabled { 1 } else { 0 })
            .bind(now)
            .bind(now)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
            let group_id = group_result.last_insert_rowid();

            let mut flat_options = Vec::new();
            let mut next_temp_id = 0_usize;
            crate::validators::preset_validator::flatten_normalized_semantic_options(
                &group.options,
                None,
                &mut next_temp_id,
                &mut flat_options,
            );

            let mut temp_to_real_option_id = HashMap::<usize, i64>::new();
            for option in flat_options {
                let parent_option_id = option
                    .parent_temp_id
                    .and_then(|temp_id| temp_to_real_option_id.get(&temp_id).copied());
                let option_result = sqlx::query(
                    "INSERT INTO preset_semantic_options (
                        group_id, option_key, parent_option_id, label, description,
                        depth, sort_order, is_selected, is_enabled, expansion_kind, created_at, updated_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(group_id)
                .bind(&option.option_key)
                .bind(parent_option_id)
                .bind(&option.label)
                .bind(&option.description)
                .bind(option.depth)
                .bind(option.sort_order)
                .bind(if option.is_selected { 1 } else { 0 })
                .bind(if option.is_enabled { 1 } else { 0 })
                .bind(&option.expansion_kind)
                .bind(now)
                .bind(now)
                .execute(&mut **tx)
                .await
                .map_err(|err| err.to_string())?;
                let option_id = option_result.last_insert_rowid();
                temp_to_real_option_id.insert(option.temp_id, option_id);

                Self::insert_semantic_option_blocks(tx, option_id, &option.blocks, now).await?;
                Self::insert_semantic_option_examples(tx, option_id, &option.examples, now).await?;

                if group.is_enabled && option.is_enabled && option.is_selected {
                    materialization
                        .blocks
                        .extend(option.blocks.iter().cloned().map(|mut block| {
                            block.semantic_option_id = Some(option_id);
                            block
                        }));
                    materialization
                        .examples
                        .extend(option.examples.iter().cloned().map(|mut example| {
                            example.semantic_option_id = Some(option_id);
                            example
                        }));
                }
            }
        }

        Ok(materialization)
    }

    async fn insert_semantic_option_blocks(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        option_id: i64,
        blocks: &[NormalizedPresetPromptBlockInput],
        now: i64,
    ) -> Result<(), String> {
        for block in blocks {
            sqlx::query(
                "INSERT INTO preset_semantic_option_blocks (
                    option_id, block_type, title, content, sort_order,
                    priority, is_enabled, scope, is_locked, lock_reason,
                    exclusive_group_key, exclusive_group_label, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(option_id)
            .bind(&block.block_type)
            .bind(&block.title)
            .bind(&block.content)
            .bind(block.sort_order)
            .bind(block.priority)
            .bind(if block.is_enabled { 1 } else { 0 })
            .bind(&block.scope)
            .bind(if block.is_locked { 1 } else { 0 })
            .bind(&block.lock_reason)
            .bind(&block.exclusive_group_key)
            .bind(&block.exclusive_group_label)
            .bind(now)
            .bind(now)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        Ok(())
    }

    async fn insert_semantic_option_examples(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        option_id: i64,
        examples: &[NormalizedPresetExampleInput],
        now: i64,
    ) -> Result<(), String> {
        for example in examples {
            sqlx::query(
                "INSERT INTO preset_semantic_option_examples (
                    option_id, role, content, sort_order, is_enabled, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(option_id)
            .bind(&example.role)
            .bind(&example.content)
            .bind(example.sort_order)
            .bind(if example.is_enabled { 1 } else { 0 })
            .bind(now)
            .bind(now)
            .execute(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        Ok(())
    }

    pub async fn load_existing_normalized_blocks(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
        semantic_only: bool,
    ) -> Result<Vec<NormalizedPresetPromptBlockInput>, String> {
        let sql = if semantic_only {
            "SELECT semantic_option_id, block_type, title, content, sort_order, priority, is_enabled, \
             scope, is_locked, lock_reason, exclusive_group_key, exclusive_group_label \
             FROM preset_prompt_blocks WHERE preset_id = ? AND semantic_option_id IS NOT NULL AND semantic_option_id > 0 \
             ORDER BY sort_order ASC, priority DESC, id ASC"
        } else {
            "SELECT semantic_option_id, block_type, title, content, sort_order, priority, is_enabled, \
             scope, is_locked, lock_reason, exclusive_group_key, exclusive_group_label \
             FROM preset_prompt_blocks WHERE preset_id = ? AND (semantic_option_id IS NULL OR semantic_option_id = 0) \
             ORDER BY sort_order ASC, priority DESC, id ASC"
        };
        let rows = sqlx::query(sql)
            .bind(preset_id)
            .fetch_all(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;

        rows.into_iter()
            .map(Self::normalized_preset_block_from_row)
            .collect()
    }

    pub async fn load_existing_normalized_examples(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
        semantic_only: bool,
    ) -> Result<Vec<NormalizedPresetExampleInput>, String> {
        let sql = if semantic_only {
            "SELECT semantic_option_id, role, content, sort_order, is_enabled \
             FROM preset_examples WHERE preset_id = ? AND semantic_option_id IS NOT NULL AND semantic_option_id > 0 \
             ORDER BY sort_order ASC, id ASC"
        } else {
            "SELECT semantic_option_id, role, content, sort_order, is_enabled \
             FROM preset_examples WHERE preset_id = ? AND (semantic_option_id IS NULL OR semantic_option_id = 0) \
             ORDER BY sort_order ASC, id ASC"
        };
        let rows = sqlx::query(sql)
            .bind(preset_id)
            .fetch_all(&mut **tx)
            .await
            .map_err(|err| err.to_string())?;

        rows.into_iter()
            .map(Self::normalized_preset_example_from_row)
            .collect()
    }

    pub async fn load_existing_semantic_materialization(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
    ) -> Result<SemanticMaterialization, String> {
        let blocks = Self::load_existing_normalized_blocks(tx, preset_id, true).await?;
        let examples = Self::load_existing_normalized_examples(tx, preset_id, true).await?;
        Ok(SemanticMaterialization { blocks, examples })
    }

    pub async fn get_locked_block_snapshots(
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
    ) -> Result<Vec<PresetBlockLockSnapshot>, String> {
        let rows = sqlx::query(
            "SELECT block_type, title, content, sort_order, priority, is_enabled, scope, \
             is_locked, lock_reason, exclusive_group_key, exclusive_group_label \
             FROM preset_prompt_blocks \
             WHERE preset_id = ? AND is_locked = 1 \
             ORDER BY sort_order ASC, priority DESC, id ASC",
        )
        .bind(preset_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

        rows.into_iter()
            .map(|row| {
                Ok(PresetBlockLockSnapshot {
                    block_type: Self::normalize_required_from_row(
                        row.try_get("block_type").unwrap_or_default(),
                        "block_type",
                    )?,
                    title: Self::normalize_optional_text(row.try_get("title").ok()),
                    content: Self::normalize_required_from_row(
                        row.try_get("content").unwrap_or_default(),
                        "content",
                    )?,
                    sort_order: row.try_get("sort_order").unwrap_or_default(),
                    priority: row.try_get("priority").unwrap_or(100),
                    is_enabled: row
                        .try_get::<i64, _>("is_enabled")
                        .map(|v| v != 0)
                        .unwrap_or(true),
                    scope: Self::normalize_required_from_row(
                        row.try_get("scope")
                            .unwrap_or_else(|_| "global".to_string()),
                        "scope",
                    )?,
                    is_locked: true,
                    lock_reason: Self::normalize_optional_text(row.try_get("lock_reason").ok()),
                    exclusive_group_key: Self::normalize_optional_text(
                        row.try_get("exclusive_group_key").ok(),
                    ),
                    exclusive_group_label: Self::normalize_optional_text(
                        row.try_get("exclusive_group_label").ok(),
                    ),
                })
            })
            .collect()
    }

    pub async fn ensure_not_in_use(db: &SqlitePool, preset_id: i64) -> Result<(), String> {
        let character_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM character_cards WHERE default_preset_id = ?")
                .bind(preset_id)
                .fetch_one(db)
                .await
                .map_err(|err| err.to_string())?;

        if character_count > 0 {
            return Err("无法删除：此预设正在被角色使用".to_string());
        }

        let conversation_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM conversations WHERE preset_id = ?")
                .bind(preset_id)
                .fetch_one(db)
                .await
                .map_err(|err| err.to_string())?;

        if conversation_count > 0 {
            return Err("无法删除：此预设正在被对话使用".to_string());
        }

        Ok(())
    }

    fn row_to_preset_summary(row: sqlx::sqlite::SqliteRow) -> Result<PresetSummary, String> {
        Ok(PresetSummary {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: Self::normalize_required_from_row(
                row.try_get("name").unwrap_or_default(),
                "name",
            )?,
            description: Self::normalize_optional_text(row.try_get("description").ok()),
            category: Self::normalize_required_from_row(
                row.try_get("category")
                    .unwrap_or_else(|_| "general".to_string()),
                "category",
            )?,
            is_builtin: row
                .try_get::<i64, _>("is_builtin")
                .map(|v| v != 0)
                .unwrap_or(false),
            version: row.try_get::<i64, _>("version").unwrap_or(1),
            temperature: row.try_get("temperature").ok(),
            max_output_tokens: row.try_get("max_output_tokens").ok(),
            top_p: row.try_get("top_p").ok(),
            top_k: row.try_get("top_k").ok(),
            presence_penalty: row.try_get("presence_penalty").ok(),
            frequency_penalty: row.try_get("frequency_penalty").ok(),
            response_mode: Self::normalize_optional_response_mode_from_row(
                row.try_get("response_mode").ok(),
            )?,
            thinking_enabled: row.try_get("thinking_enabled").ok().flatten(),
            thinking_budget_tokens: row.try_get("thinking_budget_tokens").ok(),
            beta_features: row
                .try_get("beta_features")
                .ok()
                .flatten()
                .and_then(|s: String| serde_json::from_str::<Vec<String>>(&s).ok()),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        })
    }

    fn row_to_preset_prompt_block_record(row: sqlx::sqlite::SqliteRow) -> PresetPromptBlockRecord {
        PresetPromptBlockRecord {
            id: row.try_get("id").unwrap_or_default(),
            preset_id: row.try_get("preset_id").unwrap_or_default(),
            semantic_option_id: row
                .try_get::<Option<i64>, _>("semantic_option_id")
                .unwrap_or(None)
                .filter(|v| *v > 0),
            block_type: row.try_get("block_type").unwrap_or_default(),
            title: row.try_get("title").ok(),
            content: row.try_get("content").unwrap_or_default(),
            sort_order: row.try_get("sort_order").unwrap_or_default(),
            priority: row.try_get("priority").unwrap_or(100),
            is_enabled: row
                .try_get::<i64, _>("is_enabled")
                .map(|v| v != 0)
                .unwrap_or(true),
            scope: row
                .try_get("scope")
                .unwrap_or_else(|_| "global".to_string()),
            is_locked: row
                .try_get::<i64, _>("is_locked")
                .map(|v| v != 0)
                .unwrap_or(false),
            lock_reason: row.try_get("lock_reason").ok(),
            exclusive_group_key: row.try_get("exclusive_group_key").ok(),
            exclusive_group_label: row.try_get("exclusive_group_label").ok(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }
    }

    fn row_to_preset_example_record(row: sqlx::sqlite::SqliteRow) -> PresetExampleRecord {
        PresetExampleRecord {
            id: row.try_get("id").unwrap_or_default(),
            preset_id: row.try_get("preset_id").unwrap_or_default(),
            semantic_option_id: row
                .try_get::<Option<i64>, _>("semantic_option_id")
                .unwrap_or(None)
                .filter(|v| *v > 0),
            role: row.try_get("role").unwrap_or_default(),
            content: row.try_get("content").unwrap_or_default(),
            sort_order: row.try_get("sort_order").unwrap_or_default(),
            is_enabled: row
                .try_get::<i64, _>("is_enabled")
                .map(|v| v != 0)
                .unwrap_or(true),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }
    }

    fn row_to_preset_stop_sequence_record(
        row: sqlx::sqlite::SqliteRow,
    ) -> PresetStopSequenceRecord {
        PresetStopSequenceRecord {
            id: row.try_get("id").unwrap_or_default(),
            preset_id: row.try_get("preset_id").unwrap_or_default(),
            stop_text: row.try_get("stop_text").unwrap_or_default(),
            sort_order: row.try_get("sort_order").unwrap_or_default(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }
    }

    fn row_to_preset_provider_override_record(
        row: sqlx::sqlite::SqliteRow,
    ) -> PresetProviderOverrideRecord {
        PresetProviderOverrideRecord {
            id: row.try_get("id").unwrap_or_default(),
            preset_id: row.try_get("preset_id").unwrap_or_default(),
            provider_kind: row.try_get("provider_kind").unwrap_or_default(),
            temperature_override: row.try_get("temperature_override").ok(),
            max_output_tokens_override: row.try_get("max_output_tokens_override").ok(),
            top_p_override: row.try_get("top_p_override").ok(),
            top_k_override: row.try_get("top_k_override").ok(),
            presence_penalty_override: row.try_get("presence_penalty_override").ok(),
            frequency_penalty_override: row.try_get("frequency_penalty_override").ok(),
            response_mode_override: row.try_get("response_mode_override").ok(),
            stop_sequences_override: Self::parse_optional_json_string_array(
                &row.try_get("stop_sequences_override").ok(),
            )
            .ok()
            .flatten()
            .unwrap_or_default(),
            disabled_block_types: Self::parse_optional_json_string_array(
                &row.try_get("disabled_block_types").ok(),
            )
            .ok()
            .flatten()
            .unwrap_or_default(),
            thinking_enabled_override: row.try_get("thinking_enabled_override").ok().flatten(),
            thinking_budget_tokens_override: row.try_get("thinking_budget_tokens_override").ok(),
            beta_features_override: Self::parse_optional_json_string_array(
                &row.try_get("beta_features_override").ok(),
            )
            .ok()
            .flatten(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }
    }

    fn row_to_preset_semantic_option_block_record(
        row: sqlx::sqlite::SqliteRow,
    ) -> PresetSemanticOptionBlockRecord {
        PresetSemanticOptionBlockRecord {
            id: row.try_get("id").unwrap_or_default(),
            option_id: row.try_get("option_id").unwrap_or_default(),
            block_type: row.try_get("block_type").unwrap_or_default(),
            title: row.try_get("title").ok(),
            content: row.try_get("content").unwrap_or_default(),
            sort_order: row.try_get("sort_order").unwrap_or_default(),
            priority: row.try_get("priority").unwrap_or(100),
            is_enabled: row
                .try_get::<i64, _>("is_enabled")
                .map(|v| v != 0)
                .unwrap_or(true),
            scope: row
                .try_get("scope")
                .unwrap_or_else(|_| "global".to_string()),
            is_locked: row
                .try_get::<i64, _>("is_locked")
                .map(|v| v != 0)
                .unwrap_or(false),
            lock_reason: row.try_get("lock_reason").ok(),
            exclusive_group_key: row.try_get("exclusive_group_key").ok(),
            exclusive_group_label: row.try_get("exclusive_group_label").ok(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }
    }

    fn row_to_preset_semantic_option_example_record(
        row: sqlx::sqlite::SqliteRow,
    ) -> PresetSemanticOptionExampleRecord {
        PresetSemanticOptionExampleRecord {
            id: row.try_get("id").unwrap_or_default(),
            option_id: row.try_get("option_id").unwrap_or_default(),
            role: row.try_get("role").unwrap_or_default(),
            content: row.try_get("content").unwrap_or_default(),
            sort_order: row.try_get("sort_order").unwrap_or_default(),
            is_enabled: row
                .try_get::<i64, _>("is_enabled")
                .map(|v| v != 0)
                .unwrap_or(true),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }
    }

    fn normalized_preset_block_from_row(
        row: sqlx::sqlite::SqliteRow,
    ) -> Result<NormalizedPresetPromptBlockInput, String> {
        Ok(NormalizedPresetPromptBlockInput {
            block_type: Self::normalize_required_from_row(
                row.try_get("block_type").unwrap_or_default(),
                "preset_prompt_blocks.block_type",
            )?,
            title: Self::normalize_optional_text(row.try_get("title").ok()),
            content: Self::normalize_required_from_row(
                row.try_get("content").unwrap_or_default(),
                "preset_prompt_blocks.content",
            )?,
            sort_order: row.try_get("sort_order").unwrap_or_default(),
            priority: row.try_get("priority").unwrap_or(100),
            is_enabled: row
                .try_get::<i64, _>("is_enabled")
                .map(|value| value != 0)
                .unwrap_or(true),
            scope: Self::normalize_required_from_row(
                row.try_get("scope")
                    .unwrap_or_else(|_| "global".to_string()),
                "preset_prompt_blocks.scope",
            )?,
            is_locked: row
                .try_get::<i64, _>("is_locked")
                .map(|value| value != 0)
                .unwrap_or(false),
            lock_reason: Self::normalize_optional_text(row.try_get("lock_reason").ok()),
            exclusive_group_key: Self::normalize_optional_text(
                row.try_get("exclusive_group_key").ok(),
            ),
            exclusive_group_label: Self::normalize_optional_text(
                row.try_get("exclusive_group_label").ok(),
            ),
            semantic_option_id: row
                .try_get::<Option<i64>, _>("semantic_option_id")
                .unwrap_or(None)
                .filter(|value| *value > 0),
        })
    }

    fn normalized_preset_example_from_row(
        row: sqlx::sqlite::SqliteRow,
    ) -> Result<NormalizedPresetExampleInput, String> {
        Ok(NormalizedPresetExampleInput {
            role: Self::normalize_example_role(
                0,
                &row.try_get::<String, _>("role").unwrap_or_default(),
            )?,
            content: Self::normalize_required_from_row(
                row.try_get("content").unwrap_or_default(),
                "preset_examples.content",
            )?,
            sort_order: row.try_get("sort_order").unwrap_or_default(),
            is_enabled: row
                .try_get::<i64, _>("is_enabled")
                .map(|value| value != 0)
                .unwrap_or(true),
            semantic_option_id: row
                .try_get::<Option<i64>, _>("semantic_option_id")
                .unwrap_or(None)
                .filter(|value| *value > 0),
        })
    }

    fn normalize_required_from_row(value: String, field_name: &str) -> Result<String, String> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(format!("{field_name} 不能为空"));
        }
        Ok(trimmed.to_string())
    }

    fn normalize_optional_text(value: Option<String>) -> Option<String> {
        value.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
    }

    fn normalize_optional_response_mode_from_row(
        value: Option<String>,
    ) -> Result<Option<String>, String> {
        match value {
            Some(mode) => {
                let trimmed = mode.trim();
                if trimmed.is_empty() {
                    return Ok(None);
                }
                let normalized = trimmed.to_lowercase();
                if !["compact", "verbose", "auto"].contains(&normalized.as_str()) {
                    eprintln!(
                        "警告: response_mode '{}' 无效，已被忽略，使用默认值 compact",
                        mode
                    );
                    return Ok(Some("compact".to_string()));
                }
                Ok(Some(normalized))
            }
            None => Ok(None),
        }
    }

    fn normalize_example_role(index: usize, value: &str) -> Result<String, String> {
        let trimmed = value.trim().to_lowercase();
        if !["user", "assistant", "system"].contains(&trimmed.as_str()) {
            return Err(format!(
                "examples[{index}].role 必须是 user、assistant 或 system"
            ));
        }
        Ok(trimmed)
    }

    fn serialize_optional_string_array(
        values: &Option<Vec<String>>,
    ) -> Result<Option<String>, String> {
        match values {
            Some(values) => {
                let json = serde_json::to_string(values).map_err(|e| e.to_string())?;
                Ok(Some(json))
            }
            None => Ok(None),
        }
    }

    fn parse_optional_json_string_array(
        value: &Option<String>,
    ) -> Result<Option<Vec<String>>, String> {
        match value {
            Some(json) => {
                if json.is_empty() {
                    return Ok(None);
                }
                let parsed: Vec<String> =
                    serde_json::from_str(json).map_err(|e| format!("JSON 解析失败: {e}"))?;
                Ok(Some(parsed))
            }
            None => Ok(None),
        }
    }
}

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::models::{PresetDetail, PresetSemanticGroupRecord, PresetSummary};
use crate::repositories::preset_repository::PresetRepository;
use crate::utils::now_ts;
use crate::validators::preset_validator::{
    merge_materialized_blocks, merge_materialized_examples, missing_locked_block_snapshot,
    normalize_beta_features_impl, normalize_category_impl, normalize_max_output_tokens_impl,
    normalize_optional_text_impl, normalize_penalty_impl, normalize_required_impl,
    normalize_response_mode_impl, normalize_temperature_impl,
    normalize_thinking_budget_tokens_impl, normalize_thinking_enabled_impl, normalize_top_k_impl,
    normalize_top_p_impl, PresetValidator,
};
use crate::validators::preset_validator::{
    PresetExampleInput, PresetPromptBlockInput, PresetProviderOverrideInput,
    PresetSemanticGroupInput, PresetSemanticOptionInput, PresetStopSequenceInput,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PortablePresetMeta {
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub top_k: Option<i64>,
    pub presence_penalty: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub response_mode: Option<String>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget_tokens: Option<i64>,
    pub beta_features: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortablePresetFile {
    schema_version: i64,
    format: String,
    exported_at: i64,
    preset: PortablePresetMeta,
    semantic_groups: Vec<PresetSemanticGroupInput>,
    blocks: Vec<PresetPromptBlockInput>,
    examples: Vec<PresetExampleInput>,
    stop_sequences: Vec<PresetStopSequenceInput>,
    provider_overrides: Vec<PresetProviderOverrideInput>,
}

pub struct PresetService<'a> {
    db: &'a SqlitePool,
}

impl<'a> PresetService<'a> {
    pub fn new(db: &'a SqlitePool) -> Self {
        Self { db }
    }

    pub async fn list_all(&self) -> Result<Vec<PresetSummary>, String> {
        PresetRepository::list_all(self.db).await
    }

    pub async fn get_by_id(&self, id: i64) -> Result<PresetDetail, String> {
        PresetRepository::find_by_id(self.db, id)
            .await?
            .ok_or_else(|| "指定预设不存在".to_string())
    }

    pub async fn export(&self, id: i64) -> Result<String, String> {
        let detail = self.get_by_id(id).await?;
        let portable = PortablePresetFile {
            schema_version: 1,
            format: "night-voyage-preset".to_string(),
            exported_at: now_ts(),
            preset: PortablePresetMeta {
                name: detail.preset.name,
                description: detail.preset.description,
                category: detail.preset.category,
                temperature: detail.preset.temperature,
                max_output_tokens: detail.preset.max_output_tokens,
                top_p: detail.preset.top_p,
                top_k: detail.preset.top_k,
                presence_penalty: detail.preset.presence_penalty,
                frequency_penalty: detail.preset.frequency_penalty,
                response_mode: detail.preset.response_mode,
                thinking_enabled: detail.preset.thinking_enabled,
                thinking_budget_tokens: detail.preset.thinking_budget_tokens,
                beta_features: detail.preset.beta_features,
            },
            semantic_groups: detail
                .semantic_groups
                .into_iter()
                .map(Self::semantic_group_record_to_input)
                .collect(),
            blocks: detail
                .blocks
                .into_iter()
                .filter(|block| block.semantic_option_id.is_none())
                .map(Self::preset_block_record_to_input)
                .collect(),
            examples: detail
                .examples
                .into_iter()
                .filter(|example| example.semantic_option_id.is_none())
                .map(Self::preset_example_record_to_input)
                .collect(),
            stop_sequences: detail
                .stop_sequences
                .into_iter()
                .map(Self::preset_stop_sequence_record_to_input)
                .collect(),
            provider_overrides: detail
                .provider_overrides
                .into_iter()
                .map(Self::preset_provider_override_record_to_input)
                .collect(),
        };

        serde_json::to_string_pretty(&portable).map_err(|err| err.to_string())
    }

    pub async fn import(&self, payload_json: String) -> Result<PresetDetail, String> {
        let portable = serde_json::from_str::<PortablePresetFile>(&payload_json)
            .map_err(|err| format!("预设导入 JSON 解析失败: {err}"))?;
        Self::validate_portable_preset_file(&portable)?;

        let mut name = portable.preset.name.clone();
        if PresetRepository::name_exists(self.db, &name).await? {
            name = format!("{}（导入）", name);
        }

        self.create(
            name,
            portable.preset.description,
            Some(portable.preset.category),
            portable.preset.temperature,
            portable.preset.max_output_tokens,
            portable.preset.top_p,
            portable.preset.top_k,
            portable.preset.presence_penalty,
            portable.preset.frequency_penalty,
            portable.preset.response_mode,
            portable.preset.thinking_enabled,
            portable.preset.thinking_budget_tokens,
            portable.preset.beta_features,
            Some(portable.blocks),
            Some(portable.examples),
            Some(portable.stop_sequences),
            Some(portable.provider_overrides),
            Some(portable.semantic_groups),
        )
        .await
    }

    pub async fn create(
        &self,
        name: String,
        description: Option<String>,
        category: Option<String>,
        temperature: Option<f64>,
        max_output_tokens: Option<i64>,
        top_p: Option<f64>,
        top_k: Option<i64>,
        presence_penalty: Option<f64>,
        frequency_penalty: Option<f64>,
        response_mode: Option<String>,
        thinking_enabled: Option<bool>,
        thinking_budget_tokens: Option<i64>,
        beta_features: Option<Vec<String>>,
        blocks: Option<Vec<PresetPromptBlockInput>>,
        examples: Option<Vec<PresetExampleInput>>,
        stop_sequences: Option<Vec<PresetStopSequenceInput>>,
        provider_overrides: Option<Vec<PresetProviderOverrideInput>>,
        semantic_groups: Option<Vec<PresetSemanticGroupInput>>,
    ) -> Result<PresetDetail, String> {
        let name = normalize_required_impl("name", &name)?;
        let description = normalize_optional_text_impl(description);
        let category = normalize_category_impl(category)?;
        let temperature = normalize_temperature_impl(temperature)?;
        let max_output_tokens = normalize_max_output_tokens_impl(max_output_tokens)?;
        let top_p = normalize_top_p_impl(top_p)?;
        let top_k = normalize_top_k_impl(top_k)?;
        let presence_penalty = normalize_penalty_impl(presence_penalty, "presencePenalty")?;
        let frequency_penalty = normalize_penalty_impl(frequency_penalty, "frequencyPenalty")?;
        let response_mode = normalize_response_mode_impl(response_mode, "responseMode")?;
        let thinking_enabled = normalize_thinking_enabled_impl(thinking_enabled)?;
        let thinking_budget_tokens = normalize_thinking_budget_tokens_impl(thinking_budget_tokens)?;
        let beta_features = normalize_beta_features_impl(beta_features)?;
        let direct_blocks = PresetValidator::validate_blocks(blocks)?;
        let direct_examples = PresetValidator::validate_examples(examples)?;
        let semantic_groups = PresetValidator::validate_semantic_groups(semantic_groups)?;
        let stop_sequences = PresetValidator::validate_stop_sequences(stop_sequences)?;
        let provider_overrides = PresetValidator::validate_provider_overrides(provider_overrides)?;
        let now = now_ts();

        let beta_features_json = beta_features
            .as_ref()
            .map(|f| serde_json::to_string(f).unwrap_or_default());

        let mut tx = self.db.begin().await.map_err(|err| err.to_string())?;
        let result = PresetRepository::create(
            &mut tx,
            &name,
            description,
            &category,
            temperature,
            max_output_tokens,
            top_p,
            top_k,
            presence_penalty,
            frequency_penalty,
            &response_mode,
            thinking_enabled,
            thinking_budget_tokens,
            beta_features_json.as_deref(),
            now,
        )
        .await?;

        let preset_id = result;
        let semantic_materialization =
            PresetRepository::replace_semantic_groups(&mut tx, preset_id, &semantic_groups, now)
                .await?;
        let direct_blocks =
            crate::validators::preset_validator::prune_shadowed_semantic_direct_blocks(
                direct_blocks,
                &semantic_materialization.blocks,
            );
        let blocks = merge_materialized_blocks(&direct_blocks, semantic_materialization.blocks)?;
        let examples =
            merge_materialized_examples(&direct_examples, semantic_materialization.examples);
        PresetRepository::replace_blocks(&mut tx, preset_id, &blocks, now).await?;
        PresetRepository::replace_examples(&mut tx, preset_id, &examples, now).await?;
        PresetRepository::replace_stop_sequences(&mut tx, preset_id, &stop_sequences, now).await?;
        PresetRepository::replace_provider_overrides(&mut tx, preset_id, &provider_overrides, now)
            .await?;
        tx.commit().await.map_err(|err| err.to_string())?;

        self.get_by_id(preset_id).await
    }

    pub async fn update(
        &self,
        id: i64,
        name: String,
        description: Option<String>,
        category: Option<String>,
        temperature: Option<f64>,
        max_output_tokens: Option<i64>,
        top_p: Option<f64>,
        top_k: Option<i64>,
        presence_penalty: Option<f64>,
        frequency_penalty: Option<f64>,
        response_mode: Option<String>,
        thinking_enabled: Option<bool>,
        thinking_budget_tokens: Option<i64>,
        beta_features: Option<Vec<String>>,
        blocks: Option<Vec<PresetPromptBlockInput>>,
        examples: Option<Vec<PresetExampleInput>>,
        stop_sequences: Option<Vec<PresetStopSequenceInput>>,
        provider_overrides: Option<Vec<PresetProviderOverrideInput>>,
        semantic_groups: Option<Vec<PresetSemanticGroupInput>>,
    ) -> Result<PresetDetail, String> {
        let name = normalize_required_impl("name", &name)?;
        let description = normalize_optional_text_impl(description);
        let category = normalize_category_impl(category)?;
        let temperature = normalize_temperature_impl(temperature)?;
        let max_output_tokens = normalize_max_output_tokens_impl(max_output_tokens)?;
        let top_p = normalize_top_p_impl(top_p)?;
        let top_k = normalize_top_k_impl(top_k)?;
        let presence_penalty = normalize_penalty_impl(presence_penalty, "presencePenalty")?;
        let frequency_penalty = normalize_penalty_impl(frequency_penalty, "frequencyPenalty")?;
        let response_mode = normalize_response_mode_impl(response_mode, "responseMode")?;
        let thinking_enabled = normalize_thinking_enabled_impl(thinking_enabled)?;
        let thinking_budget_tokens = normalize_thinking_budget_tokens_impl(thinking_budget_tokens)?;
        let beta_features = normalize_beta_features_impl(beta_features)?;
        let direct_blocks_input = match blocks {
            Some(blocks) => Some(PresetValidator::validate_blocks(Some(blocks))?),
            None => None,
        };
        let direct_examples_input = match examples {
            Some(examples) => Some(PresetValidator::validate_examples(Some(examples))?),
            None => None,
        };
        let semantic_groups_input = match semantic_groups {
            Some(semantic_groups) => Some(PresetValidator::validate_semantic_groups(Some(
                semantic_groups,
            ))?),
            None => None,
        };
        let stop_sequences = match stop_sequences {
            Some(stop_sequences) => Some(PresetValidator::validate_stop_sequences(Some(
                stop_sequences,
            ))?),
            None => None,
        };
        let provider_overrides = match provider_overrides {
            Some(provider_overrides) => Some(PresetValidator::validate_provider_overrides(Some(
                provider_overrides,
            ))?),
            None => None,
        };
        let now = now_ts();

        let mut tx = self.db.begin().await.map_err(|err| err.to_string())?;
        if !PresetRepository::exists(&mut tx, id).await? {
            return Err("指定预设不存在".to_string());
        }

        let direct_blocks = match direct_blocks_input {
            Some(blocks) => blocks,
            None => PresetRepository::load_existing_normalized_blocks(&mut tx, id, false).await?,
        };
        let direct_examples = match direct_examples_input {
            Some(examples) => examples,
            None => PresetRepository::load_existing_normalized_examples(&mut tx, id, false).await?,
        };
        let semantic_materialization = match semantic_groups_input.as_ref() {
            Some(semantic_groups) => {
                PresetRepository::replace_semantic_groups(&mut tx, id, semantic_groups, now).await?
            }
            None => PresetRepository::load_existing_semantic_materialization(&mut tx, id).await?,
        };
        let direct_blocks =
            crate::validators::preset_validator::prune_shadowed_semantic_direct_blocks(
                direct_blocks,
                &semantic_materialization.blocks,
            );
        let final_blocks =
            merge_materialized_blocks(&direct_blocks, semantic_materialization.blocks)?;
        let final_examples =
            merge_materialized_examples(&direct_examples, semantic_materialization.examples);

        let beta_features_json = beta_features
            .as_ref()
            .map(|f| serde_json::to_string(f).unwrap_or_default());

        Self::ensure_locked_blocks_preserved(&mut tx, id, &final_blocks).await?;

        PresetRepository::update(
            &mut tx,
            id,
            &name,
            description,
            &category,
            temperature,
            max_output_tokens,
            top_p,
            top_k,
            presence_penalty,
            frequency_penalty,
            &response_mode,
            thinking_enabled,
            thinking_budget_tokens,
            beta_features_json.as_deref(),
            now,
        )
        .await?;

        PresetRepository::replace_blocks(&mut tx, id, &final_blocks, now).await?;
        PresetRepository::replace_examples(&mut tx, id, &final_examples, now).await?;

        if let Some(stop_sequences) = stop_sequences {
            PresetRepository::replace_stop_sequences(&mut tx, id, &stop_sequences, now).await?;
        }

        if let Some(provider_overrides) = provider_overrides {
            PresetRepository::replace_provider_overrides(&mut tx, id, &provider_overrides, now)
                .await?;
        }

        tx.commit().await.map_err(|err| err.to_string())?;

        self.get_by_id(id).await
    }

    pub async fn delete(&self, id: i64) -> Result<(), String> {
        PresetRepository::ensure_not_in_use(self.db, id).await?;

        let deleted = PresetRepository::delete(self.db, id).await?;

        if !deleted {
            return Err("指定预设不存在".to_string());
        }

        Ok(())
    }

    async fn ensure_locked_blocks_preserved(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        preset_id: i64,
        final_blocks: &[crate::validators::preset_validator::NormalizedPresetPromptBlockInput],
    ) -> Result<(), String> {
        let existing_snapshots =
            PresetRepository::get_locked_block_snapshots(tx, preset_id).await?;

        if let Some(missing_label) =
            missing_locked_block_snapshot(&existing_snapshots, final_blocks)
        {
            return Err(format!(
                "不能修改或删除已锁定的块 '{}'，请先解锁后再尝试",
                missing_label
            ));
        }

        Ok(())
    }

    fn validate_portable_preset_file(file: &PortablePresetFile) -> Result<(), String> {
        if file.format.trim() != "night-voyage-preset" {
            return Err("仅支持导入 Night Voyage 自有预设格式".to_string());
        }
        if file.schema_version != 1 {
            return Err(format!(
                "当前只支持 schemaVersion=1，收到 {}",
                file.schema_version
            ));
        }
        let _ = normalize_required_impl("preset.name", &file.preset.name)?;
        let _ = normalize_required_impl("preset.category", &file.preset.category)?;
        Ok(())
    }

    fn semantic_group_record_to_input(
        group: PresetSemanticGroupRecord,
    ) -> PresetSemanticGroupInput {
        PresetSemanticGroupInput {
            group_key: group.group_key,
            label: group.label,
            description: group.description,
            sort_order: Some(group.sort_order),
            selection_mode: Some(group.selection_mode),
            is_enabled: Some(group.is_enabled),
            options: Some(
                group
                    .options
                    .into_iter()
                    .map(Self::semantic_option_record_to_input)
                    .collect(),
            ),
        }
    }

    fn semantic_option_record_to_input(
        option: crate::models::PresetSemanticOptionRecord,
    ) -> PresetSemanticOptionInput {
        PresetSemanticOptionInput {
            option_key: option.option_key,
            label: option.label,
            description: option.description,
            sort_order: Some(option.sort_order),
            is_selected: Some(option.is_selected),
            is_enabled: Some(option.is_enabled),
            expansion_kind: Some(option.expansion_kind),
            blocks: Some(
                option
                    .blocks
                    .into_iter()
                    .map(Self::semantic_option_block_record_to_input)
                    .collect(),
            ),
            examples: Some(
                option
                    .examples
                    .into_iter()
                    .map(Self::semantic_option_example_record_to_input)
                    .collect(),
            ),
            children: Some(
                option
                    .children
                    .into_iter()
                    .map(Self::semantic_option_record_to_input)
                    .collect(),
            ),
        }
    }

    fn semantic_option_block_record_to_input(
        block: crate::models::PresetSemanticOptionBlockRecord,
    ) -> PresetPromptBlockInput {
        PresetPromptBlockInput {
            block_type: block.block_type,
            title: block.title,
            content: block.content,
            sort_order: Some(block.sort_order),
            priority: Some(block.priority),
            is_enabled: Some(block.is_enabled),
            scope: Some(block.scope),
            is_locked: Some(block.is_locked),
            lock_reason: block.lock_reason,
            exclusive_group_key: block.exclusive_group_key,
            exclusive_group_label: block.exclusive_group_label,
        }
    }

    fn semantic_option_example_record_to_input(
        example: crate::models::PresetSemanticOptionExampleRecord,
    ) -> PresetExampleInput {
        PresetExampleInput {
            role: example.role,
            content: example.content,
            sort_order: Some(example.sort_order),
            is_enabled: Some(example.is_enabled),
        }
    }

    fn preset_block_record_to_input(
        block: crate::models::PresetPromptBlockRecord,
    ) -> PresetPromptBlockInput {
        PresetPromptBlockInput {
            block_type: block.block_type,
            title: block.title,
            content: block.content,
            sort_order: Some(block.sort_order),
            priority: Some(block.priority),
            is_enabled: Some(block.is_enabled),
            scope: Some(block.scope),
            is_locked: Some(block.is_locked),
            lock_reason: block.lock_reason,
            exclusive_group_key: block.exclusive_group_key,
            exclusive_group_label: block.exclusive_group_label,
        }
    }

    fn preset_example_record_to_input(
        example: crate::models::PresetExampleRecord,
    ) -> PresetExampleInput {
        PresetExampleInput {
            role: example.role,
            content: example.content,
            sort_order: Some(example.sort_order),
            is_enabled: Some(example.is_enabled),
        }
    }

    fn preset_stop_sequence_record_to_input(
        stop_sequence: crate::models::PresetStopSequenceRecord,
    ) -> PresetStopSequenceInput {
        PresetStopSequenceInput {
            stop_text: stop_sequence.stop_text,
            sort_order: Some(stop_sequence.sort_order),
        }
    }

    fn preset_provider_override_record_to_input(
        provider_override: crate::models::PresetProviderOverrideRecord,
    ) -> PresetProviderOverrideInput {
        PresetProviderOverrideInput {
            provider_kind: provider_override.provider_kind,
            temperature_override: provider_override.temperature_override,
            max_output_tokens_override: provider_override.max_output_tokens_override,
            top_p_override: provider_override.top_p_override,
            top_k_override: provider_override.top_k_override,
            presence_penalty_override: provider_override.presence_penalty_override,
            frequency_penalty_override: provider_override.frequency_penalty_override,
            response_mode_override: provider_override.response_mode_override,
            stop_sequences_override: Some(provider_override.stop_sequences_override),
            disabled_block_types: Some(provider_override.disabled_block_types),
            thinking_enabled_override: provider_override.thinking_enabled_override,
            thinking_budget_tokens_override: provider_override.thinking_budget_tokens_override,
            beta_features_override: provider_override.beta_features_override,
        }
    }
}

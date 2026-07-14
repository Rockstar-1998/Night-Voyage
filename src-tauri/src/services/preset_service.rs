use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::models::{PresetDetail, PresetSemanticGroupRecord, PresetSummary};
use crate::repositories::preset_repository::PresetRepository;
use crate::utils::now_ts;
use crate::validators::preset_validator::{
    merge_materialized_blocks, missing_locked_block_snapshot,
    normalize_beta_features_impl, normalize_category_impl, normalize_max_output_tokens_impl,
    normalize_optional_text_impl, normalize_penalty_impl, normalize_required_impl,
    normalize_response_mode_impl, normalize_temperature_impl,
    normalize_thinking_budget_tokens_impl, normalize_thinking_enabled_impl, normalize_top_k_impl,
    normalize_top_p_impl, validate_blueprint_graph, PresetValidator,
};
use crate::validators::preset_validator::{
    PresetPromptBlockInput, PresetProviderOverrideInput,
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
    pub structured_output_schema: Option<String>,
    pub structured_output_display: Option<String>,
    pub context_included_keys: Option<String>,
    pub blueprint_graph: Option<String>,
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
                structured_output_schema: detail.preset.structured_output_schema,
                structured_output_display: detail.preset.structured_output_display,
                context_included_keys: detail.preset.context_included_keys,
                blueprint_graph: detail.preset.blueprint_graph,
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
            portable.preset.structured_output_schema,
            portable.preset.structured_output_display,
            portable.preset.context_included_keys,
            portable.preset.blueprint_graph,
            Some(portable.blocks),
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
        structured_output_schema: Option<String>,
        structured_output_display: Option<String>,
        context_included_keys: Option<String>,
        blueprint_graph: Option<String>,
        blocks: Option<Vec<PresetPromptBlockInput>>,
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
        let structured_output_schema = normalize_optional_text_impl(structured_output_schema);
        let structured_output_display = normalize_optional_text_impl(structured_output_display);
        let context_included_keys = normalize_optional_text_impl(context_included_keys);
        let blueprint_graph = normalize_optional_text_impl(blueprint_graph);
        blueprint_graph
            .as_deref()
            .map(validate_blueprint_graph)
            .transpose()?;
        let direct_blocks = PresetValidator::validate_blocks(blocks)?;
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
            structured_output_schema.as_deref(),
            structured_output_display.as_deref(),
            context_included_keys.as_deref(),
            blueprint_graph.as_deref(),
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
        PresetRepository::replace_blocks(&mut tx, preset_id, &blocks, now).await?;
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
        structured_output_schema: Option<String>,
        structured_output_display: Option<String>,
        context_included_keys: Option<String>,
        blueprint_graph: Option<String>,
        blocks: Option<Vec<PresetPromptBlockInput>>,
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
        let structured_output_schema = normalize_optional_text_impl(structured_output_schema);
        let structured_output_display = normalize_optional_text_impl(structured_output_display);
        let context_included_keys = normalize_optional_text_impl(context_included_keys);
        let blueprint_graph = normalize_optional_text_impl(blueprint_graph);
        blueprint_graph
            .as_deref()
            .map(validate_blueprint_graph)
            .transpose()?;
        let direct_blocks_input = match blocks {
            Some(blocks) => Some(PresetValidator::validate_blocks(Some(blocks))?),
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
            structured_output_schema.as_deref(),
            structured_output_display.as_deref(),
            context_included_keys.as_deref(),
            blueprint_graph.as_deref(),
            now,
        )
        .await?;

        PresetRepository::replace_blocks(&mut tx, id, &final_blocks, now).await?;

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

    pub async fn rename(&self, id: i64, new_name: String) -> Result<PresetDetail, String> {
        let now = now_ts();
        let renamed = PresetRepository::rename(self.db, id, &new_name, now).await?;
        if !renamed {
            return Err("指定预设不存在".to_string());
        }
        self.get_by_id(id).await
    }

    pub async fn duplicate(&self, id: i64, new_name: String) -> Result<PresetDetail, String> {
        let json = self.export(id).await?;
        let detail = self.import(json).await?;
        self.rename(detail.preset.id, new_name).await
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
            examples: Some(vec![]),
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
            structured_output_schema_override: provider_override.structured_output_schema_override,
            structured_output_display_override: provider_override.structured_output_display_override,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::blueprint::{
        BlueprintExecutionContext, BlueprintGraph, BlueprintNode, BlueprintEdge, NodeConfig,
        Position, PromptConfig, SchemaFieldConfig, SamplingParamsConfig, ModeSwitchConfig,
    };
    use crate::services::blueprint_executor::execute_blueprint;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Build an in-memory SQLite database with all migrations applied.
    /// This is the "backdoor" that lets us test the full preset ↔
    /// blueprint chain without running the Tauri app.
    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite::memory:");
        sqlx::migrate!()
            .run(&pool)
            .await
            .expect("run migrations");
        pool
    }

    /// A minimal valid blueprint graph: Start → ModeSwitch → End.
    /// ModeSwitch's three outlets all connect directly to End.
    fn minimal_graph_json() -> String {
        let graph = BlueprintGraph {
            version: 2,
            nodes: vec![
                BlueprintNode {
                    id: "n_start".to_string(),
                    config: NodeConfig::Start,
                    position: Position { x: 0.0, y: 300.0 },
                },
                BlueprintNode {
                    id: "n_mode".to_string(),
                    config: NodeConfig::ModeSwitch(ModeSwitchConfig {
                        label: "记忆模式分支".to_string(),
                    }),
                    position: Position { x: 200.0, y: 300.0 },
                },
                BlueprintNode {
                    id: "n_end".to_string(),
                    config: NodeConfig::End,
                    position: Position { x: 400.0, y: 300.0 },
                },
            ],
            edges: vec![
                BlueprintEdge {
                    id: "e1".to_string(),
                    source: "n_start".to_string(),
                    source_port: "out".to_string(),
                    target: "n_mode".to_string(),
                    target_port: "in".to_string(),
                },
                BlueprintEdge {
                    id: "e2".to_string(),
                    source: "n_mode".to_string(),
                    source_port: "out_legacy".to_string(),
                    target: "n_end".to_string(),
                    target_port: "in".to_string(),
                },
                BlueprintEdge {
                    id: "e3".to_string(),
                    source: "n_mode".to_string(),
                    source_port: "out_mem0".to_string(),
                    target: "n_end".to_string(),
                    target_port: "in".to_string(),
                },
                BlueprintEdge {
                    id: "e4".to_string(),
                    source: "n_mode".to_string(),
                    source_port: "out_stateless".to_string(),
                    target: "n_end".to_string(),
                    target_port: "in".to_string(),
                },
            ],
        };
        serde_json::to_string(&graph).expect("serialize graph")
    }

    /// A graph with a Prompt node and a SchemaField node:
    /// Start → Prompt → SchemaField → End
    fn full_graph_json() -> String {
        let graph = BlueprintGraph {
            version: 2,
            nodes: vec![
                BlueprintNode {
                    id: "n_start".to_string(),
                    config: NodeConfig::Start,
                    position: Position { x: 0.0, y: 300.0 },
                },
                BlueprintNode {
                    id: "n_prompt".to_string(),
                    config: NodeConfig::Prompt(PromptConfig {
                        identifier: "role_def".to_string(),
                        block_type: "system".to_string(),
                        content: "You are a narrator.".to_string(),
                        priority: Some(10),
                        is_locked: false,
                        lock_reason: None,
                    }),
                    position: Position { x: 200.0, y: 300.0 },
                },
                BlueprintNode {
                    id: "n_schema".to_string(),
                    config: NodeConfig::SchemaField(SchemaFieldConfig {
                        field_name: "world_variables".to_string(),
                        field_type: "object".to_string(),
                        description: "世界状态".to_string(),
                        sub_schema: None,
                        db_mapping: Some("world_variables".to_string()),
                        is_locked: false,
                        lock_reason: None,
                    }),
                    position: Position { x: 400.0, y: 300.0 },
                },
                BlueprintNode {
                    id: "n_sampling".to_string(),
                    config: NodeConfig::SamplingParams(SamplingParamsConfig {
                        temperature: Some(0.8),
                        max_tokens: Some(4096),
                        top_p: Some(0.95),
                        frequency_penalty: None,
                        presence_penalty: None,
                        stop: None,
                        is_locked: false,
                    }),
                    position: Position { x: 600.0, y: 300.0 },
                },
                BlueprintNode {
                    id: "n_end".to_string(),
                    config: NodeConfig::End,
                    position: Position { x: 800.0, y: 300.0 },
                },
            ],
            edges: vec![
                BlueprintEdge {
                    id: "e1".to_string(),
                    source: "n_start".to_string(),
                    source_port: "out".to_string(),
                    target: "n_prompt".to_string(),
                    target_port: "in".to_string(),
                },
                BlueprintEdge {
                    id: "e2".to_string(),
                    source: "n_prompt".to_string(),
                    source_port: "out".to_string(),
                    target: "n_schema".to_string(),
                    target_port: "in".to_string(),
                },
                BlueprintEdge {
                    id: "e3".to_string(),
                    source: "n_schema".to_string(),
                    source_port: "out".to_string(),
                    target: "n_sampling".to_string(),
                    target_port: "in".to_string(),
                },
                BlueprintEdge {
                    id: "e4".to_string(),
                    source: "n_sampling".to_string(),
                    source_port: "out".to_string(),
                    target: "n_end".to_string(),
                    target_port: "in".to_string(),
                },
            ],
        };
        serde_json::to_string(&graph).expect("serialize graph")
    }

    /// Create a preset with all nullable fields set to `None` except `name`
    /// and `blueprint_graph`. This simulates the "new empty preset" scenario
    /// that was failing in the Blueprint editor.
    async fn create_test_preset(
        svc: &PresetService<'_>,
        name: &str,
        graph_json: Option<String>,
    ) -> PresetDetail {
        svc.create(
            name.to_string(),
            None,           // description
            Some("test".to_string()), // category
            None,           // temperature
            None,           // max_output_tokens (NULL, not 0)
            None,           // top_p
            None,           // top_k
            None,           // presence_penalty
            None,           // frequency_penalty
            None,           // response_mode
            None,           // thinking_enabled
            None,           // thinking_budget_tokens
            None,           // beta_features
            None,           // structured_output_schema
            None,           // structured_output_display
            None,           // context_included_keys
            graph_json,     // blueprint_graph
            None,           // blocks
            None,           // stop_sequences
            None,           // provider_overrides
            None,           // semantic_groups
        )
        .await
        .expect("create preset must succeed")
    }

    // ─── Test 1: Create preset with blueprint_graph, load it back ───

    #[tokio::test]
    async fn test_create_and_load_blueprint_graph() {
        let pool = setup_test_db().await;
        let svc = PresetService::new(&pool);

        let graph_json = minimal_graph_json();
        let detail = create_test_preset(&svc, "test_preset_1", Some(graph_json.clone())).await;

        // The loaded graph must match what we saved.
        assert_eq!(
            detail.preset.blueprint_graph.as_deref(),
            Some(graph_json.as_str()),
            "loaded blueprint_graph must match saved value"
        );
    }

    // ─── Test 2: Create preset without graph, update with graph ───

    #[tokio::test]
    async fn test_create_without_graph_then_update_with_graph() {
        let pool = setup_test_db().await;
        let svc = PresetService::new(&pool);

        // Create without graph (simulates "new empty preset" button).
        let detail = create_test_preset(&svc, "test_preset_2", None).await;
        assert!(
            detail.preset.blueprint_graph.is_none(),
            "new preset should have no blueprint_graph"
        );

        // Now update with a graph (simulates editor auto-migration save).
        let graph_json = minimal_graph_json();
        let updated = svc
            .update(
                detail.preset.id,
                detail.preset.name,
                detail.preset.description,
                Some(detail.preset.category),
                detail.preset.temperature,
                detail.preset.max_output_tokens,
                detail.preset.top_p,
                detail.preset.top_k,
                detail.preset.presence_penalty,
                detail.preset.frequency_penalty,
                detail.preset.response_mode,
                detail.preset.thinking_enabled,
                detail.preset.thinking_budget_tokens,
                detail.preset.beta_features,
                detail.preset.structured_output_schema,
                detail.preset.structured_output_display,
                detail.preset.context_included_keys,
                Some(graph_json.clone()),
                None, // blocks
                None, // stop_sequences
                None, // provider_overrides
                None, // semantic_groups
            )
            .await
            .expect("update must succeed");

        assert_eq!(
            updated.preset.blueprint_graph.as_deref(),
            Some(graph_json.as_str()),
            "updated blueprint_graph must match"
        );
    }

    // ─── Test 3: max_output_tokens = Some(0) is normalized to None ───

    #[tokio::test]
    async fn test_legacy_zero_max_output_tokens_normalized() {
        let pool = setup_test_db().await;
        let svc = PresetService::new(&pool);

        // Create with max_output_tokens = Some(0) — the legacy sentinel.
        // The validator should normalize it to None, not reject it.
        let detail = svc
            .create(
                "test_legacy_zero".to_string(),
                None,
                Some("test".to_string()),
                None,
                Some(0),         // max_output_tokens = 0 (legacy sentinel)
                None,            // top_p
                Some(0),         // top_k = 0 (legacy sentinel)
                None,            // presence_penalty
                None,            // frequency_penalty
                None,            // response_mode
                None,            // thinking_enabled
                None,            // thinking_budget_tokens
                None,            // beta_features
                None,            // structured_output_schema
                None,            // structured_output_display
                None,            // context_included_keys
                Some(minimal_graph_json()),
                None,            // blocks
                None,            // stop_sequences
                None,            // provider_overrides
                None,            // semantic_groups
            )
            .await
            .expect("create with legacy zero sentinel must succeed");

        // The stored value must be NULL (normalized from 0).
        assert!(
            detail.preset.max_output_tokens.is_none(),
            "max_output_tokens=0 must be normalized to NULL, got {:?}",
            detail.preset.max_output_tokens
        );
        assert!(
            detail.preset.top_k.is_none(),
            "top_k=0 must be normalized to NULL, got {:?}",
            detail.preset.top_k
        );
    }

    // ─── Test 4: Update preset with legacy zero values + graph ───
    // This is the exact scenario that was blocking the Blueprint editor:
    // an old preset with max_output_tokens=0 being saved with a new graph.

    #[tokio::test]
    async fn test_update_with_legacy_zero_and_graph() {
        let pool = setup_test_db().await;
        let svc = PresetService::new(&pool);

        // First create a preset with zero sentinels.
        let detail = svc
            .create(
                "test_update_legacy".to_string(),
                None,
                Some("test".to_string()),
                None,
                Some(0),  // max_output_tokens = 0
                None,
                Some(0),  // top_k = 0
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,     // no blueprint_graph yet
                None,
                None,
                None,
                None,
            )
            .await
            .expect("create must succeed");

        // Now simulate the Blueprint editor's save: echo back all fields
        // (including the 0 that was loaded from DB) + new graph.
        let graph_json = full_graph_json();
        let updated = svc
            .update(
                detail.preset.id,
                detail.preset.name.clone(),
                detail.preset.description.clone(),
                Some(detail.preset.category.clone()),
                detail.preset.temperature,
                detail.preset.max_output_tokens,  // None after normalization
                detail.preset.top_p,
                detail.preset.top_k,              // None after normalization
                detail.preset.presence_penalty,
                detail.preset.frequency_penalty,
                detail.preset.response_mode.clone(),
                detail.preset.thinking_enabled,
                detail.preset.thinking_budget_tokens,
                detail.preset.beta_features.clone(),
                detail.preset.structured_output_schema.clone(),
                detail.preset.structured_output_display.clone(),
                detail.preset.context_included_keys.clone(),
                Some(graph_json.clone()),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("update with legacy zero + graph must succeed");

        assert_eq!(
            updated.preset.blueprint_graph.as_deref(),
            Some(graph_json.as_str()),
            "graph must be saved"
        );
        assert!(
            updated.preset.max_output_tokens.is_none(),
            "max_output_tokens must be NULL after normalization"
        );
    }

    // ─── Test 5: Execute a blueprint graph end-to-end ───

    #[tokio::test]
    async fn test_execute_full_blueprint_graph() {
        let graph_json = full_graph_json();
        let graph: BlueprintGraph =
            serde_json::from_str(&graph_json).expect("parse graph JSON");

        let ctx = BlueprintExecutionContext {
            memory_mode: "stateless".to_string(),
            gate_selections: std::collections::HashMap::new(),
        };

        let result = execute_blueprint(&graph, &ctx)
            .await
            .expect("blueprint execution must succeed");

        // One Prompt block.
        assert_eq!(result.blocks.len(), 1, "exactly one block expected");
        assert_eq!(result.blocks[0].identifier, "role_def");
        assert_eq!(result.blocks[0].block_type, "system");
        assert_eq!(result.blocks[0].content, "You are a narrator.");

        // One schema property: world_variables.
        let props = result.structured_output_schema["properties"]
            .as_object()
            .expect("properties must be an object");
        assert_eq!(props.len(), 1, "exactly one property expected");
        assert!(props.contains_key("world_variables"));

        // db_mapping recorded.
        assert_eq!(
            result.db_mappings.get("world_variables").map(|s| s.as_str()),
            Some("world_variables"),
            "db_mapping must be recorded"
        );

        // Sampling params applied.
        assert_eq!(result.sampling_params.temperature, Some(0.8));
        assert_eq!(result.sampling_params.max_tokens, Some(4096));
        assert_eq!(result.sampling_params.top_p, Some(0.95));
    }

    // ─── Test 6: Create → update graph → execute ───
    // Full end-to-end: create preset with graph, update graph, execute.

    #[tokio::test]
    async fn test_full_lifecycle_create_update_execute() {
        let pool = setup_test_db().await;
        let svc = PresetService::new(&pool);

        // Step 1: Create with minimal graph.
        let detail = create_test_preset(&svc, "lifecycle", Some(minimal_graph_json())).await;

        // Step 2: Update with full graph.
        let graph_json = full_graph_json();
        let updated = svc
            .update(
                detail.preset.id,
                detail.preset.name,
                detail.preset.description,
                Some(detail.preset.category),
                detail.preset.temperature,
                detail.preset.max_output_tokens,
                detail.preset.top_p,
                detail.preset.top_k,
                detail.preset.presence_penalty,
                detail.preset.frequency_penalty,
                detail.preset.response_mode,
                detail.preset.thinking_enabled,
                detail.preset.thinking_budget_tokens,
                detail.preset.beta_features,
                detail.preset.structured_output_schema,
                detail.preset.structured_output_display,
                detail.preset.context_included_keys,
                Some(graph_json.clone()),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("update must succeed");

        // Step 3: Load back and execute.
        let loaded = svc.get_by_id(updated.preset.id).await.expect("get must succeed");
        let graph_str = loaded.preset.blueprint_graph
            .as_deref()
            .expect("graph must be present");
        let graph: BlueprintGraph =
            serde_json::from_str(graph_str).expect("parse graph JSON");

        let ctx = BlueprintExecutionContext {
            memory_mode: "stateless".to_string(),
            gate_selections: std::collections::HashMap::new(),
        };

        let result = execute_blueprint(&graph, &ctx)
            .await
            .expect("execution must succeed");

        assert_eq!(result.blocks.len(), 1, "one block from Prompt node");
        assert_eq!(result.blocks[0].identifier, "role_def");
        assert!(
            result.structured_output_schema["properties"]
                .as_object()
                .unwrap()
                .contains_key("world_variables"),
            "world_variables field must be in schema"
        );
    }
}


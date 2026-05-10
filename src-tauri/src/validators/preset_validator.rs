use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::services::prompt_compiler::{
    validate_preset_block_definition, PresetBlockValidationKind,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresetPromptBlockInput {
    pub block_type: String,
    pub title: Option<String>,
    pub content: String,
    pub sort_order: Option<i64>,
    pub priority: Option<i64>,
    pub is_enabled: Option<bool>,
    pub scope: Option<String>,
    pub is_locked: Option<bool>,
    pub lock_reason: Option<String>,
    pub exclusive_group_key: Option<String>,
    pub exclusive_group_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedPresetPromptBlockInput {
    pub block_type: String,
    pub title: Option<String>,
    pub content: String,
    pub sort_order: i64,
    pub priority: i64,
    pub is_enabled: bool,
    pub scope: String,
    pub is_locked: bool,
    pub lock_reason: Option<String>,
    pub exclusive_group_key: Option<String>,
    pub exclusive_group_label: Option<String>,
    pub semantic_option_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PresetBlockLockSnapshot {
    pub block_type: String,
    pub title: Option<String>,
    pub content: String,
    pub sort_order: i64,
    pub priority: i64,
    pub is_enabled: bool,
    pub scope: String,
    pub is_locked: bool,
    pub lock_reason: Option<String>,
    pub exclusive_group_key: Option<String>,
    pub exclusive_group_label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresetExampleInput {
    pub role: String,
    pub content: String,
    pub sort_order: Option<i64>,
    pub is_enabled: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct NormalizedPresetExampleInput {
    pub role: String,
    pub content: String,
    pub sort_order: i64,
    pub is_enabled: bool,
    pub semantic_option_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresetSemanticOptionInput {
    pub option_key: String,
    pub label: String,
    pub description: Option<String>,
    pub sort_order: Option<i64>,
    pub is_selected: Option<bool>,
    pub is_enabled: Option<bool>,
    pub expansion_kind: Option<String>,
    pub blocks: Option<Vec<PresetPromptBlockInput>>,
    pub examples: Option<Vec<PresetExampleInput>>,
    pub children: Option<Vec<PresetSemanticOptionInput>>,
}

#[derive(Debug, Clone)]
pub struct NormalizedPresetSemanticOptionInput {
    pub option_key: String,
    pub label: String,
    pub description: Option<String>,
    pub depth: i64,
    pub sort_order: i64,
    pub is_selected: bool,
    pub is_enabled: bool,
    pub expansion_kind: String,
    pub blocks: Vec<NormalizedPresetPromptBlockInput>,
    pub examples: Vec<NormalizedPresetExampleInput>,
    pub children: Vec<NormalizedPresetSemanticOptionInput>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresetSemanticGroupInput {
    pub group_key: String,
    pub label: String,
    pub description: Option<String>,
    pub sort_order: Option<i64>,
    pub selection_mode: Option<String>,
    pub is_enabled: Option<bool>,
    pub options: Option<Vec<PresetSemanticOptionInput>>,
}

#[derive(Debug, Clone)]
pub struct NormalizedPresetSemanticGroupInput {
    pub group_key: String,
    pub label: String,
    pub description: Option<String>,
    pub sort_order: i64,
    pub selection_mode: String,
    pub is_enabled: bool,
    pub options: Vec<NormalizedPresetSemanticOptionInput>,
}

#[derive(Debug, Clone)]
pub struct FlatNormalizedPresetSemanticOptionInput {
    pub temp_id: usize,
    pub parent_temp_id: Option<usize>,
    pub option_key: String,
    pub label: String,
    pub description: Option<String>,
    pub depth: i64,
    pub sort_order: i64,
    pub is_selected: bool,
    pub is_enabled: bool,
    pub expansion_kind: String,
    pub blocks: Vec<NormalizedPresetPromptBlockInput>,
    pub examples: Vec<NormalizedPresetExampleInput>,
}

#[derive(Debug, Default)]
pub struct SemanticMaterialization {
    pub blocks: Vec<NormalizedPresetPromptBlockInput>,
    pub examples: Vec<NormalizedPresetExampleInput>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresetStopSequenceInput {
    pub stop_text: String,
    pub sort_order: Option<i64>,
}

#[derive(Debug)]
pub struct NormalizedPresetStopSequenceInput {
    pub stop_text: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresetProviderOverrideInput {
    pub provider_kind: String,
    pub temperature_override: Option<f64>,
    pub max_output_tokens_override: Option<i64>,
    pub top_p_override: Option<f64>,
    pub top_k_override: Option<i64>,
    pub presence_penalty_override: Option<f64>,
    pub frequency_penalty_override: Option<f64>,
    pub response_mode_override: Option<String>,
    pub stop_sequences_override: Option<Vec<String>>,
    pub disabled_block_types: Option<Vec<String>>,
    pub thinking_enabled_override: Option<bool>,
    pub thinking_budget_tokens_override: Option<i64>,
    pub beta_features_override: Option<Vec<String>>,
}

#[derive(Debug)]
pub struct NormalizedPresetProviderOverrideInput {
    pub provider_kind: String,
    pub temperature_override: Option<f64>,
    pub max_output_tokens_override: Option<i64>,
    pub top_p_override: Option<f64>,
    pub top_k_override: Option<i64>,
    pub presence_penalty_override: Option<f64>,
    pub frequency_penalty_override: Option<f64>,
    pub response_mode_override: Option<String>,
    pub stop_sequences_override: Option<Vec<String>>,
    pub disabled_block_types: Option<Vec<String>>,
    pub thinking_enabled_override: Option<bool>,
    pub thinking_budget_tokens_override: Option<i64>,
    pub beta_features_override: Option<Vec<String>>,
}

pub struct PresetValidator;

impl PresetValidator {
    pub fn validate_blocks(
        blocks: Option<Vec<PresetPromptBlockInput>>,
    ) -> Result<Vec<NormalizedPresetPromptBlockInput>, String> {
        normalize_blocks(blocks)
    }

    pub fn validate_examples(
        examples: Option<Vec<PresetExampleInput>>,
    ) -> Result<Vec<NormalizedPresetExampleInput>, String> {
        normalize_examples(examples)
    }

    pub fn validate_semantic_groups(
        groups: Option<Vec<PresetSemanticGroupInput>>,
    ) -> Result<Vec<NormalizedPresetSemanticGroupInput>, String> {
        normalize_semantic_groups(groups)
    }

    pub fn validate_stop_sequences(
        stop_sequences: Option<Vec<PresetStopSequenceInput>>,
    ) -> Result<Vec<NormalizedPresetStopSequenceInput>, String> {
        normalize_stop_sequences(stop_sequences)
    }

    pub fn validate_provider_overrides(
        provider_overrides: Option<Vec<PresetProviderOverrideInput>>,
    ) -> Result<Vec<NormalizedPresetProviderOverrideInput>, String> {
        normalize_provider_overrides(provider_overrides)
    }

    pub fn normalize_required(field_name: &str, value: &str) -> Result<String, String> {
        normalize_required_impl(field_name, value)
    }

    pub fn normalize_optional_text(value: Option<String>) -> Option<String> {
        normalize_optional_text_impl(value)
    }

    pub fn normalize_category(value: Option<String>) -> Result<String, String> {
        normalize_category_impl(value)
    }

    pub fn normalize_temperature(value: Option<f64>) -> Result<Option<f64>, String> {
        normalize_temperature_impl(value)
    }

    pub fn normalize_max_output_tokens(value: Option<i64>) -> Result<Option<i64>, String> {
        normalize_max_output_tokens_impl(value)
    }

    pub fn normalize_top_p(value: Option<f64>) -> Result<Option<f64>, String> {
        normalize_top_p_impl(value)
    }

    pub fn normalize_penalty(value: Option<f64>, field_name: &str) -> Result<Option<f64>, String> {
        normalize_penalty_impl(value, field_name)
    }

    pub fn normalize_response_mode(
        value: Option<String>,
        field_name: &str,
    ) -> Result<String, String> {
        normalize_response_mode_impl(value, field_name)
    }
}

pub fn normalize_required_impl(field_name: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} 不能为空"));
    }
    Ok(trimmed.to_string())
}

pub fn normalize_required_from_row_impl(value: String, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} 不能为空"));
    }
    Ok(trimmed.to_string())
}

pub fn normalize_optional_text_impl(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn normalize_lock_reason_impl(
    index: usize,
    is_locked: bool,
    value: Option<String>,
) -> Result<Option<String>, String> {
    let normalized = normalize_optional_text_impl(value);
    if !is_locked && normalized.is_some() {
        return Err(format!(
            "blocks[{index}].lockReason can only be set when isLocked is true"
        ));
    }
    Ok(normalized)
}

pub fn normalize_exclusive_group_key_impl(
    index: usize,
    value: Option<String>,
) -> Result<Option<String>, String> {
    let Some(value) = normalize_optional_text_impl(value) else {
        return Ok(None);
    };

    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | ':' | '.'))
    {
        Ok(Some(value))
    } else {
        Err(format!(
            "blocks[{index}].exclusiveGroupKey contains unsupported characters"
        ))
    }
}

pub fn normalize_exclusive_group_label_impl(
    index: usize,
    key: &Option<String>,
    value: Option<String>,
) -> Result<Option<String>, String> {
    let normalized = normalize_optional_text_impl(value);
    if key.is_none() && normalized.is_some() {
        return Err(format!(
            "blocks[{index}].exclusiveGroupLabel requires exclusiveGroupKey"
        ));
    }
    Ok(normalized)
}

pub fn normalize_optional_string_list_impl(
    field_name: &str,
    values: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, String> {
    let Some(values) = values else {
        return Ok(None);
    };

    let mut normalized = Vec::with_capacity(values.len());
    let mut seen = HashSet::with_capacity(values.len());
    for (index, value) in values.into_iter().enumerate() {
        let value = normalize_required_impl(&format!("{field_name}[{index}]"), &value)?;
        if seen.insert(value.clone()) {
            normalized.push(value);
        }
    }

    Ok(Some(normalized))
}

pub fn normalize_category_impl(value: Option<String>) -> Result<String, String> {
    match value {
        Some(category) => normalize_required_impl("category", &category),
        None => Ok("general".to_string()),
    }
}

pub fn normalize_temperature_impl(value: Option<f64>) -> Result<Option<f64>, String> {
    match value {
        Some(temp) => {
            if !(0.0..=2.0).contains(&temp) {
                return Err("temperature 必须在 0.0 到 2.0 之间".to_string());
            }
            Ok(Some(temp))
        }
        None => Ok(None),
    }
}

pub fn normalize_max_output_tokens_impl(value: Option<i64>) -> Result<Option<i64>, String> {
    match value {
        Some(tokens) => {
            if tokens <= 0 {
                return Err("maxOutputTokens 必须大于 0".to_string());
            }
            Ok(Some(tokens))
        }
        None => Ok(None),
    }
}

pub fn normalize_top_p_impl(value: Option<f64>) -> Result<Option<f64>, String> {
    match value {
        Some(top_p) => {
            if !(0.0..=1.0).contains(&top_p) {
                return Err("topP 必须在 0.0 到 1.0 之间".to_string());
            }
            Ok(Some(top_p))
        }
        None => Ok(None),
    }
}

pub fn normalize_top_k_impl(value: Option<i64>) -> Result<Option<i64>, String> {
    match value {
        Some(top_k) => {
            if top_k <= 0 {
                return Err("topK 必须大于 0".to_string());
            }
            Ok(Some(top_k))
        }
        None => Ok(None),
    }
}

pub fn normalize_thinking_enabled_impl(value: Option<bool>) -> Result<Option<bool>, String> {
    Ok(value)
}

pub fn normalize_thinking_budget_tokens_impl(value: Option<i64>) -> Result<Option<i64>, String> {
    match value {
        Some(budget) => {
            if budget < 128 {
                return Err("thinkingBudgetTokens 必须 >= 128".to_string());
            }
            if budget > 128000 {
                return Err("thinkingBudgetTokens 必须 <= 128000".to_string());
            }
            Ok(Some(budget))
        }
        None => Ok(None),
    }
}

pub fn normalize_beta_features_impl(
    value: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, String> {
    match value {
        Some(features) => {
            for feature in &features {
                if feature.trim().is_empty() {
                    return Err("betaFeatures 中的每个元素不能为空字符串".to_string());
                }
            }
            if features.is_empty() {
                Ok(None)
            } else {
                Ok(Some(features))
            }
        }
        None => Ok(None),
    }
}

pub fn normalize_penalty_impl(value: Option<f64>, field_name: &str) -> Result<Option<f64>, String> {
    match value {
        Some(penalty) => {
            if !(-2.0..=2.0).contains(&penalty) {
                return Err(format!("{field_name} 必须在 -2.0 到 2.0 之间"));
            }
            Ok(Some(penalty))
        }
        None => Ok(None),
    }
}

pub fn normalize_response_mode_impl(
    value: Option<String>,
    field_name: &str,
) -> Result<String, String> {
    match value {
        Some(mode) => {
            let trimmed = mode.trim();
            if trimmed.is_empty() {
                return Ok("compact".to_string());
            }
            let normalized = trimmed.to_lowercase();
            if !["compact", "verbose", "auto"].contains(&normalized.as_str()) {
                return Err(format!("{field_name} 必须是 compact、verbose 或 auto"));
            }
            Ok(normalized)
        }
        None => Ok("compact".to_string()),
    }
}

fn normalize_optional_response_mode_from_row_impl(
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

fn normalize_scope_impl(index: usize, value: Option<String>) -> Result<String, String> {
    match value {
        Some(scope) => {
            let trimmed = scope.trim().to_lowercase();
            if !["global", "conversation", "character"].contains(&trimmed.as_str()) {
                return Err(format!(
                    "blocks[{index}].scope 必须是 global、conversation 或 character"
                ));
            }
            Ok(trimmed)
        }
        None => Ok("global".to_string()),
    }
}

fn normalize_example_role_impl(index: usize, value: &str) -> Result<String, String> {
    let trimmed = value.trim().to_lowercase();
    if !["user", "assistant", "system"].contains(&trimmed.as_str()) {
        return Err(format!(
            "examples[{index}].role 必须是 user、assistant 或 system"
        ));
    }
    Ok(trimmed)
}

fn serialize_optional_string_array_impl(
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

fn parse_optional_json_string_array_impl(
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

fn normalize_blocks(
    blocks: Option<Vec<PresetPromptBlockInput>>,
) -> Result<Vec<NormalizedPresetPromptBlockInput>, String> {
    let blocks = blocks.unwrap_or_default();
    let mut normalized = Vec::with_capacity(blocks.len());

    for (index, block) in blocks.into_iter().enumerate() {
        let block_type =
            normalize_required_impl(&format!("blocks[{index}].blockType"), &block.block_type)?;
        let content = normalize_required_impl(&format!("blocks[{index}].content"), &block.content)?;
        validate_preset_block_definition(&block_type, &content, &format!("blocks[{index}]"))?;
        let is_locked = block.is_locked.unwrap_or(false);
        let lock_reason = normalize_lock_reason_impl(index, is_locked, block.lock_reason)?;
        let exclusive_group_key =
            normalize_exclusive_group_key_impl(index, block.exclusive_group_key)?;
        let exclusive_group_label = normalize_exclusive_group_label_impl(
            index,
            &exclusive_group_key,
            block.exclusive_group_label,
        )?;

        normalized.push(NormalizedPresetPromptBlockInput {
            block_type,
            title: normalize_optional_text_impl(block.title),
            content,
            sort_order: block.sort_order.unwrap_or(index as i64),
            priority: block.priority.unwrap_or(100),
            is_enabled: block.is_enabled.unwrap_or(true),
            scope: normalize_scope_impl(index, block.scope)?,
            is_locked,
            lock_reason,
            exclusive_group_key,
            exclusive_group_label,
            semantic_option_id: None,
        });
    }

    validate_normalized_block_collection(&normalized, "blocks")?;

    Ok(normalized)
}

fn normalize_examples(
    examples: Option<Vec<PresetExampleInput>>,
) -> Result<Vec<NormalizedPresetExampleInput>, String> {
    let examples = examples.unwrap_or_default();
    let mut normalized = Vec::with_capacity(examples.len());

    for (index, example) in examples.into_iter().enumerate() {
        let role = normalize_example_role_impl(index, &example.role)?;
        let content =
            normalize_required_impl(&format!("examples[{index}].content"), &example.content)?;

        normalized.push(NormalizedPresetExampleInput {
            role,
            content,
            sort_order: example.sort_order.unwrap_or(index as i64),
            is_enabled: example.is_enabled.unwrap_or(true),
            semantic_option_id: None,
        });
    }

    Ok(normalized)
}

fn normalize_semantic_groups(
    groups: Option<Vec<PresetSemanticGroupInput>>,
) -> Result<Vec<NormalizedPresetSemanticGroupInput>, String> {
    let groups = groups.unwrap_or_default();
    let mut normalized = Vec::with_capacity(groups.len());
    let mut seen_group_keys = HashSet::with_capacity(groups.len());

    for (index, group) in groups.into_iter().enumerate() {
        let group_key = normalize_semantic_machine_key(
            &format!("semanticGroups[{index}].groupKey"),
            &group.group_key,
        )?;
        if !seen_group_keys.insert(group_key.clone()) {
            return Err(format!("semanticGroups[{index}].groupKey 不能重复"));
        }
        let label =
            normalize_required_impl(&format!("semanticGroups[{index}].label"), &group.label)?;
        let selection_mode = normalize_semantic_selection_mode(
            &format!("semanticGroups[{index}].selectionMode"),
            group.selection_mode,
        )?;
        let options = normalize_semantic_options(group.options, index, 0)?;
        if selection_mode == "single" && count_selected_semantic_options(&options) > 1 {
            return Err(format!(
                "semanticGroups[{index}] in single mode can only select one option"
            ));
        }
        let mut seen_option_keys = HashSet::new();
        validate_semantic_option_keys(&options, &mut seen_option_keys, index)?;
        normalized.push(NormalizedPresetSemanticGroupInput {
            group_key,
            label,
            description: normalize_optional_text_impl(group.description),
            sort_order: group.sort_order.unwrap_or(index as i64),
            selection_mode,
            is_enabled: group.is_enabled.unwrap_or(true),
            options,
        });
    }

    Ok(normalized)
}

fn normalize_semantic_options(
    options: Option<Vec<PresetSemanticOptionInput>>,
    group_index: usize,
    depth: i64,
) -> Result<Vec<NormalizedPresetSemanticOptionInput>, String> {
    let options = options.unwrap_or_default();
    let mut normalized = Vec::with_capacity(options.len());

    for (index, option) in options.into_iter().enumerate() {
        let option_key = normalize_semantic_machine_key(
            &format!("semanticGroups[{group_index}].options[{index}].optionKey"),
            &option.option_key,
        )?;
        let label = normalize_required_impl(
            &format!("semanticGroups[{group_index}].options[{index}].label"),
            &option.label,
        )?;
        let blocks = normalize_blocks(option.blocks)?;
        let examples = normalize_examples(option.examples)?;
        let children = normalize_semantic_options(option.children, group_index, depth + 1)?;
        normalized.push(NormalizedPresetSemanticOptionInput {
            option_key,
            label,
            description: normalize_optional_text_impl(option.description),
            depth,
            sort_order: option.sort_order.unwrap_or(index as i64),
            is_selected: option.is_selected.unwrap_or(false),
            is_enabled: option.is_enabled.unwrap_or(true),
            expansion_kind: normalize_semantic_expansion_kind(
                &format!("semanticGroups[{group_index}].options[{index}].expansionKind"),
                option.expansion_kind,
            )?,
            blocks,
            examples,
            children,
        });
    }

    Ok(normalized)
}

fn validate_semantic_option_keys(
    options: &[NormalizedPresetSemanticOptionInput],
    seen: &mut HashSet<String>,
    group_index: usize,
) -> Result<(), String> {
    for (index, option) in options.iter().enumerate() {
        if !seen.insert(option.option_key.clone()) {
            return Err(format!(
                "semanticGroups[{group_index}].options[{index}].optionKey '{}' 不能重复",
                option.option_key
            ));
        }
        validate_semantic_option_keys(&option.children, seen, group_index)?;
    }
    Ok(())
}

fn count_selected_semantic_options(options: &[NormalizedPresetSemanticOptionInput]) -> usize {
    let mut count = 0;
    for option in options {
        if option.is_selected {
            count += 1;
        }
        count += count_selected_semantic_options(&option.children);
    }
    count
}

fn normalize_semantic_machine_key(field_name: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} 不能为空"));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | ':' | '.'))
    {
        return Err(format!(
            "{field_name} 只能包含字母、数字、下划线、短横线、冒号和点"
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_semantic_selection_mode(
    field_name: &str,
    value: Option<String>,
) -> Result<String, String> {
    match value {
        Some(mode) => {
            let normalized = mode.trim().to_lowercase();
            if !["single", "multiple"].contains(&normalized.as_str()) {
                return Err(format!("{field_name} 必须是 single 或 multiple"));
            }
            Ok(normalized)
        }
        None => Ok("single".to_string()),
    }
}

fn normalize_semantic_expansion_kind(
    field_name: &str,
    value: Option<String>,
) -> Result<String, String> {
    match value {
        Some(kind) => {
            let normalized = kind.trim().to_lowercase();
            if !["mixed", "inline", "block"].contains(&normalized.as_str()) {
                return Err(format!("{field_name} 必须是 mixed、inline 或 block"));
            }
            Ok(normalized)
        }
        None => Ok("mixed".to_string()),
    }
}

fn normalize_stop_sequences(
    stop_sequences: Option<Vec<PresetStopSequenceInput>>,
) -> Result<Vec<NormalizedPresetStopSequenceInput>, String> {
    let stop_sequences = stop_sequences.unwrap_or_default();
    let mut normalized = Vec::with_capacity(stop_sequences.len());

    for (index, seq) in stop_sequences.into_iter().enumerate() {
        let stop_text =
            normalize_required_impl(&format!("stopSequences[{index}].stopText"), &seq.stop_text)?;
        normalized.push(NormalizedPresetStopSequenceInput {
            stop_text,
            sort_order: seq.sort_order.unwrap_or(index as i64),
        });
    }

    Ok(normalized)
}

fn normalize_provider_overrides(
    provider_overrides: Option<Vec<PresetProviderOverrideInput>>,
) -> Result<Vec<NormalizedPresetProviderOverrideInput>, String> {
    let provider_overrides = provider_overrides.unwrap_or_default();
    let mut normalized = Vec::with_capacity(provider_overrides.len());
    let mut seen_provider_kinds = HashSet::with_capacity(provider_overrides.len());

    for (index, override_input) in provider_overrides.into_iter().enumerate() {
        let provider_kind = normalize_required_impl(
            &format!("providerOverrides[{index}].providerKind"),
            &override_input.provider_kind,
        )?;
        if !seen_provider_kinds.insert(provider_kind.clone()) {
            return Err(format!(
                "providerOverrides[{index}].providerKind '{}' 不能重复",
                provider_kind
            ));
        }
        normalized.push(NormalizedPresetProviderOverrideInput {
            provider_kind,
            temperature_override: normalize_temperature_impl(override_input.temperature_override)?,
            max_output_tokens_override: normalize_max_output_tokens_impl(
                override_input.max_output_tokens_override,
            )?,
            top_p_override: normalize_top_p_impl(override_input.top_p_override)?,
            top_k_override: normalize_top_k_impl(override_input.top_k_override)?,
            presence_penalty_override: normalize_penalty_impl(
                override_input.presence_penalty_override,
                &format!("providerOverrides[{index}].presencePenaltyOverride"),
            )?,
            frequency_penalty_override: normalize_penalty_impl(
                override_input.frequency_penalty_override,
                &format!("providerOverrides[{index}].frequencyPenaltyOverride"),
            )?,
            response_mode_override: normalize_optional_response_mode_from_row_impl(
                override_input.response_mode_override,
            )?,
            stop_sequences_override: normalize_optional_string_list_impl(
                &format!("providerOverrides[{index}].stopSequencesOverride"),
                override_input.stop_sequences_override,
            )?,
            disabled_block_types: normalize_optional_string_list_impl(
                &format!("providerOverrides[{index}].disabledBlockTypes"),
                override_input.disabled_block_types,
            )?,
            thinking_enabled_override: normalize_thinking_enabled_impl(
                override_input.thinking_enabled_override,
            )?,
            thinking_budget_tokens_override: normalize_thinking_budget_tokens_impl(
                override_input.thinking_budget_tokens_override,
            )?,
            beta_features_override: normalize_beta_features_impl(
                override_input.beta_features_override,
            )?,
        });
    }

    Ok(normalized)
}

fn validate_normalized_block_collection(
    blocks: &[NormalizedPresetPromptBlockInput],
    field_name: &str,
) -> Result<(), String> {
    let mut enabled_prefill_count = 0;
    let mut enabled_exclusive_groups: HashMap<String, Vec<usize>> = HashMap::new();
    let mut exclusive_group_labels: HashMap<String, String> = HashMap::new();

    for (index, block) in blocks.iter().enumerate() {
        let descriptor = format!("{field_name}[{index}]");
        let validation_kind =
            validate_preset_block_definition(&block.block_type, &block.content, &descriptor)?;
        if block.is_enabled && validation_kind == PresetBlockValidationKind::Prefill {
            enabled_prefill_count += 1;
            if enabled_prefill_count > 1 {
                return Err("only one enabled prefill block is allowed per preset".to_string());
            }
        }

        if let Some(group_key) = block.exclusive_group_key.as_ref() {
            if let Some(group_label) = block.exclusive_group_label.as_ref() {
                if let Some(existing_label) = exclusive_group_labels.get(group_key) {
                    if existing_label != group_label {
                        return Err(format!(
                            "{descriptor}.exclusiveGroupLabel must match other blocks in exclusiveGroupKey '{group_key}'"
                        ));
                    }
                } else {
                    exclusive_group_labels.insert(group_key.clone(), group_label.clone());
                }
            }

            if block.is_enabled {
                enabled_exclusive_groups
                    .entry(group_key.clone())
                    .or_default()
                    .push(index);
            }
        }
    }

    for (group_key, indexes) in enabled_exclusive_groups {
        if indexes.len() > 1 {
            let conflicts = indexes
                .into_iter()
                .map(|index| format!("{field_name}[{index}]"))
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "exclusiveGroupKey '{group_key}' has multiple enabled blocks: {conflicts}"
            ));
        }
    }

    Ok(())
}

pub fn flatten_normalized_semantic_options(
    options: &[NormalizedPresetSemanticOptionInput],
    parent_temp_id: Option<usize>,
    next_temp_id: &mut usize,
    out: &mut Vec<FlatNormalizedPresetSemanticOptionInput>,
) {
    for option in options {
        let temp_id = *next_temp_id;
        *next_temp_id += 1;
        out.push(FlatNormalizedPresetSemanticOptionInput {
            temp_id,
            parent_temp_id,
            option_key: option.option_key.clone(),
            label: option.label.clone(),
            description: option.description.clone(),
            depth: option.depth,
            sort_order: option.sort_order,
            is_selected: option.is_selected,
            is_enabled: option.is_enabled,
            expansion_kind: option.expansion_kind.clone(),
            blocks: option.blocks.clone(),
            examples: option.examples.clone(),
        });
        flatten_normalized_semantic_options(&option.children, Some(temp_id), next_temp_id, out);
    }
}

pub fn merge_materialized_blocks(
    direct_blocks: &[NormalizedPresetPromptBlockInput],
    materialized_blocks: Vec<NormalizedPresetPromptBlockInput>,
) -> Result<Vec<NormalizedPresetPromptBlockInput>, String> {
    let mut merged = direct_blocks.to_vec();
    let mut seen_keys: HashMap<String, usize> = HashMap::new();

    for (index, block) in merged.iter_mut().enumerate() {
        let key = block
            .exclusive_group_key
            .clone()
            .unwrap_or_else(|| format!("{}:{}:{:?}", block.block_type, block.scope, block.title));
        seen_keys.insert(key, index);
    }

    for m_block in materialized_blocks {
        let key = m_block.exclusive_group_key.clone().unwrap_or_else(|| {
            format!(
                "{}:{}:{:?}",
                m_block.block_type, m_block.scope, m_block.title
            )
        });
        if let Some(&index) = seen_keys.get(&key) {
            if !merged[index].is_locked {
                log_merged_block_conflicts(&merged, &key);
                merged[index] = m_block;
            }
        } else {
            merged.push(m_block);
        }
    }

    Ok(merged)
}

fn log_merged_block_conflicts(blocks: &[NormalizedPresetPromptBlockInput], field_name: &str) {
    let _ = blocks;
    let _ = field_name;
}

pub fn merge_materialized_examples(
    direct_examples: &[NormalizedPresetExampleInput],
    materialized_examples: Vec<NormalizedPresetExampleInput>,
) -> Vec<NormalizedPresetExampleInput> {
    let mut merged = direct_examples.to_vec();
    let mut seen_keys: HashSet<String> = HashSet::new();

    for example in &merged {
        let key = format!("{}:{}", example.role, example.content);
        seen_keys.insert(key);
    }

    for m_example in materialized_examples {
        let key = format!("{}:{}", m_example.role, m_example.content);
        if seen_keys.insert(key) {
            merged.push(m_example);
        }
    }

    merged
}

pub fn prune_shadowed_semantic_direct_blocks(
    mut direct_blocks: Vec<NormalizedPresetPromptBlockInput>,
    materialized_blocks: &[NormalizedPresetPromptBlockInput],
) -> Vec<NormalizedPresetPromptBlockInput> {
    let semantic_group_keys: HashSet<String> = materialized_blocks
        .iter()
        .filter_map(|b| b.exclusive_group_key.as_ref())
        .filter(|key| key.starts_with("semantic:"))
        .cloned()
        .collect();

    direct_blocks.retain(|block| {
        if let Some(ref group_key) = block.exclusive_group_key {
            if group_key.starts_with("semantic:") && semantic_group_keys.contains(group_key) {
                return false;
            }
        }
        true
    });

    direct_blocks
}

pub fn preset_block_lock_snapshot_from_normalized(
    block: &NormalizedPresetPromptBlockInput,
) -> PresetBlockLockSnapshot {
    PresetBlockLockSnapshot {
        block_type: block.block_type.clone(),
        title: block.title.clone(),
        content: block.content.clone(),
        sort_order: block.sort_order,
        priority: block.priority,
        is_enabled: block.is_enabled,
        scope: block.scope.clone(),
        is_locked: block.is_locked,
        lock_reason: block.lock_reason.clone(),
        exclusive_group_key: block.exclusive_group_key.clone(),
        exclusive_group_label: block.exclusive_group_label.clone(),
    }
}

pub fn missing_locked_block_snapshot(
    existing_snapshots: &[PresetBlockLockSnapshot],
    incoming_blocks: &[NormalizedPresetPromptBlockInput],
) -> Option<String> {
    for snapshot in existing_snapshots {
        if !snapshot.is_locked {
            continue;
        }
        let still_present = incoming_blocks.iter().any(|incoming| {
            incoming.is_locked && preset_block_lock_snapshot_from_normalized(incoming) == *snapshot
        });
        if !still_present {
            return Some(preset_block_lock_snapshot_label(snapshot));
        }
    }
    None
}

fn preset_block_lock_snapshot_label(snapshot: &PresetBlockLockSnapshot) -> String {
    let mut label = format!("{}/{}", snapshot.block_type, snapshot.scope);
    if let Some(ref title) = snapshot.title {
        label.push_str(&format!("/{}", title));
    }
    if let Some(ref group_label) = snapshot.exclusive_group_label {
        label.push_str(&format!("/{}", group_label));
    }
    label
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block_input(block_type: &str, content: &str) -> PresetPromptBlockInput {
        PresetPromptBlockInput {
            block_type: block_type.to_string(),
            title: None,
            content: content.to_string(),
            sort_order: None,
            priority: None,
            is_enabled: None,
            scope: None,
            is_locked: None,
            lock_reason: None,
            exclusive_group_key: None,
            exclusive_group_label: None,
        }
    }

    fn normalized_block(block_type: &str, content: &str) -> NormalizedPresetPromptBlockInput {
        NormalizedPresetPromptBlockInput {
            block_type: block_type.to_string(),
            title: None,
            content: content.to_string(),
            sort_order: 0,
            priority: 100,
            is_enabled: true,
            scope: "global".to_string(),
            is_locked: true,
            lock_reason: Some("core".to_string()),
            exclusive_group_key: Some("style".to_string()),
            exclusive_group_label: Some("Style".to_string()),
            semantic_option_id: None,
        }
    }

    fn locked_snapshot(block_type: &str, content: &str) -> PresetBlockLockSnapshot {
        PresetBlockLockSnapshot {
            block_type: block_type.to_string(),
            title: None,
            content: content.to_string(),
            sort_order: 0,
            priority: 100,
            is_enabled: true,
            scope: "global".to_string(),
            is_locked: true,
            lock_reason: Some("core".to_string()),
            exclusive_group_key: Some("style".to_string()),
            exclusive_group_label: Some("Style".to_string()),
        }
    }

    #[test]
    fn normalize_blocks_rejects_invalid_template_syntax() {
        let mut input = block_input("template:style", "{{ current_user.content ");
        input.content = "{{ current_user.content ".to_string();
        let error = PresetValidator::validate_blocks(Some(vec![input]))
            .expect_err("invalid template syntax should fail");

        assert!(error.contains("template syntax error"));
    }

    #[test]
    fn normalize_blocks_rejects_multiple_enabled_prefill_blocks() {
        let mut first = block_input("compiler:prefill", "Seed one");
        first.is_enabled = Some(true);
        let mut second = block_input("template:prefill", "{{ current_user.content }}");
        second.is_enabled = Some(true);

        let error = PresetValidator::validate_blocks(Some(vec![first, second]))
            .expect_err("duplicate prefill should fail");

        assert!(error.contains("only one enabled prefill block"));
    }

    #[test]
    fn normalize_blocks_rejects_invalid_regex_pattern() {
        let mut input = block_input(
            "compiler:regex:must_match",
            r#"{"pattern":"(","errorMessage":"bad output"}"#,
        );
        input.content = r#"{"pattern":"(","errorMessage":"bad output"}"#.to_string();
        let error = PresetValidator::validate_blocks(Some(vec![input]))
            .expect_err("invalid regex pattern should fail");

        assert!(error.contains("regex pattern is invalid"));
    }

    #[test]
    fn normalize_blocks_rejects_multiple_enabled_blocks_in_same_exclusive_group() {
        let mut first = block_input("style", "A");
        first.exclusive_group_key = Some("style".to_string());
        let mut second = block_input("style", "B");
        second.exclusive_group_key = Some("style".to_string());

        let error = PresetValidator::validate_blocks(Some(vec![first, second]))
            .expect_err("duplicate enabled exclusive group should fail");

        assert!(error.contains("multiple enabled blocks"));
    }

    #[test]
    fn prune_shadowed_semantic_direct_blocks_removes_stale_semantic_group_blocks() {
        let mut direct = normalized_block("narration", "legacy calm");
        direct.is_locked = false;
        direct.lock_reason = None;
        direct.exclusive_group_key = Some("semantic:story-pace".to_string());
        direct.exclusive_group_label = Some("剧情节奏".to_string());

        let mut materialized = normalized_block("narration", "selected intense");
        materialized.is_locked = false;
        materialized.lock_reason = None;
        materialized.exclusive_group_key = Some("semantic:story-pace".to_string());
        materialized.exclusive_group_label = Some("剧情节奏".to_string());
        materialized.semantic_option_id = Some(42);

        let pruned = prune_shadowed_semantic_direct_blocks(vec![direct], &[materialized]);

        assert!(pruned.is_empty());
    }

    #[test]
    fn prune_shadowed_semantic_direct_blocks_keeps_nonsemantic_exclusive_groups() {
        let direct = normalized_block("style", "custom style");
        let mut materialized = normalized_block("narration", "selected intense");
        materialized.is_locked = false;
        materialized.lock_reason = None;
        materialized.exclusive_group_key = Some("semantic:story-pace".to_string());
        materialized.exclusive_group_label = Some("剧情节奏".to_string());
        materialized.semantic_option_id = Some(42);

        let pruned = prune_shadowed_semantic_direct_blocks(vec![direct.clone()], &[materialized]);

        assert_eq!(pruned, vec![direct]);
    }

    #[test]
    fn normalize_blocks_rejects_lock_reason_without_lock() {
        let mut input = block_input("style", "A");
        input.lock_reason = Some("core".to_string());

        let error = PresetValidator::validate_blocks(Some(vec![input]))
            .expect_err("lock reason without lock should fail");

        assert!(error.contains("lockReason"));
    }

    #[test]
    fn normalize_blocks_rejects_group_label_without_group_key() {
        let mut input = block_input("style", "A");
        input.exclusive_group_label = Some("Style".to_string());

        let error = PresetValidator::validate_blocks(Some(vec![input]))
            .expect_err("group label without key should fail");

        assert!(error.contains("exclusiveGroupLabel"));
    }

    #[test]
    fn missing_locked_block_snapshot_returns_none_when_locked_block_is_preserved() {
        let existing = vec![locked_snapshot("style", "Core")];
        let incoming = vec![normalized_block("style", "Core")];

        assert!(missing_locked_block_snapshot(&existing, &incoming).is_none());
    }

    #[test]
    fn missing_locked_block_snapshot_detects_modified_locked_block() {
        let existing = vec![locked_snapshot("style", "Core")];
        let incoming = vec![normalized_block("style", "Changed")];

        assert!(missing_locked_block_snapshot(&existing, &incoming).is_some());
    }
}

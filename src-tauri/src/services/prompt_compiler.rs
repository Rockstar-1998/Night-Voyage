use std::collections::HashSet;

use minijinja::{Environment, UndefinedBehavior};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::{
    llm::ChatMessage,
    services::{
        character_state_overlays::load_latest_character_state_overlay_block,
        plot_summaries::{load_completed_plot_summary_round_ids_before, load_plot_summary_blocks},
        provider_adapter::adapt_prompt_compile_result_to_openai_messages,
        world_book_matcher::{
            load_triggered_world_book_entries, WorldBookTriggerSource, WorldBookTriggerSourceKind,
        },
    },
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptCompileMode {
    ClassicChat,
    ClassicRegenerate,
    AgentDirectorPlaceholder,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PromptBudget {
    pub max_total_tokens: Option<usize>,
    pub reserve_output_tokens: Option<usize>,
    pub max_summary_tokens: Option<usize>,
    pub max_world_book_tokens: Option<usize>,
    pub max_retrieved_detail_tokens: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptCompileInput {
    pub conversation_id: i64,
    pub mode: PromptCompileMode,
    pub target_round_id: Option<i64>,
    pub provider_kind: String,
    pub model_name: String,
    pub include_streaming_seed: bool,
    pub budget: PromptBudget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptRole {
    System,
    User,
    Assistant,
}

impl PromptRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }

    fn from_message_role(role: &str) -> Self {
        match role {
            "system" => Self::System,
            "assistant" => Self::Assistant,
            _ => Self::User,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptBlockKind {
    PresetRule,
    MultiplayerProtocol,
    CharacterBase,
    WorldBookMatch,
    // TODO: WorldVariable layer is not yet implemented. PlotSummary layer already covers its functionality to some extent.
    WorldVariable,
    PlotSummary,
    RetrievedDetail,
    ExampleMessage,
    RecentHistory,
    CurrentUser,
    PrefillSeed,
}

impl PromptBlockKind {
    pub fn priority(&self) -> i32 {
        match self {
            Self::PresetRule => 100,
            Self::MultiplayerProtocol => 150,
            Self::CharacterBase => 200,
            Self::WorldBookMatch => 300,
            Self::WorldVariable => 400,
            Self::PlotSummary => 500,
            Self::RetrievedDetail => 600,
            Self::ExampleMessage => 700,
            Self::RecentHistory => 800,
            Self::CurrentUser => 900,
            Self::PrefillSeed => 1000,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PresetRule => "PresetRule",
            Self::MultiplayerProtocol => "MultiplayerProtocol",
            Self::CharacterBase => "CharacterBase",
            Self::WorldBookMatch => "WorldBookMatch",
            Self::WorldVariable => "WorldVariable",
            Self::PlotSummary => "PlotSummary",
            Self::RetrievedDetail => "RetrievedDetail",
            Self::ExampleMessage => "ExampleMessage",
            Self::RecentHistory => "RecentHistory",
            Self::CurrentUser => "CurrentUser",
            Self::PrefillSeed => "PrefillSeed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptBlockSource {
    Preset {
        preset_id: i64,
        block_id: Option<i64>,
    },
    Character {
        character_id: i64,
    },
    WorldBook {
        world_book_id: i64,
        entry_id: i64,
    },
    Summary {
        summary_id: i64,
    },
    Retrieval {
        fragment_id: i64,
    },
    Message {
        message_id: i64,
    },
    Compiler,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptBlock {
    pub kind: PromptBlockKind,
    pub priority: i32,
    pub role: PromptRole,
    pub title: Option<String>,
    pub content: String,
    pub source: PromptBlockSource,
    pub token_cost_estimate: Option<usize>,
    pub required: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompiledSamplingParams {
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub top_k: Option<i64>,
    pub presence_penalty: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub response_mode: Option<String>,
    pub stop_sequences: Vec<String>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget_tokens: Option<i64>,
    pub beta_features: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PresetCompilePreviewData {
    pub system_blocks: Vec<PromptBlock>,
    pub example_blocks: Vec<PromptBlock>,
    pub params: CompiledSamplingParams,
}

#[derive(Debug, Clone, Default)]
struct LoadedPresetCompilerData {
    blocks: Vec<PromptBlock>,
    example_blocks: Vec<PromptBlock>,
    prefill_seed: Option<PromptBlock>,
    output_validators: Vec<CompiledOutputValidator>,
    params: CompiledSamplingParams,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct LoadedPresetProviderOverrideData {
    temperature_override: Option<f64>,
    max_output_tokens_override: Option<i64>,
    top_p_override: Option<f64>,
    top_k_override: Option<i64>,
    presence_penalty_override: Option<f64>,
    frequency_penalty_override: Option<f64>,
    response_mode_override: Option<String>,
    stop_sequences_override: Option<Vec<String>>,
    disabled_block_types: HashSet<String>,
    thinking_enabled_override: Option<bool>,
    thinking_budget_tokens_override: Option<i64>,
    beta_features_override: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputValidationMode {
    MustMatch,
    MustNotMatch,
}

#[derive(Debug, Clone)]
pub(crate) struct CompiledOutputValidator {
    mode: OutputValidationMode,
    pattern: String,
    error_message: String,
    regex: Regex,
    title: Option<String>,
    source: PromptBlockSource,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OutputValidatorConfig {
    pattern: String,
    error_message: String,
}

#[derive(Debug, Clone, Serialize)]
struct PromptTemplateRenderContext {
    conversation: PromptTemplateConversationContext,
    provider: PromptTemplateProviderContext,
    current_user: PromptTemplateCurrentUserContext,
    #[serde(skip_serializing_if = "Option::is_none")]
    character: Option<PromptTemplateCharacterContext>,
}

#[derive(Debug, Clone, Serialize)]
struct PromptTemplateConversationContext {
    id: i64,
    host_character_id: Option<i64>,
    world_book_id: Option<i64>,
    preset_id: Option<i64>,
    target_round_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
struct PromptTemplateProviderContext {
    kind: String,
    model_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct PromptTemplateCurrentUserContext {
    role: String,
    content: String,
    message_id: i64,
}

#[derive(Debug, Clone, Serialize)]
struct PromptTemplateCharacterBaseSectionContext {
    section_key: String,
    title: Option<String>,
    content: String,
}

#[derive(Debug, Clone, Serialize)]
struct PromptTemplateCharacterContext {
    id: i64,
    name: String,
    description: String,
    tags: Vec<String>,
    base_sections: Vec<PromptTemplateCharacterBaseSectionContext>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CharacterBaseSectionCompileData {
    section_key: String,
    title: Option<String>,
    content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CharacterCompileData {
    character_id: i64,
    name: String,
    description: String,
    tags: Vec<String>,
    base_sections: Vec<CharacterBaseSectionCompileData>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PresetBlockDirective {
    SystemLiteral {
        normalized_block_type: String,
    },
    SystemTemplate {
        normalized_block_type: String,
    },
    PrefillLiteral,
    PrefillTemplate,
    OutputValidator {
        mode: OutputValidationMode,
        config: OutputValidatorConfig,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PresetBlockValidationKind {
    System,
    Prefill,
    OutputValidator,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptTrimmedBlock {
    pub kind: String,
    pub title: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PromptCompileDebugReport {
    pub input_sources: Vec<String>,
    pub final_block_order: Vec<String>,
    pub trimmed_blocks: Vec<PromptTrimmedBlock>,
    pub capability_checks: Vec<String>,
    pub total_token_estimate_before_trim: usize,
    pub total_token_estimate_after_trim: usize,
}

#[derive(Debug, Clone)]
pub struct PromptCompileResult {
    pub system_blocks: Vec<PromptBlock>,
    pub example_blocks: Vec<PromptBlock>,
    pub history_blocks: Vec<PromptBlock>,
    pub current_user_block: PromptBlock,
    pub prefill_seed: Option<PromptBlock>,
    pub(crate) output_validators: Vec<CompiledOutputValidator>,
    pub params: CompiledSamplingParams,
    pub debug: PromptCompileDebugReport,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConversationCompileContext {
    host_character_id: Option<i64>,
    world_book_id: Option<i64>,
    preset_id: Option<i64>,
    conversation_type: String,
}

const TEMPLATE_BLOCK_TYPE_PREFIX: &str = "template:";
const COMPILER_PREFILL_BLOCK_TYPE: &str = "compiler:prefill";
const COMPILER_REGEX_MUST_MATCH_BLOCK_TYPE: &str = "compiler:regex:must_match";
const COMPILER_REGEX_MUST_NOT_MATCH_BLOCK_TYPE: &str = "compiler:regex:must_not_match";
const MAX_WORLD_BOOK_TRIGGER_HISTORY_BLOCKS: usize = 6;
const MAX_WORLD_BOOK_BLOCKS: usize = 8;
const DEFAULT_MAX_WORLD_BOOK_TOKENS: usize = 512;

impl PromptCompileResult {
    pub fn validate_output_text(&self, content: &str) -> Result<(), String> {
        for validator in &self.output_validators {
            let is_match = validator.regex.is_match(content);
            let violation = match validator.mode {
                OutputValidationMode::MustMatch => !is_match,
                OutputValidationMode::MustNotMatch => is_match,
            };
            if violation {
                return Err(validator.error_message.clone());
            }
        }

        Ok(())
    }
}

pub fn validate_preset_block_definition(
    block_type: &str,
    content: &str,
    descriptor: &str,
) -> Result<PresetBlockValidationKind, String> {
    let directive = parse_preset_block_directive(block_type, content, descriptor)?;
    Ok(match directive {
        PresetBlockDirective::SystemLiteral { .. }
        | PresetBlockDirective::SystemTemplate { .. } => PresetBlockValidationKind::System,
        PresetBlockDirective::PrefillLiteral | PresetBlockDirective::PrefillTemplate => {
            PresetBlockValidationKind::Prefill
        }
        PresetBlockDirective::OutputValidator { .. } => PresetBlockValidationKind::OutputValidator,
    })
}

pub async fn compile_prompt(
    db: &SqlitePool,
    input: &PromptCompileInput,
    exclude_message_id: i64,
) -> Result<PromptCompileResult, String> {
    match input.mode {
        PromptCompileMode::ClassicChat | PromptCompileMode::ClassicRegenerate => {}
        PromptCompileMode::AgentDirectorPlaceholder => {
            return Err("Prompt Compiler V1 does not support director_agents yet".to_string());
        }
    }

    eprintln!("[prompt-compiler] compile_prompt: step=load_conversation_compile_context conversation_id={}", input.conversation_id);
    let context = load_conversation_compile_context(db, input.conversation_id)
        .await
        .map_err(|err| {
            eprintln!(
                "[prompt-compiler] compile_prompt: ERROR at load_conversation_compile_context: {}",
                err
            );
            err
        })?;
    let mut debug = PromptCompileDebugReport::default();

    eprintln!(
        "[prompt-compiler] compile_prompt: step=load_current_user_block conversation_id={}",
        input.conversation_id
    );
    let current_user_block =
        load_current_user_block(db, input.conversation_id, input.target_round_id)
            .await
            .map_err(|err| {
                eprintln!(
                    "[prompt-compiler] compile_prompt: ERROR at load_current_user_block: {}",
                    err
                );
                err
            })?;
    debug.input_sources.push(format!(
        "current_user:message:{}",
        source_message_id(&current_user_block.source)
    ));

    let character_data = match context.host_character_id {
        Some(character_id) => {
            eprintln!("[prompt-compiler] compile_prompt: step=load_character_compile_data character_id={}", character_id);
            load_character_compile_data(db, character_id).await.map_err(|err| {
                eprintln!("[prompt-compiler] compile_prompt: ERROR at load_character_compile_data: {}", err);
                err
            })?
        }
        None => None,
    };
    let render_context = build_runtime_template_render_context(
        &context,
        input,
        &current_user_block,
        character_data.as_ref(),
    );

    eprintln!(
        "[prompt-compiler] compile_prompt: step=load_preset_compiler_data preset_id={:?}",
        context.preset_id
    );
    let preset_compiler_data = load_preset_compiler_data(
        db,
        context.preset_id,
        Some(&input.provider_kind),
        &render_context,
        &mut debug,
    )
    .await
    .map_err(|err| {
        eprintln!(
            "[prompt-compiler] compile_prompt: ERROR at load_preset_compiler_data: {}",
            err
        );
        err
    })?;

    let mut system_blocks = preset_compiler_data.blocks;
    if context.conversation_type == "online" {
        system_blocks.push(build_block(
            PromptBlockKind::MultiplayerProtocol,
            PromptRole::System,
            Some("多人对话协议".to_string()),
            "[多人对话协议]\n当前对话为多人房间模式。每轮输入中「玩家名: 内容」格式的每一行代表一位独立真实玩家的发言。\n不同行对应不同玩家，绝非同一人的角色扮演。请分别理解每位玩家的意图，并在回复中自然回应各自的行动。\n当某行显示\"（本轮放弃发言）\"时，表示该玩家本轮选择不行动。".to_string(),
            PromptBlockSource::Compiler,
            true,
        ));
    }
    let mut latest_character_state_overlay_text = None;
    if let Some(character_data) = character_data.as_ref() {
        if let Some(character_block) = build_character_base_block(character_data) {
            debug
                .input_sources
                .push(format!("character:{}", character_data.character_id));
            system_blocks.push(character_block);
        }
        if let Some(character_state_overlay_block) = load_latest_character_state_overlay_block(
            db,
            input.conversation_id,
            character_data.character_id,
            input.target_round_id,
            &mut debug,
        )
        .await?
        {
            latest_character_state_overlay_text =
                Some(character_state_overlay_block.content.clone());
            system_blocks.push(character_state_overlay_block);
        }
    }

    let plot_summary_blocks =
        load_plot_summary_blocks(db, input.conversation_id, input.target_round_id, &mut debug)
            .await
            .map_err(|err| {
                eprintln!(
                    "[prompt-compiler] compile_prompt: ERROR at load_plot_summary_blocks: {}",
                    err
                );
                err
            })?;
    let summarized_round_ids = load_completed_plot_summary_round_ids_before(
        db,
        input.conversation_id,
        input.target_round_id,
    )
    .await.map_err(|err| {
        eprintln!("[prompt-compiler] compile_prompt: ERROR at load_completed_plot_summary_round_ids_before: {}", err);
        err
    })?;

    eprintln!(
        "[prompt-compiler] compile_prompt: step=load_recent_history_blocks conversation_id={}",
        input.conversation_id
    );
    let history_blocks = load_recent_history_blocks(
        db,
        input.conversation_id,
        input.target_round_id,
        exclude_message_id,
        &summarized_round_ids,
        &mut debug,
    )
    .await
    .map_err(|err| {
        eprintln!(
            "[prompt-compiler] compile_prompt: ERROR at load_recent_history_blocks: {}",
            err
        );
        err
    })?;

    if let Some(world_book_id) = context.world_book_id {
        eprintln!(
            "[prompt-compiler] compile_prompt: step=load_world_book_blocks world_book_id={}",
            world_book_id
        );
        let world_book_trigger_sources = build_world_book_trigger_sources(
            &current_user_block,
            &history_blocks,
            latest_character_state_overlay_text.as_deref(),
        );
        system_blocks.extend(
            load_world_book_blocks(
                db,
                world_book_id,
                &world_book_trigger_sources,
                input.budget.max_world_book_tokens,
                &mut debug,
            )
            .await?,
        );
    }
    system_blocks.extend(plot_summary_blocks);
    system_blocks.sort_by(|left, right| left.priority.cmp(&right.priority));

    let mut result = PromptCompileResult {
        system_blocks,
        example_blocks: preset_compiler_data.example_blocks,
        history_blocks,
        current_user_block,
        prefill_seed: preset_compiler_data.prefill_seed,
        output_validators: preset_compiler_data.output_validators,
        params: preset_compiler_data.params,
        debug,
    };

    result.debug.total_token_estimate_before_trim = total_estimated_tokens(&result);
    apply_budget_trim(&mut result, &input.budget);
    result.debug.total_token_estimate_after_trim = total_estimated_tokens(&result);
    result.debug.final_block_order = build_final_block_order(&result);

    Ok(result)
}

pub async fn compile_chat_messages(
    db: &SqlitePool,
    conversation_id: i64,
    exclude_message_id: i64,
) -> Result<Vec<ChatMessage>, String> {
    let target_round_id = sqlx::query_scalar(
        "SELECT round_id FROM messages WHERE id = ? AND conversation_id = ? LIMIT 1",
    )
    .bind(exclude_message_id)
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?
    .flatten();

    let provider_kind = load_compiler_wrapper_provider_kind(db, conversation_id).await?;
    let input = PromptCompileInput {
        conversation_id,
        mode: if target_round_id.is_some() {
            PromptCompileMode::ClassicRegenerate
        } else {
            PromptCompileMode::ClassicChat
        },
        target_round_id,
        provider_kind: provider_kind.clone(),
        model_name: String::new(),
        include_streaming_seed: false,
        budget: PromptBudget::default(),
    };

    let mut result = compile_prompt(db, &input, exclude_message_id).await?;
    adapt_prompt_compile_result_to_openai_messages(&mut result, &provider_kind)
}

pub async fn compile_preset_preview_data(
    db: &SqlitePool,
    preset_id: i64,
    provider_kind: Option<&str>,
) -> Result<PresetCompilePreviewData, String> {
    let mut debug = PromptCompileDebugReport::default();
    let render_context = build_preview_template_render_context(preset_id, provider_kind);
    let preset_compiler_data = load_preset_compiler_data(
        db,
        Some(preset_id),
        provider_kind,
        &render_context,
        &mut debug,
    )
    .await?;

    Ok(PresetCompilePreviewData {
        system_blocks: preset_compiler_data.blocks,
        example_blocks: preset_compiler_data.example_blocks,
        params: preset_compiler_data.params,
    })
}

pub async fn load_character_system_message(
    db: &SqlitePool,
    character_id: i64,
) -> Result<Option<String>, String> {
    let Ok(character_data) = load_character_compile_data(db, character_id).await else {
        return Ok(None);
    };

    Ok(character_data.and_then(|character_data| build_character_system_message(&character_data)))
}

async fn load_character_compile_data(
    db: &SqlitePool,
    character_id: i64,
) -> Result<Option<CharacterCompileData>, String> {
    let row = sqlx::query("SELECT name, description FROM character_cards WHERE id = ? LIMIT 1")
        .bind(character_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?;

    let Some(row) = row else {
        return Ok(None);
    };

    let name: String = row.try_get("name").unwrap_or_default();
    let description: String = row.try_get("description").unwrap_or_default();
    let tag_rows = sqlx::query(
        "SELECT tag FROM character_card_tags WHERE character_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(character_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let tags = tag_rows
        .into_iter()
        .filter_map(|tag_row| tag_row.try_get::<String, _>("tag").ok())
        .collect::<Vec<_>>();

    let section_rows = sqlx::query(
        "SELECT section_key, title, content \
         FROM character_card_base_sections \
         WHERE character_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(character_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let base_sections = section_rows
        .into_iter()
        .filter_map(|section_row| {
            let content = section_row
                .try_get::<String, _>("content")
                .unwrap_or_default()
                .trim()
                .to_string();
            if content.is_empty() {
                return None;
            }

            Some(CharacterBaseSectionCompileData {
                section_key: section_row
                    .try_get::<String, _>("section_key")
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                title: normalize_optional_title(section_row.try_get("title").ok()),
                content,
            })
        })
        .collect::<Vec<_>>();

    Ok(Some(CharacterCompileData {
        character_id,
        name: name.trim().to_string(),
        description: description.trim().to_string(),
        tags,
        base_sections,
    }))
}

fn build_character_system_message(character_data: &CharacterCompileData) -> Option<String> {
    let mut sections = Vec::new();
    if !character_data.name.is_empty() {
        sections.push(format!("Character Name: {}", character_data.name));
    }
    if !character_data.tags.is_empty() {
        sections.push(format!(
            "Character Tags: {}",
            character_data.tags.join(", ")
        ));
    }

    if !character_data.base_sections.is_empty() {
        sections.extend(
            character_data
                .base_sections
                .iter()
                .filter_map(build_character_base_section_message),
        );
    } else if !character_data.description.is_empty() {
        sections.push(format!(
            "Character Description: {}",
            character_data.description
        ));
    }

    if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
    }
}

fn build_character_base_section_message(
    section: &CharacterBaseSectionCompileData,
) -> Option<String> {
    let content = section.content.trim();
    if content.is_empty() {
        return None;
    }

    let title = section
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or(default_character_base_section_title(&section.section_key));

    Some(format!("[{title}]\n{content}"))
}

fn default_character_base_section_title(section_key: &str) -> &'static str {
    match section_key {
        "identity" => "Identity",
        "persona" => "Persona",
        "background" => "Background",
        "rules" => "Rules",
        "custom" => "Custom",
        _ => "Character Base",
    }
}

fn build_character_base_block(character_data: &CharacterCompileData) -> Option<PromptBlock> {
    let content = build_character_system_message(character_data)?;

    Some(build_block(
        PromptBlockKind::CharacterBase,
        PromptRole::System,
        Some("Character Base".to_string()),
        content,
        PromptBlockSource::Character {
            character_id: character_data.character_id,
        },
        true,
    ))
}

fn build_runtime_template_render_context(
    context: &ConversationCompileContext,
    input: &PromptCompileInput,
    current_user_block: &PromptBlock,
    character_data: Option<&CharacterCompileData>,
) -> PromptTemplateRenderContext {
    PromptTemplateRenderContext {
        conversation: PromptTemplateConversationContext {
            id: input.conversation_id,
            host_character_id: context.host_character_id,
            world_book_id: context.world_book_id,
            preset_id: context.preset_id,
            target_round_id: input.target_round_id,
        },
        provider: PromptTemplateProviderContext {
            kind: input.provider_kind.clone(),
            model_name: input.model_name.clone(),
        },
        current_user: PromptTemplateCurrentUserContext {
            role: current_user_block.role.as_str().to_string(),
            content: current_user_block.content.clone(),
            message_id: source_message_id(&current_user_block.source),
        },
        character: character_data.map(|character_data| PromptTemplateCharacterContext {
            id: character_data.character_id,
            name: character_data.name.clone(),
            description: character_data.description.clone(),
            tags: character_data.tags.clone(),
            base_sections: character_data
                .base_sections
                .iter()
                .map(|section| PromptTemplateCharacterBaseSectionContext {
                    section_key: section.section_key.clone(),
                    title: section.title.clone(),
                    content: section.content.clone(),
                })
                .collect(),
        }),
    }
}

fn build_preview_template_render_context(
    preset_id: i64,
    provider_kind: Option<&str>,
) -> PromptTemplateRenderContext {
    PromptTemplateRenderContext {
        conversation: PromptTemplateConversationContext {
            id: 0,
            host_character_id: None,
            world_book_id: None,
            preset_id: Some(preset_id),
            target_round_id: None,
        },
        provider: PromptTemplateProviderContext {
            kind: provider_kind.unwrap_or("preview_provider").to_string(),
            model_name: "preview-model".to_string(),
        },
        current_user: PromptTemplateCurrentUserContext {
            role: "user".to_string(),
            content: "Preview user input".to_string(),
            message_id: 0,
        },
        character: Some(PromptTemplateCharacterContext {
            id: 0,
            name: "Preview Character".to_string(),
            description: "Preview character description".to_string(),
            tags: vec!["preview".to_string()],
            base_sections: vec![PromptTemplateCharacterBaseSectionContext {
                section_key: "identity".to_string(),
                title: None,
                content: "Preview character identity".to_string(),
            }],
        }),
    }
}

async fn load_conversation_compile_context(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<ConversationCompileContext, String> {
    let row = sqlx::query(
        "SELECT COALESCE(host_character_id, character_id) AS host_character_id, world_book_id, preset_id, conversation_type \
         FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(ConversationCompileContext {
        host_character_id: row.try_get("host_character_id").ok(),
        world_book_id: row.try_get("world_book_id").ok(),
        preset_id: normalize_optional_positive_id(row.try_get("preset_id").ok()),
        conversation_type: row
            .try_get("conversation_type")
            .unwrap_or_else(|_| "single".to_string()),
    })
}

fn normalize_optional_positive_id(value: Option<i64>) -> Option<i64> {
    value.filter(|id| *id > 0)
}

async fn load_compiler_wrapper_provider_kind(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<String, String> {
    let provider_kind = sqlx::query_scalar(
        "SELECT ap.provider_kind \
         FROM conversations c \
         LEFT JOIN api_providers ap ON ap.id = c.provider_id \
         WHERE c.id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?
    .flatten();

    Ok(provider_kind.unwrap_or_else(|| "openai_compatible".to_string()))
}
async fn load_preset_compiler_data(
    db: &SqlitePool,
    preset_id: Option<i64>,
    provider_kind: Option<&str>,
    render_context: &PromptTemplateRenderContext,
    debug: &mut PromptCompileDebugReport,
) -> Result<LoadedPresetCompilerData, String> {
    let Some(preset_id) = normalize_optional_positive_id(preset_id) else {
        return Ok(LoadedPresetCompilerData::default());
    };

    let row = sqlx::query(
        "SELECT temperature, max_output_tokens, top_p, top_k, presence_penalty, frequency_penalty, response_mode, \
         thinking_enabled, thinking_budget_tokens, beta_features \
         FROM presets WHERE id = ? LIMIT 1",
    )
    .bind(preset_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    let row = row.ok_or_else(|| format!("conversation preset {preset_id} was not found"))?;
    let temperature: Option<f64> = row.try_get("temperature").ok();
    let max_output_tokens: Option<i64> = row.try_get("max_output_tokens").ok();
    let top_p: Option<f64> = row.try_get("top_p").ok();
    let top_k: Option<i64> = row.try_get("top_k").ok();
    let presence_penalty: Option<f64> = row.try_get("presence_penalty").ok();
    let frequency_penalty: Option<f64> = row.try_get("frequency_penalty").ok();
    let response_mode = normalize_loaded_response_mode(
        row.try_get("response_mode").ok(),
        &format!("preset {preset_id} response_mode"),
    )?;
    let thinking_enabled: Option<bool> = row.try_get("thinking_enabled").ok().flatten();
    let thinking_budget_tokens: Option<i64> = row.try_get("thinking_budget_tokens").ok();
    let beta_features_raw: Option<String> = row.try_get("beta_features").ok();
    let beta_features: Vec<String> = beta_features_raw
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default();
    let base_stop_sequences = load_preset_stop_sequences(db, preset_id).await?;
    let provider_override =
        load_preset_provider_override_data(db, preset_id, provider_kind, debug).await?;

    if temperature.is_some()
        || max_output_tokens.is_some()
        || top_p.is_some()
        || top_k.is_some()
        || presence_penalty.is_some()
        || frequency_penalty.is_some()
        || response_mode.is_some()
        || thinking_enabled.is_some()
        || thinking_budget_tokens.is_some()
        || !beta_features.is_empty()
        || !base_stop_sequences.is_empty()
    {
        debug
            .input_sources
            .push(format!("preset:{preset_id}:params"));
    }
    if !base_stop_sequences.is_empty() {
        debug
            .input_sources
            .push(format!("preset:{preset_id}:stop_sequences"));
    }

    let mut blocks = Vec::new();
    let mut prefill_seed = None;
    let mut output_validators = Vec::new();
    let rows = sqlx::query(
        "SELECT id, block_type, title, content \
         FROM preset_prompt_blocks \
         WHERE preset_id = ? AND is_enabled = 1 \
         ORDER BY sort_order ASC, priority DESC, id ASC",
    )
    .bind(preset_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    for row in rows {
        let block_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        let block_type: String = row.try_get("block_type").unwrap_or_default();
        let content: String = row.try_get("content").unwrap_or_default();
        let descriptor = format!("preset {preset_id} block {block_id}");
        let directive = parse_preset_block_directive(&block_type, &content, &descriptor)?;
        let block_type = block_type.trim().to_string();
        if preset_block_is_disabled(
            &provider_override.disabled_block_types,
            &block_type,
            &directive,
        ) {
            continue;
        }
        let title = normalize_optional_title(row.try_get("title").ok());
        if content.trim().is_empty() {
            return Err(format!(
                "preset {preset_id} block {block_id} has empty content"
            ));
        }

        debug
            .input_sources
            .push(format!("preset:{preset_id}:block:{block_id}:{block_type}"));
        match directive {
            PresetBlockDirective::SystemLiteral { .. } => {
                blocks.push(build_block(
                    PromptBlockKind::PresetRule,
                    PromptRole::System,
                    title,
                    content,
                    PromptBlockSource::Preset {
                        preset_id,
                        block_id: Some(block_id),
                    },
                    true,
                ));
            }
            PresetBlockDirective::SystemTemplate { .. } => {
                let rendered = render_prompt_template(&content, render_context, &descriptor)?;
                if rendered.trim().is_empty() {
                    return Err(format!("{descriptor} rendered empty content"));
                }
                blocks.push(build_block(
                    PromptBlockKind::PresetRule,
                    PromptRole::System,
                    title,
                    rendered,
                    PromptBlockSource::Preset {
                        preset_id,
                        block_id: Some(block_id),
                    },
                    true,
                ));
            }
            PresetBlockDirective::PrefillLiteral => {
                if prefill_seed.is_some() {
                    return Err(format!(
                        "preset {preset_id} has multiple enabled prefill blocks"
                    ));
                }
                prefill_seed = Some(build_block(
                    PromptBlockKind::PrefillSeed,
                    PromptRole::Assistant,
                    title,
                    content,
                    PromptBlockSource::Preset {
                        preset_id,
                        block_id: Some(block_id),
                    },
                    true,
                ));
            }
            PresetBlockDirective::PrefillTemplate => {
                if prefill_seed.is_some() {
                    return Err(format!(
                        "preset {preset_id} has multiple enabled prefill blocks"
                    ));
                }
                let rendered = render_prompt_template(&content, render_context, &descriptor)?;
                if rendered.trim().is_empty() {
                    return Err(format!("{descriptor} rendered empty prefill content"));
                }
                prefill_seed = Some(build_block(
                    PromptBlockKind::PrefillSeed,
                    PromptRole::Assistant,
                    title,
                    rendered,
                    PromptBlockSource::Preset {
                        preset_id,
                        block_id: Some(block_id),
                    },
                    true,
                ));
            }
            PresetBlockDirective::OutputValidator { mode, config } => {
                output_validators.push(build_output_validator(
                    mode,
                    config,
                    title,
                    PromptBlockSource::Preset {
                        preset_id,
                        block_id: Some(block_id),
                    },
                    &descriptor,
                )?);
            }
        }
    }

    let mut example_blocks = Vec::new();
    let example_rows = sqlx::query(
        "SELECT id, role, content \
         FROM preset_examples \
         WHERE preset_id = ? AND is_enabled = 1 \
         ORDER BY sort_order ASC, id ASC",
    )
    .bind(preset_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    for row in example_rows {
        let example_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        let role: String = row.try_get("role").unwrap_or_default();
        let content: String = row.try_get("content").unwrap_or_default();
        if content.trim().is_empty() {
            return Err(format!(
                "preset {preset_id} example {example_id} has empty content"
            ));
        }

        let prompt_role = match role.as_str() {
            "user" => PromptRole::User,
            "assistant" => PromptRole::Assistant,
            _ => {
                return Err(format!(
                    "preset {preset_id} example {example_id} has invalid role: {role}"
                ))
            }
        };

        debug
            .input_sources
            .push(format!("preset:{preset_id}:example:{example_id}:{role}"));
        example_blocks.push(build_block(
            PromptBlockKind::ExampleMessage,
            prompt_role,
            Some(format!("Preset Example {example_id}")),
            content,
            PromptBlockSource::Preset {
                preset_id,
                block_id: Some(example_id),
            },
            true,
        ));
    }

    Ok(LoadedPresetCompilerData {
        blocks,
        example_blocks,
        prefill_seed,
        output_validators,
        params: CompiledSamplingParams {
            temperature: provider_override.temperature_override.or(temperature),
            max_output_tokens: provider_override
                .max_output_tokens_override
                .or(max_output_tokens),
            top_p: provider_override.top_p_override.or(top_p),
            top_k: provider_override.top_k_override.or(top_k),
            presence_penalty: provider_override
                .presence_penalty_override
                .or(presence_penalty),
            frequency_penalty: provider_override
                .frequency_penalty_override
                .or(frequency_penalty),
            response_mode: provider_override.response_mode_override.or(response_mode),
            stop_sequences: provider_override
                .stop_sequences_override
                .unwrap_or(base_stop_sequences),
            thinking_enabled: provider_override
                .thinking_enabled_override
                .or(thinking_enabled),
            thinking_budget_tokens: provider_override
                .thinking_budget_tokens_override
                .or(thinking_budget_tokens),
            beta_features: provider_override
                .beta_features_override
                .unwrap_or(beta_features),
        },
    })
}

fn parse_preset_block_directive(
    block_type: &str,
    content: &str,
    descriptor: &str,
) -> Result<PresetBlockDirective, String> {
    let block_type = block_type.trim();
    if block_type.is_empty() {
        return Err(format!("{descriptor} block_type cannot be empty"));
    }
    if content.trim().is_empty() {
        return Err(format!("{descriptor} content cannot be empty"));
    }

    if let Some(base_type) = block_type.strip_prefix(TEMPLATE_BLOCK_TYPE_PREFIX) {
        let normalized_block_type = base_type.trim();
        if normalized_block_type.is_empty() {
            return Err(format!(
                "{descriptor} template block type must include a base type"
            ));
        }
        validate_prompt_template_syntax(content, descriptor)?;
        return Ok(if normalized_block_type == "prefill" {
            PresetBlockDirective::PrefillTemplate
        } else {
            PresetBlockDirective::SystemTemplate {
                normalized_block_type: normalized_block_type.to_string(),
            }
        });
    }

    match block_type {
        COMPILER_PREFILL_BLOCK_TYPE => Ok(PresetBlockDirective::PrefillLiteral),
        COMPILER_REGEX_MUST_MATCH_BLOCK_TYPE => Ok(PresetBlockDirective::OutputValidator {
            mode: OutputValidationMode::MustMatch,
            config: parse_output_validator_config(content, descriptor)?,
        }),
        COMPILER_REGEX_MUST_NOT_MATCH_BLOCK_TYPE => Ok(PresetBlockDirective::OutputValidator {
            mode: OutputValidationMode::MustNotMatch,
            config: parse_output_validator_config(content, descriptor)?,
        }),
        _ => Ok(PresetBlockDirective::SystemLiteral {
            normalized_block_type: block_type.to_string(),
        }),
    }
}

fn validate_prompt_template_syntax(template_source: &str, descriptor: &str) -> Result<(), String> {
    let mut env = Environment::new();
    env.set_undefined_behavior(UndefinedBehavior::Strict);
    env.template_from_str(template_source)
        .map_err(|err| format!("{descriptor} template syntax error: {err}"))?;
    Ok(())
}

fn render_prompt_template(
    template_source: &str,
    render_context: &PromptTemplateRenderContext,
    descriptor: &str,
) -> Result<String, String> {
    let mut env = Environment::new();
    env.set_undefined_behavior(UndefinedBehavior::Strict);
    env.render_str(template_source, render_context)
        .map_err(|err| format!("{descriptor} template render failed: {err}"))
}

fn parse_output_validator_config(
    content: &str,
    descriptor: &str,
) -> Result<OutputValidatorConfig, String> {
    let config = serde_json::from_str::<OutputValidatorConfig>(content)
        .map_err(|err| format!("{descriptor} regex validator JSON parse failed: {err}"))?;
    let pattern =
        normalize_loaded_required_text(config.pattern, &format!("{descriptor} regex pattern"))?;
    let error_message = normalize_loaded_required_text(
        config.error_message,
        &format!("{descriptor} regex error_message"),
    )?;
    Regex::new(&pattern).map_err(|err| format!("{descriptor} regex pattern is invalid: {err}"))?;

    Ok(OutputValidatorConfig {
        pattern,
        error_message,
    })
}

fn build_output_validator(
    mode: OutputValidationMode,
    config: OutputValidatorConfig,
    title: Option<String>,
    source: PromptBlockSource,
    descriptor: &str,
) -> Result<CompiledOutputValidator, String> {
    let regex = Regex::new(&config.pattern)
        .map_err(|err| format!("{descriptor} regex pattern is invalid: {err}"))?;

    Ok(CompiledOutputValidator {
        mode,
        pattern: config.pattern,
        error_message: config.error_message,
        regex,
        title,
        source,
    })
}

fn preset_block_is_disabled(
    disabled_block_types: &HashSet<String>,
    raw_block_type: &str,
    directive: &PresetBlockDirective,
) -> bool {
    let normalized_block_type = match directive {
        PresetBlockDirective::SystemLiteral {
            normalized_block_type,
        }
        | PresetBlockDirective::SystemTemplate {
            normalized_block_type,
        } => Some(normalized_block_type.as_str()),
        PresetBlockDirective::PrefillLiteral
        | PresetBlockDirective::PrefillTemplate
        | PresetBlockDirective::OutputValidator { .. } => None,
    };

    disabled_block_types.contains(raw_block_type)
        || normalized_block_type
            .map(|normalized_block_type| disabled_block_types.contains(normalized_block_type))
            .unwrap_or(false)
}

async fn load_preset_stop_sequences(
    db: &SqlitePool,
    preset_id: i64,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT id, stop_text \
         FROM preset_stop_sequences \
         WHERE preset_id = ? \
         ORDER BY sort_order ASC, id ASC",
    )
    .bind(preset_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let mut stop_sequences = Vec::with_capacity(rows.len());
    for row in rows {
        let stop_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        let stop_text: String = row.try_get("stop_text").unwrap_or_default();
        stop_sequences.push(normalize_loaded_required_text(
            stop_text,
            &format!("preset {preset_id} stop_sequence {stop_id}"),
        )?);
    }

    Ok(stop_sequences)
}

async fn load_preset_provider_override_data(
    db: &SqlitePool,
    preset_id: i64,
    provider_kind: Option<&str>,
    debug: &mut PromptCompileDebugReport,
) -> Result<LoadedPresetProviderOverrideData, String> {
    let Some(provider_kind) = provider_kind
        .map(str::trim)
        .filter(|provider_kind| !provider_kind.is_empty())
    else {
        return Ok(LoadedPresetProviderOverrideData::default());
    };

    let row = sqlx::query(
        "SELECT temperature_override, max_output_tokens_override, top_p_override, top_k_override, \
         presence_penalty_override, frequency_penalty_override, response_mode_override, \
         stop_sequences_override, disabled_block_types, \
         thinking_enabled_override, thinking_budget_tokens_override, beta_features_override \
         FROM preset_provider_overrides \
         WHERE preset_id = ? AND provider_kind = ? \
         LIMIT 1",
    )
    .bind(preset_id)
    .bind(provider_kind)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    let Some(row) = row else {
        return Ok(LoadedPresetProviderOverrideData::default());
    };

    debug.input_sources.push(format!(
        "preset:{preset_id}:provider_override:{provider_kind}"
    ));

    let stop_sequences_override = parse_optional_json_string_array(
        row.try_get("stop_sequences_override").ok(),
        &format!("preset {preset_id} provider override {provider_kind} stop_sequences_override"),
    )?;
    let disabled_block_types = parse_optional_json_string_array(
        row.try_get("disabled_block_types").ok(),
        &format!("preset {preset_id} provider override {provider_kind} disabled_block_types"),
    )?
    .unwrap_or_default()
    .into_iter()
    .collect::<HashSet<_>>();

    Ok(LoadedPresetProviderOverrideData {
        temperature_override: row.try_get("temperature_override").ok(),
        max_output_tokens_override: row.try_get("max_output_tokens_override").ok(),
        top_p_override: row.try_get("top_p_override").ok(),
        top_k_override: row.try_get("top_k_override").ok(),
        presence_penalty_override: row.try_get("presence_penalty_override").ok(),
        frequency_penalty_override: row.try_get("frequency_penalty_override").ok(),
        response_mode_override: normalize_loaded_response_mode(
            row.try_get("response_mode_override").ok(),
            &format!("preset {preset_id} provider override {provider_kind} response_mode_override"),
        )?,
        stop_sequences_override,
        disabled_block_types,
        thinking_enabled_override: row.try_get("thinking_enabled_override").ok().flatten(),
        thinking_budget_tokens_override: row.try_get("thinking_budget_tokens_override").ok(),
        beta_features_override: row
            .try_get("beta_features_override")
            .ok()
            .flatten()
            .and_then(|s: String| serde_json::from_str::<Vec<String>>(&s).ok()),
    })
}

async fn load_character_base_block(
    db: &SqlitePool,
    character_id: i64,
) -> Result<Option<PromptBlock>, String> {
    let Some(content) = load_character_system_message(db, character_id).await? else {
        return Ok(None);
    };

    Ok(Some(build_block(
        PromptBlockKind::CharacterBase,
        PromptRole::System,
        Some("Character Base".to_string()),
        content,
        PromptBlockSource::Character { character_id },
        true,
    )))
}

fn build_world_book_trigger_sources(
    current_user_block: &PromptBlock,
    history_blocks: &[PromptBlock],
    latest_character_state_overlay_text: Option<&str>,
) -> Vec<WorldBookTriggerSource> {
    let mut sources = Vec::new();

    if !current_user_block.content.trim().is_empty() {
        sources.push(WorldBookTriggerSource {
            kind: WorldBookTriggerSourceKind::CurrentUser,
            text: current_user_block.content.clone(),
        });
    }

    let recent_history_sources = history_blocks
        .iter()
        .rev()
        .filter(|block| block.role != PromptRole::System)
        .filter_map(|block| {
            let text = block.content.trim();
            if text.is_empty() {
                None
            } else {
                Some(WorldBookTriggerSource {
                    kind: WorldBookTriggerSourceKind::RecentHistory,
                    text: text.to_string(),
                })
            }
        })
        .take(MAX_WORLD_BOOK_TRIGGER_HISTORY_BLOCKS)
        .collect::<Vec<_>>();

    sources.extend(recent_history_sources);

    if let Some(overlay_text) = latest_character_state_overlay_text
        .map(str::trim)
        .filter(|overlay_text| !overlay_text.is_empty())
    {
        sources.push(WorldBookTriggerSource {
            kind: WorldBookTriggerSourceKind::CharacterStateOverlay,
            text: overlay_text.to_string(),
        });
    }

    sources
}

async fn load_world_book_blocks(
    db: &SqlitePool,
    world_book_id: i64,
    trigger_sources: &[WorldBookTriggerSource],
    max_world_book_tokens: Option<usize>,
    debug: &mut PromptCompileDebugReport,
) -> Result<Vec<PromptBlock>, String> {
    if trigger_sources.is_empty() {
        return Ok(Vec::new());
    }

    let entries = load_triggered_world_book_entries(db, world_book_id, trigger_sources).await?;
    let max_tokens = max_world_book_tokens.unwrap_or(DEFAULT_MAX_WORLD_BOOK_TOKENS);
    let mut blocks = Vec::new();
    let mut total_world_book_tokens = 0usize;

    for entry in entries {
        debug.input_sources.push(format!(
            "world_book:{}:{}:{}",
            entry.world_book_id,
            entry.entry_id,
            entry.trigger_source_kind.as_str()
        ));
        let content = if entry.title.trim().is_empty() {
            entry.content.clone()
        } else {
            format!(
                "World Book Entry: {}\n{}",
                entry.title.trim(),
                entry.content
            )
        };
        let block = build_block(
            PromptBlockKind::WorldBookMatch,
            PromptRole::System,
            Some(entry.title),
            content,
            PromptBlockSource::WorldBook {
                world_book_id: entry.world_book_id,
                entry_id: entry.entry_id,
            },
            false,
        );
        let token_cost = block
            .token_cost_estimate
            .unwrap_or_else(|| estimate_token_cost(&block.content));

        if !blocks.is_empty()
            && (blocks.len() >= MAX_WORLD_BOOK_BLOCKS
                || total_world_book_tokens.saturating_add(token_cost) > max_tokens)
        {
            break;
        }

        total_world_book_tokens = total_world_book_tokens.saturating_add(token_cost);
        blocks.push(block);
    }

    blocks.sort_by(|left, right| left.priority.cmp(&right.priority));
    Ok(blocks)
}

async fn load_current_user_block(
    db: &SqlitePool,
    conversation_id: i64,
    target_round_id: Option<i64>,
) -> Result<PromptBlock, String> {
    let row = match target_round_id {
        Some(round_id) => sqlx::query(
            "SELECT id, role, content \
             FROM messages \
             WHERE conversation_id = ? AND round_id = ? AND message_kind = 'user_aggregate' \
             ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .bind(conversation_id)
        .bind(round_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?,
        None => sqlx::query(
            "SELECT id, role, content \
             FROM messages \
             WHERE conversation_id = ? AND message_kind IN ('user_aggregate', 'user_visible') \
             ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .bind(conversation_id)
        .fetch_optional(db)
        .await
        .map_err(|err| err.to_string())?,
    };

    let row = row.ok_or_else(|| "current round input message was not found".to_string())?;
    let message_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
    let role = PromptRole::from_message_role(
        &row.try_get::<String, _>("role")
            .unwrap_or_else(|_| "user".to_string()),
    );
    let content: String = row.try_get("content").unwrap_or_default();

    Ok(build_block(
        PromptBlockKind::CurrentUser,
        role,
        Some("Current User".to_string()),
        content,
        PromptBlockSource::Message { message_id },
        true,
    ))
}

async fn load_recent_history_blocks(
    db: &SqlitePool,
    conversation_id: i64,
    target_round_id: Option<i64>,
    exclude_message_id: i64,
    summarized_round_ids: &HashSet<i64>,
    debug: &mut PromptCompileDebugReport,
) -> Result<Vec<PromptBlock>, String> {
    let rows = if let Some(tid) = target_round_id {
        let sql = "SELECT id, role, content, message_kind, round_id FROM messages WHERE conversation_id = ? AND id != ? AND ((message_kind = 'user_aggregate' AND (round_id IS NULL OR round_id != ?)) OR (message_kind = 'user_visible' AND round_id IS NULL) OR (message_kind = 'assistant_visible' AND (round_id IS NULL OR id IN (SELECT active_assistant_message_id FROM message_rounds WHERE conversation_id = ? AND active_assistant_message_id IS NOT NULL AND id != ?))) OR message_kind = 'system') ORDER BY created_at ASC, id ASC";
        eprintln!(
            "[prompt-compiler] load_recent_history_blocks(Some): sql={}",
            sql
        );
        eprintln!("[prompt-compiler] load_recent_history_blocks(Some): params: conversation_id={}, exclude_message_id={}, tid={}", conversation_id, exclude_message_id, tid);

        let step1 = sqlx::query("SELECT id FROM messages WHERE conversation_id = ? LIMIT 1")
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| {
                eprintln!("[prompt-compiler] step1_ERROR: {}", err);
                err.to_string()
            })?;
        eprintln!("[prompt-compiler] step1_ok: {:?}", step1.is_some());

        let step2 =
            sqlx::query("SELECT id FROM messages WHERE conversation_id = ? AND id != ? LIMIT 1")
                .bind(conversation_id)
                .bind(exclude_message_id)
                .fetch_optional(db)
                .await
                .map_err(|err| {
                    eprintln!("[prompt-compiler] step2_ERROR: {}", err);
                    err.to_string()
                })?;
        eprintln!("[prompt-compiler] step2_ok: {:?}", step2.is_some());

        let step3 = sqlx::query("SELECT id, role, content, message_kind, round_id FROM messages WHERE conversation_id = ? AND id != ? AND message_kind = 'user_aggregate' LIMIT 1")
            .bind(conversation_id)
            .bind(exclude_message_id)
            .fetch_optional(db)
            .await
            .map_err(|err| { eprintln!("[prompt-compiler] step3_ERROR: {}", err); err.to_string() })?;
        eprintln!("[prompt-compiler] step3_ok: {:?}", step3.is_some());

        let step4 = sqlx::query("SELECT id FROM message_rounds WHERE conversation_id = ? AND active_assistant_message_id IS NOT NULL LIMIT 1")
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| { eprintln!("[prompt-compiler] step4_ERROR: {}", err); err.to_string() })?;
        eprintln!("[prompt-compiler] step4_ok: {:?}", step4.is_some());

        let step5 = sqlx::query("SELECT id FROM messages WHERE conversation_id = ? AND id IN (SELECT active_assistant_message_id FROM message_rounds WHERE conversation_id = ?) LIMIT 1")
            .bind(conversation_id)
            .bind(conversation_id)
            .fetch_optional(db)
            .await
            .map_err(|err| { eprintln!("[prompt-compiler] step5_ERROR: {}", err); err.to_string() })?;
        eprintln!("[prompt-compiler] step5_ok: {:?}", step5.is_some());

        sqlx::query(sql)
            .bind(conversation_id)
            .bind(exclude_message_id)
            .bind(tid)
            .bind(conversation_id)
            .bind(tid)
            .fetch_all(db)
            .await
            .map_err(|err| {
                eprintln!(
                    "[prompt-compiler] load_recent_history_blocks(Some): SQL_ERROR: {}",
                    err
                );
                err.to_string()
            })?
    } else {
        let sql = "SELECT id, role, content, message_kind, round_id FROM messages WHERE conversation_id = ? AND id != ? AND (message_kind = 'user_aggregate' OR (message_kind = 'user_visible' AND round_id IS NULL) OR (message_kind = 'assistant_visible' AND (round_id IS NULL OR id IN (SELECT active_assistant_message_id FROM message_rounds WHERE conversation_id = ? AND active_assistant_message_id IS NOT NULL))) OR message_kind = 'system') ORDER BY created_at ASC, id ASC";
        eprintln!(
            "[prompt-compiler] load_recent_history_blocks(None): sql={}",
            sql
        );
        sqlx::query(sql)
            .bind(conversation_id)
            .bind(exclude_message_id)
            .bind(conversation_id)
            .fetch_all(db)
            .await
            .map_err(|err| {
                eprintln!(
                    "[prompt-compiler] load_recent_history_blocks(None): SQL_ERROR: {}",
                    err
                );
                err.to_string()
            })?
    };

    let mut blocks = Vec::with_capacity(rows.len());
    for row in rows {
        let message_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        let round_id: Option<i64> = row.try_get("round_id").ok();
        if round_id.is_some_and(|round_id| summarized_round_ids.contains(&round_id)) {
            continue;
        }
        let role = PromptRole::from_message_role(
            &row.try_get::<String, _>("role")
                .unwrap_or_else(|_| "user".to_string()),
        );
        let content: String = row.try_get("content").unwrap_or_default();
        let message_kind: String = row.try_get("message_kind").unwrap_or_default();
        debug
            .input_sources
            .push(format!("history:message:{message_id}:{message_kind}"));
        blocks.push(build_block(
            PromptBlockKind::RecentHistory,
            role,
            None,
            content,
            PromptBlockSource::Message { message_id },
            false,
        ));
    }
    Ok(blocks)
}
fn build_block(
    kind: PromptBlockKind,
    role: PromptRole,
    title: Option<String>,
    content: String,
    source: PromptBlockSource,
    required: bool,
) -> PromptBlock {
    PromptBlock {
        priority: kind.priority(),
        token_cost_estimate: Some(estimate_token_cost(&content)),
        kind,
        role,
        title,
        content,
        source,
        required,
    }
}

fn normalize_optional_title(title: Option<String>) -> Option<String> {
    title.and_then(|title| {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_loaded_required_text(value: String, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} cannot be empty"));
    }
    Ok(trimmed.to_string())
}

fn normalize_loaded_response_mode(
    value: Option<String>,
    field_name: &str,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };

    let normalized = value.trim();
    match normalized {
        "" => Ok(None),
        "text" | "json_object" => Ok(Some(normalized.to_string())),
        _ => Err(format!("{field_name} must be one of: text, json_object")),
    }
}

fn parse_optional_json_string_array(
    raw: Option<String>,
    field_name: &str,
) -> Result<Option<Vec<String>>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }

    let parsed = serde_json::from_str::<Vec<String>>(&raw)
        .map_err(|err| format!("{field_name} JSON parse failed: {err}"))?;

    let mut values = Vec::with_capacity(parsed.len());
    let mut seen = HashSet::with_capacity(parsed.len());
    for (index, value) in parsed.into_iter().enumerate() {
        let value = normalize_loaded_required_text(value, &format!("{field_name}[{index}]"))?;
        if seen.insert(value.clone()) {
            values.push(value);
        }
    }

    Ok(Some(values))
}

fn apply_budget_trim(result: &mut PromptCompileResult, budget: &PromptBudget) {
    let Some(max_total_tokens) = budget.max_total_tokens else {
        return;
    };

    let reserve_output = budget.reserve_output_tokens.unwrap_or(0).max(1024);
    let safety_margin = ((max_total_tokens as f64) * 0.1) as usize;
    let allowed_tokens = max_total_tokens
        .saturating_sub(reserve_output)
        .saturating_sub(safety_margin);

    eprintln!(
        "[prompt-compiler] apply_budget_trim: max_total_tokens={}, reserve_output={}, safety_margin={}, allowed_tokens={}, estimated_before={}",
        max_total_tokens, reserve_output, safety_margin, allowed_tokens, total_estimated_tokens(result)
    );

    loop {
        let total_tokens = total_estimated_tokens(result);
        if total_tokens <= allowed_tokens {
            eprintln!(
                "[prompt-compiler] apply_budget_trim: done. estimated_after={}, trimmed_count={}",
                total_tokens,
                result.debug.trimmed_blocks.len()
            );
            break;
        }
        if trim_first_non_required_system_block(
            result,
            PromptBlockKind::RetrievedDetail,
            "budget_trim:retrieved_detail",
        ) {
            continue;
        }
        if trim_first_non_required_system_block(
            result,
            PromptBlockKind::PlotSummary,
            "budget_trim:plot_summary",
        ) {
            continue;
        }
        if trim_first_non_required_system_block(
            result,
            PromptBlockKind::WorldBookMatch,
            "budget_trim:world_book",
        ) {
            continue;
        }
        if trim_first_non_required_system_block(
            result,
            PromptBlockKind::WorldVariable,
            "budget_trim:character_state_overlay", // TODO: Transitional - will be renamed to "budget_trim:world_variable" when WorldVariable is fully implemented
        ) {
            continue;
        }
        if trim_first_non_required_system_block(
            result,
            PromptBlockKind::ExampleMessage,
            "budget_trim:example_message",
        ) {
            continue;
        }
        if trim_oldest_history_block(result, "budget_trim:recent_history") {
            continue;
        }
        eprintln!(
            "[prompt-compiler] apply_budget_trim: WARNING cannot trim further. estimated={}, allowed={}",
            total_tokens, allowed_tokens
        );
        break;
    }
}

fn trim_first_non_required_system_block(
    result: &mut PromptCompileResult,
    kind: PromptBlockKind,
    reason: &str,
) -> bool {
    let Some(index) = result
        .system_blocks
        .iter()
        .position(|block| block.kind == kind && !block.required)
    else {
        return false;
    };

    let removed = result.system_blocks.remove(index);
    result.debug.trimmed_blocks.push(PromptTrimmedBlock {
        kind: removed.kind.as_str().to_string(),
        title: removed.title,
        reason: reason.to_string(),
    });
    true
}

fn trim_oldest_history_block(result: &mut PromptCompileResult, reason: &str) -> bool {
    let Some(index) = result
        .history_blocks
        .iter()
        .position(|block| block.kind == PromptBlockKind::RecentHistory && !block.required)
    else {
        return false;
    };

    let removed = result.history_blocks.remove(index);
    result.debug.trimmed_blocks.push(PromptTrimmedBlock {
        kind: removed.kind.as_str().to_string(),
        title: removed.title,
        reason: reason.to_string(),
    });
    true
}

fn total_estimated_tokens(result: &PromptCompileResult) -> usize {
    result
        .system_blocks
        .iter()
        .chain(result.example_blocks.iter())
        .chain(result.history_blocks.iter())
        .chain(std::iter::once(&result.current_user_block))
        .chain(result.prefill_seed.iter())
        .map(|block| {
            block
                .token_cost_estimate
                .unwrap_or_else(|| estimate_token_cost(&block.content))
        })
        .sum()
}

fn build_final_block_order(result: &PromptCompileResult) -> Vec<String> {
    result
        .system_blocks
        .iter()
        .chain(result.example_blocks.iter())
        .chain(result.history_blocks.iter())
        .chain(std::iter::once(&result.current_user_block))
        .chain(result.prefill_seed.iter())
        .map(|block| {
            if let Some(title) = &block.title {
                format!("{}({})", block.kind.as_str(), title)
            } else {
                block.kind.as_str().to_string()
            }
        })
        .collect()
}

fn estimate_token_cost(content: &str) -> usize {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let mut cjk_count = 0usize;
    let mut other_count = 0usize;
    for ch in trimmed.chars() {
        if is_cjk_codepoint(ch) {
            cjk_count += 1;
        } else {
            other_count += 1;
        }
    }
    let cjk_tokens = cjk_count.saturating_mul(2);
    let other_tokens = other_count.div_ceil(4);
    cjk_tokens.saturating_add(other_tokens)
}

fn is_cjk_codepoint(ch: char) -> bool {
    let cp = ch as u32;
    (0x4E00..=0x9FFF).contains(&cp)
        || (0x3400..=0x4DBF).contains(&cp)
        || (0x20000..=0x2A6DF).contains(&cp)
        || (0x2A700..=0x2B73F).contains(&cp)
        || (0x2B740..=0x2B81F).contains(&cp)
        || (0x2B820..=0x2CEAF).contains(&cp)
        || (0xF900..=0xFAFF).contains(&cp)
        || (0x2F800..=0x2FA1F).contains(&cp)
        || (0x3000..=0x303F).contains(&cp)
        || (0xFF00..=0xFFEF).contains(&cp)
        || (0x3040..=0x309F).contains(&cp)
        || (0x30A0..=0x30FF).contains(&cp)
        || (0xAC00..=0xD7AF).contains(&cp)
}

fn source_message_id(source: &PromptBlockSource) -> i64 {
    match source {
        PromptBlockSource::Message { message_id } => *message_id,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_character_system_message, build_preview_template_render_context,
        compile_preset_preview_data, load_preset_compiler_data, CharacterBaseSectionCompileData,
        CharacterCompileData, PromptCompileDebugReport,
    };
    use serde_json::json;
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    fn run_async_test<F>(test: F)
    where
        F: std::future::Future<Output = ()>,
    {
        tauri::async_runtime::block_on(test);
    }

    async fn create_test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create sqlite");

        sqlx::query(
            "CREATE TABLE presets (
                id INTEGER PRIMARY KEY,
                temperature REAL,
                max_output_tokens INTEGER,
                top_p REAL,
                top_k INTEGER,
                presence_penalty REAL,
                frequency_penalty REAL,
                response_mode TEXT,
                thinking_enabled INTEGER,
                thinking_budget_tokens INTEGER,
                beta_features TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("create presets");

        sqlx::query(
            "CREATE TABLE preset_prompt_blocks (
                id INTEGER PRIMARY KEY,
                preset_id INTEGER NOT NULL,
                block_type TEXT NOT NULL,
                title TEXT,
                content TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                priority INTEGER NOT NULL DEFAULT 100,
                is_enabled INTEGER NOT NULL DEFAULT 1
            )",
        )
        .execute(&pool)
        .await
        .expect("create preset_prompt_blocks");

        sqlx::query(
            "CREATE TABLE preset_examples (
                id INTEGER PRIMARY KEY,
                preset_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_enabled INTEGER NOT NULL DEFAULT 1
            )",
        )
        .execute(&pool)
        .await
        .expect("create preset_examples");

        sqlx::query(
            "CREATE TABLE preset_stop_sequences (
                id INTEGER PRIMARY KEY,
                preset_id INTEGER NOT NULL,
                stop_text TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(&pool)
        .await
        .expect("create preset_stop_sequences");

        sqlx::query(
            "CREATE TABLE preset_provider_overrides (
                id INTEGER PRIMARY KEY,
                preset_id INTEGER NOT NULL,
                provider_kind TEXT NOT NULL,
                temperature_override REAL,
                max_output_tokens_override INTEGER,
                top_p_override REAL,
                top_k_override INTEGER,
                presence_penalty_override REAL,
                frequency_penalty_override REAL,
                response_mode_override TEXT,
                stop_sequences_override TEXT,
                disabled_block_types TEXT,
                thinking_enabled_override INTEGER,
                thinking_budget_tokens_override INTEGER,
                beta_features_override TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("create preset_provider_overrides");

        pool
    }

    #[test]
    fn preview_applies_provider_override_penalties_and_filters_disabled_blocks() {
        run_async_test(async {
            let pool = create_test_pool().await;

            sqlx::query(
                "INSERT INTO presets (
                    id, temperature, max_output_tokens, top_p, presence_penalty, frequency_penalty,
                    response_mode
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(1_i64)
            .bind(0.7_f64)
            .bind(200_i64)
            .bind(0.9_f64)
            .bind(1.1_f64)
            .bind(0.6_f64)
            .bind("text")
            .execute(&pool)
            .await
            .expect("insert preset");

            sqlx::query(
                "INSERT INTO preset_prompt_blocks (
                    id, preset_id, block_type, title, content, sort_order, priority, is_enabled
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(10_i64)
            .bind(1_i64)
            .bind("style")
            .bind("Style")
            .bind("Keep the narration concise.")
            .bind(0_i64)
            .bind(100_i64)
            .bind(1_i64)
            .execute(&pool)
            .await
            .expect("insert enabled block");

            sqlx::query(
                "INSERT INTO preset_prompt_blocks (
                    id, preset_id, block_type, title, content, sort_order, priority, is_enabled
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(11_i64)
            .bind(1_i64)
            .bind("internal")
            .bind("Internal")
            .bind("This block should be disabled by provider override.")
            .bind(1_i64)
            .bind(100_i64)
            .bind(1_i64)
            .execute(&pool)
            .await
            .expect("insert disabled block candidate");

            sqlx::query(
                "INSERT INTO preset_examples (
                    id, preset_id, role, content, sort_order, is_enabled
                 ) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(21_i64)
            .bind(1_i64)
            .bind("user")
            .bind("Example input")
            .bind(0_i64)
            .bind(1_i64)
            .execute(&pool)
            .await
            .expect("insert example");

            sqlx::query(
                "INSERT INTO preset_stop_sequences (id, preset_id, stop_text, sort_order)
                 VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
            )
            .bind(31_i64)
            .bind(1_i64)
            .bind("END")
            .bind(0_i64)
            .bind(32_i64)
            .bind(1_i64)
            .bind("###")
            .bind(1_i64)
            .execute(&pool)
            .await
            .expect("insert stop sequences");

            sqlx::query(
                "INSERT INTO preset_provider_overrides (
                    id, preset_id, provider_kind, temperature_override, max_output_tokens_override,
                    top_p_override, presence_penalty_override, frequency_penalty_override,
                    response_mode_override, stop_sequences_override, disabled_block_types
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(41_i64)
            .bind(1_i64)
            .bind("openai_compatible")
            .bind(0.3_f64)
            .bind(120_i64)
            .bind(0.85_f64)
            .bind(0.4_f64)
            .bind(-0.2_f64)
            .bind("json_object")
            .bind(json!(["STOP"]).to_string())
            .bind(json!(["internal"]).to_string())
            .execute(&pool)
            .await
            .expect("insert provider override");

            let preview = compile_preset_preview_data(&pool, 1, Some("openai_compatible"))
                .await
                .expect("compile preview");

            assert_eq!(preview.system_blocks.len(), 1);
            assert_eq!(preview.system_blocks[0].title.as_deref(), Some("Style"));
            assert_eq!(preview.example_blocks.len(), 1);
            assert_eq!(preview.params.temperature, Some(0.3));
            assert_eq!(preview.params.max_output_tokens, Some(120));
            assert_eq!(preview.params.top_p, Some(0.85));
            assert_eq!(preview.params.presence_penalty, Some(0.4));
            assert_eq!(preview.params.frequency_penalty, Some(-0.2));
            assert_eq!(preview.params.response_mode.as_deref(), Some("json_object"));
            assert_eq!(preview.params.stop_sequences, vec!["STOP".to_string()]);
        });
    }

    #[test]
    fn preset_compiler_extracts_prefill_and_output_validators() {
        run_async_test(async {
            let pool = create_test_pool().await;

            sqlx::query(
                "INSERT INTO presets (
                    id, temperature, max_output_tokens, top_p, presence_penalty, frequency_penalty,
                    response_mode
                 ) VALUES (?, NULL, NULL, NULL, NULL, NULL, NULL)",
            )
            .bind(2_i64)
            .execute(&pool)
            .await
            .expect("insert preset");

            sqlx::query(
                "INSERT INTO preset_prompt_blocks (
                    id, preset_id, block_type, title, content, sort_order, priority, is_enabled
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(51_i64)
            .bind(2_i64)
            .bind("template:style")
            .bind("Style")
            .bind("Use model {{ provider.model_name }} for {{ character.name }}.")
            .bind(0_i64)
            .bind(100_i64)
            .bind(1_i64)
            .bind(52_i64)
            .bind(2_i64)
            .bind("compiler:prefill")
            .bind("Prefill")
            .bind("Assistant seed")
            .bind(1_i64)
            .bind(100_i64)
            .bind(1_i64)
            .bind(53_i64)
            .bind(2_i64)
            .bind("compiler:regex:must_not_match")
            .bind("Regex")
            .bind(r#"{"pattern":"forbidden","errorMessage":"bad output"}"#)
            .bind(2_i64)
            .bind(100_i64)
            .bind(1_i64)
            .execute(&pool)
            .await
            .expect("insert compiler blocks");

            let render_context =
                build_preview_template_render_context(2, Some("openai_compatible"));
            let mut debug = PromptCompileDebugReport::default();
            let compiled = load_preset_compiler_data(
                &pool,
                Some(2),
                Some("openai_compatible"),
                &render_context,
                &mut debug,
            )
            .await
            .expect("load compiler data");

            assert_eq!(compiled.blocks.len(), 1);
            assert_eq!(
                compiled.blocks[0].content,
                "Use model preview-model for Preview Character."
            );
            assert_eq!(
                compiled
                    .prefill_seed
                    .as_ref()
                    .map(|block| block.content.as_str()),
                Some("Assistant seed")
            );
            assert_eq!(compiled.output_validators.len(), 1);
            assert!(compiled.output_validators[0].regex.is_match("forbidden"));
            assert!(!compiled.output_validators[0].regex.is_match("allowed"));
        });
    }

    #[test]
    fn character_base_message_prefers_structured_sections_over_legacy_description() {
        let message = build_character_system_message(&CharacterCompileData {
            character_id: 1,
            name: "Iris".to_string(),
            description: "Legacy description".to_string(),
            tags: vec!["guardian".to_string(), "stoic".to_string()],
            base_sections: vec![
                CharacterBaseSectionCompileData {
                    section_key: "identity".to_string(),
                    title: None,
                    content: "Last sentinel of the north gate.".to_string(),
                },
                CharacterBaseSectionCompileData {
                    section_key: "rules".to_string(),
                    title: Some("Oaths".to_string()),
                    content: "Never abandon the watch.".to_string(),
                },
            ],
        })
        .expect("character base message should exist");

        assert!(message.contains("Character Name: Iris"));
        assert!(message.contains("Character Tags: guardian, stoic"));
        assert!(message.contains("[Identity]\nLast sentinel of the north gate."));
        assert!(message.contains("[Oaths]\nNever abandon the watch."));
        assert!(!message.contains("Legacy description"));
    }

    #[test]
    fn character_base_message_falls_back_to_legacy_description_when_sections_absent() {
        let message = build_character_system_message(&CharacterCompileData {
            character_id: 2,
            name: "Mina".to_string(),
            description: "An observant archivist.".to_string(),
            tags: vec!["scholar".to_string()],
            base_sections: vec![],
        })
        .expect("character base fallback message should exist");

        assert!(message.contains("Character Name: Mina"));
        assert!(message.contains("Character Tags: scholar"));
        assert!(message.contains("Character Description: An observant archivist."));
    }

    #[test]
    fn preview_filters_template_blocks_by_normalized_disabled_type() {
        run_async_test(async {
            let pool = create_test_pool().await;

            sqlx::query(
                "INSERT INTO presets (
                    id, temperature, max_output_tokens, top_p, presence_penalty, frequency_penalty,
                    response_mode
                 ) VALUES (?, NULL, NULL, NULL, NULL, NULL, NULL)",
            )
            .bind(3_i64)
            .execute(&pool)
            .await
            .expect("insert preset");

            sqlx::query(
                "INSERT INTO preset_prompt_blocks (
                    id, preset_id, block_type, title, content, sort_order, priority, is_enabled
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(61_i64)
            .bind(3_i64)
            .bind("template:style")
            .bind("Style")
            .bind("Template content for {{ current_user.content }}")
            .bind(0_i64)
            .bind(100_i64)
            .bind(1_i64)
            .execute(&pool)
            .await
            .expect("insert template block");

            sqlx::query(
                "INSERT INTO preset_provider_overrides (
                    id, preset_id, provider_kind, disabled_block_types
                 ) VALUES (?, ?, ?, ?)",
            )
            .bind(62_i64)
            .bind(3_i64)
            .bind("openai_compatible")
            .bind(json!(["style"]).to_string())
            .execute(&pool)
            .await
            .expect("insert provider override");

            let preview = compile_preset_preview_data(&pool, 3, Some("openai_compatible"))
                .await
                .expect("compile preview");

            assert!(preview.system_blocks.is_empty());
        });
    }
}

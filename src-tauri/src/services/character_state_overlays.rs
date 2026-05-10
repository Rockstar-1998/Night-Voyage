use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter};

use crate::{
    models::{ApiProvider, CharacterStateOverlayErrorEvent, CharacterStateOverlayUpdatedEvent},
    services::prompt_compiler::{
        load_character_system_message, PromptBlock, PromptBlockKind, PromptBlockSource,
        PromptCompileDebugReport, PromptRole,
    },
    utils::now_ts,
};

const CHARACTER_STATE_OVERLAY_SOURCE_KIND_AI: &str = "ai";
const CHARACTER_STATE_OVERLAY_STATUS_QUEUED: &str = "queued";
const CHARACTER_STATE_OVERLAY_STATUS_COMPLETED: &str = "completed";
const CHARACTER_STATE_OVERLAY_STATUS_FAILED: &str = "failed";
const DEFAULT_NO_SIGNIFICANT_CHANGES_TEXT: &str = "当前暂无显著软设定变化。";

#[derive(Debug, Clone)]
struct CharacterOverlayTargetContext {
    character_id: i64,
    character_name: String,
}

#[derive(Debug, Clone)]
struct CharacterStateOverlayGenerationContext {
    character_id: i64,
    character_name: String,
    base_message: String,
    previous_overlay: Option<String>,
    user_content: String,
    assistant_content: String,
}

pub async fn load_latest_character_state_overlay_block(
    db: &SqlitePool,
    conversation_id: i64,
    character_id: i64,
    target_round_id: Option<i64>,
    debug: &mut PromptCompileDebugReport,
) -> Result<Option<PromptBlock>, String> {
    let row = sqlx::query(
        "SELECT id, round_id, summary_text \
         FROM character_state_overlays \
         WHERE conversation_id = ? \
           AND character_id = ? \
           AND status = 'completed' \
           AND summary_text IS NOT NULL \
           AND TRIM(summary_text) <> '' \
           AND (? IS NULL OR round_id < ?) \
         ORDER BY round_id DESC, id DESC \
         LIMIT 1",
    )
    .bind(conversation_id)
    .bind(character_id)
    .bind(target_round_id)
    .bind(target_round_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    let Some(row) = row else {
        return Ok(None);
    };

    let overlay_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
    let round_id: i64 = row.try_get("round_id").unwrap_or_default();
    let summary_text = row
        .try_get::<String, _>("summary_text")
        .unwrap_or_default()
        .trim()
        .to_string();
    if summary_text.is_empty() {
        return Ok(None);
    }

    debug.input_sources.push(format!(
        "character_state_overlay:{conversation_id}:{character_id}:{round_id}:{overlay_id}"
    ));

    Ok(Some(build_character_state_overlay_block(
        overlay_id,
        summary_text,
    )))
}

pub fn spawn_character_state_overlay_generation_task(
    app: AppHandle,
    db: SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_character_state_overlay_generation_task(
            &app,
            &db,
            conversation_id,
            round_id,
            provider_id,
        )
        .await
        {
            let _ = app.emit(
                "character-state-overlay-error",
                CharacterStateOverlayErrorEvent {
                    conversation_id,
                    character_id: 0,
                    round_id,
                    overlay_id: 0,
                    source_kind: CHARACTER_STATE_OVERLAY_SOURCE_KIND_AI.to_string(),
                    status: CHARACTER_STATE_OVERLAY_STATUS_FAILED.to_string(),
                    error,
                },
            );
        }
    });
}

async fn run_character_state_overlay_generation_task(
    app: &AppHandle,
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    provider_id: i64,
) -> Result<(), String> {
    let Some(target) = load_overlay_target_context(db, conversation_id).await? else {
        return Ok(());
    };
    let provider = load_overlay_provider(db, provider_id).await?;
    let overlay_id = upsert_overlay_job(
        db,
        conversation_id,
        target.character_id,
        round_id,
        &provider.provider_kind,
        &provider.model_name,
    )
    .await?;

    let generation_context =
        match load_overlay_generation_context(db, conversation_id, round_id, &target).await {
            Ok(generation_context) => generation_context,
            Err(error) => {
                finalize_failed_overlay(db, overlay_id, &error).await?;
                emit_overlay_error(
                    app,
                    conversation_id,
                    target.character_id,
                    round_id,
                    overlay_id,
                    &error,
                )?;
                return Ok(());
            }
        };

    update_overlay_inputs(
        db,
        overlay_id,
        &generation_context.user_content,
        &generation_context.assistant_content,
    )
    .await?;

    let summary_text =
        match request_character_state_overlay_summary(&provider, &generation_context).await {
            Ok(summary_text) => summary_text,
            Err(error) => {
                finalize_failed_overlay(db, overlay_id, &error).await?;
                emit_overlay_error(
                    app,
                    conversation_id,
                    target.character_id,
                    round_id,
                    overlay_id,
                    &error,
                )?;
                return Ok(());
            }
        };

    finalize_completed_overlay(db, overlay_id, &summary_text).await?;
    emit_overlay_updated(
        app,
        conversation_id,
        target.character_id,
        round_id,
        overlay_id,
        &summary_text,
    )?;

    Ok(())
}

async fn load_overlay_target_context(
    db: &SqlitePool,
    conversation_id: i64,
) -> Result<Option<CharacterOverlayTargetContext>, String> {
    let character_id: Option<i64> = sqlx::query_scalar(
        "SELECT COALESCE(host_character_id, character_id) \
         FROM conversations WHERE id = ? LIMIT 1",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?
    .flatten();

    let Some(character_id) = character_id else {
        return Ok(None);
    };

    let character_name: Option<String> =
        sqlx::query_scalar("SELECT name FROM character_cards WHERE id = ? LIMIT 1")
            .bind(character_id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?;

    Ok(Some(CharacterOverlayTargetContext {
        character_id,
        character_name: character_name.unwrap_or_else(|| "Unnamed Character".to_string()),
    }))
}

async fn load_overlay_provider(db: &SqlitePool, provider_id: i64) -> Result<ApiProvider, String> {
    let row = sqlx::query(
        "SELECT id, name, provider_kind, base_url, api_key, model_name, max_tokens, max_context_tokens, temperature \
         FROM api_providers WHERE id = ? LIMIT 1",
    )
    .bind(provider_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(ApiProvider {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        provider_kind: row
            .try_get("provider_kind")
            .unwrap_or_else(|_| "openai_compatible".to_string()),
        base_url: row.try_get("base_url").unwrap_or_default(),
        api_key: row.try_get("api_key").unwrap_or_default(),
        model_name: row.try_get("model_name").unwrap_or_default(),
        max_tokens: row.try_get("max_tokens").ok(),
        max_context_tokens: row.try_get("max_context_tokens").ok(),
        temperature: row.try_get("temperature").ok(),
    })
}

async fn upsert_overlay_job(
    db: &SqlitePool,
    conversation_id: i64,
    character_id: i64,
    round_id: i64,
    provider_kind: &str,
    model_name: &str,
) -> Result<i64, String> {
    let now = now_ts();
    let existing_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM character_state_overlays \
         WHERE conversation_id = ? AND character_id = ? AND round_id = ? AND source_kind = ? \
         LIMIT 1",
    )
    .bind(conversation_id)
    .bind(character_id)
    .bind(round_id)
    .bind(CHARACTER_STATE_OVERLAY_SOURCE_KIND_AI)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    if let Some(existing_id) = existing_id {
        sqlx::query(
            "UPDATE character_state_overlays SET
                status = ?,
                summary_text = NULL,
                input_user_content = NULL,
                input_assistant_content = NULL,
                provider_kind = ?,
                model_name = ?,
                error_message = NULL,
                updated_at = ?,
                completed_at = NULL
             WHERE id = ?",
        )
        .bind(CHARACTER_STATE_OVERLAY_STATUS_QUEUED)
        .bind(provider_kind)
        .bind(model_name)
        .bind(now)
        .bind(existing_id)
        .execute(db)
        .await
        .map_err(|err| err.to_string())?;
        return Ok(existing_id);
    }

    let result = sqlx::query(
        "INSERT INTO character_state_overlays (
            conversation_id, character_id, round_id, source_kind, status,
            summary_text, input_user_content, input_assistant_content,
            provider_kind, model_name, error_message,
            created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?, NULL)",
    )
    .bind(conversation_id)
    .bind(character_id)
    .bind(round_id)
    .bind(CHARACTER_STATE_OVERLAY_SOURCE_KIND_AI)
    .bind(CHARACTER_STATE_OVERLAY_STATUS_QUEUED)
    .bind(provider_kind)
    .bind(model_name)
    .bind(now)
    .bind(now)
    .execute(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(result.last_insert_rowid())
}

async fn load_overlay_generation_context(
    db: &SqlitePool,
    conversation_id: i64,
    round_id: i64,
    target: &CharacterOverlayTargetContext,
) -> Result<CharacterStateOverlayGenerationContext, String> {
    let round_row = sqlx::query(
        "SELECT aggregated_user_content, active_assistant_message_id \
         FROM message_rounds WHERE id = ? AND conversation_id = ? LIMIT 1",
    )
    .bind(round_id)
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    let user_content = round_row
        .try_get::<String, _>("aggregated_user_content")
        .unwrap_or_default()
        .trim()
        .to_string();
    if user_content.is_empty() {
        return Err("角色状态总结缺少当前轮聚合用户输入".to_string());
    }

    let assistant_message_id: Option<i64> = round_row.try_get("active_assistant_message_id").ok();
    let assistant_message_id = assistant_message_id
        .ok_or_else(|| "角色状态总结缺少当前轮 assistant 输出引用".to_string())?;

    let assistant_content: String =
        sqlx::query_scalar::<_, String>("SELECT content FROM messages WHERE id = ? LIMIT 1")
            .bind(assistant_message_id)
            .fetch_optional(db)
            .await
            .map_err(|err| err.to_string())?
            .unwrap_or_default()
            .trim()
            .to_string();
    if assistant_content.is_empty() {
        return Err("角色状态总结缺少当前轮 assistant 输出正文".to_string());
    }

    let base_message = load_character_system_message(db, target.character_id)
        .await?
        .unwrap_or_else(|| format!("Character Name: {}", target.character_name));
    let previous_overlay = load_latest_completed_overlay_summary_before_round(
        db,
        conversation_id,
        target.character_id,
        round_id,
    )
    .await?;

    Ok(CharacterStateOverlayGenerationContext {
        character_id: target.character_id,
        character_name: target.character_name.clone(),
        base_message,
        previous_overlay,
        user_content,
        assistant_content,
    })
}

async fn load_latest_completed_overlay_summary_before_round(
    db: &SqlitePool,
    conversation_id: i64,
    character_id: i64,
    round_id: i64,
) -> Result<Option<String>, String> {
    let summary_text: Option<String> = sqlx::query_scalar(
        "SELECT summary_text FROM character_state_overlays \
         WHERE conversation_id = ? \
           AND character_id = ? \
           AND source_kind = ? \
           AND status = 'completed' \
           AND summary_text IS NOT NULL \
           AND TRIM(summary_text) <> '' \
           AND round_id < ? \
         ORDER BY round_id DESC, id DESC \
         LIMIT 1",
    )
    .bind(conversation_id)
    .bind(character_id)
    .bind(CHARACTER_STATE_OVERLAY_SOURCE_KIND_AI)
    .bind(round_id)
    .fetch_optional(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(summary_text.map(|summary_text| summary_text.trim().to_string()))
}

async fn update_overlay_inputs(
    db: &SqlitePool,
    overlay_id: i64,
    user_content: &str,
    assistant_content: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE character_state_overlays SET
            input_user_content = ?,
            input_assistant_content = ?,
            updated_at = ?
         WHERE id = ?",
    )
    .bind(user_content)
    .bind(assistant_content)
    .bind(now_ts())
    .bind(overlay_id)
    .execute(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(())
}

async fn request_character_state_overlay_summary(
    provider: &ApiProvider,
    context: &CharacterStateOverlayGenerationContext,
) -> Result<String, String> {
    if provider.provider_kind != "openai_compatible" {
        return Err(format!(
            "角色状态总结暂不支持 provider_kind='{}'",
            provider.provider_kind
        ));
    }

    let messages = build_character_state_overlay_messages(context);
    let request_messages = messages
        .into_iter()
        .map(|message| {
            json!({
                "role": message.0,
                "content": message.1,
            })
        })
        .collect::<Vec<_>>();

    let body = json!({
        "model": provider.model_name,
        "messages": request_messages,
        "stream": false,
        "temperature": 0.2,
        "max_tokens": 300,
    });

    let client = crate::services::http_client::shared_http_client();
    let response = client
        .post(build_openai_url(&provider.base_url))
        .bearer_auth(&provider.api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("角色状态总结请求失败: {} {}", status, text));
    }

    let value: Value = response.json().await.map_err(|err| err.to_string())?;
    let summary_text = value
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();

    if summary_text.is_empty() {
        return Err("角色状态总结响应为空".to_string());
    }

    Ok(summary_text)
}

fn build_character_state_overlay_messages(
    context: &CharacterStateOverlayGenerationContext,
) -> Vec<(String, String)> {
    let mut user_sections = vec![
        format!("角色名:\n{}", context.character_name),
        format!("角色基础层:\n{}", context.base_message),
        format!("当前轮聚合用户输入:\n{}", context.user_content),
        format!("当前轮 assistant 输出:\n{}", context.assistant_content),
    ];

    if let Some(previous_overlay) = context.previous_overlay.as_deref() {
        user_sections.insert(2, format!("上一版角色状态覆盖层:\n{}", previous_overlay));
    } else {
        user_sections.insert(
            2,
            format!(
                "上一版角色状态覆盖层:\n{}",
                DEFAULT_NO_SIGNIFICANT_CHANGES_TEXT
            ),
        );
    }

    vec![
        (
            "system".to_string(),
            "你是 Night Voyage 的角色状态覆盖层编译器。你的职责是生成可直接注入 Prompt Compiler 第 3 层的“角色状态覆盖层”。\n\
             输出必须是“当前可变软设定的完整现状快照”，而不是只描述增量变化。\n\
             只允许总结软设定：关系变化、信任/防备、阶段目标、情绪与创伤反应、口吻偏移、阶段性人格变化。\n\
             禁止改写硬设定：名字、身份、出身、物种、职业基础、世界定位、稳定硬规则。\n\
             若本轮没有带来显著新的软设定变化，但上一版状态覆盖层已有内容，则保留并整理成新的完整现状快照。\n\
             若既无上一版覆盖层，也无显著新的软设定变化，则输出“当前暂无显著软设定变化。”\n\
             输出纯文本，不要代码块，不要 JSON，不要解释过程。"
                .to_string(),
        ),
        (
            "user".to_string(),
            format!(
                "请基于以下输入，为角色生成最新一版完整的角色状态覆盖层：\n\n{}",
                user_sections.join("\n\n")
            ),
        ),
    ]
}

async fn finalize_completed_overlay(
    db: &SqlitePool,
    overlay_id: i64,
    summary_text: &str,
) -> Result<(), String> {
    let now = now_ts();
    sqlx::query(
        "UPDATE character_state_overlays SET
            status = ?,
            summary_text = ?,
            error_message = NULL,
            updated_at = ?,
            completed_at = ?
         WHERE id = ?",
    )
    .bind(CHARACTER_STATE_OVERLAY_STATUS_COMPLETED)
    .bind(summary_text)
    .bind(now)
    .bind(now)
    .bind(overlay_id)
    .execute(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(())
}

async fn finalize_failed_overlay(
    db: &SqlitePool,
    overlay_id: i64,
    error_message: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE character_state_overlays SET
            status = ?,
            error_message = ?,
            updated_at = ?,
            completed_at = NULL
         WHERE id = ?",
    )
    .bind(CHARACTER_STATE_OVERLAY_STATUS_FAILED)
    .bind(error_message)
    .bind(now_ts())
    .bind(overlay_id)
    .execute(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(())
}

fn emit_overlay_updated(
    app: &AppHandle,
    conversation_id: i64,
    character_id: i64,
    round_id: i64,
    overlay_id: i64,
    summary_text: &str,
) -> Result<(), String> {
    app.emit(
        "character-state-overlay-updated",
        CharacterStateOverlayUpdatedEvent {
            conversation_id,
            character_id,
            round_id,
            overlay_id,
            source_kind: CHARACTER_STATE_OVERLAY_SOURCE_KIND_AI.to_string(),
            status: CHARACTER_STATE_OVERLAY_STATUS_COMPLETED.to_string(),
            summary_text: summary_text.to_string(),
        },
    )
    .map_err(|err| err.to_string())
}

fn emit_overlay_error(
    app: &AppHandle,
    conversation_id: i64,
    character_id: i64,
    round_id: i64,
    overlay_id: i64,
    error: &str,
) -> Result<(), String> {
    app.emit(
        "character-state-overlay-error",
        CharacterStateOverlayErrorEvent {
            conversation_id,
            character_id,
            round_id,
            overlay_id,
            source_kind: CHARACTER_STATE_OVERLAY_SOURCE_KIND_AI.to_string(),
            status: CHARACTER_STATE_OVERLAY_STATUS_FAILED.to_string(),
            error: error.to_string(),
        },
    )
    .map_err(|err| err.to_string())
}

fn build_character_state_overlay_block(overlay_id: i64, summary_text: String) -> PromptBlock {
    let content = format!("Character State Overlay:\n{}", summary_text.trim());
    PromptBlock {
        kind: PromptBlockKind::WorldVariable,
        priority: PromptBlockKind::WorldVariable.priority(),
        role: PromptRole::System,
        title: Some("Character State Overlay".to_string()),
        content: content.clone(),
        source: PromptBlockSource::Summary {
            summary_id: overlay_id,
        },
        token_cost_estimate: Some(estimate_token_cost(&content)),
        required: true,
    }
}

fn estimate_token_cost(content: &str) -> usize {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        0
    } else {
        (trimmed.chars().count() / 4).max(1)
    }
}

fn build_openai_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{}/chat/completions", trimmed)
    } else {
        format!("{}/v1/chat/completions", trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_character_state_overlay_block, build_character_state_overlay_messages,
        CharacterStateOverlayGenerationContext,
    };
    use crate::services::prompt_compiler::{PromptBlockKind, PromptBlockSource};

    #[test]
    fn overlay_messages_include_previous_overlay_and_round_inputs() {
        let messages =
            build_character_state_overlay_messages(&CharacterStateOverlayGenerationContext {
                character_id: 1,
                character_name: "Iris".to_string(),
                base_message: "Character Name: Iris".to_string(),
                previous_overlay: Some("当前更信任队友，但仍保持戒备。".to_string()),
                user_content: "玩家请求她放下戒备。".to_string(),
                assistant_content: "她略微放松，但仍要求确认身份。".to_string(),
            });

        assert_eq!(messages.len(), 2);
        assert!(messages[1].1.contains("上一版角色状态覆盖层"));
        assert!(messages[1].1.contains("当前轮聚合用户输入"));
        assert!(messages[1].1.contains("当前轮 assistant 输出"));
    }

    #[test]
    fn overlay_block_uses_character_state_overlay_kind() {
        let block = build_character_state_overlay_block(9, "当前对同伴更信任。".to_string());

        assert_eq!(block.kind, PromptBlockKind::WorldVariable);
        assert!(block.content.contains("Character State Overlay"));
        match block.source {
            PromptBlockSource::Summary { summary_id } => assert_eq!(summary_id, 9),
            other => panic!("unexpected source: {:?}", other),
        }
    }
}

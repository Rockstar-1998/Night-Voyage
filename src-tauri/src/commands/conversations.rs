use std::collections::HashMap;

use sqlx::Row;

use crate::{
    models::{ConversationCreateResult, ConversationListItem, ConversationMember, RoundState},
    utils::now_ts,
    AppState,
};

#[tauri::command]
pub async fn conversations_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ConversationListItem>, String> {
    let rows = sqlx::query(
        "SELECT id, conversation_type, title, host_character_id, world_book_id, preset_id, \
         provider_id, chat_mode, agent_provider_policy, plot_summary_mode, created_at, updated_at \
         FROM conversations ORDER BY updated_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let conversation_id: i64 = row.try_get("id").unwrap_or_default();
        let member_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ? AND is_active = 1",
        )
        .bind(conversation_id)
        .fetch_one(&state.db)
        .await
        .map_err(|err| err.to_string())?;

        let pending_member_count = load_pending_member_count(&state.db, conversation_id).await?;

        items.push(ConversationListItem {
            id: conversation_id,
            conversation_type: row
                .try_get("conversation_type")
                .unwrap_or_else(|_| "single".to_string()),
            title: row.try_get("title").ok(),
            host_character_id: row.try_get("host_character_id").ok(),
            world_book_id: row.try_get("world_book_id").ok(),
            preset_id: normalize_optional_positive_id(row.try_get("preset_id").ok()),
            provider_id: row.try_get("provider_id").ok(),
            chat_mode: row
                .try_get("chat_mode")
                .unwrap_or_else(|_| "classic".to_string()),
            agent_provider_policy: row
                .try_get("agent_provider_policy")
                .unwrap_or_else(|_| "shared_host_provider".to_string()),
            plot_summary_mode: row
                .try_get("plot_summary_mode")
                .unwrap_or_else(|_| "ai".to_string()),
            member_count,
            pending_member_count,
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        });
    }

    Ok(items)
}

#[tauri::command]
pub async fn conversations_create(
    state: tauri::State<'_, AppState>,
    conversation_type: String,
    title: Option<String>,
    host_character_id: Option<i64>,
    world_book_id: Option<i64>,
    preset_id: Option<i64>,
    provider_id: Option<i64>,
    host_display_name: String,
    host_player_character_id: Option<i64>,
    chat_mode: Option<String>,
    agent_provider_policy: Option<String>,
) -> Result<ConversationCreateResult, String> {
    validate_conversation_type(&conversation_type)?;
    let host_character_id =
        host_character_id.ok_or_else(|| "创建会话必须绑定角色卡".to_string())?;
    let chat_mode = normalize_chat_mode(chat_mode.as_deref())?;
    let agent_provider_policy = normalize_agent_provider_policy(agent_provider_policy.as_deref())?;
    let now = now_ts();
    let title = normalize_title(title);
    let host_display_name = normalize_display_name(&host_display_name)?;

    let mut tx = state.db.begin().await.map_err(|err| err.to_string())?;
    let preset_id = resolve_conversation_preset_id(
        &mut tx,
        host_character_id,
        normalize_optional_positive_id(preset_id),
    )
    .await?;

    let result = sqlx::query(
        "INSERT INTO conversations (
            conversation_type, title, host_character_id, world_book_id, preset_id,
            provider_id, chat_mode, agent_provider_policy, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&conversation_type)
    .bind(&title)
    .bind(host_character_id)
    .bind(world_book_id)
    .bind(preset_id)
    .bind(provider_id)
    .bind(&chat_mode)
    .bind(&agent_provider_policy)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    let conversation_id = result.last_insert_rowid();

    let host_member_result = sqlx::query(
        "INSERT INTO conversation_members (
            conversation_id, member_role, display_name, player_character_id,
            join_order, is_active, created_at, updated_at
         ) VALUES (?, 'host', ?, ?, 0, 1, ?, ?)",
    )
    .bind(conversation_id)
    .bind(&host_display_name)
    .bind(host_player_character_id)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;
    let host_member_id = host_member_result.last_insert_rowid();

    let round_result = sqlx::query(
        "INSERT INTO message_rounds (conversation_id, round_index, status, created_at, updated_at) \
         VALUES (?, 1, 'collecting', ?, ?)",
    )
    .bind(conversation_id)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;
    let round_id = round_result.last_insert_rowid();

    tx.commit().await.map_err(|err| err.to_string())?;

    Ok(ConversationCreateResult {
        conversation: conversations_get_by_id(&state.db, conversation_id).await?,
        host_member: conversation_member_get(&state.db, host_member_id).await?,
        round: load_round_state(&state.db, conversation_id, round_id).await?,
    })
}

#[tauri::command]
pub async fn conversations_update_bindings(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    title: Option<String>,
    host_character_id: Option<i64>,
    world_book_id: Option<i64>,
    preset_id: Option<i64>,
    provider_id: Option<i64>,
    chat_mode: Option<String>,
    agent_provider_policy: Option<String>,
) -> Result<ConversationListItem, String> {
    let now = now_ts();
    eprintln!(
        "[conversation-debug] update_bindings:start conversation_id={} title_present={} host_character_id={:?} world_book_id={:?} preset_id={:?} provider_id={:?} chat_mode={:?} agent_provider_policy={:?}",
        conversation_id,
        title.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false),
        host_character_id,
        world_book_id,
        preset_id,
        provider_id,
        chat_mode,
        agent_provider_policy
    );
    let next_title = title.map(|value| {
        if value.trim().is_empty() {
            "新会话".to_string()
        } else {
            value
        }
    });
    let next_chat_mode = match chat_mode.as_deref() {
        Some(value) => Some(normalize_chat_mode(Some(value))?),
        None => None,
    };
    let next_policy = match agent_provider_policy.as_deref() {
        Some(value) => Some(normalize_agent_provider_policy(Some(value))?),
        None => None,
    };

    let update_sql = "UPDATE conversations SET
            title = COALESCE(?, title),
            host_character_id = COALESCE(?, host_character_id),
            world_book_id = COALESCE(?, world_book_id),
            preset_id = COALESCE(?, preset_id),
            provider_id = COALESCE(?, provider_id),
            chat_mode = COALESCE(?, chat_mode),
            agent_provider_policy = COALESCE(?, agent_provider_policy),
            updated_at = ?
         WHERE id = ?";
    eprintln!(
        "[conversation-debug] update_bindings:sql={}",
        update_sql.replace('\n', " ")
    );

    sqlx::query(update_sql)
        .bind(next_title)
        .bind(host_character_id)
        .bind(world_book_id)
        .bind(normalize_optional_positive_id(preset_id))
        .bind(provider_id)
        .bind(next_chat_mode)
        .bind(next_policy)
        .bind(now)
        .bind(conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| {
            eprintln!(
                "[conversation-debug] update_bindings:error conversation_id={} error={}",
                conversation_id, err
            );
            err.to_string()
        })?;

    eprintln!(
        "[conversation-debug] update_bindings:success conversation_id={} normalized_preset_id={:?} normalized_world_book_id={:?}",
        conversation_id,
        normalize_optional_positive_id(preset_id),
        world_book_id
    );

    conversations_get_by_id(&state.db, conversation_id).await
}

#[tauri::command]
pub async fn conversations_rename(
    state: tauri::State<'_, AppState>,
    id: i64,
    title: String,
) -> Result<ConversationListItem, String> {
    conversations_update_bindings(state, id, Some(title), None, None, None, None, None, None).await
}

#[tauri::command]
pub async fn conversation_members_list(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
) -> Result<Vec<ConversationMember>, String> {
    let rows = sqlx::query(
        "SELECT id, conversation_id, member_role, display_name, player_character_id, join_order, is_active, created_at, updated_at \
         FROM conversation_members WHERE conversation_id = ? ORDER BY join_order ASC, id ASC",
    )
    .bind(conversation_id)
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(rows.into_iter().map(row_to_conversation_member).collect())
}

#[tauri::command]
pub async fn conversation_members_create(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    display_name: String,
    player_character_id: Option<i64>,
) -> Result<ConversationMember, String> {
    let display_name = normalize_display_name(&display_name)?;
    let now = now_ts();

    let join_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(join_order), -1) + 1 FROM conversation_members WHERE conversation_id = ?",
    )
    .bind(conversation_id)
    .fetch_one(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let result = sqlx::query(
        "INSERT INTO conversation_members (
            conversation_id, member_role, display_name, player_character_id,
            join_order, is_active, created_at, updated_at
         ) VALUES (?, 'member', ?, ?, ?, 1, ?, ?)",
    )
    .bind(conversation_id)
    .bind(&display_name)
    .bind(player_character_id)
    .bind(join_order)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    conversation_member_get(&state.db, result.last_insert_rowid()).await
}

#[tauri::command]
pub async fn conversation_members_update(
    state: tauri::State<'_, AppState>,
    member_id: i64,
    display_name: Option<String>,
    player_character_id: Option<i64>,
    is_active: Option<bool>,
) -> Result<ConversationMember, String> {
    let now = now_ts();
    let next_display_name = match display_name.as_deref() {
        Some(value) => Some(normalize_display_name(value)?),
        None => None,
    };

    sqlx::query(
        "UPDATE conversation_members SET
            display_name = COALESCE(?, display_name),
            player_character_id = COALESCE(?, player_character_id),
            is_active = COALESCE(?, is_active),
            updated_at = ?
         WHERE id = ?",
    )
    .bind(next_display_name)
    .bind(player_character_id)
    .bind(is_active.map(|value| if value { 1 } else { 0 }))
    .bind(now)
    .bind(member_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let member = conversation_member_get(&state.db, member_id).await?;
    sqlx::query("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(member.conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    Ok(member)
}

#[tauri::command]
pub async fn conversation_members_delete(
    state: tauri::State<'_, AppState>,
    member_id: i64,
) -> Result<(), String> {
    let conversation_id: i64 =
        sqlx::query_scalar("SELECT conversation_id FROM conversation_members WHERE id = ? LIMIT 1")
            .bind(member_id)
            .fetch_one(&state.db)
            .await
            .map_err(|err| err.to_string())?;

    sqlx::query("DELETE FROM conversation_members WHERE id = ?")
        .bind(member_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    sqlx::query("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .bind(now_ts())
        .bind(conversation_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn conversations_delete(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    eprintln!("[conversation-debug] delete:start conversation_id={}", id);
    let room_ref_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM rooms WHERE conversation_id = ?")
            .bind(id)
            .fetch_one(&state.db)
            .await
            .map_err(|err| {
                eprintln!(
                    "[conversation-debug] delete:room_ref_count_error conversation_id={} error={}",
                    id, err
                );
                err.to_string()
            })?;
    eprintln!(
        "[conversation-debug] delete:room_ref_count conversation_id={} room_ref_count={}",
        id, room_ref_count
    );

    let round_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM message_rounds WHERE conversation_id = ?")
            .bind(id)
            .fetch_all(&state.db)
            .await
            .map_err(|err| {
                eprintln!(
                    "[conversation-debug] delete:load_round_ids_error conversation_id={} error={}",
                    id, err
                );
                err.to_string()
            })?;
    eprintln!(
        "[conversation-debug] delete:loaded_round_ids conversation_id={} round_count={}",
        id,
        round_ids.len()
    );

    for round_id in &round_ids {
        let message_ids: Vec<i64> =
            sqlx::query_scalar("SELECT id FROM messages WHERE round_id = ?")
                .bind(round_id)
                .fetch_all(&state.db)
                .await
                .map_err(|err| err.to_string())?;

        for message_id in &message_ids {
            sqlx::query("DELETE FROM message_content_parts WHERE message_id = ?")
                .bind(message_id)
                .execute(&state.db)
                .await
                .map_err(|err| err.to_string())?;
            sqlx::query("DELETE FROM message_tool_calls WHERE message_id = ?")
                .bind(message_id)
                .execute(&state.db)
                .await
                .map_err(|err| err.to_string())?;
        }

        sqlx::query("DELETE FROM messages WHERE round_id = ?")
            .bind(round_id)
            .execute(&state.db)
            .await
            .map_err(|err| err.to_string())?;

        sqlx::query("DELETE FROM round_member_actions WHERE round_id = ?")
            .bind(round_id)
            .execute(&state.db)
            .await
            .map_err(|err| err.to_string())?;
    }

    let agent_run_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM agent_runs WHERE conversation_id = ?")
            .bind(id)
            .fetch_all(&state.db)
            .await
            .map_err(|err| {
                eprintln!(
                    "[conversation-debug] delete:load_agent_runs_error conversation_id={} error={}",
                    id, err
                );
                err.to_string()
            })?;
    eprintln!(
        "[conversation-debug] delete:loaded_agent_runs conversation_id={} agent_run_count={}",
        id,
        agent_run_ids.len()
    );

    for agent_run_id in &agent_run_ids {
        eprintln!(
            "[conversation-debug] delete:delete_agent_drafts conversation_id={} agent_run_id={}",
            id, agent_run_id
        );
        sqlx::query("DELETE FROM agent_drafts WHERE agent_run_id = ?")
            .bind(agent_run_id)
            .execute(&state.db)
            .await
            .map_err(|err| {
                eprintln!(
                    "[conversation-debug] delete:delete_agent_drafts_error conversation_id={} agent_run_id={} error={}",
                    id,
                    agent_run_id,
                    err
                );
                err.to_string()
            })?;
    }

    sqlx::query("DELETE FROM agent_runs WHERE conversation_id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    sqlx::query("DELETE FROM character_state_overlays WHERE conversation_id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    sqlx::query("DELETE FROM plot_summaries WHERE conversation_id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    sqlx::query("DELETE FROM message_rounds WHERE conversation_id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    sqlx::query("DELETE FROM conversation_members WHERE conversation_id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    sqlx::query("DELETE FROM conversations WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|err| {
            eprintln!(
                "[conversation-debug] delete:delete_conversation_row_error conversation_id={} error={}",
                id,
                err
            );
            err.to_string()
        })?;

    eprintln!("[conversation-debug] delete:success conversation_id={}", id);
    Ok(())
}

fn row_to_conversation_list_item(row: sqlx::sqlite::SqliteRow) -> ConversationListItem {
    ConversationListItem {
        id: row.try_get("id").unwrap_or_default(),
        conversation_type: row
            .try_get("conversation_type")
            .unwrap_or_else(|_| "single".to_string()),
        title: row.try_get("title").ok(),
        host_character_id: row.try_get("host_character_id").ok(),
        world_book_id: row.try_get("world_book_id").ok(),
        preset_id: normalize_optional_positive_id(row.try_get("preset_id").ok()),
        provider_id: row.try_get("provider_id").ok(),
        chat_mode: row
            .try_get("chat_mode")
            .unwrap_or_else(|_| "classic".to_string()),
        agent_provider_policy: row
            .try_get("agent_provider_policy")
            .unwrap_or_else(|_| "shared_host_provider".to_string()),
        plot_summary_mode: row
            .try_get("plot_summary_mode")
            .unwrap_or_else(|_| "ai".to_string()),
        member_count: row.try_get("member_count").unwrap_or_default(),
        pending_member_count: row.try_get("pending_member_count").unwrap_or_default(),
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    }
}

fn row_to_conversation_member(row: sqlx::sqlite::SqliteRow) -> ConversationMember {
    ConversationMember {
        id: row.try_get("id").unwrap_or_default(),
        conversation_id: row.try_get("conversation_id").unwrap_or_default(),
        member_role: row.try_get("member_role").unwrap_or_default(),
        display_name: row.try_get("display_name").unwrap_or_default(),
        player_character_id: row.try_get("player_character_id").ok(),
        join_order: row.try_get("join_order").unwrap_or_default(),
        is_active: row
            .try_get::<i64, _>("is_active")
            .map(|value| value != 0)
            .unwrap_or(false),
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    }
}

async fn conversations_get_by_id(
    db: &sqlx::SqlitePool,
    id: i64,
) -> Result<ConversationListItem, String> {
    let base_sql =
        "SELECT id, conversation_type, title, host_character_id, world_book_id, preset_id, \
         provider_id, chat_mode, agent_provider_policy, plot_summary_mode, created_at, updated_at \
         FROM conversations WHERE id = ? LIMIT 1";
    eprintln!("[conversation-debug] get_by_id:base_sql={}", base_sql);
    let row = sqlx::query(base_sql)
        .bind(id)
        .fetch_one(db)
        .await
        .map_err(|err| {
            eprintln!(
                "[conversation-debug] get_by_id:base_sql_error id={} error={}",
                id, err
            );
            err.to_string()
        })?;

    let member_count_sql =
        "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ? AND is_active = 1";
    eprintln!(
        "[conversation-debug] get_by_id:member_count_sql={}",
        member_count_sql
    );
    let member_count: i64 = sqlx::query_scalar(member_count_sql)
        .bind(id)
        .fetch_one(db)
        .await
        .map_err(|err| {
            eprintln!(
                "[conversation-debug] get_by_id:member_count_error id={} error={}",
                id, err
            );
            err.to_string()
        })?;

    let pending_member_count = load_pending_member_count(db, id).await.map_err(|err| {
        eprintln!(
            "[conversation-debug] get_by_id:pending_member_count_error id={} error={}",
            id, err
        );
        err
    })?;

    Ok(ConversationListItem {
        id: row.try_get("id").unwrap_or_default(),
        conversation_type: row
            .try_get("conversation_type")
            .unwrap_or_else(|_| "single".to_string()),
        title: row.try_get("title").ok(),
        host_character_id: row.try_get("host_character_id").ok(),
        world_book_id: row.try_get("world_book_id").ok(),
        preset_id: normalize_optional_positive_id(row.try_get("preset_id").ok()),
        provider_id: row.try_get("provider_id").ok(),
        chat_mode: row
            .try_get("chat_mode")
            .unwrap_or_else(|_| "classic".to_string()),
        agent_provider_policy: row
            .try_get("agent_provider_policy")
            .unwrap_or_else(|_| "shared_host_provider".to_string()),
        plot_summary_mode: row
            .try_get("plot_summary_mode")
            .unwrap_or_else(|_| "ai".to_string()),
        member_count,
        pending_member_count,
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    })
}

async fn conversation_member_get(
    db: &sqlx::SqlitePool,
    member_id: i64,
) -> Result<ConversationMember, String> {
    let row = sqlx::query(
        "SELECT id, conversation_id, member_role, display_name, player_character_id, join_order, is_active, created_at, updated_at \
         FROM conversation_members WHERE id = ?",
    )
    .bind(member_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(row_to_conversation_member(row))
}

async fn load_pending_member_count(
    db: &sqlx::SqlitePool,
    conversation_id: i64,
) -> Result<i64, String> {
    let round_sql = "SELECT id FROM message_rounds WHERE conversation_id = ? AND status = 'collecting' ORDER BY round_index DESC LIMIT 1";
    eprintln!(
        "[conversation-debug] load_pending_member_count:round_sql={}",
        round_sql
    );
    let collecting_round_id: Option<i64> = sqlx::query_scalar(round_sql)
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .map_err(|err| {
        eprintln!("[conversation-debug] load_pending_member_count:round_sql_error conversation_id={} error={}", conversation_id, err);
        err.to_string()
    })?
    .flatten();

    let Some(round_id) = collecting_round_id else {
        eprintln!(
            "[conversation-debug] load_pending_member_count:no_collecting_round conversation_id={}",
            conversation_id
        );
        return Ok(0);
    };

    let pending_sql = "SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = ? AND m.is_active = 1 AND NOT EXISTS (SELECT 1 FROM round_member_actions a WHERE a.round_id = ? AND a.member_id = m.id)";
    eprintln!("[conversation-debug] load_pending_member_count:pending_sql={} conversation_id={} round_id={}", pending_sql, conversation_id, round_id);
    sqlx::query_scalar(pending_sql)
    .bind(conversation_id)
    .bind(round_id)
    .fetch_one(db)
    .await
    .map_err(|err| {
        eprintln!("[conversation-debug] load_pending_member_count:pending_sql_error conversation_id={} round_id={} error={}", conversation_id, round_id, err);
        err.to_string()
    })
}

async fn load_round_state(
    db: &sqlx::SqlitePool,
    conversation_id: i64,
    round_id: i64,
) -> Result<RoundState, String> {
    let row = sqlx::query(
        "SELECT id, conversation_id, round_index, status, aggregated_user_content, active_assistant_message_id, updated_at \
         FROM message_rounds WHERE id = ? AND conversation_id = ? LIMIT 1",
    )
    .bind(round_id)
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    let required_member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ? AND is_active = 1",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    let decided_member_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM round_member_actions WHERE round_id = ?")
            .bind(round_id)
            .fetch_one(db)
            .await
            .map_err(|err| err.to_string())?;

    let waiting_rows = sqlx::query(
        "SELECT id FROM conversation_members WHERE conversation_id = ? AND is_active = 1 \
         AND NOT EXISTS (
             SELECT 1 FROM round_member_actions WHERE round_id = ? AND member_id = conversation_members.id
         ) \
         ORDER BY join_order ASC",
    )
    .bind(conversation_id)
    .bind(round_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(RoundState {
        round_id: row.try_get("id").unwrap_or_default(),
        conversation_id: row.try_get("conversation_id").unwrap_or_default(),
        round_index: row.try_get("round_index").unwrap_or_default(),
        status: row
            .try_get("status")
            .unwrap_or_else(|_| "collecting".to_string()),
        required_member_count,
        decided_member_count,
        waiting_member_ids: waiting_rows
            .into_iter()
            .map(|waiting_row| waiting_row.try_get("id").unwrap_or_default())
            .collect(),
        aggregated_user_content: row.try_get("aggregated_user_content").ok(),
        active_assistant_message_id: row.try_get("active_assistant_message_id").ok(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    })
}

fn normalize_title(title: Option<String>) -> Option<String> {
    title
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or(Some("新会话".to_string()))
}

fn normalize_display_name(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("显示名称不能为空".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_conversation_type(value: &str) -> Result<(), String> {
    match value {
        "single" | "online" => Ok(()),
        _ => Err("conversationType 只支持 single 或 online".to_string()),
    }
}

fn normalize_chat_mode(value: Option<&str>) -> Result<String, String> {
    match value.unwrap_or("classic") {
        "classic" => Ok("classic".to_string()),
        "director_agents" => Ok("director_agents".to_string()),
        _ => Err("chatMode 只支持 classic 或 director_agents".to_string()),
    }
}

fn normalize_agent_provider_policy(value: Option<&str>) -> Result<String, String> {
    match value.unwrap_or("shared_host_provider") {
        "shared_host_provider" => Ok("shared_host_provider".to_string()),
        "mixed_cost_optimized" => Ok("mixed_cost_optimized".to_string()),
        _ => Err(
            "agentProviderPolicy 只支持 shared_host_provider 或 mixed_cost_optimized".to_string(),
        ),
    }
}

async fn resolve_conversation_preset_id(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    host_character_id: i64,
    preset_id: Option<i64>,
) -> Result<Option<i64>, String> {
    if preset_id.is_some() {
        return Ok(preset_id);
    }

    let default_preset_id =
        sqlx::query_scalar("SELECT default_preset_id FROM character_cards WHERE id = ? LIMIT 1")
            .bind(host_character_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|err| err.to_string())?
            .flatten();

    Ok(normalize_optional_positive_id(default_preset_id))
}

fn normalize_optional_positive_id(value: Option<i64>) -> Option<i64> {
    value.filter(|id| *id > 0)
}

#[tauri::command]
pub async fn conversations_fork(
    state: tauri::State<'_, AppState>,
    conversation_id: i64,
    up_to_message_id: i64,
) -> Result<i64, String> {
    eprintln!(
        "[conversation-debug] fork:start conversation_id={} up_to_message_id={}",
        conversation_id, up_to_message_id
    );
    let original: (Option<String>, Option<i64>, Option<i64>, Option<i64>, Option<i64>, String, String, Option<String>) = sqlx::query_as(
        "SELECT title, host_character_id, world_book_id, preset_id, provider_id, conversation_type, chat_mode, agent_provider_policy FROM conversations WHERE id = ?"
    )
    .bind(conversation_id)
    .fetch_one(&state.db)
    .await
    .map_err(|err| {
        eprintln!(
            "[conversation-debug] fork:load_original_error conversation_id={} up_to_message_id={} error={}",
            conversation_id,
            up_to_message_id,
            err
        );
        err.to_string()
    })?;

    let (
        title,
        host_character_id,
        world_book_id,
        preset_id,
        provider_id,
        conversation_type,
        chat_mode,
        agent_provider_policy,
    ) = original;
    let forked_title = format!("{} (分支)", title.unwrap_or_default());
    let now = now_ts();

    let fork_id: i64 = sqlx::query_scalar(
        "INSERT INTO conversations (title, host_character_id, world_book_id, preset_id, provider_id, conversation_type, chat_mode, agent_provider_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
    )
    .bind(&forked_title)
    .bind(host_character_id)
    .bind(world_book_id)
    .bind(preset_id)
    .bind(provider_id)
    .bind(&conversation_type)
    .bind(&chat_mode)
    .bind(&agent_provider_policy)
    .bind(now)
    .bind(now)
    .fetch_one(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query("INSERT INTO conversation_members (conversation_id, member_role, display_name, player_character_id, join_order, is_active, created_at, updated_at) SELECT ?, member_role, display_name, player_character_id, join_order, is_active, ?, ? FROM conversation_members WHERE conversation_id = ?")
            .bind(fork_id)
            .bind(now)
            .bind(now)
            .bind(conversation_id)
            .execute(&state.db)
            .await
            .map_err(|err| err.to_string())?;

    let orig_members = sqlx::query(
        "SELECT id, member_role, display_name, join_order FROM conversation_members WHERE conversation_id = ? ORDER BY join_order ASC, id ASC"
    )
    .bind(conversation_id)
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let fork_members = sqlx::query(
        "SELECT id, member_role, display_name, join_order FROM conversation_members WHERE conversation_id = ? ORDER BY join_order ASC, id ASC"
    )
    .bind(fork_id)
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let mut member_map: HashMap<i64, i64> = HashMap::new();
    for (orig, fork) in orig_members.iter().zip(fork_members.iter()) {
        let orig_id: i64 = orig.try_get("id").unwrap_or_default();
        let fork_id_member: i64 = fork.try_get("id").unwrap_or_default();
        member_map.insert(orig_id, fork_id_member);
    }

    // 1. 先确定目标消息所在的 round_index
    let target_round_index: i64 = sqlx::query_scalar(
        "SELECT r.round_index FROM message_rounds r INNER JOIN messages m ON m.round_id = r.id WHERE m.id = ?"
    )
    .bind(up_to_message_id)
    .fetch_one(&state.db)
    .await
    .map_err(|err| {
        eprintln!(
            "[conversation-debug] fork:get_target_round_index_error conversation_id={} up_to_message_id={} error={}",
            conversation_id,
            up_to_message_id,
            err
        );
        err.to_string()
    })?;

    // 2. 查询原会话中所有 round_index <= 目标轮次索引的轮次
    let round_rows = sqlx::query(
        "SELECT id, round_index FROM message_rounds WHERE conversation_id = ? AND round_index <= ? ORDER BY round_index ASC"
    )
    .bind(conversation_id)
    .bind(target_round_index)
    .fetch_all(&state.db)
    .await
    .map_err(|err| {
        eprintln!(
            "[conversation-debug] fork:load_round_rows_error conversation_id={} target_round_index={} error={}",
            conversation_id,
            target_round_index,
            err
        );
        err.to_string()
    })?;

    let round_debug = round_rows
        .iter()
        .map(|row| {
            let round_id: i64 = row.try_get("id").unwrap_or_default();
            let round_index: i64 = row.try_get("round_index").unwrap_or_default();
            format!("{}:{}", round_id, round_index)
        })
        .collect::<Vec<_>>();
    eprintln!(
        "[conversation-debug] fork:round_rows conversation_id={} up_to_message_id={} target_round_index={} rows={:?}",
        conversation_id,
        up_to_message_id,
        target_round_index,
        round_debug
    );

    for round_row in &round_rows {
        let orig_round_id: i64 = round_row.try_get("id").map_err(|err| err.to_string())?;
        let round_index: i64 = round_row
            .try_get("round_index")
            .map_err(|err| err.to_string())?;

        let new_round_id: i64 = sqlx::query_scalar(
            "INSERT INTO message_rounds (conversation_id, round_index, status, created_at, updated_at) VALUES (?, ?, 'completed', ?, ?) RETURNING id"
        )
        .bind(fork_id)
        .bind(round_index)
        .bind(now)
        .bind(now)
        .fetch_one(&state.db)
        .await
        .map_err(|err| {
            eprintln!(
                "[conversation-debug] fork:insert_round_error source_conversation_id={} fork_id={} orig_round_id={} round_index={} error={}",
                conversation_id,
                fork_id,
                orig_round_id,
                round_index,
                err
            );
            err.to_string()
        })?;

        let orig_messages = sqlx::query(
            "SELECT id, member_id, role, content, message_kind, is_hidden, is_swipe, swipe_index, reply_to_id, created_at FROM messages WHERE round_id = ? AND id <= ? ORDER BY id"
        )
        .bind(orig_round_id)
        .bind(up_to_message_id)
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?;

        for msg_row in &orig_messages {
            let orig_member_id: Option<i64> = msg_row.try_get("member_id").ok();
            let mapped_member_id = orig_member_id
                .and_then(|id| member_map.get(&id).copied())
                .or(orig_member_id);

            sqlx::query(
                "INSERT INTO messages (conversation_id, round_id, member_id, role, content, message_kind, is_hidden, is_swipe, swipe_index, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(fork_id)
            .bind(new_round_id)
            .bind(mapped_member_id)
            .bind(msg_row.try_get::<String, _>("role").unwrap_or_default())
            .bind(msg_row.try_get::<String, _>("content").unwrap_or_default())
            .bind(msg_row.try_get::<String, _>("message_kind").unwrap_or_default())
            .bind(msg_row.try_get::<i64, _>("is_hidden").unwrap_or_default())
            .bind(msg_row.try_get::<i64, _>("is_swipe").unwrap_or_default())
            .bind(msg_row.try_get::<i64, _>("swipe_index").unwrap_or_default())
            .bind(msg_row.try_get::<Option<i64>, _>("reply_to_id").ok().flatten())
            .bind(msg_row.try_get::<i64, _>("created_at").unwrap_or_default())
            .execute(&state.db)
            .await
            .map_err(|err| err.to_string())?;
        }

        let active_msg_id: Option<i64> = sqlx::query_scalar(
            "SELECT MAX(id) FROM messages WHERE round_id = ? AND role = 'assistant' AND is_hidden = 0"
        )
        .bind(new_round_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|err| err.to_string())?
        .flatten();

        if let Some(active_id) = active_msg_id {
            sqlx::query("UPDATE message_rounds SET active_assistant_message_id = ? WHERE id = ?")
                .bind(active_id)
                .bind(new_round_id)
                .execute(&state.db)
                .await
                .map_err(|err| err.to_string())?;
        }
    }

    eprintln!(
        "[conversation-debug] fork:success source_conversation_id={} up_to_message_id={} fork_id={}",
        conversation_id,
        up_to_message_id,
        fork_id
    );
    Ok(fork_id)
}

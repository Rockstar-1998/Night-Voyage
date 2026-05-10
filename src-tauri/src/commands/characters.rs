use serde::Deserialize;
use sqlx::Row;

use crate::{
    models::{CharacterBaseSection, CharacterCard},
    utils::now_ts,
    AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterBaseSectionInput {
    pub section_key: String,
    pub title: Option<String>,
    pub content: String,
    pub sort_order: Option<i64>,
}

#[derive(Debug)]
struct NormalizedCharacterBaseSectionInput {
    section_key: String,
    title: Option<String>,
    content: String,
    sort_order: i64,
}

#[tauri::command]
pub async fn character_cards_list(
    state: tauri::State<'_, AppState>,
    card_type: Option<String>,
) -> Result<Vec<CharacterCard>, String> {
    if let Some(ref value) = card_type {
        validate_card_type(value)?;
    }

    let rows = match card_type {
        Some(card_type) => sqlx::query(
            "SELECT id FROM character_cards WHERE card_type = ? ORDER BY updated_at DESC, id DESC",
        )
        .bind(card_type)
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?,
        None => sqlx::query("SELECT id FROM character_cards ORDER BY updated_at DESC, id DESC")
            .fetch_all(&state.db)
            .await
            .map_err(|err| err.to_string())?,
    };

    let mut cards = Vec::with_capacity(rows.len());
    for row in rows {
        let id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        cards.push(character_card_get(&state.db, id).await?);
    }

    Ok(cards)
}

#[tauri::command]
pub async fn character_cards_create(
    state: tauri::State<'_, AppState>,
    card_type: String,
    name: String,
    image_path: Option<String>,
    description: String,
    tags: Vec<String>,
    base_sections: Option<Vec<CharacterBaseSectionInput>>,
    first_messages: Option<Vec<String>>,
    default_world_book_id: Option<i64>,
    default_preset_id: Option<i64>,
    default_provider_id: Option<i64>,
) -> Result<CharacterCard, String> {
    let card_type = normalize_card_type(&card_type)?;
    let name = normalize_required("name", &name)?;
    let image_path = normalize_optional(image_path);
    let description = description.trim().to_string();
    let tags = normalize_tags(tags);
    let base_sections = normalize_base_sections(base_sections.unwrap_or_default())?;
    let first_messages = normalize_first_messages(first_messages.unwrap_or_default());
    let now = now_ts();

    let (default_world_book_id, default_preset_id, default_provider_id, first_messages) =
        normalize_card_bindings(
            &card_type,
            default_world_book_id,
            default_preset_id,
            default_provider_id,
            first_messages,
        );

    let legacy_tags = if tags.is_empty() {
        None
    } else {
        Some(tags.join(", "))
    };
    let legacy_first_message = first_messages.first().cloned();

    let mut tx = state.db.begin().await.map_err(|err| err.to_string())?;
    let result = sqlx::query(
        "INSERT INTO character_cards (
            name, avatar_path, description, first_message, tags, card_type,
            default_world_book_id, default_preset_id, default_provider_id,
            created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&name)
    .bind(&image_path)
    .bind(&description)
    .bind(&legacy_first_message)
    .bind(&legacy_tags)
    .bind(&card_type)
    .bind(default_world_book_id)
    .bind(default_preset_id)
    .bind(default_provider_id)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    let character_id = result.last_insert_rowid();
    replace_tags(&mut tx, character_id, &tags).await?;
    replace_base_sections(&mut tx, character_id, &base_sections, now).await?;
    replace_openers(&mut tx, character_id, &first_messages, now).await?;

    tx.commit().await.map_err(|err| err.to_string())?;
    character_card_get(&state.db, character_id).await
}

#[tauri::command]
pub async fn character_cards_update(
    state: tauri::State<'_, AppState>,
    id: i64,
    card_type: String,
    name: String,
    image_path: Option<String>,
    description: String,
    tags: Vec<String>,
    base_sections: Option<Vec<CharacterBaseSectionInput>>,
    first_messages: Option<Vec<String>>,
    default_world_book_id: Option<i64>,
    default_preset_id: Option<i64>,
    default_provider_id: Option<i64>,
) -> Result<CharacterCard, String> {
    let card_type = normalize_card_type(&card_type)?;
    let name = normalize_required("name", &name)?;
    let image_path = normalize_optional(image_path);
    let description = description.trim().to_string();
    let tags = normalize_tags(tags);
    let base_sections = match base_sections {
        Some(base_sections) => Some(normalize_base_sections(base_sections)?),
        None => None,
    };
    let first_messages = normalize_first_messages(first_messages.unwrap_or_default());
    let now = now_ts();

    let (default_world_book_id, default_preset_id, default_provider_id, first_messages) =
        normalize_card_bindings(
            &card_type,
            default_world_book_id,
            default_preset_id,
            default_provider_id,
            first_messages,
        );

    let legacy_tags = if tags.is_empty() {
        None
    } else {
        Some(tags.join(", "))
    };
    let legacy_first_message = first_messages.first().cloned();

    let mut tx = state.db.begin().await.map_err(|err| err.to_string())?;
    sqlx::query(
        "UPDATE character_cards SET
            name = ?,
            avatar_path = ?,
            description = ?,
            first_message = ?,
            tags = ?,
            card_type = ?,
            default_world_book_id = ?,
            default_preset_id = ?,
            default_provider_id = ?,
            updated_at = ?
         WHERE id = ?",
    )
    .bind(&name)
    .bind(&image_path)
    .bind(&description)
    .bind(&legacy_first_message)
    .bind(&legacy_tags)
    .bind(&card_type)
    .bind(default_world_book_id)
    .bind(default_preset_id)
    .bind(default_provider_id)
    .bind(now)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    replace_tags(&mut tx, id, &tags).await?;
    if let Some(base_sections) = base_sections.as_ref() {
        replace_base_sections(&mut tx, id, base_sections, now).await?;
    }
    replace_openers(&mut tx, id, &first_messages, now).await?;

    tx.commit().await.map_err(|err| err.to_string())?;
    character_card_get(&state.db, id).await
}

#[tauri::command]
pub async fn character_cards_delete(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM character_cards WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

async fn character_card_get(db: &sqlx::SqlitePool, id: i64) -> Result<CharacterCard, String> {
    let row = sqlx::query(
        "SELECT id, card_type, name, avatar_path, description, first_message, tags,
                default_world_book_id, default_preset_id, default_provider_id,
                created_at, updated_at
         FROM character_cards WHERE id = ?",
    )
    .bind(id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    let tags = load_tags(db, id, row.try_get::<String, _>("tags").unwrap_or_default()).await?;
    let base_sections = load_base_sections(db, id).await?;
    let first_messages = load_openers(
        db,
        id,
        row.try_get::<String, _>("first_message")
            .unwrap_or_default(),
    )
    .await?;

    Ok(CharacterCard {
        id: row.try_get("id").unwrap_or_default(),
        card_type: row
            .try_get("card_type")
            .unwrap_or_else(|_| "npc".to_string()),
        name: row.try_get("name").unwrap_or_default(),
        image_path: row.try_get("avatar_path").ok(),
        description: row.try_get("description").unwrap_or_default(),
        tags,
        base_sections,
        first_messages,
        default_world_book_id: row.try_get("default_world_book_id").ok(),
        default_preset_id: row.try_get("default_preset_id").ok(),
        default_provider_id: row.try_get("default_provider_id").ok(),
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    })
}

async fn replace_tags(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    character_id: i64,
    tags: &[String],
) -> Result<(), String> {
    sqlx::query("DELETE FROM character_card_tags WHERE character_id = ?")
        .bind(character_id)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

    for (index, tag) in tags.iter().enumerate() {
        sqlx::query(
            "INSERT INTO character_card_tags (character_id, tag, sort_order) VALUES (?, ?, ?)",
        )
        .bind(character_id)
        .bind(tag)
        .bind(index as i64)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;
    }

    Ok(())
}

async fn replace_base_sections(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    character_id: i64,
    base_sections: &[NormalizedCharacterBaseSectionInput],
    now: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM character_card_base_sections WHERE character_id = ?")
        .bind(character_id)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

    for base_section in base_sections {
        sqlx::query(
            "INSERT INTO character_card_base_sections (
                character_id, section_key, title, content, sort_order, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(character_id)
        .bind(&base_section.section_key)
        .bind(&base_section.title)
        .bind(&base_section.content)
        .bind(base_section.sort_order)
        .bind(now)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;
    }

    Ok(())
}

async fn replace_openers(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    character_id: i64,
    first_messages: &[String],
    now: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM character_card_openers WHERE character_id = ?")
        .bind(character_id)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;

    for (index, message) in first_messages.iter().enumerate() {
        sqlx::query(
            "INSERT INTO character_card_openers (character_id, opener_text, sort_order, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(character_id)
        .bind(message)
        .bind(index as i64)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(|err| err.to_string())?;
    }

    Ok(())
}

async fn load_tags(
    db: &sqlx::SqlitePool,
    character_id: i64,
    legacy_tags: String,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT tag FROM character_card_tags WHERE character_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(character_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    if !rows.is_empty() {
        return Ok(rows
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("tag").ok())
            .collect());
    }

    Ok(legacy_tags
        .split(',')
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .map(|tag| tag.to_string())
        .collect())
}

async fn load_base_sections(
    db: &sqlx::SqlitePool,
    character_id: i64,
) -> Result<Vec<CharacterBaseSection>, String> {
    let rows = sqlx::query(
        "SELECT id, character_id, section_key, title, content, sort_order, created_at, updated_at \
         FROM character_card_base_sections WHERE character_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(character_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| CharacterBaseSection {
            id: row.try_get("id").unwrap_or_default(),
            character_id: row.try_get("character_id").unwrap_or_default(),
            section_key: row.try_get("section_key").unwrap_or_default(),
            title: normalize_optional(row.try_get("title").ok()),
            content: row.try_get("content").unwrap_or_default(),
            sort_order: row.try_get("sort_order").unwrap_or_default(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        })
        .collect())
}

async fn load_openers(
    db: &sqlx::SqlitePool,
    character_id: i64,
    legacy_first_message: String,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT opener_text FROM character_card_openers WHERE character_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(character_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    if !rows.is_empty() {
        return Ok(rows
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("opener_text").ok())
            .collect());
    }

    if legacy_first_message.trim().is_empty() {
        Ok(Vec::new())
    } else {
        Ok(vec![legacy_first_message])
    }
}

fn normalize_card_type(value: &str) -> Result<String, String> {
    validate_card_type(value)?;
    Ok(value.trim().to_string())
}

fn validate_card_type(value: &str) -> Result<(), String> {
    match value.trim() {
        "npc" | "player" => Ok(()),
        _ => Err("cardType 只支持 npc 或 player".to_string()),
    }
}

fn normalize_required(field_name: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{} 不能为空", field_name));
    }
    Ok(trimmed.to_string())
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    tags.into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect()
}

fn normalize_base_sections(
    base_sections: Vec<CharacterBaseSectionInput>,
) -> Result<Vec<NormalizedCharacterBaseSectionInput>, String> {
    let mut normalized = Vec::with_capacity(base_sections.len());
    for (index, base_section) in base_sections.into_iter().enumerate() {
        normalized.push(NormalizedCharacterBaseSectionInput {
            section_key: normalize_base_section_key(
                &base_section.section_key,
                &format!("baseSections[{index}].sectionKey"),
            )?,
            title: normalize_optional(base_section.title),
            content: normalize_required(
                &format!("baseSections[{index}].content"),
                &base_section.content,
            )?,
            sort_order: base_section.sort_order.unwrap_or(index as i64),
        });
    }

    Ok(normalized)
}

fn normalize_base_section_key(value: &str, field_name: &str) -> Result<String, String> {
    match value.trim() {
        "identity" | "persona" | "background" | "rules" | "custom" => Ok(value.trim().to_string()),
        _ => Err(format!(
            "{} 只支持 identity、persona、background、rules、custom",
            field_name
        )),
    }
}

fn normalize_first_messages(first_messages: Vec<String>) -> Vec<String> {
    first_messages
        .into_iter()
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
        .collect()
}

fn normalize_card_bindings(
    card_type: &str,
    default_world_book_id: Option<i64>,
    default_preset_id: Option<i64>,
    default_provider_id: Option<i64>,
    first_messages: Vec<String>,
) -> (Option<i64>, Option<i64>, Option<i64>, Vec<String>) {
    if card_type == "player" {
        (None, None, None, Vec::new())
    } else {
        (
            default_world_book_id,
            default_preset_id,
            default_provider_id,
            first_messages,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_base_sections, CharacterBaseSectionInput};

    #[test]
    fn normalize_base_sections_defaults_sort_order_and_trims_values() {
        let sections = normalize_base_sections(vec![CharacterBaseSectionInput {
            section_key: " identity ".to_string(),
            title: Some("  Core Identity  ".to_string()),
            content: "  A veteran detective.  ".to_string(),
            sort_order: None,
        }])
        .expect("base sections should normalize");

        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].section_key, "identity");
        assert_eq!(sections[0].title.as_deref(), Some("Core Identity"));
        assert_eq!(sections[0].content, "A veteran detective.");
        assert_eq!(sections[0].sort_order, 0);
    }

    #[test]
    fn normalize_base_sections_rejects_invalid_section_key() {
        let error = normalize_base_sections(vec![CharacterBaseSectionInput {
            section_key: "mood".to_string(),
            title: None,
            content: "volatile".to_string(),
            sort_order: None,
        }])
        .expect_err("invalid section key should fail");

        assert!(error.contains("baseSections[0].sectionKey"));
    }
}

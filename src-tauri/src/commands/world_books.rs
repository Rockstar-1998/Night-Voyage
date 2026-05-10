use sqlx::Row;

use crate::{
    models::{WorldBookEntryRecord, WorldBookSummary},
    utils::now_ts,
    AppState,
};

#[tauri::command]
pub async fn world_books_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WorldBookSummary>, String> {
    let rows = sqlx::query(
        "SELECT wb.id, wb.title, wb.description, wb.image_path, wb.created_at, wb.updated_at, COUNT(wbe.id) AS entry_count \
         FROM world_books wb \
         LEFT JOIN world_book_entries wbe ON wbe.world_book_id = wb.id \
         GROUP BY wb.id \
         ORDER BY wb.updated_at DESC, wb.id DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(rows.into_iter().map(row_to_world_book_summary).collect())
}

#[tauri::command]
pub async fn world_books_create(
    state: tauri::State<'_, AppState>,
    title: String,
    description: Option<String>,
    image_path: Option<String>,
) -> Result<WorldBookSummary, String> {
    let title = normalize_required("title", &title)?;
    let description = normalize_optional(description);
    let image_path = normalize_optional(image_path);
    let now = now_ts();

    let result = sqlx::query(
        "INSERT INTO world_books (title, description, image_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&title)
    .bind(&description)
    .bind(&image_path)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    world_book_get(&state.db, result.last_insert_rowid()).await
}

#[tauri::command]
pub async fn world_books_update(
    state: tauri::State<'_, AppState>,
    id: i64,
    title: Option<String>,
    description: Option<String>,
    image_path: Option<String>,
) -> Result<WorldBookSummary, String> {
    let next_title = match title {
        Some(value) => Some(normalize_required("title", &value)?),
        None => None,
    };
    let now = now_ts();

    sqlx::query(
        "UPDATE world_books SET
            title = COALESCE(?, title),
            description = COALESCE(?, description),
            image_path = COALESCE(?, image_path),
            updated_at = ?
         WHERE id = ?",
    )
    .bind(next_title)
    .bind(normalize_optional(description))
    .bind(normalize_optional(image_path))
    .bind(now)
    .bind(id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    world_book_get(&state.db, id).await
}

#[tauri::command]
pub async fn world_books_delete(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM world_books WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn world_book_entries_list(
    state: tauri::State<'_, AppState>,
    world_book_id: i64,
) -> Result<Vec<WorldBookEntryRecord>, String> {
    let rows = sqlx::query(
        "SELECT id FROM world_book_entries WHERE world_book_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(world_book_id)
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let mut entries = Vec::with_capacity(rows.len());
    for row in rows {
        let id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        entries.push(world_book_entry_get(&state.db, id).await?);
    }
    Ok(entries)
}

#[tauri::command]
pub async fn world_book_entries_upsert(
    state: tauri::State<'_, AppState>,
    world_book_id: i64,
    entry_id: Option<i64>,
    title: String,
    content: String,
    keywords: Vec<String>,
    trigger_mode: String,
    is_enabled: bool,
    sort_order: Option<i64>,
) -> Result<WorldBookEntryRecord, String> {
    let title = normalize_required("title", &title)?;
    let content = content.trim().to_string();
    let keywords = normalize_keywords(keywords);
    let trigger_mode = normalize_trigger_mode(&trigger_mode)?;
    let now = now_ts();
    let sort_order = sort_order.unwrap_or(0);

    let mut tx = state.db.begin().await.map_err(|err| err.to_string())?;
    let entry_id = match entry_id {
        Some(entry_id) => {
            sqlx::query(
                "UPDATE world_book_entries SET
                    title = ?,
                    content = ?,
                    trigger_mode = ?,
                    is_enabled = ?,
                    sort_order = ?,
                    updated_at = ?
                 WHERE id = ? AND world_book_id = ?",
            )
            .bind(&title)
            .bind(&content)
            .bind(&trigger_mode)
            .bind(if is_enabled { 1 } else { 0 })
            .bind(sort_order)
            .bind(now)
            .bind(entry_id)
            .bind(world_book_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;
            entry_id
        }
        None => {
            let result = sqlx::query(
                "INSERT INTO world_book_entries (
                    world_book_id, title, content, trigger_mode,
                    is_enabled, sort_order, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(world_book_id)
            .bind(&title)
            .bind(&content)
            .bind(&trigger_mode)
            .bind(if is_enabled { 1 } else { 0 })
            .bind(sort_order)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;
            result.last_insert_rowid()
        }
    };

    sqlx::query("DELETE FROM world_book_entry_keywords WHERE entry_id = ?")
        .bind(entry_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

    for (index, keyword) in keywords.iter().enumerate() {
        sqlx::query(
            "INSERT INTO world_book_entry_keywords (entry_id, keyword, sort_order) VALUES (?, ?, ?)",
        )
        .bind(entry_id)
        .bind(keyword)
        .bind(index as i64)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
    }

    sqlx::query("UPDATE world_books SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(world_book_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

    tx.commit().await.map_err(|err| err.to_string())?;
    world_book_entry_get(&state.db, entry_id).await
}

#[tauri::command]
pub async fn world_book_entries_delete(
    state: tauri::State<'_, AppState>,
    entry_id: i64,
) -> Result<(), String> {
    let world_book_id: i64 =
        sqlx::query_scalar("SELECT world_book_id FROM world_book_entries WHERE id = ? LIMIT 1")
            .bind(entry_id)
            .fetch_one(&state.db)
            .await
            .map_err(|err| err.to_string())?;

    sqlx::query("DELETE FROM world_book_entries WHERE id = ?")
        .bind(entry_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    sqlx::query("UPDATE world_books SET updated_at = ? WHERE id = ?")
        .bind(now_ts())
        .bind(world_book_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    Ok(())
}

async fn world_book_get(db: &sqlx::SqlitePool, id: i64) -> Result<WorldBookSummary, String> {
    let row = sqlx::query(
        "SELECT wb.id, wb.title, wb.description, wb.image_path, wb.created_at, wb.updated_at, COUNT(wbe.id) AS entry_count \
         FROM world_books wb \
         LEFT JOIN world_book_entries wbe ON wbe.world_book_id = wb.id \
         WHERE wb.id = ?
         GROUP BY wb.id",
    )
    .bind(id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(row_to_world_book_summary(row))
}

async fn world_book_entry_get(
    db: &sqlx::SqlitePool,
    id: i64,
) -> Result<WorldBookEntryRecord, String> {
    let row = sqlx::query(
        "SELECT id, world_book_id, title, content, trigger_mode, is_enabled, sort_order, created_at, updated_at \
         FROM world_book_entries WHERE id = ?",
    )
    .bind(id)
    .fetch_one(db)
    .await
    .map_err(|err| err.to_string())?;

    let keywords = load_keywords(db, id).await?;

    Ok(WorldBookEntryRecord {
        id: row.try_get("id").unwrap_or_default(),
        world_book_id: row.try_get("world_book_id").unwrap_or_default(),
        title: row.try_get("title").unwrap_or_default(),
        content: row.try_get("content").unwrap_or_default(),
        keywords,
        trigger_mode: row
            .try_get("trigger_mode")
            .unwrap_or_else(|_| "any".to_string()),
        is_enabled: row
            .try_get::<i64, _>("is_enabled")
            .map(|value| value != 0)
            .unwrap_or(true),
        sort_order: row.try_get("sort_order").unwrap_or_default(),
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
    })
}

async fn load_keywords(db: &sqlx::SqlitePool, entry_id: i64) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT keyword FROM world_book_entry_keywords WHERE entry_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(entry_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("keyword").ok())
        .collect())
}

fn row_to_world_book_summary(row: sqlx::sqlite::SqliteRow) -> WorldBookSummary {
    WorldBookSummary {
        id: row.try_get("id").unwrap_or_default(),
        title: row.try_get("title").unwrap_or_default(),
        description: row.try_get("description").ok(),
        image_path: row.try_get("image_path").ok(),
        entry_count: row.try_get("entry_count").unwrap_or_default(),
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
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

fn normalize_keywords(keywords: Vec<String>) -> Vec<String> {
    keywords
        .into_iter()
        .map(|keyword| keyword.trim().to_string())
        .filter(|keyword| !keyword.is_empty())
        .collect()
}

fn normalize_trigger_mode(value: &str) -> Result<String, String> {
    match value.trim() {
        "any" => Ok("any".to_string()),
        "all" => Ok("all".to_string()),
        _ => Err("triggerMode 只支持 any 或 all".to_string()),
    }
}

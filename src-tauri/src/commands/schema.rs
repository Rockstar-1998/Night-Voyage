use std::sync::atomic::{AtomicU64, Ordering};

static SCHEMA_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

use crate::{
    models::schema::SchemaDefinition,
    utils::now_ts,
    AppState,
};

fn row_to_schema_definition(row: &sqlx::sqlite::SqliteRow) -> Result<SchemaDefinition, String> {
    SchemaDefinition::from_row(row)
}

#[tauri::command]
pub async fn preset_schemas_list(
    state: tauri::State<'_, AppState>,
    preset_id: i64,
) -> Result<Vec<SchemaDefinition>, String> {
    let rows = sqlx::query(
        "SELECT id, preset_id, name, description, retention_depth, fields_json, created_at, updated_at \
         FROM preset_schemas \
         WHERE preset_id = ? \
         ORDER BY updated_at DESC, id ASC",
    )
    .bind(preset_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    rows.iter().map(row_to_schema_definition).collect()
}

#[tauri::command]
pub async fn preset_schema_get(
    state: tauri::State<'_, AppState>,
    schema_id: String,
) -> Result<SchemaDefinition, String> {
    let row = sqlx::query(
        "SELECT id, preset_id, name, description, retention_depth, fields_json, created_at, updated_at \
         FROM preset_schemas \
         WHERE id = ?",
    )
    .bind(&schema_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Schema '{}' not found", schema_id))?;

    row_to_schema_definition(&row)
}

#[tauri::command]
pub async fn preset_schema_save(
    state: tauri::State<'_, AppState>,
    mut schema: SchemaDefinition,
) -> Result<SchemaDefinition, String> {
    if schema.name.trim().is_empty() {
        return Err("Schema name cannot be empty".to_string());
    }

    // 校验保留层数：若配置必须为正整数 (N >= 1)
    if let Some(depth) = schema.retention_depth {
        if depth == 0 {
            return Err("Retention depth must be greater than or equal to 1".to_string());
        }
    }

    let now = now_ts();

    if schema.id.trim().is_empty() {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        schema.id = format!("schema_{:x}_{:x}", millis, SCHEMA_ID_COUNTER.fetch_add(1, Ordering::Relaxed));
        schema.created_at = now;
    }

    schema.updated_at = now;
    if schema.created_at == 0 {
        schema.created_at = now;
    }

    let fields_json = serde_json::to_string(&schema.fields)
        .map_err(|e| format!("Failed to serialize fields: {}", e))?;

    let retention_depth_i64 = schema.retention_depth.map(|d| d as i64);

    sqlx::query(
        "INSERT INTO preset_schemas (id, preset_id, name, description, retention_depth, fields_json, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET \
            name = excluded.name, \
            description = excluded.description, \
            retention_depth = excluded.retention_depth, \
            fields_json = excluded.fields_json, \
            updated_at = excluded.updated_at",
    )
    .bind(&schema.id)
    .bind(schema.preset_id)
    .bind(&schema.name)
    .bind(&schema.description)
    .bind(retention_depth_i64)
    .bind(&fields_json)
    .bind(schema.created_at)
    .bind(schema.updated_at)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(schema)
}

#[tauri::command]
pub async fn preset_schema_delete(
    state: tauri::State<'_, AppState>,
    schema_id: String,
) -> Result<(), String> {
    let result = sqlx::query("DELETE FROM preset_schemas WHERE id = ?")
        .bind(&schema_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    if result.rows_affected() == 0 {
        return Err(format!("Schema '{}' not found", schema_id));
    }

    Ok(())
}

#[tauri::command]
pub async fn preset_schema_reorder_fields(
    state: tauri::State<'_, AppState>,
    schema_id: String,
    field_names: Vec<String>,
) -> Result<SchemaDefinition, String> {
    let mut schema = preset_schema_get(state.clone(), schema_id).await?;

    let mut reordered = Vec::with_capacity(schema.fields.len());
    let mut remaining = schema.fields;

    for name in &field_names {
        if let Some(pos) = remaining.iter().position(|f| &f.name == name) {
            reordered.push(remaining.remove(pos));
        }
    }
    // 把未在 field_names 中显式指定的剩余字段追加在末尾
    reordered.extend(remaining);

    schema.fields = reordered;
    preset_schema_save(state, schema).await
}

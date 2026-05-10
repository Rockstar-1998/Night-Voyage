use serde::Serialize;
use sqlx::Row;
use tauri::AppHandle;

use crate::{db, AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_name: String,
    pub app_version: String,
    pub db_path: String,
}

#[derive(Serialize, Clone)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    let package = app.package_info();
    let db_path = db::resolve_db_path(&app).map_err(|err| err.to_string())?;

    Ok(AppInfo {
        app_name: package.name.to_string(),
        app_version: package.version.to_string(),
        db_path: db_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn settings_get_all(state: tauri::State<'_, AppState>) -> Result<Vec<Setting>, String> {
    let rows = sqlx::query("SELECT key, value FROM settings ORDER BY key")
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    let mut settings = Vec::with_capacity(rows.len());
    for row in rows {
        settings.push(Setting {
            key: row.try_get("key").map_err(|err| err.to_string())?,
            value: row.try_get("value").map_err(|err| err.to_string())?,
        });
    }

    Ok(settings)
}

#[tauri::command]
pub async fn settings_set(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> Result<Setting, String> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) \
        ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&key)
    .bind(&value)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(Setting { key, value })
}

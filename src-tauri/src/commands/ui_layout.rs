use std::sync::atomic::{AtomicU64, Ordering};
use sqlx::Row;
use tauri::State;

use crate::models::ui_layout::{LayoutContainer, LayoutMountType, UILayoutDefinition};
use crate::AppState;

static UI_LAYOUT_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn generate_ui_layout_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = UI_LAYOUT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("uil_{:x}_{:x}", now, seq)
}

fn row_to_ui_layout(row: &sqlx::sqlite::SqliteRow) -> Result<UILayoutDefinition, String> {
    let id: String = row.try_get("id").map_err(|e| e.to_string())?;
    let preset_id: i64 = row.try_get("preset_id").map_err(|e| e.to_string())?;
    let name: String = row.try_get("name").map_err(|e| e.to_string())?;
    let mount_type_str: String = row.try_get("mount_type").map_err(|e| e.to_string())?;
    let theme: String = row.try_get("theme").map_err(|e| e.to_string())?;
    let custom_css: String = row.try_get("custom_css").map_err(|e| e.to_string())?;
    let layout_json: String = row.try_get("layout_json").map_err(|e| e.to_string())?;

    let mount_type = match mount_type_str.as_str() {
        "TopSticky" => LayoutMountType::TopSticky,
        "FloatingHUD" => LayoutMountType::FloatingHUD,
        "MobileDrawer" => LayoutMountType::MobileDrawer,
        "MobileBottomSticky" => LayoutMountType::MobileBottomSticky,
        _ => LayoutMountType::RightDock,
    };

    let root_container: LayoutContainer = serde_json::from_str(&layout_json)
        .unwrap_or_else(|_| UILayoutDefinition::default().root_container);

    Ok(UILayoutDefinition {
        id,
        preset_id,
        name,
        mount_type,
        theme,
        custom_css,
        root_container,
    })
}

/// 获取指定预设下的所有常驻 UI 布局模板
#[tauri::command]
pub async fn preset_ui_layout_list(
    preset_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<UILayoutDefinition>, String> {
    let rows = sqlx::query(
        "SELECT id, preset_id, name, mount_type, theme, custom_css, layout_json, created_at, updated_at \
         FROM preset_ui_layouts WHERE preset_id = ? ORDER BY created_at ASC",
    )
    .bind(preset_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("查询 preset_ui_layouts 失败: {}", e).replace('\\', "/"))?;

    let mut list = Vec::new();
    for row in rows {
        if let Ok(layout) = row_to_ui_layout(&row) {
            list.push(layout);
        }
    }

    Ok(list)
}

/// 获取指定 UI 布局模板详情
#[tauri::command]
pub async fn preset_ui_layout_get(
    layout_id: String,
    state: State<'_, AppState>,
) -> Result<UILayoutDefinition, String> {
    let row = sqlx::query(
        "SELECT id, preset_id, name, mount_type, theme, custom_css, layout_json, created_at, updated_at \
         FROM preset_ui_layouts WHERE id = ?",
    )
    .bind(&layout_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| format!("查询 preset_ui_layout 失败: {}", e).replace('\\', "/"))?
    .ok_or_else(|| format!("未找到 UI 布局 ID: {}", layout_id))?;

    row_to_ui_layout(&row)
}

/// 保存或更新 UI 布局模板
#[tauri::command]
pub async fn preset_ui_layout_save(
    layout: UILayoutDefinition,
    state: State<'_, AppState>,
) -> Result<UILayoutDefinition, String> {
    let id = if layout.id.trim().is_empty() {
        generate_ui_layout_id()
    } else {
        layout.id.clone()
    };

    let mount_str = match layout.mount_type {
        LayoutMountType::RightDock => "RightDock",
        LayoutMountType::TopSticky => "TopSticky",
        LayoutMountType::FloatingHUD => "FloatingHUD",
        LayoutMountType::MobileDrawer => "MobileDrawer",
        LayoutMountType::MobileBottomSticky => "MobileBottomSticky",
    };

    let layout_json = serde_json::to_string(&layout.root_container)
        .map_err(|e| format!("序列化 layout_json 失败: {}", e).replace('\\', "/"))?;
    let now = crate::utils::now_ts();

    sqlx::query(
        "INSERT INTO preset_ui_layouts (id, preset_id, name, mount_type, theme, custom_css, layout_json, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET \
            name = excluded.name, \
            mount_type = excluded.mount_type, \
            theme = excluded.theme, \
            custom_css = excluded.custom_css, \
            layout_json = excluded.layout_json, \
            updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(layout.preset_id)
    .bind(&layout.name)
    .bind(mount_str)
    .bind(&layout.theme)
    .bind(&layout.custom_css)
    .bind(layout_json)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|e| format!("保存 preset_ui_layout 失败: {}", e).replace('\\', "/"))?;

    let mut saved = layout;
    saved.id = id;
    Ok(saved)
}

/// 删除 UI 布局模板
#[tauri::command]
pub async fn preset_ui_layout_delete(
    layout_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    sqlx::query("DELETE FROM preset_ui_layouts WHERE id = ?")
        .bind(&layout_id)
        .execute(&state.db)
        .await
        .map_err(|e| format!("删除 preset_ui_layout 失败: {}", e).replace('\\', "/"))?;

    Ok(())
}

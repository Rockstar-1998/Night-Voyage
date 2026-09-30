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

    // 未知 mount_type 必须当场失败：静默落到 RightDock 会让保存时读回的布局
    // 与创作者所见不一致（C2 零静默回退）。
    let mount_type = match mount_type_str.as_str() {
        "RightDock" => LayoutMountType::RightDock,
        "TopSticky" => LayoutMountType::TopSticky,
        "FloatingHUD" => LayoutMountType::FloatingHUD,
        "MobileDrawer" => LayoutMountType::MobileDrawer,
        "MobileBottomSticky" => LayoutMountType::MobileBottomSticky,
        other => {
            return Err(format!(
                "未知的 mount_type: {} (期望 RightDock / TopSticky / FloatingHUD / MobileDrawer / MobileBottomSticky)",
                other
            )
            .replace('\\', "/"))
        }
    };

    // layout_json 解析失败同样硬错：用默认模板顶替会把"布局数据坏了"伪装成"布局是空的"。
    let root_container: LayoutContainer = serde_json::from_str(&layout_json)
        .map_err(|e| format!("解析 layout_json 失败: {}", e).replace('\\', "/"))?;

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

    // 逐行硬错而不是跳过坏行：列表里"少一个布局"比"报错"更难排查（C2）。
    let mut list = Vec::with_capacity(rows.len());
    for row in rows {
        list.push(row_to_ui_layout(&row)?);
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

/// 把某个 UI 布局绑定到指定会话（会话级常驻 HUD 布局选择）。
///
/// 绑定前先校验该布局存在，避免写入悬空引用（C2：不留下"绑了个不存在的模板"这种坏状态）。
#[tauri::command]
pub async fn preset_ui_layout_activate(
    session_id: i64,
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

    let layout = row_to_ui_layout(&row)?;

    sqlx::query(
        "INSERT INTO session_ui_layouts (session_id, layout_id, updated_at) VALUES (?, ?, ?) \
         ON CONFLICT(session_id) DO UPDATE SET layout_id = excluded.layout_id, updated_at = excluded.updated_at",
    )
    .bind(session_id)
    .bind(&layout_id)
    .bind(crate::utils::now_ts())
    .execute(&state.db)
    .await
    .map_err(|e| format!("绑定会话布局失败: {}", e).replace('\\', "/"))?;

    Ok(layout)
}

/// 取指定会话当前生效的 UI 布局。
///
/// 解析链只有一环：`session_ui_layouts` 的显式绑定。没有绑定就报错，
/// **不返回默认模板**——否则"没配布局"与"配了默认布局"在界面上一模一样，
/// 创作者无法判断自己的布局到底有没有生效。
#[tauri::command]
pub async fn preset_ui_layout_for_conversation(
    conversation_id: i64,
    state: State<'_, AppState>,
) -> Result<UILayoutDefinition, String> {
    let bound: Option<String> =
        sqlx::query_scalar("SELECT layout_id FROM session_ui_layouts WHERE session_id = ? LIMIT 1")
            .bind(conversation_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| format!("查询会话布局绑定失败: {}", e).replace('\\', "/"))?;

    let layout_id = bound.ok_or_else(|| {
        format!(
            "会话 {} 尚未绑定常驻 HUD 布局；请在预设详情页的「UI 设计器」里创建布局并绑定",
            conversation_id
        )
    })?;

    let row = sqlx::query(
        "SELECT id, preset_id, name, mount_type, theme, custom_css, layout_json, created_at, updated_at \
         FROM preset_ui_layouts WHERE id = ?",
    )
    .bind(&layout_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| format!("查询 preset_ui_layout 失败: {}", e).replace('\\', "/"))?
    .ok_or_else(|| format!("会话绑定的 UI 布局已不存在: {}", layout_id))?;

    row_to_ui_layout(&row)
}

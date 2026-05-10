use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAsset {
    pub stored_path: String,
}

#[tauri::command]
pub async fn assets_import_image(
    app: AppHandle,
    source_path: String,
) -> Result<ImportedAsset, String> {
    let source = PathBuf::from(source_path.trim());
    if !source.exists() {
        return Err("源图片不存在".to_string());
    }

    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "图片文件名无效".to_string())?
        .to_string();
    let bytes = std::fs::read(&source).map_err(|err| err.to_string())?;
    let assets_dir = resolve_assets_dir(&app)?;
    store_bytes(&assets_dir, &file_name, &bytes)
}

#[tauri::command]
pub async fn assets_import_image_bytes(
    app: AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<ImportedAsset, String> {
    if bytes.is_empty() {
        return Err("图片内容为空".to_string());
    }

    let assets_dir = resolve_assets_dir(&app)?;
    store_bytes(&assets_dir, &file_name, &bytes)
}

fn resolve_assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let assets_dir = app_data_dir.join("assets").join("images");
    std::fs::create_dir_all(&assets_dir).map_err(|err| err.to_string())?;
    Ok(assets_dir)
}

fn store_bytes(assets_dir: &Path, file_name: &str, bytes: &[u8]) -> Result<ImportedAsset, String> {
    let extension = extract_extension(file_name)?;
    validate_extension(&extension)?;

    let file_stem = Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image")
        .trim();
    let sanitized = sanitize_file_stem(file_stem);
    let timestamp = crate::utils::now_ts();
    let target = assets_dir.join(format!("{}-{}.{}", sanitized, timestamp, extension));

    std::fs::write(&target, bytes).map_err(|err| err.to_string())?;

    Ok(ImportedAsset {
        stored_path: normalize_path(&target),
    })
}

fn extract_extension(file_name: &str) -> Result<String, String> {
    Path::new(file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .ok_or_else(|| "图片文件缺少扩展名".to_string())
}

fn validate_extension(extension: &str) -> Result<(), String> {
    let allowed = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"];
    if allowed.contains(&extension) {
        Ok(())
    } else {
        Err("仅支持 png / jpg / jpeg / webp / gif / bmp / svg 图片".to_string())
    }
}

fn sanitize_file_stem(input: &str) -> String {
    let value = input
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' {
                char
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if value.is_empty() {
        "image".to_string()
    } else {
        value
    }
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

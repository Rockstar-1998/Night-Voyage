//! Night Voyage Exchange: 角色卡 / 世界书的导入导出。
//!
//! 采用与独立转换器 (ST2NV-Converter) 完全一致的 `night-voyage-exchange`
//! v1.x 协议，字段名与前端 `CreateCharacterCardPayload` /
//! `UpsertWorldBookEntryPayload`（camelCase）对齐，因此转换器产出的
//! `.nvexchange.json` 可被本模块直接导入。
//!
//! 零回退原则：协议/枚举校验失败、事务任一步失败都显式报错并回滚，
//! 绝不做「部分成功」静默吞错。

use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::{AppHandle, Manager};

use crate::{utils::now_ts, AppState};

/// 本端可写出/读入的协议主版本。导入时只校验主版本，次版本向后兼容。
const PROTOCOL_NAME: &str = "night-voyage-exchange";
const PROTOCOL_MAJOR: u32 = 1;

const CARD_TYPES: [&str; 2] = ["npc", "player"];
const SECTION_KEYS: [&str; 5] = ["identity", "persona", "background", "rules", "custom"];
const TRIGGER_MODES: [&str; 3] = ["any", "all", "always"];

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeBaseSection {
    pub section_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub content: String,
    #[serde(default)]
    pub sort_order: i64,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeCharacter {
    pub name: String,
    #[serde(default = "default_card_type")]
    pub card_type: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub base_sections: Vec<ExchangeBaseSection>,
    #[serde(default)]
    pub first_messages: Vec<String>,
}

fn default_card_type() -> String {
    "npc".to_string()
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeWorldBookEntry {
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default = "default_trigger_mode")]
    pub trigger_mode: String,
    #[serde(default = "default_true")]
    pub is_enabled: bool,
    #[serde(default)]
    pub sort_order: i64,
}

fn default_trigger_mode() -> String {
    "any".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeWorldBook {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub entries: Vec<ExchangeWorldBookEntry>,
}

/// 旁路二进制资产（头像）。导出时 base64 内嵌进同一 JSON 自包含。
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeAsset {
    /// 关联角色，按 `characters[]` 下标定位（导出单卡时恒为 0）。
    pub role: String,
    pub file_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_format: Option<String>,
    /// base64 编码的二进制内容。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_base64: Option<String>,
    /// 该资产归属的角色下标。
    #[serde(default)]
    pub character_index: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeDocument {
    pub protocol: String,
    pub protocol_version: String,
    #[serde(default)]
    pub source: serde_json::Value,
    #[serde(default)]
    pub characters: Vec<ExchangeCharacter>,
    #[serde(default)]
    pub world_books: Vec<ExchangeWorldBook>,
    #[serde(default)]
    pub assets: Vec<ExchangeAsset>,
}

impl ExchangeDocument {
    fn new(kind: &str) -> Self {
        ExchangeDocument {
            protocol: PROTOCOL_NAME.to_string(),
            protocol_version: format!("{PROTOCOL_MAJOR}.0"),
            source: serde_json::json!({ "tool": "night-voyage", "kind": kind }),
            characters: Vec::new(),
            world_books: Vec::new(),
            assets: Vec::new(),
        }
    }
}

#[derive(Serialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeImportReport {
    pub characters: i64,
    pub world_books: i64,
    pub world_book_entries: i64,
    pub avatars: i64,
}

// EXCHANGE_COMMANDS_PLACEHOLDER

// ---- 导出：角色卡 ----------------------------------------------------------

#[tauri::command]
pub async fn character_cards_export(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<String, String> {
    let row = sqlx::query(
        "SELECT card_type, name, avatar_path, description FROM character_cards WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?
    .ok_or_else(|| "角色卡不存在".to_string())?;

    let card_type: String = row.try_get("card_type").unwrap_or_else(|_| "npc".to_string());
    let name: String = row.try_get("name").unwrap_or_default();
    let description: String = row.try_get("description").unwrap_or_default();
    let avatar_path: Option<String> = row.try_get("avatar_path").ok();

    let tags = load_tags(&state.db, id).await?;
    let base_sections = load_base_sections(&state.db, id).await?;
    let first_messages = load_openers(&state.db, id).await?;

    let mut doc = ExchangeDocument::new("character");
    doc.characters.push(ExchangeCharacter {
        name,
        card_type,
        description,
        tags,
        base_sections,
        first_messages,
    });

    // 头像 base64 内嵌（若存在且可读）。读不到时不静默成功，记录为缺失而非伪造。
    if let Some(path) = avatar_path.as_ref().filter(|p| !p.trim().is_empty()) {
        let resolved = std::path::PathBuf::from(path);
        if resolved.exists() {
            let bytes = std::fs::read(&resolved).map_err(|err| {
                format!("读取头像失败 ({path}): {err}")
            })?;
            let file_name = resolved
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("avatar.png")
                .to_string();
            let ext = resolved
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase());
            doc.assets.push(ExchangeAsset {
                role: "character_avatar".to_string(),
                file_name,
                source_format: ext,
                data_base64: Some(base64::engine::general_purpose::STANDARD.encode(&bytes)),
                character_index: 0,
            });
        }
    }

    serde_json::to_string_pretty(&doc).map_err(|err| err.to_string())
}

// ---- 导出：世界书 ----------------------------------------------------------

#[tauri::command]
pub async fn world_books_export(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<String, String> {
    let book_row = sqlx::query("SELECT title, description FROM world_books WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "世界书不存在".to_string())?;

    let title: String = book_row.try_get("title").unwrap_or_default();
    let description: Option<String> = book_row.try_get("description").ok();

    let entry_rows = sqlx::query(
        "SELECT id, title, content, trigger_mode, is_enabled, sort_order \
         FROM world_book_entries WHERE world_book_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let mut entries = Vec::with_capacity(entry_rows.len());
    for row in entry_rows {
        let entry_id: i64 = row.try_get("id").unwrap_or_default();
        let keywords = load_entry_keywords(&state.db, entry_id).await?;
        entries.push(ExchangeWorldBookEntry {
            title: row.try_get("title").unwrap_or_default(),
            content: row.try_get("content").unwrap_or_default(),
            keywords,
            trigger_mode: row
                .try_get("trigger_mode")
                .unwrap_or_else(|_| "any".to_string()),
            is_enabled: row
                .try_get::<i64, _>("is_enabled")
                .map(|v| v != 0)
                .unwrap_or(true),
            sort_order: row.try_get("sort_order").unwrap_or_default(),
        });
    }

    let mut doc = ExchangeDocument::new("worldbook");
    doc.world_books.push(ExchangeWorldBook {
        title,
        description,
        entries,
    });

    serde_json::to_string_pretty(&doc).map_err(|err| err.to_string())
}

// IMPORT_PLACEHOLDER

// ---- 导入 ------------------------------------------------------------------

#[tauri::command]
pub async fn exchange_import(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    payload_json: String,
) -> Result<ExchangeImportReport, String> {
    let doc: ExchangeDocument = serde_json::from_str(&payload_json)
        .map_err(|err| format!("交换文件 JSON 解析失败: {err}"))?;

    if doc.protocol != PROTOCOL_NAME {
        return Err(format!(
            "不是 Night Voyage 交换文件 (protocol = '{}')",
            doc.protocol
        ));
    }
    let major = doc
        .protocol_version
        .split('.')
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or_else(|| format!("无法识别协议版本 '{}'", doc.protocol_version))?;
    if major != PROTOCOL_MAJOR {
        return Err(format!(
            "协议主版本不兼容：文件 v{}，当前支持 v{}",
            major, PROTOCOL_MAJOR
        ));
    }

    if doc.characters.is_empty() && doc.world_books.is_empty() {
        return Err("交换文件不含任何角色卡或世界书".to_string());
    }

    // 先校验全部枚举与必填，任一非法立即拒绝（不进事务、不部分写入）。
    for (idx, ch) in doc.characters.iter().enumerate() {
        if ch.name.trim().is_empty() {
            return Err(format!("characters[{idx}].name 不能为空"));
        }
        if !CARD_TYPES.contains(&ch.card_type.trim()) {
            return Err(format!(
                "characters[{idx}].cardType 非法：'{}'（只支持 npc / player）",
                ch.card_type
            ));
        }
        for (si, sec) in ch.base_sections.iter().enumerate() {
            if !SECTION_KEYS.contains(&sec.section_key.trim()) {
                return Err(format!(
                    "characters[{idx}].baseSections[{si}].sectionKey 非法：'{}'",
                    sec.section_key
                ));
            }
        }
    }
    for (bi, book) in doc.world_books.iter().enumerate() {
        if book.title.trim().is_empty() {
            return Err(format!("worldBooks[{bi}].title 不能为空"));
        }
        for (ei, entry) in book.entries.iter().enumerate() {
            if !TRIGGER_MODES.contains(&entry.trigger_mode.trim()) {
                return Err(format!(
                    "worldBooks[{bi}].entries[{ei}].triggerMode 非法：'{}'",
                    entry.trigger_mode
                ));
            }
        }
    }

    // 头像先落地到资产目录（事务外的文件 I/O），拿到 character_index -> stored_path 映射。
    // 落地失败显式报错；不静默忽略。
    let mut avatar_paths: std::collections::HashMap<usize, String> =
        std::collections::HashMap::new();
    let assets_dir = crate::commands::assets::resolve_assets_dir(&app)?;
    let mut avatar_count = 0i64;
    for asset in &doc.assets {
        let Some(b64) = asset.data_base64.as_ref() else {
            continue;
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.as_bytes())
            .map_err(|err| format!("头像 base64 解码失败 ({}): {err}", asset.file_name))?;
        let stored =
            crate::commands::assets::store_bytes(&assets_dir, &asset.file_name, &bytes)?;
        avatar_paths.insert(asset.character_index, stored.stored_path);
        avatar_count += 1;
    }

    let now = now_ts();
    let mut tx = state.db.begin().await.map_err(|err| err.to_string())?;

    let mut report = ExchangeImportReport {
        avatars: avatar_count,
        ..Default::default()
    };

    for (idx, ch) in doc.characters.iter().enumerate() {
        let card_type = ch.card_type.trim();
        let is_player = card_type == "player";
        let tags: Vec<String> = ch
            .tags
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        let first_messages: Vec<String> = if is_player {
            Vec::new()
        } else {
            ch.first_messages
                .iter()
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty())
                .collect()
        };
        let legacy_tags = if tags.is_empty() {
            None
        } else {
            Some(tags.join(", "))
        };
        let legacy_first = first_messages.first().cloned();
        let image_path = avatar_paths.get(&idx).cloned();

        let result = sqlx::query(
            "INSERT INTO character_cards (
                name, avatar_path, description, first_message, tags, card_type,
                created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(ch.name.trim())
        .bind(&image_path)
        .bind(ch.description.trim())
        .bind(&legacy_first)
        .bind(&legacy_tags)
        .bind(card_type)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        let character_id = result.last_insert_rowid();

        for (ti, tag) in tags.iter().enumerate() {
            sqlx::query(
                "INSERT INTO character_card_tags (character_id, tag, sort_order) VALUES (?, ?, ?)",
            )
            .bind(character_id)
            .bind(tag)
            .bind(ti as i64)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        for (si, sec) in ch.base_sections.iter().enumerate() {
            let content = sec.content.trim();
            if content.is_empty() {
                continue;
            }
            let title = sec.title.as_ref().map(|t| t.trim()).filter(|t| !t.is_empty());
            let sort_order = if sec.sort_order != 0 { sec.sort_order } else { si as i64 };
            sqlx::query(
                "INSERT INTO character_card_base_sections (
                    character_id, section_key, title, content, sort_order, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(character_id)
            .bind(sec.section_key.trim())
            .bind(title)
            .bind(content)
            .bind(sort_order)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        for (mi, message) in first_messages.iter().enumerate() {
            sqlx::query(
                "INSERT INTO character_card_openers (character_id, opener_text, sort_order, created_at) VALUES (?, ?, ?, ?)",
            )
            .bind(character_id)
            .bind(message)
            .bind(mi as i64)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;
        }

        report.characters += 1;
    }

    for book in &doc.world_books {
        let result = sqlx::query(
            "INSERT INTO world_books (title, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .bind(book.title.trim())
        .bind(book.description.as_ref().map(|d| d.trim()).filter(|d| !d.is_empty()))
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        let world_book_id = result.last_insert_rowid();

        for (ei, entry) in book.entries.iter().enumerate() {
            let title = entry.title.trim();
            if title.is_empty() {
                return Err(format!(
                    "世界书「{}」第 {} 条缺少标题",
                    book.title,
                    ei + 1
                ));
            }
            let keywords: Vec<String> = entry
                .keywords
                .iter()
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
                .collect();
            let sort_order = if entry.sort_order != 0 { entry.sort_order } else { ei as i64 };

            let entry_result = sqlx::query(
                "INSERT INTO world_book_entries (
                    world_book_id, title, content, trigger_mode, is_enabled, sort_order, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(world_book_id)
            .bind(title)
            .bind(entry.content.trim())
            .bind(entry.trigger_mode.trim())
            .bind(if entry.is_enabled { 1 } else { 0 })
            .bind(sort_order)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;
            let entry_id = entry_result.last_insert_rowid();

            for (ki, keyword) in keywords.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO world_book_entry_keywords (entry_id, keyword, sort_order) VALUES (?, ?, ?)",
                )
                .bind(entry_id)
                .bind(keyword)
                .bind(ki as i64)
                .execute(&mut *tx)
                .await
                .map_err(|err| err.to_string())?;
            }

            report.world_book_entries += 1;
        }

        report.world_books += 1;
    }

    tx.commit().await.map_err(|err| err.to_string())?;
    Ok(report)
}

// ---- 读取辅助 --------------------------------------------------------------

async fn load_tags(db: &sqlx::SqlitePool, character_id: i64) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT tag FROM character_card_tags WHERE character_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(character_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("tag").ok())
        .collect())
}

async fn load_base_sections(
    db: &sqlx::SqlitePool,
    character_id: i64,
) -> Result<Vec<ExchangeBaseSection>, String> {
    let rows = sqlx::query(
        "SELECT section_key, title, content, sort_order \
         FROM character_card_base_sections WHERE character_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(character_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| ExchangeBaseSection {
            section_key: row.try_get("section_key").unwrap_or_default(),
            title: row.try_get("title").ok(),
            content: row.try_get("content").unwrap_or_default(),
            sort_order: row.try_get("sort_order").unwrap_or_default(),
        })
        .collect())
}

async fn load_openers(db: &sqlx::SqlitePool, character_id: i64) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT opener_text FROM character_card_openers WHERE character_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(character_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("opener_text").ok())
        .collect())
}

async fn load_entry_keywords(
    db: &sqlx::SqlitePool,
    entry_id: i64,
) -> Result<Vec<String>, String> {
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

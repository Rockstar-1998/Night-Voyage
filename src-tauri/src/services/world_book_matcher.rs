use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum WorldBookTriggerSourceKind {
    CurrentUser,
    RecentHistory,
    CharacterStateOverlay,
}

impl WorldBookTriggerSourceKind {
    pub fn priority(&self) -> i32 {
        match self {
            Self::CurrentUser => 0,
            Self::RecentHistory => 1,
            Self::CharacterStateOverlay => 2,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CurrentUser => "current_user",
            Self::RecentHistory => "recent_history",
            Self::CharacterStateOverlay => "character_state_overlay",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorldBookTriggerSource {
    pub kind: WorldBookTriggerSourceKind,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TriggeredWorldBookEntry {
    pub world_book_id: i64,
    pub entry_id: i64,
    pub title: String,
    pub content: String,
    pub sort_order: i64,
    pub trigger_source_kind: WorldBookTriggerSourceKind,
}

pub async fn load_triggered_world_book_entries(
    db: &SqlitePool,
    world_book_id: i64,
    trigger_sources: &[WorldBookTriggerSource],
) -> Result<Vec<TriggeredWorldBookEntry>, String> {
    let normalized_sources = trigger_sources
        .iter()
        .filter_map(|source| {
            let normalized = source.text.trim().to_lowercase();
            if normalized.is_empty() {
                None
            } else {
                Some((source.kind, normalized))
            }
        })
        .collect::<Vec<_>>();

    if normalized_sources.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query(
        "SELECT id, title, content, trigger_mode, sort_order \
         FROM world_book_entries \
         WHERE world_book_id = ? AND is_enabled = 1 \
         ORDER BY sort_order ASC, id ASC",
    )
    .bind(world_book_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let mut results = Vec::new();

    for row in rows {
        let entry_id: i64 = row.try_get("id").map_err(|err| err.to_string())?;
        let title: String = row.try_get("title").unwrap_or_default();
        let content: String = row.try_get("content").unwrap_or_default();
        let sort_order: i64 = row.try_get("sort_order").unwrap_or_default();
        let trigger_mode: String = row
            .try_get("trigger_mode")
            .unwrap_or_else(|_| "any".to_string());

        let keywords = load_keywords(db, entry_id).await?;
        let matched_source_kind = normalized_sources
            .iter()
            .filter_map(|(kind, normalized_text)| {
                if world_book_entry_matches(normalized_text, &keywords, &trigger_mode) {
                    Some(*kind)
                } else {
                    None
                }
            })
            .min_by_key(|kind| kind.priority());

        if let Some(trigger_source_kind) = matched_source_kind {
            results.push(TriggeredWorldBookEntry {
                world_book_id,
                entry_id,
                title,
                content,
                sort_order,
                trigger_source_kind,
            });
        }
    }

    results.sort_by_key(|entry| {
        (
            entry.trigger_source_kind.priority(),
            entry.sort_order,
            entry.entry_id,
        )
    });

    Ok(results)
}

async fn load_keywords(db: &SqlitePool, entry_id: i64) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT keyword FROM world_book_entry_keywords \
         WHERE entry_id = ? \
         ORDER BY sort_order ASC, id ASC",
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

fn world_book_entry_matches(context_text: &str, keywords: &[String], trigger_mode: &str) -> bool {
    let normalized_keywords = keywords
        .iter()
        .map(|keyword| keyword.trim().to_lowercase())
        .filter(|keyword| !keyword.is_empty())
        .collect::<Vec<_>>();

    if normalized_keywords.is_empty() {
        return false;
    }

    match trigger_mode {
        "all" => normalized_keywords
            .iter()
            .all(|keyword| context_text.contains(keyword)),
        _ => normalized_keywords
            .iter()
            .any(|keyword| context_text.contains(keyword)),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        load_triggered_world_book_entries, WorldBookTriggerSource, WorldBookTriggerSourceKind,
    };
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    fn run_async_test<F>(test: F)
    where
        F: std::future::Future<Output = ()>,
    {
        tauri::async_runtime::block_on(test);
    }

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create sqlite");

        sqlx::query(
            "CREATE TABLE world_book_entries (
                id INTEGER PRIMARY KEY,
                world_book_id INTEGER,
                title TEXT,
                content TEXT,
                trigger_mode TEXT,
                is_enabled INTEGER,
                sort_order INTEGER
             )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE world_book_entry_keywords (
                id INTEGER PRIMARY KEY,
                entry_id INTEGER,
                keyword TEXT,
                sort_order INTEGER
             )",
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[test]
    fn matcher_supports_any_and_all_modes() {
        run_async_test(async {
            let pool = setup_test_db().await;

            sqlx::query(
                "INSERT INTO world_book_entries (
                    id, world_book_id, title, content, trigger_mode, is_enabled, sort_order
                 ) VALUES
                    (1, 10, '酒馆', '酒馆设定', 'any', 1, 0),
                    (2, 10, '密语', '密语设定', 'all', 1, 1)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO world_book_entry_keywords (id, entry_id, keyword, sort_order) VALUES
                    (1, 1, '酒馆', 0),
                    (2, 2, '暗号', 0),
                    (3, 2, '门', 1)",
            )
            .execute(&pool)
            .await
            .unwrap();

            let entries = load_triggered_world_book_entries(
                &pool,
                10,
                &[WorldBookTriggerSource {
                    kind: WorldBookTriggerSourceKind::CurrentUser,
                    text: "我们先去酒馆，再看门上的暗号".to_string(),
                }],
            )
            .await
            .unwrap();

            assert_eq!(entries.len(), 2);
            assert_eq!(entries[0].entry_id, 1);
            assert_eq!(entries[1].entry_id, 2);
        });
    }

    #[test]
    fn matcher_prefers_stronger_trigger_source_when_multiple_sources_match_same_entry() {
        run_async_test(async {
            let pool = setup_test_db().await;

            sqlx::query(
                "INSERT INTO world_book_entries (
                    id, world_book_id, title, content, trigger_mode, is_enabled, sort_order
                 ) VALUES (1, 10, '黑港', '黑港设定', 'any', 1, 0)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO world_book_entry_keywords (id, entry_id, keyword, sort_order) VALUES
                    (1, 1, '黑港', 0)",
            )
            .execute(&pool)
            .await
            .unwrap();

            let entries = load_triggered_world_book_entries(
                &pool,
                10,
                &[
                    WorldBookTriggerSource {
                        kind: WorldBookTriggerSourceKind::RecentHistory,
                        text: "我们已经抵达黑港。".to_string(),
                    },
                    WorldBookTriggerSource {
                        kind: WorldBookTriggerSourceKind::CurrentUser,
                        text: "我走进黑港的码头。".to_string(),
                    },
                ],
            )
            .await
            .unwrap();

            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].entry_id, 1);
            assert_eq!(
                entries[0].trigger_source_kind,
                WorldBookTriggerSourceKind::CurrentUser
            );
        });
    }

    #[test]
    fn matcher_sorts_current_user_before_recent_history_before_overlay() {
        run_async_test(async {
            let pool = setup_test_db().await;

            sqlx::query(
                "INSERT INTO world_book_entries (
                    id, world_book_id, title, content, trigger_mode, is_enabled, sort_order
                 ) VALUES
                    (1, 10, '近史命中', 'A', 'any', 1, 2),
                    (2, 10, '当前轮命中', 'B', 'any', 1, 1),
                    (3, 10, '状态命中', 'C', 'any', 1, 0)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO world_book_entry_keywords (id, entry_id, keyword, sort_order) VALUES
                    (1, 1, '近史词', 0),
                    (2, 2, '当前词', 0),
                    (3, 3, '状态词', 0)",
            )
            .execute(&pool)
            .await
            .unwrap();

            let entries = load_triggered_world_book_entries(
                &pool,
                10,
                &[
                    WorldBookTriggerSource {
                        kind: WorldBookTriggerSourceKind::CharacterStateOverlay,
                        text: "状态词".to_string(),
                    },
                    WorldBookTriggerSource {
                        kind: WorldBookTriggerSourceKind::RecentHistory,
                        text: "近史词".to_string(),
                    },
                    WorldBookTriggerSource {
                        kind: WorldBookTriggerSourceKind::CurrentUser,
                        text: "当前词".to_string(),
                    },
                ],
            )
            .await
            .unwrap();

            assert_eq!(entries.len(), 3);
            assert_eq!(entries[0].entry_id, 2);
            assert_eq!(entries[1].entry_id, 1);
            assert_eq!(entries[2].entry_id, 3);
        });
    }
}

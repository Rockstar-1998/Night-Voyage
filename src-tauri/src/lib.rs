use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

mod commands;
mod db;
mod llm;
mod models;
mod network;
mod repositories;
mod services;
mod utils;
mod validators;

pub struct AppState {
    pub db: SqlitePool,
    pub host_server: Mutex<Option<Arc<Mutex<network::RoomServer>>>>,
    pub room_client: Mutex<Option<Arc<Mutex<network::RoomClient>>>>,
    /// Per-embedding-provider memory backend cache, keyed by
    /// `embedding_provider_id`. Services are constructed lazily on first use
    /// via `memory_providers::get_or_build_memory_service`. An empty map
    /// means no conversation has triggered construction yet, not that mem0
    /// is disabled — callers must report build errors rather than silently
    /// degrading.
    pub memory_service:
        Mutex<HashMap<i64, Arc<dyn services::memory_service::MemoryService>>>,
    /// Records why mem0 is unavailable. Always `None` under lazy
    /// construction (errors are reported per-conversation at build time);
    /// retained for API compatibility with `mem0_init_status`.
    pub mem0_init_error: Option<String>,
}

#[tauri::command]
async fn show_window(window: tauri::Window) {
    window.show().unwrap();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let pool = tauri::async_runtime::block_on(db::init_pool(&app_handle))?;

            // Memory backend is constructed lazily per-conversation based on
            // its `embedding_provider_id`. The cache starts empty; services
            // are built on first use via `get_or_build_memory_service`.
            // Build errors surface per-conversation rather than at startup.
            app.manage(AppState {
                db: pool.clone(),
                host_server: Mutex::new(None),
                room_client: Mutex::new(None),
                memory_service: Mutex::new(HashMap::new()),
                mem0_init_error: None,
            });

            let cleanup_pool = pool.clone();
            tauri::async_runtime::spawn(async move {
                db::cleanup_stale_rooms(&cleanup_pool).await;
            });

            Ok(())
        })
        .on_page_load(|webview, payload| {
            use tauri::webview::PageLoadEvent;
            if payload.event() == PageLoadEvent::Finished {
                let window = webview.window();
                let _ = window.show();
                dbg_eprintln!("[startup] page-load-finished: window shown");
            }
        })
        .invoke_handler(tauri::generate_handler![
            show_window,
            commands::assets::assets_import_image,
            commands::assets::assets_import_image_bytes,
            commands::providers::providers_list,
            commands::providers::providers_create,
            commands::providers::providers_update,
            commands::providers::providers_delete,
            commands::providers::providers_test,
            commands::providers::providers_test_claude_native,
            commands::providers::providers_fetch_models,
            commands::providers::providers_count_tokens,
            commands::conversations::conversations_list,
            commands::conversations::conversations_create,
            commands::conversations::conversations_update_bindings,
            commands::conversations::conversations_rename,
            commands::conversations::conversations_delete,
            commands::conversations::conversation_members_list,
            commands::conversations::conversation_members_create,
            commands::conversations::conversation_members_update,
            commands::conversations::conversation_members_delete,
            commands::conversations::conversations_fork,
            commands::blueprint::update_preset_gate_selection,
            commands::blueprint::load_preset_gate_selections,
            commands::blueprint::clear_preset_gate_selection,
            commands::blueprint::load_blueprint_gates,
            commands::blueprint::normalize_blueprint_graph,
            commands::plot_summaries::plot_summaries_list,
            commands::plot_summaries::plot_summaries_get_pending,
            commands::plot_summaries::plot_summaries_upsert_manual,
            commands::plot_summaries::plot_summaries_update_mode,
            commands::presets::presets_list,
            commands::presets::presets_get,
            commands::presets::presets_export,
            commands::presets::presets_import,
            commands::presets::presets_create,
            commands::presets::presets_update,
            commands::presets::presets_delete,
            commands::presets::presets_rename,
            commands::presets::presets_duplicate,
            commands::chat::messages_list,
            commands::chat::send_message,
            commands::chat::chat_submit_input,
            commands::chat::regenerate_message,
            commands::chat::chat_regenerate_round,
            commands::chat::chat_submit_tool_result,
            commands::chat::round_state_get,
            commands::chat::messages_switch_swipe,
            commands::chat::messages_update_content,
            commands::chat::messages_delete,
            commands::chat::abort_round_stream,
            commands::chat::retry_failed_round,
            commands::chat::get_conversation_token_usage,
            commands::chat::update_conversation_context_window,
            commands::chat::rewind_to_round,
            commands::chat::resolve_conversation_mode,
            commands::characters::character_cards_list,
            commands::characters::character_cards_create,
            commands::characters::character_cards_update,
            commands::characters::character_cards_delete,
            commands::characters::character_card_export_image,
            commands::world_books::world_books_list,
            commands::world_books::world_books_create,
            commands::world_books::world_books_update,
            commands::world_books::world_books_delete,
            commands::world_books::world_book_entries_list,
            commands::world_books::world_book_entries_upsert,
            commands::world_books::world_book_entries_delete,
            commands::exchange::character_cards_export,
            commands::exchange::world_books_export,
            commands::exchange::exchange_import,
            commands::rooms::room_create,
            commands::rooms::room_open,
            commands::rooms::room_update_port,
            commands::rooms::room_get_status,
            commands::rooms::room_join,
            commands::rooms::room_leave,
            commands::rooms::room_close,
            commands::rooms::room_send_message,
            commands::rooms::room_broadcast_round_state,
            commands::rooms::room_broadcast_schema_toggle,
            commands::rooms::room_broadcast_token_usage,
            commands::rooms::room_broadcast_plot_summary,
            commands::rooms::room_update_guest_character,
            commands::rooms::room_request_context,
            commands::rooms::room_save_guest_history,
            commands::rooms::room_get_guest_history,
            commands::settings::app_info,
            commands::settings::settings_get_all,
            commands::settings::settings_set,
            commands::mem0::mem0_status,
            commands::mem0::memory_mode_set,
            commands::mem0::mem0_set_enabled,
            commands::mem0::mem0_search_test,
            commands::mem0::mem0_list_memories,
            commands::mem0::mem0_delete_memory,
            commands::mem0::mem0_delete_all,
            commands::mem0_snapshot::mem0_snapshot_list,
            commands::mem0_snapshot::mem0_snapshot_window_set,
            commands::mem0::mem0_init_status,
            commands::utils::format_timestamp,
            commands::utils::format_timestamps
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

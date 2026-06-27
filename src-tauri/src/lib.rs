use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

mod backdoor;
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
    /// Optional memory backend. Lazily initialized: providers may not exist at
    /// startup and mem0 init can fail without aborting the app. `None` means the
    /// feature is unavailable; callers degrade gracefully instead of erroring.
    pub memory_service:
        Mutex<Option<Arc<dyn services::memory_service::MemoryService>>>,
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

            // Best-effort memory backend init. Failure here (no provider yet,
            // mem0 misconfiguration) must not panic — the feature is optional
            // and degrades to `None`. It can be (re)built later on demand.
            let memory_service = tauri::async_runtime::block_on(
                services::memory_providers::build_memory_service(&pool),
            )
            .map_err(|err| {
                eprintln!("[startup] memory service unavailable: {err}");
                err
            })
            .ok();

            app.manage(AppState {
                db: pool.clone(),
                host_server: Mutex::new(None),
                room_client: Mutex::new(None),
                memory_service: Mutex::new(memory_service),
            });

            backdoor::start_backdoor_server(pool, app.handle().clone());

            Ok(())
        })
        .on_page_load(|webview, payload| {
            use tauri::webview::PageLoadEvent;
            if payload.event() == PageLoadEvent::Finished {
                let window = webview.window();
                let _ = window.show();
                eprintln!("[startup] page-load-finished: window shown");
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
            commands::characters::character_cards_list,
            commands::characters::character_cards_create,
            commands::characters::character_cards_update,
            commands::characters::character_cards_delete,
            commands::world_books::world_books_list,
            commands::world_books::world_books_create,
            commands::world_books::world_books_update,
            commands::world_books::world_books_delete,
            commands::world_books::world_book_entries_list,
            commands::world_books::world_book_entries_upsert,
            commands::world_books::world_book_entries_delete,
            commands::rooms::room_create,
            commands::rooms::room_join,
            commands::rooms::room_leave,
            commands::rooms::room_close,
            commands::rooms::room_send_message,
            commands::rooms::room_broadcast_stream_chunk,
            commands::rooms::room_broadcast_round_state,
            commands::settings::app_info,
            commands::settings::settings_get_all,
            commands::settings::settings_set,
            commands::mem0::mem0_status,
            commands::mem0::mem0_set_enabled,
            commands::mem0::mem0_search_test,
            commands::mem0::mem0_list_memories,
            commands::mem0::mem0_delete_memory,
            commands::mem0::mem0_delete_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

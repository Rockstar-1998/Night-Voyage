// character_state_overlays removed (migration 0036): table dropped,
// WorldVariable merged into message_rounds.world_variables.
pub mod chat;
pub mod chat_service;
/// Isolated debug log macros — see module docs for cleanup procedure.
pub mod debug_log;
pub mod http_client;
pub mod mem0_snapshot;
pub mod memory_providers;
pub mod memory_service;
pub mod plot_summaries;
pub mod preset_service;
pub mod prompt_compiler;
pub mod provider_adapter;
pub mod stream_processor;
pub mod structured_output_parser;
pub mod world_book_matcher;

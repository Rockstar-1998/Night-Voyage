// ============================================================================
// ISOLATED DEBUG COMMAND FOR FRONTEND LOG FORWARDING — SCHEDULED FOR REMOVAL
// ============================================================================
//
// 前端 console.log 在 Tauri release 构建中默认不输出到后端 stderr。
// 此 command 接收前端 debug 日志，通过 `dbg_eprintln!` 输出到后端 stderr，
// 让前端日志能在后端日志中直接查看。
//
// 清理步骤：删除本文件，从 commands/mod.rs 移除 `pub mod debug;`，
// 从 lib.rs 的 invoke_handler! 移除 `commands::debug::debug_log_frontend,`。
// ============================================================================

use crate::dbg_eprintln;

#[tauri::command]
pub async fn debug_log_frontend(message: String) -> Result<(), String> {
    dbg_eprintln!("{}", message);
    Ok(())
}

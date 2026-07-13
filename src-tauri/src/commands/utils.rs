//! Pure-formatting Tauri commands shared by both PC and mobile frontends.
//!
//! Backed by `chrono::Local` so output respects the host machine timezone,
//! matching the legacy JS `Date.toLocaleString` behavior in the WebView.

use chrono::{Datelike, Local, TimeZone, Timelike};

/// Format a Unix timestamp (in seconds) as a localized short date-time
/// string.
///
/// Mirrors the legacy JS helper
/// ```ignore
/// new Date(timestamp * 1000).toLocaleString('zh-CN', {
///     month: '2-digit', day: '2-digit',
///     hour: '2-digit', minute: '2-digit',
/// })
/// ```
///
/// Output shape is `MM/DD HH:mm` in the host's local timezone. Returning a
/// `Result` rather than panicking keeps callers compliant with the C2
/// zero-fallback rule: an invalid timestamp surfaces as an explicit error.
#[tauri::command]
pub fn format_timestamp(timestamp: i64) -> Result<String, String> {
    let dt = Local
        .timestamp_opt(timestamp, 0)
        .single()
        .ok_or_else(|| format!("invalid timestamp: {}", timestamp))?;
    Ok(format!(
        "{:02}/{:02} {:02}:{:02}",
        dt.month(),
        dt.day(),
        dt.hour(),
        dt.minute()
    ))
}

/// Batch version of [`format_timestamp`]. Returns one formatted string per
/// input timestamp, preserving order. Designed for list rendering (e.g.
/// session lists) where invoking per-item would multiply IPC overhead.
#[tauri::command]
pub fn format_timestamps(timestamps: Vec<i64>) -> Result<Vec<String>, String> {
    timestamps.iter().map(|&ts| format_timestamp(ts)).collect()
}

import { invokeCommand } from './internal';

/**
 * Format a Unix timestamp (seconds) as a localized short date-time string.
 *
 * Wraps the Rust `format_timestamp` Tauri command. Output shape mirrors the
 * legacy JS `Date.toLocaleString('zh-CN', { month, day, hour, minute })`
 * helper: `MM/DD HH:mm` in the host's local timezone.
 *
 * Per C1 (frontend render-only), timestamp formatting lives in the Rust
 * backend; this wrapper only forwards the IPC call.
 */
export async function formatTimestamp(timestamp: number): Promise<string> {
  return invokeCommand<string>('format_timestamp', { timestamp });
}

/**
 * Batch version of {@link formatTimestamp}. Returns one formatted string
 * per input timestamp, preserving order. Use this when formatting a list of
 * timestamps (e.g. session lists) to avoid multiplying IPC round-trips.
 */
export async function formatTimestamps(timestamps: number[]): Promise<string[]> {
  return invokeCommand<string[]>('format_timestamps', { timestamps });
}

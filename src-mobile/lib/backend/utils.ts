import { invoke } from '@tauri-apps/api/core';

/**
 * Format a Unix timestamp (seconds) as a localized short date-time string.
 *
 * Wraps the Rust `format_timestamp` Tauri command. Output shape mirrors the
 * legacy JS `Date.toLocaleString('zh-CN', { month, day, hour, minute })`
 * helper: `MM/DD HH:mm` in the host's local timezone.
 *
 * Independent of the PC-side `src/lib/backend` wrapper per C5 (Mobile Frontend
 * Independence). Both wrappers call the same shared Rust command — only the
 * TypeScript glue is duplicated.
 */
export async function formatTimestamp(timestamp: number): Promise<string> {
  return invoke<string>('format_timestamp', { timestamp });
}

/**
 * Batch version of {@link formatTimestamp}. Returns one formatted string
 * per input timestamp, preserving order. Use this when formatting a list of
 * timestamps (e.g. session lists) to avoid multiplying IPC round-trips.
 */
export async function formatTimestamps(timestamps: number[]): Promise<string[]> {
  return invoke<string[]>('format_timestamps', { timestamps });
}

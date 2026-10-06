pub mod port;

use std::time::{SystemTime, UNIX_EPOCH};

/// 毫秒级 Unix 时间戳（时序泳道"毫秒级回放"用）。
pub fn now_ts_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

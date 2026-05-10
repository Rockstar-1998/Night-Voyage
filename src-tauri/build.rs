use std::time::{SystemTime, UNIX_EPOCH};

fn unix_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn main() {
    let ts = unix_ts();
    println!("cargo:warning=[Night Voyage][build.rs] enter ts={ts}");
    tauri_build::build();
    println!(
        "cargo:warning=[Night Voyage][build.rs] exit ts={}",
        unix_ts()
    );
}

mod handlers;

use sqlx::SqlitePool;
use tauri::AppHandle;

#[derive(Clone)]
pub struct BackdoorState {
    pub db: SqlitePool,
    pub app: AppHandle,
    pub startup_time: std::time::Instant,
}

pub fn start_backdoor_server(db: SqlitePool, app: AppHandle) {
    if cfg!(debug_assertions) {
        spawn_backdoor(db, app, 17530);
        return;
    }

    if let Ok(port_str) = std::env::var("NIGHT_VOYAGE_BACKDOOR_PORT") {
        if let Ok(port) = port_str.parse::<u16>() {
            spawn_backdoor(db, app, port);
            return;
        }
    }
}

fn spawn_backdoor(db: SqlitePool, app: AppHandle, port: u16) {
    let state = BackdoorState {
        db,
        app,
        startup_time: std::time::Instant::now(),
    };

    let router = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_handler))
        .route(
            "/backdoor/providers",
            axum::routing::get(handlers::providers_handler),
        )
        .route(
            "/backdoor/chat-test",
            axum::routing::post(handlers::chat_test_handler),
        )
        .route("/backdoor/gc", axum::routing::post(handlers::gc_handler))
        .with_state(state);

    let addr = format!("127.0.0.1:{}", port);

    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind(&addr).await {
            Ok(listener) => {
                eprintln!("[backdoor] listening on {}", addr);
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("[backdoor] server error: {}", e);
                }
            }
            Err(e) => {
                eprintln!("[backdoor] failed to bind {}: {}", addr, e);
            }
        }
    });
}

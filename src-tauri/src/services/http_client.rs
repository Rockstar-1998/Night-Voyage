use std::sync::OnceLock;

use reqwest::Client;

static SHARED_CLIENT: OnceLock<Client> = OnceLock::new();
static SHARED_PERMISSIVE_CLIENT: OnceLock<Client> = OnceLock::new();

pub fn shared_http_client() -> &'static Client {
    SHARED_CLIENT.get_or_init(|| {
        Client::builder()
            .build()
            .expect("failed to build shared HTTP client")
    })
}

pub fn shared_permissive_http_client() -> &'static Client {
    SHARED_PERMISSIVE_CLIENT.get_or_init(|| {
        Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .expect("failed to build shared permissive HTTP client")
    })
}

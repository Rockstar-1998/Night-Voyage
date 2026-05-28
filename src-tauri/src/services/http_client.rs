use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;

static SHARED_CLIENT: OnceLock<Client> = OnceLock::new();
static SHARED_PERMISSIVE_CLIENT: OnceLock<Client> = OnceLock::new();

const HTTP_TIMEOUT_SECS: u64 = 300;

pub fn shared_http_client() -> &'static Client {
    SHARED_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
            .no_proxy()
            .build()
            .expect("failed to build shared HTTP client")
    })
}

pub fn shared_permissive_http_client() -> &'static Client {
    SHARED_PERMISSIVE_CLIENT.get_or_init(|| {
        Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
            .no_proxy()
            .build()
            .expect("failed to build shared permissive HTTP client")
    })
}

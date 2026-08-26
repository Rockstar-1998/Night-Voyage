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
            // 尊重系统/环境变量代理（HTTPS_PROXY/HTTP_PROXY 及 Windows 系统代理）。
            // 否则国际端点（如 integrate.api.nvidia.com）在需要代理的网络下会直接 connection error。
            // 未配置代理时此设置等价于无代理，无副作用。
            .build()
            .expect("failed to build shared HTTP client")
    })
}

pub fn shared_permissive_http_client() -> &'static Client {
    SHARED_PERMISSIVE_CLIENT.get_or_init(|| {
        Client::builder()
            .danger_accept_invalid_certs(true)
            // LLM 流式响应可能耗时极长（本地大模型预填充 + 长生成可达数十分钟），
            // 整体请求超时会在合法生成中途中断响应，因此将整体超时设为一小时。
            // 通过 read_timeout 检测真正僵死的连接：若连续 10 分钟未收到任何字节，
            // 才视为连接已死并报错。该客户端仅用于 LLM/provider 稀疏调用，
            // 故长超时不会阻塞其它非 LLM 请求（那些请求使用 shared_http_client）。
            .timeout(Duration::from_secs(3600))
            .read_timeout(Duration::from_secs(600))
            // 尊重系统/环境变量代理：国际端点（NVIDIA 等）在需代理的网络下，无代理会被 connection error 阻断。
            // 未配置代理时此设置无副作用。
            // 禁用 keep-alive 空闲池：每次请求强制新建连接并重新 TLS 握手。
            // 原因：Akamai/NVIDIA 边缘对空闲连接超时关得很快，reqwest 池会复用已死连接，
            // 发请求阶段才暴露 `connection error`（见 2026-08-21 NVIDIA 自定义 provider 报错）。
            // 代价：每次请求多一次亚秒级握手。普通聊天稀疏调用可接受。
            // ⚠️ 约束：未来的 agent 模式（密集串行 LLM 调用）不得使用此客户端/此线路——
            // 密集模式应改为「保留池 + 传输层对 connection error 重试一次」，否则每步都握手会累积明显延迟。
            .pool_max_idle_per_host(0)
            .build()
            .expect("failed to build shared permissive HTTP client")
    })
}

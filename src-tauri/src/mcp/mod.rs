//! 开发期 MCP（Model Context Protocol）端点。
//!
//! 由运行中的 Tauri 后端在回环地址上监听 HTTP，把真实后端能力（SQLite 会话状态、
//! ToolCall 契约执行、HUD 增量广播）暴露为 MCP 工具。形态与机器上既有的
//! `claireon`（UE 编辑器）与 `unity` 一致：GUI 应用自监听本地 MCP 端点。
//!
//! 定位是开发期诊断通道，不是产品功能：
//! - 调用方在 `lib.rs` 以 `cfg(all(desktop, debug_assertions))` 引入，发行版与
//!   Android 构建经 cfg 剥离，产物中不含本模块任何代码；
//! - 仅绑定 `127.0.0.1`，并要求 `X-NV-Token` 请求头；
//! - 监听失败只记录日志，不阻断应用启动——MCP 不是产品启动前提。
//!
//! 设计细节与约束合规见 `.trae/specs/nv-mcp-dev-endpoint/spec.md`。

mod protocol;
mod tools;

use std::convert::Infallible;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderValue, CONTENT_TYPE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::AppHandle;
use tokio::net::TcpListener;

use crate::dbg_eprintln;
use protocol::{codes, JsonRpcRequest};
use tools::ToolContext;

/// 端点监听端口。避开 claireon 的 55286 与 unity 的 8080。
const MCP_PORT: u16 = 55287;

/// 鉴权令牌落盘路径（C6：统一落在 `D:\software_cache`，不写系统盘）。
const TOKEN_FILE: &str = "D:\\software_cache\\night-voyage-mcp.token";

/// 鉴权请求头（HTTP 头名不区分大小写，hyper 会按小写比较）。
const TOKEN_HEADER: &str = "x-nv-token";

/// 客户端未声明协议版本时使用的默认版本。
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

/// 监听循环在 accept 出错后的退避时长，避免错误持续时忙转。
const ACCEPT_BACKOFF: Duration = Duration::from_millis(200);

/// 启动开发期 MCP 端点。
///
/// 令牌初始化或端口绑定失败时，以 `dbg_eprintln!` 显式报告并返回，不 panic、不阻断应用。
pub async fn start(app: AppHandle, db: SqlitePool) {
    let token = match load_or_create_token() {
        Ok(token) => token,
        Err(err) => {
            dbg_eprintln!("[mcp] 令牌初始化失败，端点未启动: {}", err);
            return;
        }
    };

    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, MCP_PORT));
    let listener = match TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => {
            dbg_eprintln!("[mcp] 绑定 {} 失败，端点未启动: {}", addr, err);
            return;
        }
    };

    dbg_eprintln!(
        "[mcp] dev endpoint listening on http://{}/mcp（令牌文件 {}）",
        addr,
        TOKEN_FILE
    );

    let ctx = ToolContext { app, db };
    let token = Arc::new(token);

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(err) => {
                dbg_eprintln!("[mcp] accept 失败: {}", err);
                tokio::time::sleep(ACCEPT_BACKOFF).await;
                continue;
            }
        };

        let ctx = ctx.clone();
        let token = Arc::clone(&token);

        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let service = service_fn(move |req: Request<Incoming>| {
                let ctx = ctx.clone();
                let token = Arc::clone(&token);
                async move { Ok::<_, Infallible>(handle(req, ctx, token).await) }
            });

            if let Err(err) = http1::Builder::new().serve_connection(io, service).await {
                dbg_eprintln!("[mcp] 处理来自 {} 的连接失败: {}", peer, err);
            }
        });
    }
}

/// 读取已有令牌；不存在或为空时生成并落盘，保证令牌跨重启稳定。
fn load_or_create_token() -> Result<String, String> {
    let path = Path::new(TOKEN_FILE);

    if let Ok(existing) = std::fs::read_to_string(path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!("创建令牌目录 {} 失败: {}", parent.to_string_lossy().replace('\\', "/"), err)
        })?;
    }

    let token = derive_token();
    std::fs::write(path, &token).map_err(|err| {
        format!("写入令牌文件 {} 失败: {}", TOKEN_FILE.replace('\\', "/"), err)
    })?;
    Ok(token)
}

/// 派生 32 位十六进制令牌。
///
/// 使用标准库的 `RandomState` 作为种子源（由操作系统随机源初始化）。这不是密码学
/// 强度的随机源，用途也仅限于阻止同机无关进程误用回环端点。
fn derive_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let mut first = RandomState::new().build_hasher();
    first.write_u64(u64::from(std::process::id()));
    let low = first.finish();

    let mut second = RandomState::new().build_hasher();
    second.write_u64(low);
    second.write_u64(u64::from(std::process::id()).rotate_left(32));
    let high = second.finish();

    format!("{high:016x}{low:016x}")
}

/// 处理单个 HTTP 请求。
async fn handle(request: Request<Incoming>, ctx: ToolContext, token: Arc<String>) -> Response<Full<Bytes>> {
    if request.method() != Method::POST || request.uri().path() != "/mcp" {
        return json_response(
            StatusCode::METHOD_NOT_ALLOWED,
            &protocol::error(
                Value::Null,
                codes::INVALID_REQUEST,
                format!(
                    "本端点仅接受 POST /mcp（收到 {} {}）",
                    request.method(),
                    request.uri().path()
                ),
            ),
        );
    }

    let presented = request
        .headers()
        .get(TOKEN_HEADER)
        .and_then(|value| value.to_str().ok());

    if presented != Some(token.as_str()) {
        return json_response(
            StatusCode::UNAUTHORIZED,
            &protocol::error(
                Value::Null,
                codes::UNAUTHORIZED,
                format!("请求头 {} 缺失或不匹配", TOKEN_HEADER),
            ),
        );
    }

    let body = match request.into_body().collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(err) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                &protocol::error(Value::Null, codes::INVALID_REQUEST, format!("读取请求体失败: {}", err)),
            );
        }
    };

    let request = match serde_json::from_slice::<JsonRpcRequest>(&body) {
        Ok(request) => request,
        Err(err) => {
            return json_response(
                StatusCode::OK,
                &protocol::error(
                    Value::Null,
                    codes::INVALID_REQUEST,
                    format!("载荷不是合法的单对象 JSON-RPC 请求（批量数组不受支持）: {}", err),
                ),
            );
        }
    };

    dispatch(request, &ctx).await
}

/// 按 JSON-RPC 方法分派；通知类请求不返回响应体。
async fn dispatch(request: JsonRpcRequest, ctx: &ToolContext) -> Response<Full<Bytes>> {
    let Some(id) = request.id.clone() else {
        // 通知（含 notifications/initialized）：按规范以 202 结束，无响应体。
        return empty_response(StatusCode::ACCEPTED);
    };

    let result = match request.method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": declared_protocol_version(request.params.as_ref()),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": {
                "name": "night-voyage-dev-mcp",
                "version": env!("CARGO_PKG_VERSION"),
            }
        })),
        "notifications/initialized" => Ok(json!({})),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::tool_listing() })),
        "tools/call" => call_tool(ctx, request.params.as_ref()).await,
        other => Err((
            codes::METHOD_NOT_FOUND,
            format!(
                "不支持的方法: {}（支持 initialize / notifications/initialized / ping / tools/list / tools/call）",
                other
            ),
        )),
    };

    match result {
        Ok(value) => json_response(StatusCode::OK, &protocol::success(id, value)),
        Err((code, message)) => {
            json_response(StatusCode::OK, &protocol::error(id, code, protocol::normalize_message(message)))
        }
    }
}

/// 执行 `tools/call`：解析参数、定位工具、调用处理器。
///
/// 工具处理器返回的 `Err` 不是协议层失败，而是**工具自身执行失败**，按 MCP 规范以
/// `isError: true` 的内容返回，原文透出，不做任何弱化。
async fn call_tool(ctx: &ToolContext, params: Option<&Value>) -> Result<Value, (i64, String)> {
    let params = params.ok_or((codes::INVALID_PARAMS, "tools/call 缺少 params".to_string()))?;

    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or((codes::INVALID_PARAMS, "tools/call 缺少字符串参数 name".to_string()))?;

    let empty = Value::Object(serde_json::Map::new());
    let args = params
        .get("arguments")
        .filter(|value| value.is_object())
        .unwrap_or(&empty);

    let tool = tools::find_tool(name).ok_or((
        codes::METHOD_NOT_FOUND,
        format!("未知工具: {}；可用工具: {}", name, tools::tool_names()),
    ))?;

    match tool.call(ctx, args).await {
        Ok(text) => Ok(json!({
            "content": [{ "type": "text", "text": text }],
            "isError": false,
        })),
        Err(err) => Ok(json!({
            "content": [{ "type": "text", "text": protocol::normalize_message(err) }],
            "isError": true,
        })),
    }
}

/// 回显客户端声明的协议版本；未声明时使用默认版本。
fn declared_protocol_version(params: Option<&Value>) -> String {
    params
        .and_then(|params| params.get("protocolVersion"))
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_PROTOCOL_VERSION)
        .to_string()
}

/// 构造 JSON 响应。序列化失败时返回显式错误体，不做静默空响应。
fn json_response(status: StatusCode, payload: &Value) -> Response<Full<Bytes>> {
    let body = match serde_json::to_vec(payload) {
        Ok(body) => body,
        Err(err) => {
            dbg_eprintln!("[mcp] 响应序列化失败: {}", err);
            r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"端点在序列化响应时失败"}}"#
                .as_bytes()
                .to_vec()
        }
    };

    let mut response = Response::new(Full::new(Bytes::from(body)));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

/// 构造空响应（用于通知与错误语义之外的无体状态码）。
fn empty_response(status: StatusCode) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::new()));
    *response.status_mut() = status;
    response
}

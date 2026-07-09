//! # Agent Preview Bridge
//!
//! A loopback MCP server (Streamable HTTP transport) that lets the AI agent
//! running in the workspace terminal use the live preview: read console
//! output and network requests, inspect the DOM, navigate, reload, and take
//! screenshots.
//!
//! Security model: the server binds 127.0.0.1 and only answers on the path
//! `/mcp/<token>` where the token is random per server instance. The full URL
//! (including the token) is handed to the agent CLI via `mcp add`, so the
//! agent never handles a credential — but a malicious webpage spraying
//! loopback ports can't guess the path, and any request carrying a browser
//! `Origin` header is rejected outright (MCP CLI clients never send one).
//!
//! Tool calls are not executed here: each `tools/call` is forwarded to the
//! window's frontend as an `agent-bridge-request` event, and the frontend
//! (which owns the inspect store and the preview iframe) answers via the
//! `agent_bridge_respond` command. This module only speaks MCP.

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

type ServerBody = BoxBody<Bytes, hyper::Error>;

fn full_body(data: Bytes) -> ServerBody {
    Full::new(data).map_err(|never| match never {}).boxed()
}

/// Maximum accepted request body (JSON-RPC messages are tiny; this is a
/// safety cap, not a tuning knob).
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

/// How long a forwarded tool call waits for the frontend before giving up.
const DEFAULT_TOOL_TIMEOUT_SECS: u64 = 20;
/// Screenshots go through Playwright; the first run may install a headless
/// Chromium, which takes minutes.
const SCREENSHOT_TOOL_TIMEOUT_SECS: u64 = 240;

/// MCP protocol revisions this server knows. We echo the client's requested
/// version when it's one of these; otherwise we answer with our latest.
const KNOWN_PROTOCOL_VERSIONS: &[&str] = &["2024-11-05", "2025-03-26", "2025-06-18"];
const LATEST_PROTOCOL_VERSION: &str = "2025-03-26";

/// A running bridge server for one workspace window.
struct BridgeInstance {
    port: u16,
    token: String,
    shutdown_tx: Option<oneshot::Sender<()>>,
    _task_handle: JoinHandle<()>,
}

/// window_label -> instance
static BRIDGE_INSTANCES: LazyLock<Mutex<HashMap<String, BridgeInstance>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// In-flight tool calls awaiting a frontend answer, keyed by request id.
static PENDING_REQUESTS: LazyLock<Mutex<HashMap<u64, oneshot::Sender<Value>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// Info returned to the frontend so it can register the server with the agent.
#[derive(serde::Serialize, Clone)]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
    pub url: String,
}

fn bridge_url(port: u16, token: &str) -> String {
    format!("http://127.0.0.1:{port}/mcp/{token}")
}

/// Start (or return the already-running) bridge server for a window.
pub async fn start_agent_bridge(
    app: tauri::AppHandle,
    window_label: String,
) -> Result<BridgeInfo, String> {
    // Idempotent: a window keeps one bridge for its whole life.
    if let Ok(instances) = BRIDGE_INSTANCES.lock() {
        if let Some(existing) = instances.get(&window_label) {
            return Ok(BridgeInfo {
                port: existing.port,
                token: existing.token.clone(),
                url: bridge_url(existing.port, &existing.token),
            });
        }
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind agent bridge port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get agent bridge address: {e}"))?
        .port();

    let token = uuid::Uuid::new_v4().simple().to_string();
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    let label_for_task = window_label.clone();
    let token_for_task = token.clone();
    let task_handle = tokio::spawn(async move {
        tracing::info!(
            "[AgentBridge] MCP server started on port {} for window '{}'",
            port,
            label_for_task
        );
        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, _addr)) => {
                            let app = app.clone();
                            let label = label_for_task.clone();
                            let token = token_for_task.clone();
                            tokio::spawn(async move {
                                let io = TokioIo::new(stream);
                                let service = service_fn(move |req: Request<Incoming>| {
                                    let app = app.clone();
                                    let label = label.clone();
                                    let token = token.clone();
                                    async move { handle_http(app, label, token, req).await }
                                });
                                if let Err(e) = http1::Builder::new().serve_connection(io, service).await {
                                    tracing::debug!("[AgentBridge] Connection error: {}", e);
                                }
                            });
                        }
                        Err(e) => tracing::error!("[AgentBridge] Accept error: {}", e),
                    }
                }
                _ = &mut shutdown_rx => {
                    tracing::info!("[AgentBridge] Shutting down on port {}", port);
                    break;
                }
            }
        }
    });

    let info = BridgeInfo {
        port,
        token: token.clone(),
        url: bridge_url(port, &token),
    };

    BRIDGE_INSTANCES
        .lock()
        .map_err(|e| format!("Failed to acquire agent bridge lock: {e}"))?
        .insert(
            window_label,
            BridgeInstance {
                port,
                token,
                shutdown_tx: Some(shutdown_tx),
                _task_handle: task_handle,
            },
        );

    Ok(info)
}

/// Stop the bridge for a window (called on window close).
pub fn stop_agent_bridge(window_label: &str) {
    if let Ok(mut instances) = BRIDGE_INSTANCES.lock() {
        if let Some(mut instance) = instances.remove(window_label) {
            if let Some(tx) = instance.shutdown_tx.take() {
                let _ = tx.send(());
            }
            tracing::info!(
                "[AgentBridge] Stopped bridge for window '{}' (port {})",
                window_label,
                instance.port
            );
        }
    }
}

/// Stop all bridges (app cleanup).
pub fn stop_all_agent_bridges() {
    if let Ok(mut instances) = BRIDGE_INSTANCES.lock() {
        for (label, mut instance) in instances.drain() {
            if let Some(tx) = instance.shutdown_tx.take() {
                let _ = tx.send(());
            }
            tracing::info!(
                "[AgentBridge] Stopped bridge for window '{}' (cleanup)",
                label
            );
        }
    }
}

/// Resolve an in-flight tool call with the frontend's answer.
/// Returns false when the request already timed out (or never existed).
pub fn resolve_bridge_request(request_id: u64, result: Value) -> bool {
    let sender = PENDING_REQUESTS
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&request_id));
    match sender {
        Some(tx) => tx.send(result).is_ok(),
        None => false,
    }
}

// ============================================================================
// HTTP layer
// ============================================================================

fn plain_response(status: StatusCode, body: &'static str) -> Response<ServerBody> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(full_body(Bytes::from(body)))
        .unwrap()
}

fn json_response(value: Value) -> Response<ServerBody> {
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(full_body(Bytes::from(value.to_string())))
        .unwrap()
}

/// Requests carrying a browser `Origin` header are cross-origin fetches from
/// a webpage — never an MCP CLI client. Reject them all: combined with the
/// random URL token this closes off CSRF and DNS-rebinding attacks.
fn is_browser_origin(req: &Request<Incoming>) -> bool {
    req.headers().get("origin").is_some()
}

/// The Host header must be loopback — a DNS-rebinding request arrives with
/// the attacker's hostname.
fn has_valid_host(req: &Request<Incoming>) -> bool {
    match req.headers().get("host").and_then(|h| h.to_str().ok()) {
        Some(host) => {
            let host = host.split(':').next().unwrap_or("");
            host == "127.0.0.1" || host == "localhost" || host == "[::1]"
        }
        // HTTP/1.1 requires Host; anything without it is not a real client.
        None => false,
    }
}

async fn handle_http(
    app: tauri::AppHandle,
    window_label: String,
    token: String,
    req: Request<Incoming>,
) -> Result<Response<ServerBody>, hyper::Error> {
    if is_browser_origin(&req) || !has_valid_host(&req) {
        tracing::warn!("[AgentBridge] Rejected request with browser Origin or foreign Host");
        return Ok(plain_response(StatusCode::FORBIDDEN, "Forbidden"));
    }

    let expected_path = format!("/mcp/{token}");
    if req.uri().path().trim_end_matches('/') != expected_path {
        return Ok(plain_response(StatusCode::NOT_FOUND, "Not found"));
    }

    match *req.method() {
        Method::POST => {
            let body = req.into_body().collect().await?.to_bytes();
            if body.len() > MAX_BODY_BYTES {
                return Ok(plain_response(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Payload too large",
                ));
            }
            let message: Value = match serde_json::from_slice(&body) {
                Ok(v) => v,
                Err(e) => {
                    return Ok(json_response(error_response(
                        Value::Null,
                        -32700,
                        &format!("Parse error: {e}"),
                    )))
                }
            };
            if message.is_array() {
                return Ok(json_response(error_response(
                    Value::Null,
                    -32600,
                    "Batch requests are not supported",
                )));
            }
            // JSON-RPC notification (no id): acknowledge without a body.
            if message.get("id").is_none_or(Value::is_null) {
                return Ok(Response::builder()
                    .status(StatusCode::ACCEPTED)
                    .body(full_body(Bytes::new()))
                    .unwrap());
            }
            let response = handle_rpc(&app, &window_label, &message).await;
            Ok(json_response(response))
        }
        // We don't offer a server-initiated SSE stream.
        Method::GET => Ok(plain_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        )),
        // Session termination is a no-op for this stateless server.
        Method::DELETE => Ok(plain_response(StatusCode::OK, "")),
        _ => Ok(plain_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        )),
    }
}

// ============================================================================
// JSON-RPC / MCP layer
// ============================================================================

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn success_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn initialize_result(params: Option<&Value>) -> Value {
    let requested = params
        .and_then(|p| p.get("protocolVersion"))
        .and_then(Value::as_str)
        .unwrap_or(LATEST_PROTOCOL_VERSION);
    let version = if KNOWN_PROTOCOL_VERSIONS.contains(&requested) {
        requested
    } else {
        LATEST_PROTOCOL_VERSION
    };
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": {} },
        "serverInfo": {
            "name": "ship-studio-preview",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "instructions": "Tools for the Ship Studio live preview of this project. After making code changes, use preview_console to check for runtime errors and preview_screenshot to see the rendered result. preview_navigate moves the preview the user is looking at, so tell them when you do it.",
    })
}

struct ToolDef {
    name: &'static str,
    description: &'static str,
    timeout_secs: u64,
    input_schema: fn() -> Value,
}

const TOOLS: &[ToolDef] = &[
    ToolDef {
        name: "preview_console",
        description: "Read recent console output (logs, warnings, errors, uncaught exceptions, unhandled rejections) captured from the Ship Studio live preview of this project. Use after making changes to check for runtime errors.",
        timeout_secs: DEFAULT_TOOL_TIMEOUT_SECS,
        input_schema: || json!({
            "type": "object",
            "properties": {
                "level": { "type": "string", "enum": ["all", "error", "warn"], "description": "Filter: 'error' = errors only, 'warn' = warnings and errors, 'all' (default) = everything." },
                "limit": { "type": "integer", "description": "Max entries, most recent first kept (default 50)." }
            }
        }),
    },
    ToolDef {
        name: "preview_network",
        description: "List recent network requests (fetch/XHR) made by the preview page, with method, status, and duration. Useful for spotting failing API calls.",
        timeout_secs: DEFAULT_TOOL_TIMEOUT_SECS,
        input_schema: || json!({
            "type": "object",
            "properties": {
                "failed_only": { "type": "boolean", "description": "Only requests that errored or returned status >= 400." },
                "limit": { "type": "integer", "description": "Max entries, most recent kept (default 50)." }
            }
        }),
    },
    ToolDef {
        name: "preview_dom",
        description: "Get a fresh serialized snapshot of the preview page's current DOM tree as an HTML outline. Use to verify what actually rendered.",
        timeout_secs: DEFAULT_TOOL_TIMEOUT_SECS,
        input_schema: || json!({ "type": "object", "properties": {} }),
    },
    ToolDef {
        name: "preview_navigate",
        description: "Navigate the live preview to a path within the app, e.g. '/about'. The user sees the preview change.",
        timeout_secs: DEFAULT_TOOL_TIMEOUT_SECS,
        input_schema: || json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute path within the app, starting with '/'." }
            },
            "required": ["path"]
        }),
    },
    ToolDef {
        name: "preview_reload",
        description: "Reload the current preview page.",
        timeout_secs: DEFAULT_TOOL_TIMEOUT_SECS,
        input_schema: || json!({ "type": "object", "properties": {} }),
    },
    ToolDef {
        name: "preview_screenshot",
        description: "Take a screenshot of the current preview page and return it as an image (also saved under .shipstudio/screenshots/). The first use may take a few minutes while a headless browser is installed.",
        timeout_secs: SCREENSHOT_TOOL_TIMEOUT_SECS,
        input_schema: || json!({
            "type": "object",
            "properties": {
                "full_page": { "type": "boolean", "description": "Capture the full scrollable page instead of just the viewport (slower)." }
            }
        }),
    },
];

fn tools_list_result() -> Value {
    let tools: Vec<Value> = TOOLS
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": (t.input_schema)(),
            })
        })
        .collect();
    json!({ "tools": tools })
}

async fn handle_rpc(app: &tauri::AppHandle, window_label: &str, message: &Value) -> Value {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let params = message.get("params");

    match method {
        "initialize" => success_response(id, initialize_result(params)),
        "ping" => success_response(id, json!({})),
        "tools/list" => success_response(id, tools_list_result()),
        "tools/call" => {
            let name = params
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let arguments = params
                .and_then(|p| p.get("arguments"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            match TOOLS.iter().find(|t| t.name == name) {
                Some(tool) => {
                    let result = dispatch_tool(app, window_label, tool, arguments).await;
                    success_response(id, result)
                }
                None => error_response(id, -32602, &format!("Unknown tool: {name}")),
            }
        }
        _ => error_response(id, -32601, &format!("Method not found: {method}")),
    }
}

/// Forward a tool call to the window's frontend and wait for its answer.
/// Failures come back as in-band tool errors (isError: true) rather than
/// protocol errors, so the agent can read what went wrong and adapt.
async fn dispatch_tool(
    app: &tauri::AppHandle,
    window_label: &str,
    tool: &ToolDef,
    arguments: Value,
) -> Value {
    let request_id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel::<Value>();

    if let Ok(mut pending) = PENDING_REQUESTS.lock() {
        pending.insert(request_id, tx);
    } else {
        return tool_error_result(
            "Ship Studio's agent bridge is in a broken state (lock poisoned). Restart Ship Studio.",
        );
    }

    let payload = json!({
        "requestId": request_id,
        "tool": tool.name,
        "arguments": arguments,
    });
    tracing::info!(
        "[AgentBridge] Tool call '{}' (request {}) for window '{}'",
        tool.name,
        request_id,
        window_label
    );

    if let Err(e) = app.emit_to(window_label, "agent-bridge-request", payload) {
        if let Ok(mut pending) = PENDING_REQUESTS.lock() {
            pending.remove(&request_id);
        }
        return tool_error_result(&format!(
            "Could not reach the Ship Studio preview window: {e}"
        ));
    }

    match tokio::time::timeout(Duration::from_secs(tool.timeout_secs), rx).await {
        Ok(Ok(result)) => {
            // The frontend answers with a full MCP CallToolResult. Guard the
            // shape so a bug there can't produce a protocol-corrupting reply.
            if result.get("content").map(Value::is_array).unwrap_or(false) {
                result
            } else {
                tool_error_result("The preview returned a malformed tool result (missing 'content'). This is a Ship Studio bug.")
            }
        }
        Ok(Err(_)) | Err(_) => {
            if let Ok(mut pending) = PENDING_REQUESTS.lock() {
                pending.remove(&request_id);
            }
            tool_error_result(&format!(
                "The preview did not respond within {}s. The preview panel may not be open in Ship Studio, or the dev server may not be running. Ask the user to open the preview.",
                tool.timeout_secs
            ))
        }
    }
}

fn tool_error_result(message: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_echoes_known_protocol_version() {
        let params = json!({ "protocolVersion": "2024-11-05" });
        let result = initialize_result(Some(&params));
        assert_eq!(result["protocolVersion"], "2024-11-05");
        assert_eq!(result["serverInfo"]["name"], "ship-studio-preview");
        assert!(result["capabilities"]["tools"].is_object());
    }

    #[test]
    fn test_initialize_falls_back_on_unknown_protocol_version() {
        let params = json!({ "protocolVersion": "1999-01-01" });
        let result = initialize_result(Some(&params));
        assert_eq!(result["protocolVersion"], LATEST_PROTOCOL_VERSION);
    }

    #[test]
    fn test_initialize_without_params() {
        let result = initialize_result(None);
        assert_eq!(result["protocolVersion"], LATEST_PROTOCOL_VERSION);
    }

    #[test]
    fn test_tools_list_contains_all_tools() {
        let result = tools_list_result();
        let tools = result["tools"].as_array().unwrap();
        assert_eq!(tools.len(), TOOLS.len());
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"preview_console"));
        assert!(names.contains(&"preview_screenshot"));
        assert!(names.contains(&"preview_navigate"));
        // Every tool must have a valid object schema.
        for tool in tools {
            assert_eq!(tool["inputSchema"]["type"], "object");
            assert!(!tool["description"].as_str().unwrap().is_empty());
        }
    }

    #[test]
    fn test_error_response_shape() {
        let resp = error_response(json!(7), -32601, "Method not found: nope");
        assert_eq!(resp["jsonrpc"], "2.0");
        assert_eq!(resp["id"], 7);
        assert_eq!(resp["error"]["code"], -32601);
    }

    #[test]
    fn test_resolve_unknown_request_returns_false() {
        assert!(!resolve_bridge_request(999_999, json!({})));
    }

    #[test]
    fn test_tool_error_result_is_in_band() {
        let result = tool_error_result("boom");
        assert_eq!(result["isError"], true);
        assert_eq!(result["content"][0]["type"], "text");
        assert_eq!(result["content"][0]["text"], "boom");
    }

    #[test]
    fn test_bridge_url_format() {
        assert_eq!(
            bridge_url(4123, "abc123"),
            "http://127.0.0.1:4123/mcp/abc123"
        );
    }
}

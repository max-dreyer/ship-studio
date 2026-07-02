//! # Preview Reverse Proxy
//!
//! A lightweight HTTP reverse proxy that sits between the preview iframe and the
//! dev server. It injects a navigation tracking script into HTML responses
//! so the parent window can detect when the user navigates within the iframe.
//!
//! Also transparently forwards WebSocket upgrades (for HMR) and streams
//! non-HTML responses (SSE, JS, CSS, images, etc.) without buffering.

mod html;

pub use html::*;

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{LazyLock, Mutex};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// Maximum response body size to buffer for HTML injection (50 MB).
const MAX_BODY_SIZE: usize = 50 * 1024 * 1024;

/// Timeout for establishing the upstream TCP connection. Localhost either
/// accepts immediately or refuses outright; a hang here means a firewalled or
/// wedged port and should fail fast instead of holding the request forever.
const UPSTREAM_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Timeout for the upstream response headers. Must be generous: dev servers
/// compile routes on demand and hold the request open until the compile
/// finishes — tens of seconds on a real dependency tree (the frontend's
/// readiness probe rides the same wait). This is a backstop against a truly
/// hung upstream, not a UX timeout.
const UPSTREAM_RESPONSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// Timeout for buffering an HTML body once response headers have arrived.
/// Headers-then-stall is not a compile wait — after headers the body should
/// flow immediately on localhost.
const HTML_BODY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Script injected into HTML responses to report navigation events to the parent window.
/// Monkey-patches history.pushState/replaceState and listens for popstate to catch all
/// client-side navigation in frameworks like Next.js, React Router, etc.
const NAV_SCRIPT: &str = r#"<script>(function(){var n=function(){window.parent.postMessage({type:'shipstudio:navigate',pathname:location.pathname},'*')};var p=history.pushState;var r=history.replaceState;history.pushState=function(){p.apply(this,arguments);n()};history.replaceState=function(){r.apply(this,arguments);n()};window.addEventListener('popstate',n);n()})()</script>"#;

/// Visual-editor selection layer, injected into every preview HTML response but
/// **inert until** the parent posts `ss:activate`. When active it outlines the
/// hovered/selected element (overlay drawn inside the iframe so it tracks scroll
/// automatically), reports a `ss:select` signature {className, tagName, text,
/// ancestorClasses, rect} on click, and live-applies a new class on `ss:mutate`
/// for instant (Webflow-style) feedback before the source write-back commits.
///
/// The script body lives in `select_script.html` so the same source is shared
/// with the jsdom behavior test (`src/components/edit/selectScript.test.ts`).
const SELECT_SCRIPT: &str = include_str!("select_script.html");

/// Hides the preview iframe's *default* browser scrollbars — the chunky white
/// macOS/WebKit bars that frame the rendered site — without hijacking sites that
/// style their own. Injected at the very start of `<head>` (see
/// `inject_at_head_start`) so any site stylesheet, which loads afterward, wins
/// the cascade. We deliberately use zero-size (not `display:none`) and no
/// `!important`, so a site's `::-webkit-scrollbar { width: … }` overrides this
/// and its custom scrollbar still shows. Scrolling itself is unaffected — only
/// the visual bar is suppressed. `scrollbar-width:none` covers Windows WebView2.
const SCROLLBAR_STYLE: &str = r#"<style id="ss-hide-scrollbars">::-webkit-scrollbar{width:0;height:0;background:transparent}html{scrollbar-width:none}</style>"#;

/// Keeps the preview scroll position across full page reloads. Astro reloads the
/// WHOLE document on a `.astro` save (no in-place HMR like React Fast Refresh), so
/// without this the preview snaps to the top on every save — and restoring *after*
/// first paint just makes it visibly jerk (top → back). So we inject this at the
/// very start of `<head>`, take over scroll restoration, and HOLD the repaint
/// (`visibility:hidden`) until the saved position is restored — then reveal. The
/// net effect: a save reloads but the preview stays put, with no visible jump.
/// Keyed by pathname, so a real navigation still starts at the top.
///
/// The hold is released as soon as the document is tall enough to reach the
/// saved position (rAF poll), with DOMContentLoaded/load and a 400ms hard cap
/// as fallbacks — an over-long hold reads as a blank flash unique to the
/// preview. The script body lives in `scroll_restore.html` so it stays readable
/// and can be exercised by jsdom tests like the selection script.
const SCROLL_RESTORE: &str = include_str!("scroll_restore.html");

/// Makes the editor's OWN save feel like Next's in-place Fast Refresh. Astro
/// full-reloads the whole document on a `.astro` save (which is what makes the
/// preview jerk), but the edit is ALREADY shown live and Tailwind pushes its new
/// CSS over a SEPARATE css-update HMR message. So we wrap Vite's HMR WebSocket and
/// swallow just the `full-reload` message — but ONLY in the brief window right after
/// the editor commits a save (`window.__ssSuppressUntil`, set on `ss:commit`),
/// and at most ONE per window: dropping a reload closes the window, so a racing
/// reload from an unrelated change (an agent editing files) still lands instead
/// of leaving the preview permanently stale. CSS updates always pass, so the real
/// compiled CSS applies. Gated to Vite's `vite-hmr` subprotocol so it never touches
/// a site's own sockets. Injected at head start so it wraps WebSocket before
/// `@vite/client` connects.
///
/// The script body lives in `reload_suppress.html` so the same source is shared
/// with the jsdom behavior test (`src/components/preview/reloadSuppress.test.ts`).
const RELOAD_SUPPRESS: &str = include_str!("reload_suppress.html");

/// Boxed body type that can be either a full buffered body or a streamed body.
type ProxyBody = BoxBody<Bytes, hyper::Error>;

/// Convert full bytes into a ProxyBody.
fn full_body(data: Bytes) -> ProxyBody {
    Full::new(data).map_err(|never| match never {}).boxed()
}

/// Convert an empty body into a ProxyBody.
fn empty_body() -> ProxyBody {
    Full::new(Bytes::new())
        .map_err(|never| match never {})
        .boxed()
}

/// Sanitize a CSP header value for the HTTP preview iframe. Removes two
/// directives that are incompatible with serving the previewed app over plain
/// HTTP inside an iframe:
/// - `frame-ancestors` — so the page can be framed inside the preview at all.
/// - `upgrade-insecure-requests` — the preview is served over `http://localhost`,
///   but this directive makes the browser rewrite every subresource request to
///   `https://`. WebKit (which the preview's WKWebView and Safari use) honors it
///   even on localhost, so CSS/images 404 over https and the page renders blank
///   or unstyled; Chromium exempts localhost, so the bug only shows in the
///   WebKit preview. Stripping it only affects the local preview, never the
///   user's deployed site.
///
/// Returns the value untouched when neither directive is present, and `None`
/// when nothing remains (drop the header).
fn sanitize_csp_for_preview(
    value: &hyper::header::HeaderValue,
) -> Option<hyper::header::HeaderValue> {
    let Ok(s) = value.to_str() else {
        // Unparseable CSP — drop it rather than risk it blanking the iframe.
        return None;
    };
    let lower = s.to_ascii_lowercase();
    if !lower.contains("frame-ancestors") && !lower.contains("upgrade-insecure-requests") {
        return Some(value.clone());
    }
    let kept: Vec<&str> = s
        .split(';')
        .map(str::trim)
        .filter(|d| {
            if d.is_empty() {
                return false;
            }
            let dl = d.to_ascii_lowercase();
            !dl.starts_with("frame-ancestors") && dl != "upgrade-insecure-requests"
        })
        .collect();
    if kept.is_empty() {
        return None;
    }
    hyper::header::HeaderValue::from_str(&kept.join("; ")).ok()
}

/// Rewrite a `localhost`/`127.0.0.1` Origin header to the dev server's port.
///
/// Requests reaching the proxy come from pages served *by* the proxy, so their
/// Origin names the proxy's ephemeral port. Dev servers that host/origin-check
/// requests (Vite's HMR WebSocket upgrade, CSRF-guarded endpoints) must instead
/// see the origin they expect — their own. Non-localhost origins pass through
/// untouched.
fn rewrite_localhost_origin(
    value: &hyper::header::HeaderValue,
    target_port: u16,
) -> Option<hyper::header::HeaderValue> {
    let s = value.to_str().ok()?;
    let host = s.strip_prefix("http://")?.split(':').next()?;
    if host != "localhost" && host != "127.0.0.1" {
        return None;
    }
    hyper::header::HeaderValue::from_str(&format!("http://{host}:{target_port}")).ok()
}

/// A running proxy instance.
struct ProxyInstance {
    _proxy_port: u16,
    _target_port: u16,
    shutdown_tx: Option<oneshot::Sender<()>>,
    _task_handle: JoinHandle<()>,
}

/// Maps window_label -> ProxyInstance
static PROXY_INSTANCES: LazyLock<Mutex<HashMap<String, ProxyInstance>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Start a reverse proxy for the given window, forwarding to `target_port`.
/// Returns the proxy's listening port.
pub async fn start_preview_proxy(window_label: String, target_port: u16) -> Result<u16, String> {
    // Stop any existing proxy for this window
    stop_preview_proxy(&window_label);

    // Bind to a random available port on localhost
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind proxy port: {e}"))?;

    let proxy_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get proxy address: {e}"))?
        .port();

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    let task_handle = tokio::spawn(async move {
        tracing::info!(
            "[Proxy] Started on port {} -> target port {}",
            proxy_port,
            target_port
        );

        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            tokio::spawn(handle_connection(stream, addr, target_port));
                        }
                        Err(e) => {
                            tracing::error!("[Proxy] Accept error: {}", e);
                        }
                    }
                }
                _ = &mut shutdown_rx => {
                    tracing::info!("[Proxy] Shutting down proxy on port {}", proxy_port);
                    break;
                }
            }
        }
    });

    let instance = ProxyInstance {
        _proxy_port: proxy_port,
        _target_port: target_port,
        shutdown_tx: Some(shutdown_tx),
        _task_handle: task_handle,
    };

    PROXY_INSTANCES
        .lock()
        .map_err(|e| format!("Failed to acquire proxy lock: {e}"))?
        .insert(window_label, instance);

    tracing::info!("[Proxy] Proxy registered on port {}", proxy_port);
    Ok(proxy_port)
}

/// Stop the proxy for the given window.
pub fn stop_preview_proxy(window_label: &str) {
    if let Ok(mut instances) = PROXY_INSTANCES.lock() {
        if let Some(mut instance) = instances.remove(window_label) {
            if let Some(tx) = instance.shutdown_tx.take() {
                let _ = tx.send(());
            }
            tracing::info!("[Proxy] Stopped proxy for window '{}'", window_label);
        }
    }
}

/// Stop all running proxies (called during app cleanup).
pub fn stop_all_proxies() {
    if let Ok(mut instances) = PROXY_INSTANCES.lock() {
        for (label, mut instance) in instances.drain() {
            if let Some(tx) = instance.shutdown_tx.take() {
                let _ = tx.send(());
            }
            tracing::info!("[Proxy] Stopped proxy for window '{}' (cleanup)", label);
        }
    }
}

/// Handle a single incoming TCP connection.
async fn handle_connection(stream: TcpStream, addr: SocketAddr, target_port: u16) {
    let io = TokioIo::new(stream);

    let service = service_fn(move |req: Request<Incoming>| handle_request(req, target_port));

    if let Err(e) = http1::Builder::new()
        .preserve_header_case(true)
        .title_case_headers(true)
        .serve_connection(io, service)
        .with_upgrades()
        .await
    {
        // Connection reset / closed by client is normal
        tracing::debug!("[Proxy] Connection error from {}: {}", addr, e);
    }
}

/// Handle a single HTTP request by proxying it to the target dev server.
async fn handle_request(
    req: Request<Incoming>,
    target_port: u16,
) -> Result<Response<ProxyBody>, hyper::Error> {
    let is_websocket = is_upgrade_request(&req);

    if is_websocket {
        return handle_websocket_upgrade(req, target_port).await;
    }

    match proxy_http_request(req, target_port).await {
        Ok(resp) => Ok(resp),
        Err(e) => {
            tracing::error!("[Proxy] Request failed: {}", e);
            let body = format!("Proxy error: {e}");
            Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body(Bytes::from(body)))
                .unwrap())
        }
    }
}

/// Check if a request is a WebSocket upgrade request.
fn is_upgrade_request(req: &Request<Incoming>) -> bool {
    req.headers()
        .get(hyper::header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false)
}

/// Proxy a regular HTTP request (non-WebSocket).
/// HTML responses are buffered and injected with the nav script.
/// All other responses (JS, CSS, images, SSE streams) are forwarded as-is without buffering.
async fn proxy_http_request(
    req: Request<Incoming>,
    target_port: u16,
) -> Result<Response<ProxyBody>, Box<dyn std::error::Error + Send + Sync>> {
    // Connect to target via hostname so both IPv4 and IPv6 are tried.
    // Vite-based dev servers (Astro, SvelteKit, Nuxt) bind to `localhost` which
    // resolves to `::1` (IPv6) on macOS -- hardcoding 127.0.0.1 fails for those.
    let stream = tokio::time::timeout(
        UPSTREAM_CONNECT_TIMEOUT,
        TcpStream::connect(format!("localhost:{target_port}")),
    )
    .await??;
    let io = TokioIo::new(stream);

    let (mut sender, conn) = hyper::client::conn::http1::Builder::new()
        .preserve_header_case(true)
        .title_case_headers(true)
        .handshake(io)
        .await?;

    // Spawn connection driver
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            tracing::debug!("[Proxy] Client connection error: {}", e);
        }
    });

    // Build forwarded request - strip Accept-Encoding to avoid gzip for HTML,
    // and rewrite Host header to target port so dev servers don't reject it.
    let (parts, body) = req.into_parts();
    let mut builder = Request::builder()
        .method(parts.method)
        .uri(parts.uri.clone())
        .version(parts.version);

    for (key, value) in &parts.headers {
        // Strip Accept-Encoding so dev server returns uncompressed HTML
        if key == hyper::header::ACCEPT_ENCODING {
            continue;
        }
        // Rewrite Host to target port so dev server sees the expected origin
        if key == hyper::header::HOST {
            builder = builder.header(key, format!("localhost:{target_port}"));
            continue;
        }
        // Rewrite Origin for the same reason — a CSRF/origin-checking dev
        // server must not see the proxy's ephemeral port.
        if key == hyper::header::ORIGIN {
            if let Some(v) = rewrite_localhost_origin(value, target_port) {
                builder = builder.header(key, v);
                continue;
            }
        }
        builder = builder.header(key, value);
    }

    let forwarded_req = builder.body(body)?;

    // Send request and get response
    let resp = tokio::time::timeout(
        UPSTREAM_RESPONSE_TIMEOUT,
        sender.send_request(forwarded_req),
    )
    .await??;

    // Check if response is HTML (needs injection)
    let is_html = resp
        .headers()
        .get(hyper::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("text/html"))
        .unwrap_or(false);

    let status = resp.status();
    let headers = resp.headers().clone();

    if is_html {
        // Buffer HTML response body and inject nav script (and error overlay for 5xx)
        let body_bytes = tokio::time::timeout(HTML_BODY_TIMEOUT, resp.collect())
            .await??
            .to_bytes();
        let is_server_error = status.is_server_error();

        let response_body = if body_bytes.len() < MAX_BODY_SIZE {
            let modified = if is_server_error {
                tracing::warn!(
                    "[Proxy] Dev server returned {} for HTML response, injecting error overlay",
                    status.as_u16()
                );
                inject_error_into_html(&body_bytes, status.as_u16())
            } else {
                inject_nav_script(&body_bytes)
            };
            full_body(Bytes::from(modified))
        } else {
            // Too large to inject, pass through as-is
            full_body(body_bytes)
        };

        // For error responses, return 200 so the iframe actually renders our overlay.
        // WebKit may show its own error page for 5xx, hiding our injected content.
        // The actual status code is displayed in the overlay's badge.
        let effective_status = if is_server_error {
            StatusCode::OK
        } else {
            status
        };

        let mut response = Response::builder().status(effective_status);
        for (key, value) in &headers {
            // Skip Content-Length since body size changed; skip Content-Encoding
            if key == hyper::header::CONTENT_LENGTH || key == hyper::header::CONTENT_ENCODING {
                continue;
            }
            // The injected body no longer matches upstream's cache validators,
            // and the iframe URL carries no cache-busting param — the webview
            // must never reuse a cached copy of injected HTML (replaced with a
            // hard no-store below).
            if key == hyper::header::CACHE_CONTROL
                || key == hyper::header::ETAG
                || key == hyper::header::LAST_MODIFIED
            {
                continue;
            }
            // The page renders inside the preview iframe — drop anti-framing
            // headers (Shopify storefronts send X-Frame-Options: DENY).
            if key == hyper::header::X_FRAME_OPTIONS {
                continue;
            }
            if key == hyper::header::CONTENT_SECURITY_POLICY {
                if let Some(v) = sanitize_csp_for_preview(value) {
                    response = response.header(key, v);
                }
                continue;
            }
            response = response.header(key, value);
        }
        response = response.header(hyper::header::CACHE_CONTROL, "no-store");

        Ok(response.body(response_body)?)
    } else {
        // Stream non-HTML responses through without buffering.
        // This properly handles SSE (text/event-stream), chunked JS/CSS, etc.
        let incoming_body = resp.into_body();

        let mut response = Response::builder().status(status);
        for (key, value) in &headers {
            if key == hyper::header::X_FRAME_OPTIONS {
                continue;
            }
            if key == hyper::header::CONTENT_SECURITY_POLICY {
                if let Some(v) = sanitize_csp_for_preview(value) {
                    response = response.header(key, v);
                }
                continue;
            }
            response = response.header(key, value);
        }

        Ok(response.body(incoming_body.boxed())?)
    }
}

/// Handle WebSocket upgrade by forwarding the upgrade to the target and piping
/// the upgraded connections bidirectionally.
async fn handle_websocket_upgrade(
    req: Request<Incoming>,
    target_port: u16,
) -> Result<Response<ProxyBody>, hyper::Error> {
    // Connect via hostname for IPv4/IPv6 compatibility (see proxy_http_request)
    let target_stream = match tokio::time::timeout(
        UPSTREAM_CONNECT_TIMEOUT,
        TcpStream::connect(format!("localhost:{target_port}")),
    )
    .await
    .map_err(std::io::Error::from)
    .and_then(|r| r)
    {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("[Proxy] WebSocket target connection failed: {}", e);
            return Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body(Bytes::from("WebSocket proxy error")))
                .unwrap());
        }
    };

    let target_io = TokioIo::new(target_stream);

    // Create client connection with upgrade support
    let (mut sender, conn) = match hyper::client::conn::http1::Builder::new()
        .preserve_header_case(true)
        .title_case_headers(true)
        .handshake(target_io)
        .await
    {
        Ok(h) => h,
        Err(e) => {
            tracing::error!("[Proxy] WebSocket handshake error: {}", e);
            return Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body(Bytes::from("WebSocket handshake error")))
                .unwrap());
        }
    };

    // Drive client connection with upgrades enabled
    tokio::spawn(async move {
        if let Err(e) = conn.with_upgrades().await {
            tracing::debug!("[Proxy] WebSocket client conn error: {}", e);
        }
    });

    // Split the incoming request: extract upgrade future, forward rest to target
    let (mut parts, body) = req.into_parts();

    // Extract the client's OnUpgrade from request extensions (set by hyper server)
    let client_on_upgrade = parts.extensions.remove::<hyper::upgrade::OnUpgrade>();

    // Build request to forward to target
    let mut builder = Request::builder()
        .method(parts.method)
        .uri(parts.uri.clone())
        .version(parts.version);

    for (key, value) in &parts.headers {
        // Rewrite Host/Origin to the dev server's own port, exactly like the
        // HTTP path. Vite host/origin-checks its HMR WebSocket upgrade; leaking
        // the proxy's ephemeral port here gets the HMR socket rejected on
        // stricter setups — the preview then silently stops receiving updates
        // until the dev server is restarted.
        if key == hyper::header::HOST {
            builder = builder.header(key, format!("localhost:{target_port}"));
            continue;
        }
        if key == hyper::header::ORIGIN {
            if let Some(v) = rewrite_localhost_origin(value, target_port) {
                builder = builder.header(key, v);
                continue;
            }
        }
        builder = builder.header(key, value);
    }

    let forwarded_req = match builder.body(body) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("[Proxy] Failed to build WS forward request: {}", e);
            return Ok(Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(full_body(Bytes::from("Internal proxy error")))
                .unwrap());
        }
    };

    // Send upgrade request to target
    let target_resp = match sender.send_request(forwarded_req).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("[Proxy] WebSocket forward failed: {}", e);
            return Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body(Bytes::from("WebSocket proxy error")))
                .unwrap());
        }
    };

    if target_resp.status() != StatusCode::SWITCHING_PROTOCOLS {
        // Target didn't upgrade - return as regular response
        let status = target_resp.status();
        let headers = target_resp.headers().clone();
        let body_bytes = target_resp
            .collect()
            .await
            .map(|b| b.to_bytes())
            .unwrap_or_default();

        let mut response = Response::builder().status(status);
        for (key, value) in &headers {
            response = response.header(key, value);
        }
        return Ok(response.body(full_body(body_bytes)).unwrap());
    }

    // Target agreed to upgrade! Save response headers before consuming for upgrade.
    let resp_headers = target_resp.headers().clone();

    // Get target's upgraded connection (consumes response)
    let target_upgraded = hyper::upgrade::on(target_resp).await;

    // Build 101 response to return to client (with headers from target)
    let mut response_builder = Response::builder().status(StatusCode::SWITCHING_PROTOCOLS);
    for (key, value) in &resp_headers {
        response_builder = response_builder.header(key, value);
    }
    let client_response = response_builder.body(empty_body()).unwrap();

    // Spawn task to pipe client <-> target after both sides have upgraded
    if let (Some(client_on_upgrade), Ok(target_upgraded)) = (client_on_upgrade, target_upgraded) {
        tokio::spawn(async move {
            match client_on_upgrade.await {
                Ok(client_upgraded) => {
                    let mut client_io = TokioIo::new(client_upgraded);
                    let mut target_io = TokioIo::new(target_upgraded);

                    match tokio::io::copy_bidirectional(&mut client_io, &mut target_io).await {
                        Ok((c2t, t2c)) => {
                            tracing::debug!(
                                "[Proxy] WebSocket closed (client->target: {} bytes, target->client: {} bytes)",
                                c2t, t2c
                            );
                        }
                        Err(e) => {
                            tracing::debug!("[Proxy] WebSocket pipe error: {}", e);
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("[Proxy] Client WebSocket upgrade failed: {}", e);
                }
            }
        });
    } else {
        tracing::error!(
            "[Proxy] WebSocket upgrade: missing client upgrade or target upgrade failed"
        );
    }

    Ok(client_response)
}

#[cfg(test)]
mod tests {
    use super::rewrite_localhost_origin;
    use hyper::header::HeaderValue;

    #[test]
    fn localhost_origin_is_rewritten_to_target_port() {
        let v = HeaderValue::from_static("http://localhost:61234");
        assert_eq!(
            rewrite_localhost_origin(&v, 3000).unwrap(),
            HeaderValue::from_static("http://localhost:3000")
        );
    }

    #[test]
    fn loopback_ip_origin_keeps_its_host_form() {
        let v = HeaderValue::from_static("http://127.0.0.1:61234");
        assert_eq!(
            rewrite_localhost_origin(&v, 3000).unwrap(),
            HeaderValue::from_static("http://127.0.0.1:3000")
        );
    }

    #[test]
    fn portless_localhost_origin_gains_target_port() {
        let v = HeaderValue::from_static("http://localhost");
        assert_eq!(
            rewrite_localhost_origin(&v, 4321).unwrap(),
            HeaderValue::from_static("http://localhost:4321")
        );
    }

    #[test]
    fn non_localhost_origins_pass_through_untouched() {
        for origin in ["https://localhost:1234", "http://example.com:80", "null"] {
            let v = HeaderValue::from_str(origin).unwrap();
            assert!(rewrite_localhost_origin(&v, 3000).is_none());
        }
    }
}

/// End-to-end tests over real sockets: a canned upstream records exactly what
/// the proxy forwards, and the raw response bytes show what a webview would see.
#[cfg(test)]
mod e2e_tests {
    use super::{start_preview_proxy, stop_preview_proxy};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::Mutex;

    /// Spawn a fake dev server that captures each request's head (through the
    /// blank line) and answers with `response`. Returns its port.
    async fn spawn_upstream(response: &'static str, captured: Arc<Mutex<Vec<String>>>) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let captured = captured.clone();
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut buf = [0u8; 1024];
                    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                        match stream.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => head.extend_from_slice(&buf[..n]),
                        }
                    }
                    captured
                        .lock()
                        .await
                        .push(String::from_utf8_lossy(&head).to_string());
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });
        port
    }

    /// Send raw bytes to the proxy and collect the full response.
    async fn roundtrip(proxy_port: u16, request: String) -> String {
        let mut client = TcpStream::connect(("127.0.0.1", proxy_port)).await.unwrap();
        client.write_all(request.as_bytes()).await.unwrap();
        let mut resp = Vec::new();
        // WS upgrades keep the socket open — read until headers, then stop.
        let mut buf = [0u8; 1024];
        while !resp.windows(4).any(|w| w == b"\r\n\r\n") || resp.starts_with(b"HTTP/1.1 200") {
            match tokio::time::timeout(std::time::Duration::from_secs(5), client.read(&mut buf))
                .await
            {
                Ok(Ok(0)) | Err(_) => break,
                Ok(Ok(n)) => resp.extend_from_slice(&buf[..n]),
                Ok(Err(_)) => break,
            }
        }
        String::from_utf8_lossy(&resp).to_string()
    }

    #[tokio::test]
    async fn http_path_rewrites_headers_hardens_caching_and_injects() {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let body = "<html><head><title>t</title></head><body>hi</body></html>";
        let upstream = spawn_upstream(
            // Cacheable upstream response — the proxy must strip the validators
            // since the injected body no longer matches them.
            Box::leak(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nCache-Control: max-age=3600\r\nETag: \"abc\"\r\n\r\n{body}",
                    body.len()
                )
                .into_boxed_str(),
            ),
            captured.clone(),
        )
        .await;
        let proxy_port = start_preview_proxy("e2e-http".into(), upstream)
            .await
            .unwrap();

        let resp = roundtrip(
            proxy_port,
            format!(
                "GET / HTTP/1.1\r\nHost: localhost:{proxy_port}\r\nOrigin: http://localhost:{proxy_port}\r\nAccept-Encoding: gzip, br\r\nConnection: close\r\n\r\n"
            ),
        )
        .await;
        stop_preview_proxy("e2e-http");

        // What the dev server saw: its own port in Host/Origin, no Accept-Encoding.
        let seen = captured.lock().await.join("").to_lowercase();
        assert!(
            seen.contains(&format!("host: localhost:{upstream}")),
            "{seen}"
        );
        assert!(
            seen.contains(&format!("origin: http://localhost:{upstream}")),
            "{seen}"
        );
        assert!(!seen.contains("accept-encoding"), "{seen}");

        // What the webview gets: injected scripts, hard no-store, no validators.
        assert!(resp.contains("ss-reload-suppress"), "{resp}");
        assert!(resp.contains("ss-scroll-restore"), "{resp}");
        assert!(resp.contains("shipstudio:navigate"), "{resp}");
        let lower = resp.to_lowercase();
        assert!(lower.contains("cache-control: no-store"), "{resp}");
        assert!(!lower.contains("etag"), "{resp}");
        assert!(!lower.contains("max-age"), "{resp}");
    }

    #[tokio::test]
    async fn ws_upgrade_rewrites_host_and_origin_for_hmr() {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let upstream = spawn_upstream(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n",
            captured.clone(),
        )
        .await;
        let proxy_port = start_preview_proxy("e2e-ws".into(), upstream)
            .await
            .unwrap();

        let resp = roundtrip(
            proxy_port,
            format!(
                "GET / HTTP/1.1\r\nHost: localhost:{proxy_port}\r\nOrigin: http://localhost:{proxy_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n"
            ),
        )
        .await;
        stop_preview_proxy("e2e-ws");

        // The upgrade reached the dev server with ITS port in Host/Origin —
        // Vite origin-checks the HMR socket; the proxy port would get it
        // rejected and silently kill hot updates.
        let seen = captured.lock().await.join("").to_lowercase();
        assert!(
            seen.contains(&format!("host: localhost:{upstream}")),
            "{seen}"
        );
        assert!(
            seen.contains(&format!("origin: http://localhost:{upstream}")),
            "{seen}"
        );
        assert!(seen.contains("sec-websocket-protocol: vite-hmr"), "{seen}");

        // And the upgrade completed through the proxy.
        assert!(resp.starts_with("HTTP/1.1 101"), "{resp}");
    }
}

#[cfg(test)]
mod csp_tests {
    use super::sanitize_csp_for_preview;
    use hyper::header::HeaderValue;

    #[test]
    fn csp_without_stripped_directives_passes_through() {
        let v = HeaderValue::from_static("default-src 'self'; img-src *");
        assert_eq!(sanitize_csp_for_preview(&v).unwrap(), v);
    }

    #[test]
    fn frame_ancestors_directive_is_removed() {
        let v = HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'; img-src *");
        assert_eq!(
            sanitize_csp_for_preview(&v).unwrap(),
            HeaderValue::from_static("default-src 'self'; img-src *")
        );
    }

    #[test]
    fn csp_that_is_only_frame_ancestors_is_dropped() {
        let v = HeaderValue::from_static("frame-ancestors 'none'");
        assert!(sanitize_csp_for_preview(&v).is_none());
    }

    #[test]
    fn frame_ancestors_match_is_case_insensitive() {
        let v = HeaderValue::from_static("Frame-Ancestors https://admin.shopify.com");
        assert!(sanitize_csp_for_preview(&v).is_none());
    }

    #[test]
    fn upgrade_insecure_requests_directive_is_removed() {
        // The preview is served over http://localhost; this directive makes WebKit
        // rewrite subresources to https and blank them. It must be stripped while
        // the rest of the policy is preserved.
        let v = HeaderValue::from_static(
            "default-src 'self'; img-src 'self'; upgrade-insecure-requests",
        );
        assert_eq!(
            sanitize_csp_for_preview(&v).unwrap(),
            HeaderValue::from_static("default-src 'self'; img-src 'self'")
        );
    }

    #[test]
    fn upgrade_insecure_requests_match_is_case_insensitive() {
        let v = HeaderValue::from_static("Upgrade-Insecure-Requests");
        assert!(sanitize_csp_for_preview(&v).is_none());
    }

    #[test]
    fn frame_ancestors_and_upgrade_insecure_requests_removed_together() {
        let v = HeaderValue::from_static(
            "default-src 'self'; frame-ancestors 'none'; upgrade-insecure-requests; img-src *",
        );
        assert_eq!(
            sanitize_csp_for_preview(&v).unwrap(),
            HeaderValue::from_static("default-src 'self'; img-src *")
        );
    }
}

//! # Chromium Preview Engine
//!
//! Mirrors a real Chromium into the workspace. The app's own webview is
//! WebKit on macOS, so an in-window preview can never BE Chrome — instead we
//! drive a headless Chromium (the user's installed Chrome, or Playwright's
//! cached build) over the Chrome DevTools Protocol and stream its screencast
//! into a canvas, forwarding input back. Pixel-for-pixel Blink rendering.
//!
//! Latency design — animations must feel live:
//! - Frames travel as **binary JPEG over a local WebSocket** straight into
//!   the webview: no Tauri IPC, no JSON, no base64 in the frame path.
//! - Screencast frames are **acked immediately** on receipt so Chromium keeps
//!   capturing while previous frames are still in flight.
//! - The bridge is **latest-wins** (a `watch` channel): a slow consumer skips
//!   stale frames instead of building a queue.
//! - Input events go over the same socket and are dispatched **fire-and-forget**
//!   (no CDP round-trip wait on the hot path).
//!
//! The page loads through the existing preview proxy, so script injection
//! (nav tracking, HMR watchdog, scrollbars) applies to this engine too.

mod cdp;
mod launcher;

use bytes::Bytes;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::task::JoinHandle;

/// JPEG quality for screencast frames. 80 is visually clean for UI work while
/// keeping 2x-retina frames small enough for 60fps over a local socket.
const SCREENCAST_QUALITY: u32 = 80;

/// Current logical viewport of the mirrored page.
#[derive(Clone, Copy)]
struct Viewport {
    width: u32,
    height: u32,
    device_scale_factor: f64,
}

struct ChromeInstance {
    child: tokio::process::Child,
    tasks: Vec<JoinHandle<()>>,
    bridge_port: u16,
}

fn kill_instance(mut instance: ChromeInstance) {
    let _ = instance.child.start_kill();
    for task in instance.tasks {
        task.abort();
    }
}

static INSTANCES: LazyLock<Mutex<HashMap<String, ChromeInstance>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Start a Chromium preview for `window_label`, mirroring `url` at the given
/// logical size. Returns the local WebSocket bridge port the frontend
/// connects to for frames + input.
pub async fn start_chrome_preview(
    window_label: String,
    url: String,
    width: u32,
    height: u32,
    device_scale_factor: f64,
) -> Result<u16, String> {
    // Serialize starts: two concurrent launches for the same window (React
    // dev double-mount, rapid engine toggles) share a profile dir and race —
    // one fails to start while the other gets registered and then killed by
    // the loser's cleanup. Later callers wait, then supersede cleanly via the
    // stop below.
    static START_GATE: LazyLock<tokio::sync::Mutex<()>> =
        LazyLock::new(|| tokio::sync::Mutex::new(()));
    let _gate = START_GATE.lock().await;

    stop_chrome_preview(&window_label, None);

    let viewport = Viewport {
        width,
        height,
        device_scale_factor,
    };
    let binary = launcher::find_chromium_binary().ok_or(
        "No Chromium-family browser found. Install Google Chrome (or Chromium/Edge) to use the Chrome preview engine.",
    )?;
    tracing::info!("[ChromePreview] Launching {:?}", binary);
    let launched = launcher::launch(&binary, &window_label, viewport).await?;
    let child = launched.child;

    let (cdp, events) = cdp::Cdp::connect(&launched.ws_url).await?;

    // One page target, attached as a flattened session. Created directly on
    // the preview URL: navigating there from about:blank would swap renderer
    // processes (cross-origin) and detach the session before the screencast
    // starts. Later navigations stay on the dev-server origin, so the
    // session survives them.
    let target = cdp
        .call("Target.createTarget", None, json!({ "url": url }))
        .await?;
    let target_id = target["targetId"]
        .as_str()
        .ok_or("CDP: createTarget returned no targetId")?
        .to_string();
    let attached = cdp
        .call(
            "Target.attachToTarget",
            None,
            json!({ "targetId": target_id, "flatten": true }),
        )
        .await?;
    let session = attached["sessionId"]
        .as_str()
        .ok_or("CDP: attachToTarget returned no sessionId")?
        .to_string();

    cdp.call("Page.enable", Some(&session), json!({})).await?;
    // The headless window id, for resizing the raster surface later
    // (best-effort: emulation still applies if the call is unsupported).
    let window_id = cdp
        .call(
            "Browser.getWindowForTarget",
            None,
            json!({ "targetId": target_id }),
        )
        .await
        .ok()
        .and_then(|v| v["windowId"].as_u64());
    apply_viewport(&cdp, &session, window_id, viewport).await?;
    start_screencast(&cdp, &session, viewport).await?;

    // Latest-wins channels: frames and a fatal-status line.
    let frame_tx = Arc::new(watch::channel::<Option<Bytes>>(None).0);
    let status_tx = Arc::new(watch::channel::<Option<String>>(None).0);
    let viewport_state = Arc::new(tokio::sync::Mutex::new(viewport));

    let pump = tokio::spawn(pump_events(
        cdp.clone(),
        session.clone(),
        events,
        frame_tx.clone(),
        status_tx.clone(),
    ));

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind chrome bridge port: {e}"))?;
    let bridge_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read chrome bridge address: {e}"))?
        .port();
    let server = tokio::spawn(serve_bridge(
        listener,
        cdp,
        session,
        window_id,
        frame_tx,
        status_tx,
        viewport_state,
    ));

    INSTANCES
        .lock()
        .map_err(|e| format!("Failed to acquire chrome preview lock: {e}"))?
        .insert(
            window_label,
            ChromeInstance {
                child,
                tasks: vec![pump, server],
                bridge_port,
            },
        );

    tracing::info!("[ChromePreview] Bridge listening on port {}", bridge_port);
    Ok(bridge_port)
}

/// Stop the Chromium preview for the given window.
///
/// `only_port` scopes the stop to the instance that owns that bridge port —
/// a stale caller (an unmounted component whose replacement already started a
/// new instance, e.g. React StrictMode's double-mount) then no-ops instead of
/// killing its successor. `None` force-stops whatever is running.
pub fn stop_chrome_preview(window_label: &str, only_port: Option<u16>) {
    if let Ok(mut instances) = INSTANCES.lock() {
        let owns_it = instances
            .get(window_label)
            .is_some_and(|i| only_port.is_none() || only_port == Some(i.bridge_port));
        if !owns_it {
            return;
        }
        if let Some(instance) = instances.remove(window_label) {
            kill_instance(instance);
            tracing::info!("[ChromePreview] Stopped for window '{window_label}'");
        }
    }
}

/// Stop all Chromium previews (app cleanup).
pub fn stop_all_chrome_previews() {
    if let Ok(mut instances) = INSTANCES.lock() {
        for (label, instance) in instances.drain() {
            kill_instance(instance);
            tracing::info!("[ChromePreview] Stopped for window '{label}' (cleanup)");
        }
    }
}

async fn apply_viewport(
    cdp: &cdp::Cdp,
    session: &str,
    window_id: Option<u64>,
    vp: Viewport,
) -> Result<(), String> {
    // Resize the headless window itself: the screencast captures the
    // compositor surface at window size × launch scale factor, so bounds must
    // track the viewport or frames get rescaled (blurry). Best-effort — the
    // emulation override below still handles layout if this is unsupported.
    if let Some(id) = window_id {
        let _ = cdp
            .call(
                "Browser.setWindowBounds",
                None,
                json!({ "windowId": id, "bounds": { "width": vp.width, "height": vp.height } }),
            )
            .await;
    }
    cdp.call(
        "Emulation.setDeviceMetricsOverride",
        Some(session),
        json!({
            "width": vp.width,
            "height": vp.height,
            // Fractional DSF is how scale-to-fit stays crisp: the page lays
            // out at the true CSS width while rasterizing exactly at the
            // canvas's device-pixel size.
            "deviceScaleFactor": vp.device_scale_factor,
            "mobile": false,
        }),
    )
    .await?;
    Ok(())
}

async fn start_screencast(cdp: &cdp::Cdp, session: &str, vp: Viewport) -> Result<(), String> {
    cdp.call(
        "Page.startScreencast",
        Some(session),
        json!({
            "format": "jpeg",
            "quality": SCREENCAST_QUALITY,
            // Generous caps so Chromium never rescales frames itself.
            "maxWidth": (vp.width as f64 * vp.device_scale_factor).ceil() as u32,
            "maxHeight": (vp.height as f64 * vp.device_scale_factor).ceil() as u32,
            "everyNthFrame": 1,
        }),
    )
    .await?;
    Ok(())
}

/// Route CDP events: decode + publish screencast frames (acking immediately),
/// surface target death as a status message.
async fn pump_events(
    cdp: cdp::Cdp,
    session: String,
    mut events: tokio::sync::mpsc::UnboundedReceiver<Value>,
    frame_tx: Arc<watch::Sender<Option<Bytes>>>,
    status_tx: Arc<watch::Sender<Option<String>>>,
) {
    use base64::Engine;
    while let Some(event) = events.recv().await {
        match event["method"].as_str() {
            Some("Page.screencastFrame") => {
                let params = &event["params"];
                // Ack BEFORE decode/publish — Chromium won't capture the next
                // frame until the previous one is acknowledged.
                if let Some(frame_session) = params["sessionId"].as_i64() {
                    cdp.fire(
                        "Page.screencastFrameAck",
                        Some(&session),
                        json!({ "sessionId": frame_session }),
                    );
                }
                if let Some(data) = params["data"].as_str() {
                    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data) {
                        let _ = frame_tx.send(Some(Bytes::from(bytes)));
                    }
                }
            }
            Some("Inspector.detached") | Some("Target.targetCrashed") => {
                let _ = status_tx.send(Some("Chromium page crashed".to_string()));
            }
            _ => {}
        }
    }
    // Event stream ended = Chromium (or its connection) is gone.
    let _ = status_tx.send(Some("Chromium exited".to_string()));
}

/// Accept app connections on the bridge and serve them: screencast frames go
/// down as binary, input/control comes up as JSON text.
async fn serve_bridge(
    listener: TcpListener,
    cdp: cdp::Cdp,
    session: String,
    window_id: Option<u64>,
    frame_tx: Arc<watch::Sender<Option<Bytes>>>,
    status_tx: Arc<watch::Sender<Option<String>>>,
    viewport: Arc<tokio::sync::Mutex<Viewport>>,
) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            break;
        };
        tokio::spawn(serve_client(
            stream,
            cdp.clone(),
            session.clone(),
            window_id,
            frame_tx.clone(),
            status_tx.clone(),
            viewport.clone(),
        ));
    }
}

/// The bridge is bound to 127.0.0.1, but any local process (or the previewed
/// page itself, which runs on a localhost origin) could still dial it — only
/// accept WebSocket upgrades from the app webview's own origin. That's
/// `tauri://localhost` (macOS) / `https://tauri.localhost` (Windows) in
/// production; the Vite dev origin is additionally allowed in debug builds.
fn is_app_origin(origin: &str) -> bool {
    if origin == "tauri://localhost" || origin == "https://tauri.localhost" {
        return true;
    }
    #[cfg(debug_assertions)]
    {
        let rest = origin.strip_prefix("http://").unwrap_or("");
        let host = rest.split(':').next().unwrap_or("");
        if host == "localhost" || host == "127.0.0.1" {
            return true;
        }
    }
    false
}

async fn serve_client(
    stream: tokio::net::TcpStream,
    cdp: cdp::Cdp,
    session: String,
    window_id: Option<u64>,
    frame_tx: Arc<watch::Sender<Option<Bytes>>>,
    status_tx: Arc<watch::Sender<Option<String>>>,
    viewport: Arc<tokio::sync::Mutex<Viewport>>,
) {
    use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
    use tokio_tungstenite::tungstenite::Message;

    let ws = tokio_tungstenite::accept_hdr_async(stream, |req: &Request, resp: Response| {
        let origin_ok = req
            .headers()
            .get("origin")
            .and_then(|v| v.to_str().ok())
            .is_some_and(is_app_origin);
        if origin_ok {
            Ok(resp)
        } else {
            Err(ErrorResponse::new(Some("Forbidden".into())))
        }
    })
    .await;
    let Ok(ws) = ws else {
        return;
    };
    let (mut sink, mut source) = futures_util::StreamExt::split(ws);

    // Downstream: frames + status, latest-wins.
    let mut frames = frame_tx.subscribe();
    let mut statuses = status_tx.subscribe();
    let writer = tokio::spawn(async move {
        use futures_util::SinkExt;
        // A late joiner (remount, engine re-toggle) gets the current frame
        // immediately instead of a blank canvas until the next damage.
        let initial = frames.borrow_and_update().clone();
        if let Some(frame) = initial {
            if sink.send(Message::Binary(frame.to_vec())).await.is_err() {
                return;
            }
        }
        loop {
            tokio::select! {
                changed = frames.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    let frame = frames.borrow_and_update().clone();
                    if let Some(frame) = frame {
                        if sink.send(Message::Binary(frame.to_vec())).await.is_err() {
                            return;
                        }
                    }
                }
                changed = statuses.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    let status = statuses.borrow_and_update().clone();
                    if let Some(status) = status {
                        let msg = json!({ "type": "status", "state": "dead", "reason": status });
                        let _ = sink.send(Message::Text(msg.to_string())).await;
                        return;
                    }
                }
            }
        }
    });

    // Upstream: input (hot, fire-and-forget) and control (awaited).
    while let Some(Ok(msg)) = futures_util::StreamExt::next(&mut source).await {
        let Message::Text(text) = msg else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        match value["type"].as_str() {
            Some("mouse") | Some("key") | Some("insertText") => {
                dispatch_input(&cdp, &session, &value);
            }
            Some("navigate") => {
                if let Some(url) = value["url"].as_str() {
                    let _ = cdp
                        .call("Page.navigate", Some(&session), json!({ "url": url }))
                        .await;
                }
            }
            Some("reload") => {
                let _ = cdp.call("Page.reload", Some(&session), json!({})).await;
            }
            Some("resize") => {
                let (Some(w), Some(h)) = (value["width"].as_u64(), value["height"].as_u64()) else {
                    continue;
                };
                let dsf = value["deviceScaleFactor"].as_f64().unwrap_or(1.0);
                let next = Viewport {
                    width: w as u32,
                    height: h as u32,
                    device_scale_factor: dsf,
                };
                *viewport.lock().await = next;
                if apply_viewport(&cdp, &session, window_id, next)
                    .await
                    .is_ok()
                {
                    // Screencast caps are fixed at start time — restart it so
                    // the raster follows the new size.
                    let _ = cdp
                        .call("Page.stopScreencast", Some(&session), json!({}))
                        .await;
                    let _ = start_screencast(&cdp, &session, next).await;
                }
            }
            _ => {}
        }
    }
    writer.abort();
}

/// Map a bridge input message onto CDP input dispatch. Fire-and-forget: input
/// feel is the product here, and a per-event CDP round trip would serialize
/// the stream.
fn dispatch_input(cdp: &cdp::Cdp, session: &str, value: &Value) {
    match value["type"].as_str() {
        Some("mouse") => {
            let kind = match value["kind"].as_str() {
                Some("down") => "mousePressed",
                Some("up") => "mouseReleased",
                Some("move") => "mouseMoved",
                Some("wheel") => "mouseWheel",
                _ => return,
            };
            let mut params = json!({
                "type": kind,
                "x": value["x"].as_f64().unwrap_or(0.0),
                "y": value["y"].as_f64().unwrap_or(0.0),
                "modifiers": value["modifiers"].as_i64().unwrap_or(0),
                "buttons": value["buttons"].as_i64().unwrap_or(0),
                "pointerType": "mouse",
            });
            if kind == "mousePressed" || kind == "mouseReleased" {
                params["button"] = json!(value["button"].as_str().unwrap_or("left"));
                params["clickCount"] = json!(value["clickCount"].as_i64().unwrap_or(1));
            }
            if kind == "mouseWheel" {
                params["deltaX"] = json!(value["deltaX"].as_f64().unwrap_or(0.0));
                params["deltaY"] = json!(value["deltaY"].as_f64().unwrap_or(0.0));
            }
            cdp.fire("Input.dispatchMouseEvent", Some(session), params);
        }
        Some("key") => {
            let text = value["text"].as_str().unwrap_or("");
            let kind = match value["kind"].as_str() {
                // keyDown with text makes Chromium synthesize keypress/input
                // events (what editable fields listen for); rawKeyDown is for
                // non-printing keys.
                Some("down") if !text.is_empty() => "keyDown",
                Some("down") => "rawKeyDown",
                Some("up") => "keyUp",
                _ => return,
            };
            let key_code = value["keyCode"].as_i64().unwrap_or(0);
            let mut params = json!({
                "type": kind,
                "key": value["key"].as_str().unwrap_or(""),
                "code": value["code"].as_str().unwrap_or(""),
                "windowsVirtualKeyCode": key_code,
                "nativeVirtualKeyCode": key_code,
                "modifiers": value["modifiers"].as_i64().unwrap_or(0),
                "autoRepeat": value["repeat"].as_bool().unwrap_or(false),
            });
            if !text.is_empty() {
                params["text"] = json!(text);
            }
            cdp.fire("Input.dispatchKeyEvent", Some(session), params);
        }
        Some("insertText") => {
            if let Some(text) = value["text"].as_str() {
                cdp.fire("Input.insertText", Some(session), json!({ "text": text }));
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::is_app_origin;

    #[test]
    fn bridge_accepts_only_app_origins() {
        for good in ["tauri://localhost", "https://tauri.localhost"] {
            assert!(is_app_origin(good), "{good}");
        }
        for bad in [
            "https://evil.example",
            "http://localhost.evil.example",
            "https://tauri.localhost.evil.example",
            "",
        ] {
            assert!(!is_app_origin(bad), "{bad}");
        }
        // Vite dev origin is only valid in debug builds.
        assert_eq!(
            is_app_origin("http://localhost:1420"),
            cfg!(debug_assertions)
        );
    }

    /// Full-pipeline test against a REAL local Chromium: launch, CDP,
    /// screencast, bridge WebSocket, input dispatch. Ignored by default (CI
    /// has no browser); run with:
    /// `cargo test chrome_preview -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn e2e_streams_animated_frames_through_the_bridge() {
        use futures_util::{SinkExt, StreamExt};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        use tokio_tungstenite::tungstenite::Message;

        // Tiny HTTP server with a continuously animating page.
        let page = "<html><head><style>\
            @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}\
            div{width:200px;height:200px;background:linear-gradient(red,blue);\
            animation:spin 1s linear infinite}</style></head>\
            <body><div></div></body></html>";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{page}",
            page.len()
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let page_port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let response = response.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = stream.read(&mut buf).await;
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });

        let bridge_port = super::start_chrome_preview(
            "e2e-chrome-test".into(),
            format!("http://127.0.0.1:{page_port}/"),
            800,
            600,
            2.0,
        )
        .await
        .expect("chrome preview should start");

        // Connect like the app does (origin-checked).
        let mut request = format!("ws://127.0.0.1:{bridge_port}/")
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("Origin", "tauri://localhost".parse().unwrap());
        let (mut ws, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("bridge should accept app origin");

        // Collect frames for 2 seconds — the animation must keep them coming.
        let started = std::time::Instant::now();
        let mut frames = 0u32;
        let mut bytes = 0usize;
        while started.elapsed() < std::time::Duration::from_secs(2) {
            match tokio::time::timeout(std::time::Duration::from_secs(2), ws.next()).await {
                Ok(Some(Ok(Message::Binary(frame)))) => {
                    assert_eq!(&frame[..2], &[0xFF, 0xD8], "frames must be JPEG");
                    frames += 1;
                    bytes += frame.len();
                }
                Ok(Some(Ok(_))) => {}
                _ => break,
            }
        }
        println!(
            "chrome-preview e2e: {frames} frames in 2s (~{} fps), avg {} KB/frame",
            frames / 2,
            bytes / frames.max(1) as usize / 1024
        );
        assert!(
            frames >= 20,
            "expected a continuous animated stream, got {frames} frames in 2s"
        );

        // Input dispatch must not error the connection.
        ws.send(Message::Text(
            r#"{"type":"mouse","kind":"move","x":100,"y":100}"#.into(),
        ))
        .await
        .unwrap();

        // A non-app origin must be rejected in release semantics; in debug
        // builds localhost is allowed, so probe with an unrelated origin.
        let mut evil = format!("ws://127.0.0.1:{bridge_port}/")
            .into_client_request()
            .unwrap();
        evil.headers_mut()
            .insert("Origin", "https://evil.example".parse().unwrap());
        assert!(
            tokio_tungstenite::connect_async(evil).await.is_err(),
            "bridge must reject foreign origins"
        );

        // A stale stop (wrong port) must NOT kill the running instance…
        super::stop_chrome_preview("e2e-chrome-test", Some(bridge_port.wrapping_add(1)));
        assert!(
            super::INSTANCES
                .lock()
                .unwrap()
                .contains_key("e2e-chrome-test"),
            "port-scoped stop with a stale port must no-op"
        );
        // …while the owning stop does.
        super::stop_chrome_preview("e2e-chrome-test", Some(bridge_port));
        assert!(!super::INSTANCES
            .lock()
            .unwrap()
            .contains_key("e2e-chrome-test"));
    }
}

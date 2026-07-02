//! Minimal Chrome DevTools Protocol client over WebSocket.
//!
//! Just enough CDP for the Chromium preview: request/response correlation by
//! id, session-scoped commands (flattened target sessions), an event stream,
//! and a fire-and-forget path for latency-critical sends (input events and
//! screencast acks must not wait a round trip).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// How long to wait for a CDP command's response.
const COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

#[derive(Clone)]
pub struct Cdp {
    out_tx: mpsc::UnboundedSender<Message>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
}

impl Cdp {
    /// Connect to a Chromium DevTools WebSocket endpoint. Returns the client
    /// plus the stream of CDP events (messages without an `id`).
    pub async fn connect(ws_url: &str) -> Result<(Cdp, mpsc::UnboundedReceiver<Value>), String> {
        let (stream, _) = tokio_tungstenite::connect_async(ws_url)
            .await
            .map_err(|e| format!("CDP connect failed: {e}"))?;
        let (mut sink, mut source) = futures_util::StreamExt::split(stream);

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();
        let (event_tx, event_rx) = mpsc::unbounded_channel::<Value>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

        // Writer: serialize all outbound traffic through one task.
        tokio::spawn(async move {
            while let Some(msg) = out_rx.recv().await {
                if futures_util::SinkExt::send(&mut sink, msg).await.is_err() {
                    break;
                }
            }
        });

        // Reader: route responses to their waiters, everything else to events.
        let pending_reader = pending.clone();
        tokio::spawn(async move {
            while let Some(Ok(msg)) = futures_util::StreamExt::next(&mut source).await {
                let Message::Text(text) = msg else { continue };
                let Ok(value) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                if let Some(id) = value.get("id").and_then(Value::as_u64) {
                    if let Some(tx) = pending_reader.lock().await.remove(&id) {
                        let _ = tx.send(value);
                    }
                } else {
                    // Dropped receiver = shutting down; stop pumping.
                    if event_tx.send(value).is_err() {
                        break;
                    }
                }
            }
        });

        Ok((
            Cdp {
                out_tx,
                pending,
                next_id: Arc::new(AtomicU64::new(1)),
            },
            event_rx,
        ))
    }

    fn envelope(&self, id: u64, method: &str, session_id: Option<&str>, params: Value) -> Message {
        let mut msg = json!({ "id": id, "method": method, "params": params });
        if let Some(sid) = session_id {
            msg["sessionId"] = json!(sid);
        }
        Message::Text(msg.to_string())
    }

    /// Send a command and await its result. Errors on CDP error responses.
    pub async fn call(
        &self,
        method: &str,
        session_id: Option<&str>,
        params: Value,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        self.out_tx
            .send(self.envelope(id, method, session_id, params))
            .map_err(|_| "CDP connection closed".to_string())?;

        let response = tokio::time::timeout(COMMAND_TIMEOUT, rx)
            .await
            .map_err(|_| format!("CDP {method} timed out"))?
            .map_err(|_| "CDP connection closed".to_string())?;

        if let Some(err) = response.get("error") {
            return Err(format!("CDP {method} failed: {err}"));
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Fire-and-forget send for the hot path (input dispatch, screencast acks).
    /// Chrome's response is dropped by the reader when no waiter is registered.
    pub fn fire(&self, method: &str, session_id: Option<&str>, params: Value) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let _ = self
            .out_tx
            .send(self.envelope(id, method, session_id, params));
    }
}

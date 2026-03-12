//! # Auth Commands
//!
//! Commands for Supabase authentication — OAuth flow with localhost callback,
//! session management, and token storage.
//!
//! OAuth uses a one-shot HTTP server on localhost to capture the PKCE auth code
//! from the browser redirect, then emits it to the frontend via a Tauri event.
//!
//! Session tokens are stored in `~/.shipstudio/auth/` for now.
//! TODO: Replace with OS keychain integration (keyring crate).

use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::Emitter;
use tracing::{info, warn};

/// Preferred port for the OAuth callback server.
const OAUTH_CALLBACK_PORT: u16 = 19432;

/// Start a one-shot HTTP server that waits for the OAuth callback.
///
/// Returns the port number. After the browser redirects with `?code=...`,
/// the server emits an `oauth-callback` event with the auth code and shuts down.
#[tauri::command]
pub async fn start_oauth_server(app: tauri::AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{OAUTH_CALLBACK_PORT}"))
        .or_else(|_| TcpListener::bind("127.0.0.1:0"))
        .map_err(|e| format!("Failed to start OAuth server: {e}"))?;

    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    info!("OAuth callback server listening on port {port}");

    std::thread::spawn(move || {
        let timeout = std::time::Duration::from_secs(300);
        let start = std::time::Instant::now();

        while start.elapsed() < timeout {
            let Ok((mut stream, _)) = listener.accept() else {
                continue;
            };

            let mut buf = vec![0u8; 16384];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]).to_string();
            let first_line = request.lines().next().unwrap_or("");

            if first_line.starts_with("GET /callback") {
                // Parse query string for PKCE `code` parameter
                let code = first_line
                    .split_once('?')
                    .map(|(_, qs)| qs.split_once(" HTTP").map_or(qs, |(q, _)| q))
                    .and_then(|qs| {
                        qs.split('&')
                            .filter_map(|p| p.split_once('='))
                            .find(|(k, _)| *k == "code")
                            .map(|(_, v)| v.to_string())
                    });

                if let Some(code) = code {
                    info!("OAuth callback received authorization code");
                    let _ = app.emit("oauth-callback", code);

                    let html = concat!(
                        "<!DOCTYPE html><html><head><style>",
                        "body{font-family:-apple-system,system-ui,sans-serif;display:flex;",
                        "justify-content:center;align-items:center;height:100vh;margin:0;",
                        "background:#0a0a0a;color:#fafafa}",
                        ".c{text-align:center;padding:2rem}",
                        "h2{color:#10b981;margin-bottom:.5rem}",
                        "</style></head><body><div class=\"c\">",
                        "<h2>Authentication Successful</h2>",
                        "<p>You can close this tab and return to Ship Studio.</p>",
                        "</div></body></html>"
                    );

                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    break;
                }

                // No code — return a simple error page
                let err_html = "<!DOCTYPE html><html><body><p>Authentication failed — no code received.</p></body></html>";
                let response = format!(
                    "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    err_html.len(),
                    err_html
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            } else {
                // Respond 404 to other requests (favicon, etc.)
                let resp =
                    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
            }
        }

        info!("OAuth callback server shut down");
    });

    Ok(port)
}

/// Start Supabase OAuth flow by opening the browser.
///
/// The frontend handles the actual OAuth redirect via Supabase JS SDK.
/// This command is a placeholder for future native OAuth support.
#[tauri::command]
pub async fn start_supabase_auth() -> Result<(), String> {
    info!("Supabase auth initiated — frontend handles OAuth flow");
    Ok(())
}

/// Handle OAuth callback — store tokens securely
#[tauri::command]
pub async fn handle_auth_callback(
    access_token: String,
    refresh_token: String,
) -> Result<(), String> {
    info!("Handling auth callback, storing tokens");

    store_token("access_token", &access_token)?;
    store_token("refresh_token", &refresh_token)?;

    Ok(())
}

/// Get the stored auth session tokens
#[tauri::command]
pub async fn get_auth_session() -> Result<Option<AuthSession>, String> {
    let access_token = get_token("access_token");
    let refresh_token = get_token("refresh_token");

    match (access_token, refresh_token) {
        (Some(access), Some(refresh)) => Ok(Some(AuthSession {
            access_token: access,
            refresh_token: refresh,
        })),
        _ => Ok(None),
    }
}

/// Clear stored auth session
#[tauri::command]
pub async fn logout() -> Result<(), String> {
    info!("Clearing auth session");
    delete_token("access_token");
    delete_token("refresh_token");
    Ok(())
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: String,
}

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------

fn store_token(key: &str, value: &str) -> Result<(), String> {
    let path = token_path(key);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, value).map_err(|e| format!("Failed to store token: {}", e))
}

fn get_token(key: &str) -> Option<String> {
    let path = token_path(key);
    match std::fs::read_to_string(&path) {
        Ok(val) => Some(val),
        Err(_) => {
            warn!("No token found for key: {}", key);
            None
        }
    }
}

fn delete_token(key: &str) {
    let path = token_path(key);
    let _ = std::fs::remove_file(path);
}

fn token_path(key: &str) -> std::path::PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    home.join(".shipstudio").join("auth").join(key)
}

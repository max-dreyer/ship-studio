//! # Chromium Preview Commands
//!
//! Tauri command wrappers for the Chromium preview engine — a headless
//! Chromium driven over CDP whose screencast is mirrored into the workspace
//! (see `crate::chrome_preview`).

use crate::errors::CommandError;

/// Start a Chromium preview mirroring `url` for this window. Returns the
/// local WebSocket bridge port (binary JPEG frames down, JSON input up).
#[tauri::command]
#[tracing::instrument(skip(url))]
pub async fn start_chrome_preview(
    window_label: String,
    url: String,
    width: u32,
    height: u32,
    device_scale_factor: f64,
) -> Result<u16, CommandError> {
    crate::chrome_preview::start_chrome_preview(
        window_label,
        url,
        width,
        height,
        device_scale_factor,
    )
    .await
    .map_err(CommandError::from)
}

/// Stop the Chromium preview for the given window. Passing `bridge_port`
/// scopes the stop to that instance (stale unmounts can't kill a successor);
/// omit it to force-stop.
#[tauri::command]
#[tracing::instrument]
pub fn stop_chrome_preview(
    window_label: String,
    bridge_port: Option<u16>,
) -> Result<(), CommandError> {
    crate::chrome_preview::stop_chrome_preview(&window_label, bridge_port);
    Ok(())
}

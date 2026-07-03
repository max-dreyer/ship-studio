//! Locates and launches a Chromium binary for the preview engine.
//!
//! Preference order: the user's installed Chrome/Chromium/Edge (already
//! located by `find_chromium_browser` for screenshot thumbnails — zero extra
//! download, and it IS the browser users compare against), then the Chromium
//! that Playwright's screenshot environment cached.

use std::path::PathBuf;
use tokio::io::AsyncBufReadExt;

/// How long to wait for Chromium to print its DevTools endpoint.
const DEVTOOLS_STARTUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

pub struct LaunchedChromium {
    pub child: tokio::process::Child,
    /// Browser-level DevTools WebSocket URL.
    pub ws_url: String,
}

/// Find a Chromium-family binary to drive.
pub fn find_chromium_binary() -> Option<PathBuf> {
    if let Some(found) = crate::commands::ide::find_chromium_browser() {
        return Some(found);
    }
    playwright_cached_chromium()
}

/// Chromium downloaded by the Playwright screenshot environment
/// (`~/Library/Caches/ms-playwright/chromium-*` on macOS).
fn playwright_cached_chromium() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let cache = dirs::home_dir()?.join("Library/Caches/ms-playwright");
        let mut candidates: Vec<PathBuf> = std::fs::read_dir(&cache)
            .ok()?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("chromium-"))
            })
            .collect();
        // Newest build wins (names sort as chromium-<build>).
        candidates.sort();
        for dir in candidates.into_iter().rev() {
            for sub in ["chrome-mac", "chrome-mac-arm64"] {
                let exe = dir.join(sub).join("Chromium.app/Contents/MacOS/Chromium");
                if exe.exists() {
                    return Some(exe);
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// Launch Chromium headless with remote debugging on an ephemeral port and an
/// isolated profile, and wait for it to announce its DevTools endpoint.
///
/// `viewport` sizes the headless window and pins its raster scale: the
/// screencast captures the compositor surface at window-size × the launch
/// device-scale-factor, so without these flags every frame comes back at
/// Chromium's default 800×600 @ 1x and gets stretched blurry across the
/// canvas. `Emulation.setDeviceMetricsOverride` alone does not change the
/// headless raster surface.
pub async fn launch(
    binary: &PathBuf,
    window_label: &str,
    viewport: super::Viewport,
) -> Result<LaunchedChromium, String> {
    let profile_dir = dirs::home_dir()
        .ok_or("Could not determine home directory")?
        .join(".ship-studio")
        .join("chrome-preview")
        .join(window_label);
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Failed to create chrome profile dir: {e}"))?;

    let mut child = tokio::process::Command::new(binary)
        .args([
            // `new` headless renders through the real compositor — required
            // for a screencast that keeps up with animations.
            "--headless=new",
            // Port 0 = pick a free one; the chosen endpoint is printed to stderr.
            "--remote-debugging-port=0",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-features=Translate",
            // Screencast JPEGs otherwise pick up the display's wide-gamut
            // profile and shift colors vs the app's rendering.
            "--force-color-profile=srgb",
            "--mute-audio",
            "about:blank",
        ])
        // A dedicated profile guarantees a NEW process: launching the user's
        // Chrome binary without one would just signal their running Chrome
        // and exit, leaving nothing to attach to.
        .arg(format!("--user-data-dir={}", profile_dir.display()))
        .arg(format!(
            "--window-size={},{}",
            viewport.width, viewport.height
        ))
        .arg(format!(
            "--force-device-scale-factor={:.4}",
            viewport.device_scale_factor
        ))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to launch Chromium: {e}"))?;

    let stderr = child.stderr.take().ok_or("Chromium stderr not captured")?;

    let ws_url = tokio::time::timeout(DEVTOOLS_STARTUP_TIMEOUT, async {
        let mut lines = tokio::io::BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(rest) = line.strip_prefix("DevTools listening on ") {
                let ws = rest.trim().to_string();
                // Keep draining stderr so Chromium never blocks on a full pipe.
                tokio::spawn(async move {
                    while let Ok(Some(line)) = lines.next_line().await {
                        tracing::trace!("[ChromePreview] chromium: {line}");
                    }
                });
                return Ok(ws);
            }
            tracing::trace!("[ChromePreview] chromium: {line}");
        }
        Err("Chromium exited before announcing DevTools endpoint".to_string())
    })
    .await
    .map_err(|_| "Timed out waiting for Chromium DevTools endpoint".to_string())??;

    Ok(LaunchedChromium { child, ws_url })
}

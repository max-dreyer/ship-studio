//! # Browser discovery
//!
//! Finds the browsers actually installed on this machine, rather than checking
//! a hard-coded list of paths.
//!
//! The list-based approach it replaces missed three things: browsers installed
//! per-user in `~/Applications`, browsers renamed or moved, and every browser
//! nobody thought to add (Vivaldi, Opera, Orion, Zen, …). On macOS the system
//! already knows what a browser is: an app whose `Info.plist` claims the
//! `http` / `https` URL schemes. Asking that question finds all of them.
//!
//! Rebuilt from the specification in `docs/recovery/lost-features.md`.

use crate::errors::CommandError;
use crate::types::BrowserInfo;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Where macOS keeps applications: system-wide, then per-user.
#[cfg(target_os = "macos")]
fn application_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from("/Applications")];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join("Applications"));
    }
    // Chrome-style "app shortcuts" and some installers land a level deeper.
    dirs.push(PathBuf::from("/Applications/Utilities"));
    dirs
}

/// The slice of `Info.plist` that matters for "is this a browser".
#[derive(Debug, Deserialize)]
struct InfoPlist {
    #[serde(rename = "CFBundleIdentifier")]
    bundle_id: Option<String>,
    #[serde(rename = "CFBundleName")]
    name: Option<String>,
    #[serde(rename = "CFBundleDisplayName")]
    display_name: Option<String>,
    #[serde(rename = "CFBundleURLTypes", default)]
    url_types: Vec<UrlType>,
}

#[derive(Debug, Deserialize)]
struct UrlType {
    #[serde(rename = "CFBundleURLSchemes", default)]
    schemes: Vec<String>,
}

/// A browser is an app that handles BOTH `http` and `https`.
///
/// Requiring both is what separates browsers from the file-transfer and chat
/// clients that also claim a web scheme: Cyberduck registers `http` alone (as
/// "WebDAV URL"), Safari and Chrome register the pair. `LSHandlerRank` looks
/// like the obvious discriminator but isn't — Chrome leaves it unset just as
/// Cyberduck does.
fn handles_web(plist: &InfoPlist) -> bool {
    let mut http = false;
    let mut https = false;
    for scheme in plist.url_types.iter().flat_map(|t| t.schemes.iter()) {
        if scheme.eq_ignore_ascii_case("http") {
            http = true;
        } else if scheme.eq_ignore_ascii_case("https") {
            https = true;
        }
    }
    http && https
}

/// Stable id for a browser, derived from its bundle identifier.
///
/// `com.google.Chrome` → `chrome`. Falling back to the whole identifier keeps
/// ids unique for anything unusual, and keeps the well-known ones matching the
/// values the frontend already stores as a preference.
fn browser_id(bundle_id: &str) -> String {
    let last = bundle_id.rsplit('.').next().unwrap_or(bundle_id);
    last.to_lowercase()
}

/// Human name for the list: display name, then bundle name, then the app's
/// own filename with `.app` removed.
fn browser_name(plist: &InfoPlist, app: &Path) -> String {
    plist
        .display_name
        .clone()
        .or_else(|| plist.name.clone())
        .unwrap_or_else(|| {
            app.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Browser".to_string())
        })
}

/// Parse an `Info.plist` (XML or binary) into the fields we need.
#[cfg(target_os = "macos")]
fn read_plist(path: &Path) -> Option<InfoPlist> {
    // `plutil` reads both plist encodings and hands back JSON, which avoids
    // taking a plist parser as a dependency just for this.
    let out = std::process::Command::new("/usr/bin/plutil")
        .args(["-convert", "json", "-o", "-", "--"])
        .arg(path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    serde_json::from_slice::<InfoPlist>(&out.stdout).ok()
}

/// Every browser installed on this machine.
#[cfg(target_os = "macos")]
fn discover() -> Vec<BrowserInfo> {
    let mut found: Vec<BrowserInfo> = Vec::new();
    let mut seen_ids: Vec<String> = Vec::new();

    for dir in application_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let app = entry.path();
            if app.extension().and_then(|e| e.to_str()) != Some("app") {
                continue;
            }
            let Some(plist) = read_plist(&app.join("Contents").join("Info.plist")) else {
                continue;
            };
            if !handles_web(&plist) {
                continue;
            }
            let Some(bundle_id) = plist.bundle_id.clone() else {
                continue;
            };
            let id = browser_id(&bundle_id);
            // The same browser can sit in both /Applications and ~/Applications.
            if seen_ids.contains(&id) {
                continue;
            }
            seen_ids.push(id.clone());
            found.push(BrowserInfo {
                id,
                name: browser_name(&plist, &app),
            });
        }
    }

    // Alphabetical: the discovery order is filesystem order, which is arbitrary
    // and would make the dropdown reshuffle between machines.
    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    tracing::info!(count = found.len(), "browser discovery completed");
    found
}

#[cfg(not(target_os = "macos"))]
fn discover() -> Vec<BrowserInfo> {
    // Other platforms keep the list-based detection in `ide::mod`.
    Vec::new()
}

#[tauri::command]
#[tracing::instrument]
pub async fn discover_browsers() -> Result<Vec<BrowserInfo>, CommandError> {
    Ok(discover())
}

/// Reject anything that isn't a web URL before handing it to the shell.
///
/// Without this, a `file://` or a crafted scheme would be passed straight to
/// `open`, which will happily launch things that are not web pages.
pub fn validate_web_url(url: &str) -> Result<(), CommandError> {
    let lower = url.trim().to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(());
    }
    Err(CommandError::Validation {
        field: "url".into(),
        reason: format!("Only http and https URLs can be opened in a browser (got \"{url}\")"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plist(schemes: &[&str]) -> InfoPlist {
        InfoPlist {
            bundle_id: Some("com.example.Thing".into()),
            name: Some("Thing".into()),
            display_name: None,
            url_types: vec![UrlType {
                schemes: schemes.iter().map(|s| s.to_string()).collect(),
            }],
        }
    }

    #[test]
    fn a_browser_is_an_app_that_handles_both_web_schemes() {
        assert!(handles_web(&plist(&["http", "https"])));
        // Case varies between vendors in real Info.plist files.
        assert!(handles_web(&plist(&["HTTP", "HTTPS"])));
    }

    #[test]
    fn the_pair_may_be_split_across_url_type_entries() {
        let split = InfoPlist {
            bundle_id: Some("com.example.Split".into()),
            name: None,
            display_name: None,
            url_types: vec![
                UrlType {
                    schemes: vec!["http".into()],
                },
                UrlType {
                    schemes: vec!["https".into()],
                },
            ],
        };
        assert!(handles_web(&split));
    }

    #[test]
    fn a_helper_claiming_only_http_is_not_a_browser() {
        // Cyberduck registers http alone, for WebDAV. It must not show up in
        // the browser dropdown.
        assert!(!handles_web(&plist(&["http"])));
    }

    #[test]
    fn apps_handling_other_schemes_are_not_browsers() {
        assert!(!handles_web(&plist(&["mailto"])));
        assert!(!handles_web(&plist(&["slack", "zoommtg"])));
        assert!(!handles_web(&plist(&[])));
    }

    #[test]
    fn ids_match_the_names_the_frontend_already_stores() {
        assert_eq!(browser_id("com.google.Chrome"), "chrome");
        assert_eq!(browser_id("com.apple.Safari"), "safari");
        assert_eq!(browser_id("org.mozilla.firefox"), "firefox");
        assert_eq!(browser_id("company.thebrowser.Browser"), "browser");
    }

    #[test]
    fn an_odd_identifier_still_yields_something_unique() {
        assert_eq!(browser_id("weird"), "weird");
    }

    #[test]
    fn names_prefer_the_display_name() {
        let mut p = plist(&["http"]);
        p.display_name = Some("Google Chrome".into());
        assert_eq!(
            browser_name(&p, Path::new("/Applications/x.app")),
            "Google Chrome"
        );
    }

    #[test]
    fn names_fall_back_to_the_app_filename() {
        let mut p = plist(&["http"]);
        p.name = None;
        p.display_name = None;
        assert_eq!(
            browser_name(&p, Path::new("/Applications/Some Browser.app")),
            "Some Browser"
        );
    }

    #[test]
    fn only_web_urls_reach_the_shell() {
        assert!(validate_web_url("https://example.com").is_ok());
        assert!(validate_web_url("http://localhost:3000").is_ok());
        assert!(validate_web_url("HTTPS://EXAMPLE.COM").is_ok());

        for bad in ["file:///etc/passwd", "javascript:alert(1)", "ftp://x", ""] {
            let err = validate_web_url(bad).unwrap_err().to_string();
            assert!(
                err.contains("Only http and https URLs"),
                "{bad} was allowed"
            );
        }
    }
}

//! # Window Management Commands
//!
//! Commands for managing multiple windows and tracking which projects
//! are open in each window.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

lazy_static::lazy_static! {
    /// Maps window label -> project path
    static ref WINDOW_PROJECTS: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
    /// Maps window label -> dev server port
    static ref WINDOW_PORTS: Mutex<HashMap<String, u16>> = Mutex::new(HashMap::new());
}

/// Counter for unique window names (starts at 2 since "main" is the first window)
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(2);

/// Register that a project is now open in a specific window.
///
/// This is called when a user selects a project to open in a window.
/// Returns an error if the project is already open in another window.
#[tauri::command]
pub fn register_project_open(window_label: String, project_path: String) -> Result<(), String> {
    let mut projects = WINDOW_PROJECTS.lock().map_err(|e| e.to_string())?;

    // Check if this project is already open in another window
    for (label, path) in projects.iter() {
        if path == &project_path && label != &window_label {
            return Err(format!("Project is already open in window '{}'", label));
        }
    }

    // Register the project for this window
    projects.insert(window_label, project_path);
    Ok(())
}

/// Unregister the project for a window (e.g., when going back to projects list).
#[tauri::command]
pub fn unregister_project(window_label: String) -> Result<(), String> {
    let mut projects = WINDOW_PROJECTS.lock().map_err(|e| e.to_string())?;
    projects.remove(&window_label);
    Ok(())
}

/// Get all currently open projects and their windows.
///
/// Returns a map of window label -> project path.
#[tauri::command]
pub fn get_open_projects() -> Result<HashMap<String, String>, String> {
    let projects = WINDOW_PROJECTS.lock().map_err(|e| e.to_string())?;
    Ok(projects.clone())
}

/// Check if a project is open in any window.
///
/// Returns the window label if the project is open, or null if not.
#[tauri::command]
pub fn is_project_open(project_path: String) -> Result<Option<String>, String> {
    let projects = WINDOW_PROJECTS.lock().map_err(|e| e.to_string())?;

    for (label, path) in projects.iter() {
        if path == &project_path {
            return Ok(Some(label.clone()));
        }
    }

    Ok(None)
}

/// Register the dev server port for a window.
///
/// This is used to track which port each window's dev server is using.
#[tauri::command]
pub fn register_window_port(window_label: String, port: u16) -> Result<(), String> {
    let mut ports = WINDOW_PORTS.lock().map_err(|e| e.to_string())?;
    ports.insert(window_label, port);
    Ok(())
}

/// Get the dev server port for a window, if registered.
#[tauri::command]
pub fn get_window_port(window_label: String) -> Result<Option<u16>, String> {
    let ports = WINDOW_PORTS.lock().map_err(|e| e.to_string())?;
    Ok(ports.get(&window_label).copied())
}

/// Atomically allocate and register a port for a window.
///
/// This combines finding an available port and registering it in a single
/// atomic operation to prevent race conditions.
#[tauri::command]
pub fn allocate_window_port(window_label: String, preferred_port: u16) -> Result<u16, String> {
    use std::net::TcpListener;

    let mut ports = WINDOW_PORTS.lock().map_err(|e| e.to_string())?;

    // Get set of ports already claimed by other windows
    let claimed_ports: std::collections::HashSet<u16> = ports.values().copied().collect();

    // Try ports starting from preferred, up to preferred + 100
    for port in preferred_port..preferred_port.saturating_add(100) {
        // Skip if already claimed by another window
        if claimed_ports.contains(&port) {
            tracing::debug!("Port {} already claimed by another window, skipping", port);
            continue;
        }

        // Try to bind to verify it's actually available
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            // Port is available and not claimed - register it atomically
            ports.insert(window_label.clone(), port);
            tracing::info!("Allocated port {} for window {}", port, window_label);
            return Ok(port);
        }
    }

    Err(format!(
        "Could not find available port in range {}-{}",
        preferred_port,
        preferred_port.saturating_add(99)
    ))
}

/// Create a new window for the application.
///
/// Returns the label of the newly created window.
#[tauri::command]
pub fn create_new_window(app: AppHandle) -> Result<String, String> {
    let counter = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("main-{}", counter);

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Ship Studio")
        .inner_size(1400.0, 900.0)
        .min_inner_size(1000.0, 600.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    tracing::info!("Created new window: {}", label);
    Ok(label)
}

/// Clean up all resources associated with a window.
///
/// This is called when a window is being destroyed.
/// It unregisters the project and port for the window.
#[tauri::command]
pub fn cleanup_window_resources(window_label: String) -> Result<(), String> {
    tracing::info!("Cleaning up resources for window: {}", window_label);

    // Unregister project
    if let Ok(mut projects) = WINDOW_PROJECTS.lock() {
        if let Some(path) = projects.remove(&window_label) {
            tracing::info!("Unregistered project {} from window {}", path, window_label);
        }
    }

    // Unregister port
    if let Ok(mut ports) = WINDOW_PORTS.lock() {
        if let Some(port) = ports.remove(&window_label) {
            tracing::info!("Unregistered port {} from window {}", port, window_label);
        }
    }

    Ok(())
}

/// Get the label of a window that has a specific project open.
/// Used internally to check if a project can be opened.
pub fn get_window_for_project(project_path: &str) -> Option<String> {
    if let Ok(projects) = WINDOW_PROJECTS.lock() {
        for (label, path) in projects.iter() {
            if path == project_path {
                return Some(label.clone());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_unregister_project() {
        // Clear any existing state
        WINDOW_PROJECTS.lock().unwrap().clear();

        // Register a project
        register_project_open("main".to_string(), "/path/to/project".to_string()).unwrap();

        // Check it's registered
        let result = is_project_open("/path/to/project".to_string()).unwrap();
        assert_eq!(result, Some("main".to_string()));

        // Unregister it
        unregister_project("main".to_string()).unwrap();

        // Check it's no longer registered
        let result = is_project_open("/path/to/project".to_string()).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_duplicate_project_registration() {
        // Clear any existing state
        WINDOW_PROJECTS.lock().unwrap().clear();

        // Register a project in window 1
        register_project_open("main".to_string(), "/path/to/project".to_string()).unwrap();

        // Try to register the same project in window 2 - should fail
        let result = register_project_open("main-2".to_string(), "/path/to/project".to_string());
        assert!(result.is_err());

        // Registering in the same window should succeed (update)
        register_project_open("main".to_string(), "/path/to/project".to_string()).unwrap();
    }

    #[test]
    fn test_window_port_tracking() {
        // Clear any existing state
        WINDOW_PORTS.lock().unwrap().clear();

        // Register a port
        register_window_port("main".to_string(), 3000).unwrap();

        // Check it's registered
        let result = get_window_port("main".to_string()).unwrap();
        assert_eq!(result, Some(3000));

        // Check unknown window returns None
        let result = get_window_port("unknown".to_string()).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_allocate_window_port_avoids_claimed() {
        // Clear any existing state
        WINDOW_PORTS.lock().unwrap().clear();

        // Window 1 claims port 3000
        WINDOW_PORTS
            .lock()
            .unwrap()
            .insert("main".to_string(), 3000);

        // Window 2 tries to allocate starting from 3000
        // Should skip 3000 (claimed) and try 3001
        let result = allocate_window_port("main-2".to_string(), 3000);

        // Result depends on whether 3001 is available on this system
        // The key assertion is that it doesn't return 3000
        if let Ok(port) = result {
            assert_ne!(port, 3000, "Should not allocate already claimed port");
            // Verify it was registered
            let registered = get_window_port("main-2".to_string()).unwrap();
            assert_eq!(registered, Some(port));
        }
        // If it errors, that's acceptable (no available ports in test env)
    }
}

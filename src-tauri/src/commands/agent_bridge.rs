//! Commands for the agent preview bridge (the global loopback MCP server that
//! lets the workspace agent read the preview's console/network/DOM, interact
//! with the page, navigate it, and take screenshots). The server itself lives
//! in `crate::agent_bridge` and starts at app launch.

use crate::agent_bridge;
use crate::errors::CommandError;
use crate::utils::validate_project_path;

/// The MCP URL to register for this project (starts the global bridge if it
/// isn't running yet). The project path rides inside the URL so the server
/// can route tool calls to whichever window has the project open.
#[tauri::command]
#[tracing::instrument(skip(app))]
pub async fn get_agent_bridge_url(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<String, CommandError> {
    let validated = validate_project_path(&project_path)?;
    let canonical = validated.to_string_lossy().to_string();
    agent_bridge::agent_bridge_url_for_project(app, &canonical)
        .await
        .map_err(CommandError::from)
}

/// Mark this project's preview bridge listener as attached (mounted and
/// answering) or detached. Detached projects fail tool calls fast with an
/// honest "preview isn't active" message instead of a long timeout.
#[tauri::command]
#[tracing::instrument]
pub async fn agent_bridge_attach(project_path: String, attached: bool) -> Result<(), CommandError> {
    let validated = validate_project_path(&project_path)?;
    let canonical = validated.to_string_lossy().to_string();
    agent_bridge::set_project_attached(&canonical, attached);
    Ok(())
}

/// Answer an in-flight bridge tool call. `result` must be a full MCP
/// CallToolResult ({ content: [...], isError? }) — it is passed through to
/// the agent verbatim.
#[tauri::command]
#[tracing::instrument(skip(result))]
pub async fn agent_bridge_respond(
    request_id: u64,
    result: serde_json::Value,
) -> Result<(), CommandError> {
    if !agent_bridge::resolve_bridge_request(request_id, result) {
        // Not an error worth failing on: the call likely timed out server-side
        // moments before the frontend answered.
        tracing::warn!(
            "[AgentBridge] Response for request {} arrived after timeout (dropped)",
            request_id
        );
    }
    Ok(())
}

//! Commands for the agent preview bridge (the loopback MCP server that lets
//! the workspace agent read the preview's console/network/DOM, navigate it,
//! and take screenshots). The server itself lives in `crate::agent_bridge`.

use crate::agent_bridge::{self, BridgeInfo};
use crate::errors::CommandError;

/// Start (or return the already-running) bridge MCP server for this window.
/// Returns the port, token, and full URL to register with the agent CLI.
#[tauri::command]
#[tracing::instrument(skip(app))]
pub async fn start_agent_bridge(
    app: tauri::AppHandle,
    window_label: String,
) -> Result<BridgeInfo, CommandError> {
    agent_bridge::start_agent_bridge(app, window_label)
        .await
        .map_err(CommandError::from)
}

/// Stop the bridge server for this window.
#[tauri::command]
#[tracing::instrument]
pub async fn stop_agent_bridge(window_label: String) -> Result<(), CommandError> {
    agent_bridge::stop_agent_bridge(&window_label);
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

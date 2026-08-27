use serde::{Deserialize, Serialize};
use tauri::State;

use super::{CommandError, DesktopState};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOutboxItem {
    pub operation_id: String,
    pub protocol_version: i64,
    pub device_id: String,
    pub client_sequence: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub project_id: String,
    pub action: String,
    pub base_revision: i64,
    pub payload_json: String,
    pub attempts: i64,
    pub last_error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProjectChangeInput {
    pub project_id: String,
    pub revision: i64,
    pub commit_sequence: i64,
    pub deleted: bool,
    pub project: Option<serde_json::Value>,
}

#[tauri::command]
pub fn list_pending_outbox(
    state: State<'_, DesktopState>,
    limit: i64,
) -> Result<Vec<PendingOutboxItem>, CommandError> {
    let database = state.database()?;
    database
        .pending_outbox(limit)
        .map(|items| {
            items
                .into_iter()
                .map(|item| PendingOutboxItem {
                    operation_id: item.operation_id,
                    protocol_version: item.protocol_version,
                    device_id: item.device_id,
                    client_sequence: item.client_sequence,
                    entity_type: item.entity_type,
                    entity_id: item.entity_id,
                    project_id: item.project_id,
                    action: item.action,
                    base_revision: item.base_revision,
                    payload_json: item.payload_json,
                    attempts: item.attempts,
                    last_error: item.last_error,
                })
                .collect()
        })
        .map_err(Into::into)
}

#[tauri::command]
pub fn acknowledge_outbox(
    state: State<'_, DesktopState>,
    operation_id: String,
) -> Result<(), CommandError> {
    state
        .database()?
        .acknowledge_outbox(&operation_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn record_outbox_failure(
    state: State<'_, DesktopState>,
    operation_id: String,
    message: String,
) -> Result<(), CommandError> {
    state
        .database()?
        .record_outbox_failure(&operation_id, &message)
        .map_err(Into::into)
}

#[tauri::command]
pub fn discard_outbox(
    state: State<'_, DesktopState>,
    operation_id: String,
    project_id: String,
    reason: String,
) -> Result<(), CommandError> {
    state
        .database()?
        .discard_outbox(&operation_id, &project_id, &reason)
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_sync_cursor(state: State<'_, DesktopState>) -> Result<i64, CommandError> {
    state.database()?.pull_cursor().map_err(Into::into)
}

#[tauri::command]
pub fn advance_sync_cursor(
    state: State<'_, DesktopState>,
    cursor: i64,
) -> Result<(), CommandError> {
    state
        .database()?
        .advance_pull_cursor(cursor)
        .map_err(Into::into)
}

#[tauri::command]
pub fn apply_project_change(
    state: State<'_, DesktopState>,
    input: ApplyProjectChangeInput,
) -> Result<(), CommandError> {
    state
        .database()?
        .apply_project_change(
            &input.project_id,
            input.revision,
            input.commit_sequence,
            input.deleted,
            input.project,
        )
        .map_err(Into::into)
}

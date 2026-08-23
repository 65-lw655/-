use serde::Serialize;
use tauri::State;

use super::{CommandError, DesktopState};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStatus {
    pub device_id: String,
    pub pending_count: i64,
}

#[tauri::command]
pub fn get_local_status(state: State<'_, DesktopState>) -> Result<LocalStatus, CommandError> {
    let database = state.database()?;
    let settings = database.device_settings()?;
    let pending_count = database.pending_outbox_count()?;

    Ok(LocalStatus {
        device_id: settings.device_id.to_string(),
        pending_count,
    })
}

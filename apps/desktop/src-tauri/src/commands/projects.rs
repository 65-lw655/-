use tauri::State;

use super::{CommandError, DesktopState};
use crate::local_db::{LocalProjectDetails, LocalProjectPage, ProjectListFilters};

#[tauri::command]
pub fn list_local_projects(
    state: State<'_, DesktopState>,
    filters: ProjectListFilters,
) -> Result<LocalProjectPage, CommandError> {
    state.database()?.list_projects(filters).map_err(Into::into)
}

#[tauri::command]
pub fn get_local_project(
    state: State<'_, DesktopState>,
    project_id: String,
) -> Result<LocalProjectDetails, CommandError> {
    state
        .database()?
        .get_project(&project_id)
        .map_err(Into::into)
}

#[cfg(feature = "development")]
#[tauri::command]
pub fn seed_fictional_local_project(
    state: State<'_, DesktopState>,
) -> Result<LocalProjectDetails, CommandError> {
    let database = state.database()?;
    database.seed_fictional_local_project()?;
    database
        .get_project(crate::local_db::fictional_seed::FICTIONAL_PROJECT_ID)
        .map_err(Into::into)
}

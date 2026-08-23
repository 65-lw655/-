pub mod commands;
pub mod local_db;

use std::error::Error;
use std::fs;
use std::path::PathBuf;

use commands::DesktopState;
use local_db::LocalDatabase;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().setup(|app| {
        let database_path = local_database_path(app)?;
        let database = LocalDatabase::open(&database_path)?;
        app.manage(DesktopState::new(database));
        Ok(())
    });

    #[cfg(feature = "development")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::projects::list_local_projects,
        commands::projects::get_local_project,
        commands::projects::update_local_project,
        commands::projects::seed_fictional_local_project,
        commands::status::get_local_status
    ]);

    #[cfg(not(feature = "development"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::projects::list_local_projects,
        commands::projects::get_local_project,
        commands::projects::update_local_project,
        commands::status::get_local_status
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("failed to run desktop application");
}

fn local_database_path(app: &tauri::App) -> Result<PathBuf, Box<dyn Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data_dir)?;
    Ok(app_data_dir.join("local.sqlite"))
}

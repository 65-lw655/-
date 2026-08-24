pub mod commands;
pub mod credential;
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
        let state = match open_local_database(app) {
            Ok(database) => DesktopState::new(database),
            Err(_) => DesktopState::initialization_failed("本机数据初始化失败".to_string()),
        };
        app.manage(state);
        Ok(())
    });

    #[cfg(feature = "development")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::projects::list_local_projects,
        commands::projects::get_local_project,
        commands::projects::update_local_project,
        commands::projects::seed_fictional_local_project,
        commands::credential::credential_status,
        commands::credential::save_credential,
        commands::credential::delete_credential,
        commands::status::get_local_status
    ]);

    #[cfg(not(feature = "development"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::projects::list_local_projects,
        commands::projects::get_local_project,
        commands::projects::update_local_project,
        commands::credential::credential_status,
        commands::credential::save_credential,
        commands::credential::delete_credential,
        commands::status::get_local_status
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("failed to run desktop application");
}

fn open_local_database(app: &tauri::App) -> Result<LocalDatabase, Box<dyn Error>> {
    let database_path = local_database_path(app)?;
    Ok(LocalDatabase::open(&database_path)?)
}

fn local_database_path(app: &tauri::App) -> Result<PathBuf, Box<dyn Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data_dir)?;
    Ok(app_data_dir.join("local.sqlite"))
}

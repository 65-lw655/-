pub mod projects;
pub mod status;

use std::sync::{Mutex, MutexGuard};

use serde::Serialize;

use crate::local_db::{LocalDatabase, LocalDbError};

pub struct DesktopState {
    database: Mutex<LocalDatabase>,
}

impl DesktopState {
    pub fn new(database: LocalDatabase) -> Self {
        Self {
            database: Mutex::new(database),
        }
    }

    fn database(&self) -> Result<MutexGuard<'_, LocalDatabase>, CommandError> {
        self.database.lock().map_err(|_| CommandError {
            code: "LOCAL_DB_LOCK_FAILED",
            message: "failed to lock local database".to_string(),
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl From<LocalDbError> for CommandError {
    fn from(error: LocalDbError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

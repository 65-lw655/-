pub mod projects;
pub mod status;

use std::sync::{Mutex, MutexGuard};

use std::collections::BTreeMap;

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
            field_errors: None,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_errors: Option<BTreeMap<String, String>>,
}

impl From<LocalDbError> for CommandError {
    fn from(error: LocalDbError) -> Self {
        let field_errors = error
            .field_errors()
            .map(|fields| fields.into_iter().collect::<BTreeMap<_, _>>());
        Self {
            code: error.code(),
            message: error.to_string(),
            field_errors,
        }
    }
}

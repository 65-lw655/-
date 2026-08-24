pub mod credential;
pub mod projects;
pub mod status;

use std::sync::{Mutex, MutexGuard};

use std::collections::BTreeMap;

use serde::Serialize;

use crate::credential::{CredentialError, CredentialStore};
use crate::local_db::{LocalDatabase, LocalDbError};

pub struct DesktopState {
    database: Mutex<LocalDatabase>,
    credential_store: Box<dyn CredentialStore>,
}

impl DesktopState {
    pub fn new(database: LocalDatabase) -> Self {
        Self::with_credential_store(
            database,
            crate::credential::system::SystemCredentialStore::default(),
        )
    }

    pub fn with_credential_store(
        database: LocalDatabase,
        credential_store: impl CredentialStore + 'static,
    ) -> Self {
        Self {
            database: Mutex::new(database),
            credential_store: Box::new(credential_store),
        }
    }

    fn database(&self) -> Result<MutexGuard<'_, LocalDatabase>, CommandError> {
        self.database.lock().map_err(|_| CommandError {
            code: "LOCAL_DB_LOCK_FAILED",
            message: "failed to lock local database".to_string(),
            field_errors: None,
        })
    }

    pub fn credential_store(&self) -> &dyn CredentialStore {
        self.credential_store.as_ref()
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

impl From<CredentialError> for CommandError {
    fn from(error: CredentialError) -> Self {
        match error {
            CredentialError::Missing => Self {
                code: "CREDENTIAL_MISSING",
                message: error.to_string(),
                field_errors: None,
            },
            CredentialError::Unavailable => Self {
                code: "CREDENTIAL_UNAVAILABLE",
                message: error.to_string(),
                field_errors: None,
            },
        }
    }
}

use serde::Deserialize;
use tauri::State;

use super::{CommandError, DesktopState};
use crate::credential::{CredentialError, CredentialStatus, CredentialStore};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCredentialInput {
    credential: String,
}

#[tauri::command]
pub fn credential_status(state: State<'_, DesktopState>) -> Result<CredentialStatus, CommandError> {
    credential_status_from_store(state.credential_store()).map_err(Into::into)
}

#[tauri::command]
pub fn save_credential(
    state: State<'_, DesktopState>,
    input: SaveCredentialInput,
) -> Result<CredentialStatus, CommandError> {
    save_credential_to_store(state.credential_store(), input.credential).map_err(CommandError::from)
}

#[tauri::command]
pub fn delete_credential(state: State<'_, DesktopState>) -> Result<CredentialStatus, CommandError> {
    delete_credential_from_store(state.credential_store()).map_err(CommandError::from)
}

pub fn credential_status_from_store(
    store: &dyn CredentialStore,
) -> Result<CredentialStatus, CredentialError> {
    match store.read() {
        Ok(Some(_)) => Ok(CredentialStatus::Present),
        Ok(None) | Err(CredentialError::Missing) => Ok(CredentialStatus::Missing),
        Err(CredentialError::Unavailable) => Ok(CredentialStatus::Unavailable),
    }
}

pub fn save_credential_to_store(
    store: &dyn CredentialStore,
    credential: String,
) -> Result<CredentialStatus, CredentialError> {
    store.save(&credential)?;
    Ok(CredentialStatus::Present)
}

pub fn read_credential_from_store(
    store: &dyn CredentialStore,
) -> Result<Option<String>, CredentialError> {
    store.read()
}

pub fn delete_credential_from_store(
    store: &dyn CredentialStore,
) -> Result<CredentialStatus, CredentialError> {
    store.delete()?;
    Ok(CredentialStatus::Missing)
}

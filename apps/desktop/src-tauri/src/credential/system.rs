use std::sync::Mutex;

use super::{CredentialError, CredentialStore};

const SERVICE: &str = "cn.projectonline.desktop";
const ACCOUNT: &str = "desktop-session";

pub struct SystemCredentialStore {
    lock: Mutex<()>,
}

impl Default for SystemCredentialStore {
    fn default() -> Self {
        Self {
            lock: Mutex::new(()),
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl CredentialStore for SystemCredentialStore {
    fn save(&self, credential: &str) -> Result<(), CredentialError> {
        let _guard = self.lock.lock().map_err(|_| CredentialError::Unavailable)?;
        keyring::Entry::new(SERVICE, ACCOUNT)
            .set_password(credential)
            .map_err(map_keyring_error)
    }

    fn read(&self) -> Result<Option<String>, CredentialError> {
        let _guard = self.lock.lock().map_err(|_| CredentialError::Unavailable)?;
        match keyring::Entry::new(SERVICE, ACCOUNT).get_password() {
            Ok(credential) => Ok(Some(credential)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(map_keyring_error(error)),
        }
    }

    fn delete(&self) -> Result<(), CredentialError> {
        let _guard = self.lock.lock().map_err(|_| CredentialError::Unavailable)?;
        match keyring::Entry::new(SERVICE, ACCOUNT).delete_password() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(map_keyring_error(error)),
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn map_keyring_error(error: keyring::Error) -> CredentialError {
    match error {
        keyring::Error::NoEntry => CredentialError::Missing,
        _ => CredentialError::Unavailable,
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl CredentialStore for SystemCredentialStore {
    fn save(&self, _credential: &str) -> Result<(), CredentialError> {
        let _guard = self.lock.lock().map_err(|_| CredentialError::Unavailable)?;
        Err(CredentialError::Unavailable)
    }

    fn read(&self) -> Result<Option<String>, CredentialError> {
        let _guard = self.lock.lock().map_err(|_| CredentialError::Unavailable)?;
        Err(CredentialError::Unavailable)
    }

    fn delete(&self) -> Result<(), CredentialError> {
        let _guard = self.lock.lock().map_err(|_| CredentialError::Unavailable)?;
        Err(CredentialError::Unavailable)
    }
}

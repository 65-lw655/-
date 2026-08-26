use std::sync::Mutex;

use super::{CredentialError, CredentialStore};

#[derive(Default)]
pub struct MemoryCredentialStore {
    credential: Mutex<Option<String>>,
    unavailable: bool,
}

impl MemoryCredentialStore {
    pub fn unavailable() -> Self {
        Self {
            credential: Mutex::new(None),
            unavailable: true,
        }
    }

    fn credential(&self) -> Result<std::sync::MutexGuard<'_, Option<String>>, CredentialError> {
        if self.unavailable {
            return Err(CredentialError::Unavailable);
        }

        self.credential
            .lock()
            .map_err(|_| CredentialError::Unavailable)
    }
}

impl CredentialStore for MemoryCredentialStore {
    fn save(&self, credential: &str) -> Result<(), CredentialError> {
        *self.credential()? = Some(credential.to_string());
        Ok(())
    }

    fn read(&self) -> Result<Option<String>, CredentialError> {
        Ok(self.credential()?.clone())
    }

    fn delete(&self) -> Result<(), CredentialError> {
        *self.credential()? = None;
        Ok(())
    }
}

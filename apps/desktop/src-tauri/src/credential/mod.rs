pub mod memory;
pub mod system;

use serde::Serialize;
use thiserror::Error;

pub trait CredentialStore: Send + Sync {
    fn save(&self, credential: &str) -> Result<(), CredentialError>;
    fn read(&self) -> Result<Option<String>, CredentialError>;
    fn delete(&self) -> Result<(), CredentialError>;
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CredentialStatus {
    Present,
    Missing,
    Unavailable,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CredentialError {
    #[error("desktop credential is missing")]
    Missing,
    #[error("desktop credential store is unavailable")]
    Unavailable,
}

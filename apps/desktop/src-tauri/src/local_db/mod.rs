mod migrations;
mod models;

use std::fmt;
use std::path::Path;

use rusqlite::{params, Connection};
use thiserror::Error;
use uuid::Uuid;

pub use models::DeviceSettings;

#[cfg(test)]
mod tests;

pub struct LocalDatabase {
    connection: Connection,
}

impl fmt::Debug for LocalDatabase {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LocalDatabase")
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Error)]
pub enum LocalDbError {
    #[error("failed to open local database")]
    Open(#[source] rusqlite::Error),
    #[error("failed to read local database state")]
    State(#[source] rusqlite::Error),
    #[error("failed to apply local database migration version {version}")]
    Migration { version: i64 },
    #[error("local database state is corrupt")]
    CorruptState,
}

impl LocalDbError {
    #[cfg(test)]
    pub(crate) fn migration_version(&self) -> Option<i64> {
        match self {
            Self::Migration { version, .. } => Some(*version),
            _ => None,
        }
    }
}

impl LocalDatabase {
    pub fn open(path: &Path) -> Result<Self, LocalDbError> {
        Self::open_with_migrations(path, migrations::MIGRATIONS)
    }

    fn open_with_migrations(
        path: &Path,
        migrations: &[migrations::Migration],
    ) -> Result<Self, LocalDbError> {
        let mut connection = Connection::open(path).map_err(LocalDbError::Open)?;
        migrations::apply(&mut connection, migrations)?;
        initialize_device_settings(&connection)?;

        Ok(Self { connection })
    }

    pub fn schema_version(&self) -> Result<i64, LocalDbError> {
        self.connection
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .map_err(LocalDbError::State)
    }

    pub fn device_settings(&self) -> Result<DeviceSettings, LocalDbError> {
        read_device_settings(&self.connection)
    }
}

fn initialize_device_settings(connection: &Connection) -> Result<(), LocalDbError> {
    match device_settings_count(connection)? {
        0 => {
            let device_id = Uuid::new_v4().to_string();
            connection
                .execute(
                    "INSERT INTO device_settings (device_id, next_client_sequence, created_at)
                     VALUES (?1, 1, datetime('now'))",
                    params![device_id],
                )
                .map_err(LocalDbError::State)?;
            Ok(())
        }
        1 => Ok(()),
        _ => Err(LocalDbError::CorruptState),
    }
}

fn device_settings_count(connection: &Connection) -> Result<i64, LocalDbError> {
    connection
        .query_row("SELECT COUNT(*) FROM device_settings", [], |row| row.get(0))
        .map_err(LocalDbError::State)
}

fn read_device_settings(connection: &Connection) -> Result<DeviceSettings, LocalDbError> {
    if device_settings_count(connection)? != 1 {
        return Err(LocalDbError::CorruptState);
    }

    let (device_id, next_client_sequence): (String, i64) = connection
        .query_row(
            "SELECT device_id, next_client_sequence FROM device_settings",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(LocalDbError::State)?;

    Ok(DeviceSettings {
        device_id: Uuid::parse_str(&device_id).map_err(|_| LocalDbError::CorruptState)?,
        next_client_sequence,
    })
}

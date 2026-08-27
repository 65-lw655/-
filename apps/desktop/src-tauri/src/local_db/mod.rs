mod migrations;
mod models;
mod outbox;
mod projects;

#[cfg(any(test, feature = "development"))]
pub(crate) mod fictional_seed;

use std::fmt;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use thiserror::Error;
use uuid::Uuid;

pub use models::DeviceSettings;
pub use projects::{
    LocalProjectDetails, LocalProjectPage, LocalProjectRecord, ProjectListFilters,
    UpdateLocalProject,
};

#[cfg(test)]
mod tests;

pub struct LocalDatabase {
    connection: Connection,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingOutboxItem {
    pub operation_id: String,
    pub protocol_version: i64,
    pub device_id: String,
    pub client_sequence: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub project_id: String,
    pub action: String,
    pub base_revision: i64,
    pub payload_json: String,
    pub attempts: i64,
    pub last_error: Option<String>,
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
    #[error("local project was not found")]
    ProjectNotFound,
    #[error("local project cannot be edited")]
    ProjectForbidden,
    #[error("local project validation failed")]
    ValidationFailed { field_errors: Vec<FieldError> },
    #[error("failed to write local project")]
    LocalWriteFailed(#[source] rusqlite::Error),
    #[error("local project data is corrupt")]
    CorruptProject,
}

impl LocalDbError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Open(_) => "LOCAL_DB_OPEN_FAILED",
            Self::State(_) => "LOCAL_DB_STATE_FAILED",
            Self::Migration { .. } => "LOCAL_DB_MIGRATION_FAILED",
            Self::CorruptState => "LOCAL_DB_CORRUPT_STATE",
            Self::ProjectNotFound => "PROJECT_NOT_FOUND",
            Self::ProjectForbidden => "PROJECT_FORBIDDEN",
            Self::ValidationFailed { .. } => "VALIDATION_FAILED",
            Self::LocalWriteFailed(_) => "LOCAL_WRITE_FAILED",
            Self::CorruptProject => "LOCAL_PROJECT_CORRUPT",
        }
    }

    pub fn field_errors(&self) -> Option<Vec<(String, String)>> {
        match self {
            Self::ValidationFailed { field_errors } => Some(
                field_errors
                    .iter()
                    .map(|field| (field.field.clone(), field.message.clone()))
                    .collect(),
            ),
            _ => None,
        }
    }

    #[cfg(test)]
    pub(crate) fn migration_version(&self) -> Option<i64> {
        match self {
            Self::Migration { version, .. } => Some(*version),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    pub field: String,
    pub message: String,
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

    pub fn pending_outbox_count(&self) -> Result<i64, LocalDbError> {
        self.connection
            .query_row("SELECT COUNT(*) FROM sync_outbox", [], |row| row.get(0))
            .map_err(LocalDbError::State)
    }

    pub fn pending_outbox(&self, limit: i64) -> Result<Vec<PendingOutboxItem>, LocalDbError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT operation_id, protocol_version, device_id, client_sequence,
                        entity_type, entity_id, project_id, action, base_revision,
                        payload_json, attempts, last_error
                 FROM sync_outbox
                 ORDER BY client_sequence ASC
                 LIMIT ?1",
            )
            .map_err(LocalDbError::State)?;
        let rows = statement
            .query_map([limit.clamp(1, 100)], |row| {
                Ok(PendingOutboxItem {
                    operation_id: row.get(0)?,
                    protocol_version: row.get(1)?,
                    device_id: row.get(2)?,
                    client_sequence: row.get(3)?,
                    entity_type: row.get(4)?,
                    entity_id: row.get(5)?,
                    project_id: row.get(6)?,
                    action: row.get(7)?,
                    base_revision: row.get(8)?,
                    payload_json: row.get(9)?,
                    attempts: row.get(10)?,
                    last_error: row.get(11)?,
                })
            })
            .map_err(LocalDbError::State)?;
        rows.map(|row| row.map_err(LocalDbError::State)).collect()
    }

    pub fn record_outbox_failure(
        &self,
        operation_id: &str,
        message: &str,
    ) -> Result<(), LocalDbError> {
        self.connection
            .execute(
                "UPDATE sync_outbox
                 SET attempts = attempts + 1, last_error = ?1
                 WHERE operation_id = ?2",
                params![message, operation_id],
            )
            .map_err(LocalDbError::LocalWriteFailed)?;
        Ok(())
    }

    pub fn acknowledge_outbox(&self, operation_id: &str) -> Result<(), LocalDbError> {
        self.connection
            .execute(
                "DELETE FROM sync_outbox WHERE operation_id = ?1",
                params![operation_id],
            )
            .map_err(LocalDbError::LocalWriteFailed)?;
        Ok(())
    }

    pub fn discard_outbox(
        &self,
        operation_id: &str,
        project_id: &str,
        _reason: &str,
    ) -> Result<(), LocalDbError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(LocalDbError::LocalWriteFailed)?;
        transaction
            .execute(
                "DELETE FROM sync_outbox WHERE operation_id = ?1",
                params![operation_id],
            )
            .map_err(LocalDbError::LocalWriteFailed)?;
        transaction
            .execute(
                "UPDATE local_projects
                 SET sync_state = 'SYNCED', can_edit = 0
                 WHERE id = ?1",
                params![project_id],
            )
            .map_err(LocalDbError::LocalWriteFailed)?;
        transaction.commit().map_err(LocalDbError::LocalWriteFailed)
    }

    pub fn pull_cursor(&self) -> Result<i64, LocalDbError> {
        self.connection
            .query_row(
                "SELECT project_commit_sequence FROM sync_cursor WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map_err(LocalDbError::State)
    }

    pub fn advance_pull_cursor(&self, cursor: i64) -> Result<(), LocalDbError> {
        self.connection
            .execute(
                "UPDATE sync_cursor
                 SET project_commit_sequence = MAX(project_commit_sequence, ?1)
                 WHERE id = 1",
                params![cursor.max(0)],
            )
            .map_err(LocalDbError::LocalWriteFailed)?;
        Ok(())
    }

    pub fn apply_project_change(
        &self,
        project_id: &str,
        revision: i64,
        commit_sequence: i64,
        deleted: bool,
        payload: Option<serde_json::Value>,
    ) -> Result<(), LocalDbError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(LocalDbError::LocalWriteFailed)?;

        if deleted {
            transaction
                .execute(
                    "DELETE FROM sync_outbox WHERE project_id = ?1",
                    params![project_id],
                )
                .map_err(LocalDbError::LocalWriteFailed)?;
            transaction
                .execute(
                    "DELETE FROM local_projects WHERE id = ?1",
                    params![project_id],
                )
                .map_err(LocalDbError::LocalWriteFailed)?;
        } else {
            let payload = payload.ok_or(LocalDbError::CorruptProject)?;
            let name = json_string(&payload, "name")?;
            let year = json_i64(&payload, "year")?;
            let project_type = json_string(&payload, "type")?;
            let status = json_string(&payload, "status")?;
            let phase = json_string(&payload, "phase")?;
            let filing_status = json_string(&payload, "filingStatus")?;
            let planned_completion_date = json_optional_string(&payload, "plannedCompletionDate")?;
            let actual_completion_date = json_optional_string(&payload, "actualCompletionDate")?;
            let exists: Option<i64> = transaction
                .query_row(
                    "SELECT revision FROM local_projects WHERE id = ?1",
                    params![project_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(LocalDbError::LocalWriteFailed)?;

            if exists.is_none_or(|current| revision > current) {
                if exists.is_some() {
                    transaction
                        .execute(
                            "UPDATE local_projects
                             SET name = ?1, year = ?2, type = ?3, status = ?4,
                                 phase = ?5, filing_status = ?6,
                                 planned_completion_date = ?7,
                                 actual_completion_date = ?8,
                                 revision = ?9, commit_sequence = ?10,
                                 local_updated_at = datetime('now'),
                                 sync_state = 'SYNCED'
                             WHERE id = ?11",
                            params![
                                name,
                                year,
                                project_type,
                                status,
                                phase,
                                filing_status,
                                planned_completion_date,
                                actual_completion_date,
                                revision,
                                commit_sequence,
                                project_id
                            ],
                        )
                        .map_err(LocalDbError::LocalWriteFailed)?;
                } else {
                    transaction
                        .execute(
                            "INSERT INTO local_projects (
                                id, name, year, type, status, phase, lifecycle,
                                filing_status, planned_completion_date,
                                actual_completion_date, created_at, created_by,
                                updated_at, updated_by, revision, commit_sequence,
                                archived_at, archived_by, can_edit, local_updated_at,
                                sync_state
                             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ACTIVE', ?7, ?8,
                                ?9, datetime('now'), 'server-sync', datetime('now'),
                                'server-sync', ?10, ?11, NULL, NULL, 0,
                                datetime('now'), 'SYNCED')",
                            params![
                                project_id,
                                name,
                                year,
                                project_type,
                                status,
                                phase,
                                filing_status,
                                planned_completion_date,
                                actual_completion_date,
                                revision,
                                commit_sequence
                            ],
                        )
                        .map_err(LocalDbError::LocalWriteFailed)?;
                }
            }
        }

        transaction
            .execute(
                "UPDATE sync_cursor
                 SET project_commit_sequence = MAX(project_commit_sequence, ?1)
                 WHERE id = 1",
                params![commit_sequence.max(0)],
            )
            .map_err(LocalDbError::LocalWriteFailed)?;
        transaction.commit().map_err(LocalDbError::LocalWriteFailed)
    }
}

fn json_string(payload: &serde_json::Value, field: &str) -> Result<String, LocalDbError> {
    payload
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or(LocalDbError::CorruptProject)
}

fn json_i64(payload: &serde_json::Value, field: &str) -> Result<i64, LocalDbError> {
    payload
        .get(field)
        .and_then(serde_json::Value::as_i64)
        .ok_or(LocalDbError::CorruptProject)
}

fn json_optional_string(
    payload: &serde_json::Value,
    field: &str,
) -> Result<Option<String>, LocalDbError> {
    match payload.get(field) {
        Some(value) if value.is_null() => Ok(None),
        Some(value) => value
            .as_str()
            .map(|text| Some(text.to_string()))
            .ok_or(LocalDbError::CorruptProject),
        None => Err(LocalDbError::CorruptProject),
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

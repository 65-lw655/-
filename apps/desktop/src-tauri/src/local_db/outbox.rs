use rusqlite::{params, Transaction};

use super::LocalDbError;

pub(crate) struct OutboxInsert<'a> {
    pub operation_id: &'a str,
    pub device_id: &'a str,
    pub client_sequence: i64,
    pub project_id: &'a str,
    pub base_revision: i64,
    pub payload_json: &'a str,
}

pub(crate) fn insert_project_upsert(
    transaction: &Transaction<'_>,
    input: OutboxInsert<'_>,
) -> Result<(), LocalDbError> {
    transaction
        .execute(
            "INSERT INTO sync_outbox (
                operation_id,
                protocol_version,
                device_id,
                client_sequence,
                entity_type,
                entity_id,
                project_id,
                action,
                base_revision,
                payload_json,
                created_at
             )
             VALUES (?1, 1, ?2, ?3, 'PROJECT', ?4, ?4, 'UPSERT', ?5, ?6, datetime('now'))",
            params![
                input.operation_id,
                input.device_id,
                input.client_sequence,
                input.project_id,
                input.base_revision,
                input.payload_json
            ],
        )
        .map_err(LocalDbError::LocalWriteFailed)?;

    Ok(())
}

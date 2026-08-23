use rusqlite::params;

use super::{LocalDatabase, LocalDbError};

pub const FICTIONAL_PROJECT_ID: &str = "00000000-0000-4000-8000-0000000000f5";

impl LocalDatabase {
    #[cfg(any(test, feature = "development"))]
    pub fn seed_fictional_local_project(&self) -> Result<(), LocalDbError> {
        self.connection
            .execute(
                "INSERT INTO local_projects (
                    id,
                    name,
                    year,
                    type,
                    status,
                    phase,
                    lifecycle,
                    filing_status,
                    planned_completion_date,
                    actual_completion_date,
                    created_at,
                    created_by,
                    updated_at,
                    updated_by,
                    revision,
                    commit_sequence,
                    archived_at,
                    archived_by,
                    can_edit,
                    local_updated_at,
                    sync_state
                 )
                 VALUES (
                    ?1,
                    '示例-离线本地项目',
                    2026,
                    '展览展示',
                    '施工中',
                    '深化设计',
                    'ACTIVE',
                    '未归档',
                    '2026-10-01',
                    NULL,
                    '2026-08-20T08:00:00.000Z',
                    'local-fictional-user',
                    '2026-08-22T09:30:00.000Z',
                    'local-fictional-user',
                    1,
                    1,
                    NULL,
                    NULL,
                    1,
                    '2026-08-23T09:00:00.000Z',
                    'SYNCED'
                 )
                 ON CONFLICT(id) DO NOTHING",
                params![FICTIONAL_PROJECT_ID],
            )
            .map(|_| ())
            .map_err(LocalDbError::State)
    }
}

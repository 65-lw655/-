use rusqlite::{params, Connection};

use super::LocalDbError;

pub(crate) const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        description: "m4 desktop offline foundation",
        sql: include_str!("../../migrations/001_m4_foundation.sql"),
    },
    Migration {
        version: 2,
        description: "m5 project sync state",
        sql: include_str!("../../migrations/002_m5_sync.sql"),
    },
];

#[derive(Clone, Copy, Debug)]
pub(crate) struct Migration {
    version: i64,
    description: &'static str,
    sql: &'static str,
}

impl Migration {
    #[cfg(test)]
    pub(crate) const fn new(version: i64, sql: &'static str) -> Self {
        Self {
            version,
            description: "test migration",
            sql,
        }
    }
}

pub(crate) fn apply(
    connection: &mut Connection,
    migrations: &[Migration],
) -> Result<(), LocalDbError> {
    ensure_migration_table(connection)?;

    for migration in migrations {
        if migration_applied(connection, migration.version)? {
            continue;
        }

        let transaction = connection
            .transaction()
            .map_err(|_| LocalDbError::Migration {
                version: migration.version,
            })?;

        transaction
            .execute_batch(migration.sql)
            .map_err(|_| LocalDbError::Migration {
                version: migration.version,
            })?;
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, description, applied_at)
                 VALUES (?1, ?2, datetime('now'))",
                params![migration.version, migration.description],
            )
            .map_err(|_| LocalDbError::Migration {
                version: migration.version,
            })?;
        transaction.commit().map_err(|_| LocalDbError::Migration {
            version: migration.version,
        })?;
    }

    Ok(())
}

fn ensure_migration_table(connection: &Connection) -> Result<(), LocalDbError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
               version INTEGER PRIMARY KEY,
               description TEXT NOT NULL,
               applied_at TEXT NOT NULL
             );",
        )
        .map_err(LocalDbError::State)
}

fn migration_applied(connection: &Connection, version: i64) -> Result<bool, LocalDbError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
            params![version],
            |row| row.get::<_, i64>(0),
        )
        .map(|exists| exists == 1)
        .map_err(LocalDbError::State)
}

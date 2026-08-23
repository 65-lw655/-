use std::path::Path;

use super::migrations::Migration;
use super::LocalDatabase;
use tempfile::TempDir;

#[test]
fn opening_empty_file_applies_migration_and_creates_stable_device() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");

    let db = LocalDatabase::open(&db_path).expect("open local database");

    assert_eq!(db.schema_version().expect("schema version"), 1);
    let settings = db.device_settings().expect("device settings");
    assert!(!settings.device_id.is_nil());
    assert_eq!(settings.next_client_sequence, 1);
}

#[test]
fn reopening_database_keeps_device_id_and_sequence() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");

    let original_settings = {
        let db = LocalDatabase::open(&db_path).expect("open local database");
        db.device_settings().expect("device settings")
    };

    let reopened = LocalDatabase::open(&db_path).expect("reopen local database");

    assert_eq!(
        reopened.device_settings().expect("device settings"),
        original_settings
    );
}

#[test]
fn failing_migration_rolls_back_schema_and_version_row() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let migrations = [
        Migration::new(1, "CREATE TABLE committed_marker (id INTEGER PRIMARY KEY);"),
        Migration::new(2, "CREATE TABLE rolled_back_marker (id INTEGER PRIMARY KEY"),
    ];

    let error =
        LocalDatabase::open_with_migrations(&db_path, &migrations).expect_err("migration fails");

    assert_eq!(error.migration_version(), Some(2));
    assert_eq!(schema_version(&db_path), 1);
    assert!(table_exists(&db_path, "committed_marker"));
    assert!(!table_exists(&db_path, "rolled_back_marker"));
}

fn schema_version(path: &Path) -> i64 {
    let connection = rusqlite::Connection::open(path).expect("open sqlite");
    connection
        .query_row(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("read schema version")
}

fn table_exists(path: &Path, table_name: &str) -> bool {
    let connection = rusqlite::Connection::open(path).expect("open sqlite");
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?1)",
            [table_name],
            |row| row.get::<_, i64>(0),
        )
        .expect("read table exists")
        == 1
}

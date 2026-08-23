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

#[test]
fn project_read_seed_is_idempotent() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let db = LocalDatabase::open(&db_path).expect("open local database");

    db.seed_fictional_local_project()
        .expect("seed fictional project");
    db.seed_fictional_local_project()
        .expect("seed fictional project again");

    let page = db
        .list_projects(project_filters())
        .expect("list local projects");

    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].project.id, fictional_project_id());
    assert!(page.items[0].project.name.starts_with("示例-"));
}

#[test]
fn project_read_list_filters_pages_and_orders_projects() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let db = LocalDatabase::open(&db_path).expect("open local database");
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: "00000000-0000-4000-8000-000000000001",
            name: "示例-城市记忆展",
            year: 2026,
            status: "施工中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-23T10:00:00.000Z",
            commit_sequence: 1,
            sync_state: "SYNCED",
            can_edit: 1,
        },
    );
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: "00000000-0000-4000-8000-000000000003",
            name: "示例-城市更新馆",
            year: 2026,
            status: "施工中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-23T11:00:00.000Z",
            commit_sequence: 2,
            sync_state: "PENDING",
            can_edit: 0,
        },
    );
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: "00000000-0000-4000-8000-000000000002",
            name: "示例-城市档案馆",
            year: 2026,
            status: "施工中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-23T11:00:00.000Z",
            commit_sequence: 3,
            sync_state: "SYNCED",
            can_edit: 1,
        },
    );
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: "00000000-0000-4000-8000-000000000004",
            name: "示例-乡村展厅",
            year: 2025,
            status: "待验收",
            lifecycle: "ARCHIVED",
            local_updated_at: "2026-08-23T12:00:00.000Z",
            commit_sequence: 4,
            sync_state: "SYNCED",
            can_edit: 1,
        },
    );

    let page = db
        .list_projects(super::ProjectListFilters {
            query: Some("城市".to_string()),
            year: Some(2026),
            status: Some("施工中".to_string()),
            lifecycle: Some("ACTIVE".to_string()),
            page: 1,
            page_size: 2,
        })
        .expect("list filtered projects");

    assert_eq!(page.total, 3);
    assert_eq!(page.page, 1);
    assert_eq!(page.page_size, 2);
    assert_eq!(
        page.items
            .iter()
            .map(|item| item.project.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "00000000-0000-4000-8000-000000000002",
            "00000000-0000-4000-8000-000000000003"
        ]
    );
    assert_eq!(page.items[0].sync_state, "SYNCED");
    assert_eq!(page.items[1].sync_state, "PENDING");

    let second_page = db
        .list_projects(super::ProjectListFilters {
            query: Some("城市".to_string()),
            year: Some(2026),
            status: Some("施工中".to_string()),
            lifecycle: Some("ACTIVE".to_string()),
            page: 2,
            page_size: 2,
        })
        .expect("list second page");

    assert_eq!(
        second_page
            .items
            .iter()
            .map(|item| item.project.id.as_str())
            .collect::<Vec<_>>(),
        vec!["00000000-0000-4000-8000-000000000001"]
    );
}

#[test]
fn project_read_detail_reports_project_not_found() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let db = LocalDatabase::open(&db_path).expect("open local database");

    let error = db
        .get_project("00000000-0000-4000-8000-00000000ffff")
        .expect_err("missing project fails");

    assert_eq!(error.code(), "PROJECT_NOT_FOUND");
}

#[test]
fn project_read_detail_maps_fields_and_permissions() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let db = LocalDatabase::open(&db_path).expect("open local database");
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: fictional_project_id(),
            name: "示例-离线重点项目",
            year: 2026,
            status: "深化中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-23T13:00:00.000Z",
            commit_sequence: 7,
            sync_state: "PENDING",
            can_edit: 0,
        },
    );

    let details = db
        .get_project(fictional_project_id())
        .expect("project details");

    assert_eq!(details.project.id, fictional_project_id());
    assert_eq!(details.project.name, "示例-离线重点项目");
    assert_eq!(details.project.year, 2026);
    assert_eq!(details.project.status, "深化中");
    assert_eq!(details.project.phase, "深化设计");
    assert_eq!(details.project.lifecycle, "ACTIVE");
    assert_eq!(details.project.filing_status, "未归档");
    assert_eq!(
        details.project.planned_completion_date.as_deref(),
        Some("2026-10-01")
    );
    assert_eq!(details.project.actual_completion_date, None);
    assert_eq!(details.project.created_at, "2026-08-20T08:00:00.000Z");
    assert_eq!(details.project.created_by, "local-fictional-user");
    assert_eq!(details.project.updated_at, "2026-08-22T09:30:00.000Z");
    assert_eq!(details.project.updated_by, "local-fictional-user");
    assert_eq!(details.project.revision, 2);
    assert_eq!(details.project.commit_sequence, 7);
    assert_eq!(details.project.archived_at, None);
    assert_eq!(details.project.archived_by, None);
    assert!(!details.permissions.can_edit);
    assert!(!details.permissions.can_manage_members);
    assert!(!details.permissions.can_change_lifecycle);
    assert!(!details.permissions.can_read_audit);
    assert_eq!(details.sync_state, "PENDING");
}

fn project_filters() -> super::ProjectListFilters {
    super::ProjectListFilters {
        query: None,
        year: None,
        status: None,
        lifecycle: Some("ACTIVE".to_string()),
        page: 1,
        page_size: 20,
    }
}

fn fictional_project_id() -> &'static str {
    "00000000-0000-4000-8000-0000000000f5"
}

struct ProjectFixture {
    id: &'static str,
    name: &'static str,
    year: i64,
    status: &'static str,
    lifecycle: &'static str,
    local_updated_at: &'static str,
    commit_sequence: i64,
    sync_state: &'static str,
    can_edit: i64,
}

fn insert_project_fixture(path: &Path, fixture: ProjectFixture) {
    let connection = rusqlite::Connection::open(path).expect("open sqlite");
    connection
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
                ?2,
                ?3,
                '展览展示',
                ?4,
                '深化设计',
                ?5,
                '未归档',
                '2026-10-01',
                NULL,
                '2026-08-20T08:00:00.000Z',
                'local-fictional-user',
                '2026-08-22T09:30:00.000Z',
                'local-fictional-user',
                2,
                ?6,
                NULL,
                NULL,
                ?7,
                ?8,
                ?9
             )",
            rusqlite::params![
                fixture.id,
                fixture.name,
                fixture.year,
                fixture.status,
                fixture.lifecycle,
                fixture.commit_sequence,
                fixture.can_edit,
                fixture.local_updated_at,
                fixture.sync_state
            ],
        )
        .expect("insert project fixture");
}

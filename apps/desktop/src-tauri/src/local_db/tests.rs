use std::path::Path;

use super::migrations::Migration;
use super::LocalDatabase;
use tempfile::TempDir;

#[test]
fn opening_empty_file_applies_migration_and_creates_stable_device() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");

    let db = LocalDatabase::open(&db_path).expect("open local database");

    assert_eq!(db.schema_version().expect("schema version"), 2);
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

#[test]
fn project_update_writes_project_outbox_and_advances_device_sequence() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    {
        let db = LocalDatabase::open(&db_path).expect("open local database");
        insert_project_fixture(
            &db_path,
            ProjectFixture {
                id: editable_project_id(),
                name: "示例-离线重点项目",
                year: 2026,
                status: "深化中",
                lifecycle: "ACTIVE",
                local_updated_at: "2026-08-23T13:00:00.000Z",
                commit_sequence: 7,
                sync_state: "SYNCED",
                can_edit: 1,
            },
        );
        assert_eq!(
            db.device_settings()
                .expect("device settings")
                .next_client_sequence,
            1
        );
    }

    let mut db = LocalDatabase::open(&db_path).expect("reopen local database");
    let saved = db
        .update_project(
            editable_project_id(),
            project_update_input("示例-本地已修改"),
        )
        .expect("update project");
    drop(db);

    let reopened = LocalDatabase::open(&db_path).expect("reopen local database");
    let details = reopened
        .get_project(editable_project_id())
        .expect("read updated project");
    let outbox = outbox_rows(&db_path);

    assert_eq!(saved.sync_state, "PENDING");
    assert_eq!(details.project.name, "示例-本地已修改");
    assert_eq!(details.project.year, 2027);
    assert_eq!(details.project.r#type, "展陈工程");
    assert_eq!(details.project.status, "施工中");
    assert_eq!(details.project.phase, "施工交付");
    assert_eq!(details.project.filing_status, "已归档");
    assert_eq!(
        details.project.planned_completion_date.as_deref(),
        Some("2027-05-01")
    );
    assert_eq!(
        details.project.actual_completion_date.as_deref(),
        Some("2027-05-20")
    );
    assert_eq!(details.project.revision, 2);
    assert_eq!(details.project.commit_sequence, 7);
    assert_eq!(details.sync_state, "PENDING");
    assert_eq!(outbox.len(), 1);
    assert_eq!(outbox[0].protocol_version, 1);
    assert_eq!(outbox[0].client_sequence, 1);
    assert_eq!(outbox[0].entity_type, "PROJECT");
    assert_eq!(outbox[0].project_id, editable_project_id());
    assert_eq!(outbox[0].action, "UPSERT");
    assert_eq!(outbox[0].base_revision, 2);
    assert_eq!(
        outbox[0].payload_json,
        r#"{"name":"示例-本地已修改","year":2027,"type":"展陈工程","status":"施工中","phase":"施工交付","filingStatus":"已归档","plannedCompletionDate":"2027-05-01","actualCompletionDate":"2027-05-20"}"#
    );
    assert_eq!(
        reopened
            .device_settings()
            .expect("device settings")
            .next_client_sequence,
        2
    );
}

#[test]
fn project_update_rolls_back_project_and_sequence_when_outbox_insert_fails() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let mut db = LocalDatabase::open(&db_path).expect("open local database");
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: editable_project_id(),
            name: "示例-离线重点项目",
            year: 2026,
            status: "深化中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-23T13:00:00.000Z",
            commit_sequence: 7,
            sync_state: "SYNCED",
            can_edit: 1,
        },
    );
    install_outbox_abort_trigger(&db_path);

    let error = db
        .update_project(editable_project_id(), project_update_input("示例-不会落库"))
        .expect_err("outbox insert failure rolls back");
    drop(db);

    let reopened = LocalDatabase::open(&db_path).expect("reopen local database");
    let details = reopened
        .get_project(editable_project_id())
        .expect("read project");

    assert_eq!(error.code(), "LOCAL_WRITE_FAILED");
    assert_eq!(details.project.name, "示例-离线重点项目");
    assert_eq!(details.sync_state, "SYNCED");
    assert_eq!(
        reopened
            .device_settings()
            .expect("device settings")
            .next_client_sequence,
        1
    );
    assert!(outbox_rows(&db_path).is_empty());
}

#[test]
fn project_update_rejects_forbidden_project_without_writes() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let mut db = LocalDatabase::open(&db_path).expect("open local database");
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: editable_project_id(),
            name: "示例-只读项目",
            year: 2026,
            status: "深化中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-23T13:00:00.000Z",
            commit_sequence: 7,
            sync_state: "SYNCED",
            can_edit: 0,
        },
    );

    let error = db
        .update_project(
            editable_project_id(),
            project_update_input("示例-不允许修改"),
        )
        .expect_err("forbidden project fails");
    drop(db);

    let reopened = LocalDatabase::open(&db_path).expect("reopen local database");
    let details = reopened
        .get_project(editable_project_id())
        .expect("read project");

    assert_eq!(error.code(), "PROJECT_FORBIDDEN");
    assert_eq!(details.project.name, "示例-只读项目");
    assert_eq!(details.sync_state, "SYNCED");
    assert_eq!(
        reopened
            .device_settings()
            .expect("device settings")
            .next_client_sequence,
        1
    );
    assert!(outbox_rows(&db_path).is_empty());
}

#[test]
fn project_update_rejects_invalid_input_with_field_errors_without_writes() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let mut db = LocalDatabase::open(&db_path).expect("open local database");
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: editable_project_id(),
            name: "示例-离线重点项目",
            year: 2026,
            status: "深化中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-23T13:00:00.000Z",
            commit_sequence: 7,
            sync_state: "SYNCED",
            can_edit: 1,
        },
    );

    let error = db
        .update_project(
            editable_project_id(),
            super::UpdateLocalProject {
                name: " ".to_string(),
                year: 2200,
                r#type: "展览展示".to_string(),
                status: "未知状态".to_string(),
                phase: "深化设计".to_string(),
                filing_status: "未归档".to_string(),
                planned_completion_date: Some("2026-02-30".to_string()),
                actual_completion_date: None,
            },
        )
        .expect_err("invalid input fails");
    drop(db);

    let reopened = LocalDatabase::open(&db_path).expect("reopen local database");
    let details = reopened
        .get_project(editable_project_id())
        .expect("read project");

    assert_eq!(error.code(), "VALIDATION_FAILED");
    assert_eq!(
        error.field_errors().expect("field errors"),
        vec![
            ("name".to_string(), "长度必须为 1-200 个字符".to_string()),
            ("year".to_string(), "必须为 1900-2100 的整数".to_string()),
            ("status".to_string(), "状态无效".to_string()),
            (
                "plannedCompletionDate".to_string(),
                "必须是真实的 YYYY-MM-DD 日期或 null".to_string()
            )
        ]
    );
    assert_eq!(details.project.name, "示例-离线重点项目");
    assert_eq!(details.sync_state, "SYNCED");
    assert_eq!(
        reopened
            .device_settings()
            .expect("device settings")
            .next_client_sequence,
        1
    );
    assert!(outbox_rows(&db_path).is_empty());
}

#[test]
fn project_update_uses_distinct_operation_ids_and_consecutive_sequences() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let mut db = LocalDatabase::open(&db_path).expect("open local database");
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: editable_project_id(),
            name: "示例-离线重点项目",
            year: 2026,
            status: "深化中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-23T13:00:00.000Z",
            commit_sequence: 7,
            sync_state: "SYNCED",
            can_edit: 1,
        },
    );

    db.update_project(
        editable_project_id(),
        project_update_input("示例-第一次修改"),
    )
    .expect("first update");
    db.update_project(
        editable_project_id(),
        project_update_input("示例-第二次修改"),
    )
    .expect("second update");
    drop(db);

    let rows = outbox_rows(&db_path);

    assert_eq!(rows.len(), 2);
    assert_ne!(rows[0].operation_id, rows[1].operation_id);
    assert_eq!(
        rows.iter()
            .map(|row| row.client_sequence)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
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

fn editable_project_id() -> &'static str {
    "00000000-0000-4000-8000-000000000101"
}

fn project_update_input(name: &str) -> super::UpdateLocalProject {
    super::UpdateLocalProject {
        name: name.to_string(),
        year: 2027,
        r#type: "展陈工程".to_string(),
        status: "施工中".to_string(),
        phase: "施工交付".to_string(),
        filing_status: "已归档".to_string(),
        planned_completion_date: Some("2027-05-01".to_string()),
        actual_completion_date: Some("2027-05-20".to_string()),
    }
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

struct OutboxRow {
    operation_id: String,
    protocol_version: i64,
    client_sequence: i64,
    entity_type: String,
    project_id: String,
    action: String,
    base_revision: i64,
    payload_json: String,
}

fn outbox_rows(path: &Path) -> Vec<OutboxRow> {
    let connection = rusqlite::Connection::open(path).expect("open sqlite");
    let mut statement = connection
        .prepare(
            "SELECT
                operation_id,
                protocol_version,
                client_sequence,
                entity_type,
                project_id,
                action,
                base_revision,
                payload_json
             FROM sync_outbox
             ORDER BY client_sequence",
        )
        .expect("prepare outbox read");
    statement
        .query_map([], |row| {
            Ok(OutboxRow {
                operation_id: row.get(0)?,
                protocol_version: row.get(1)?,
                client_sequence: row.get(2)?,
                entity_type: row.get(3)?,
                project_id: row.get(4)?,
                action: row.get(5)?,
                base_revision: row.get(6)?,
                payload_json: row.get(7)?,
            })
        })
        .expect("read outbox rows")
        .collect::<Result<Vec<_>, _>>()
        .expect("map outbox rows")
}

fn install_outbox_abort_trigger(path: &Path) {
    let connection = rusqlite::Connection::open(path).expect("open sqlite");
    connection
        .execute_batch(
            "CREATE TRIGGER abort_sync_outbox_insert
             BEFORE INSERT ON sync_outbox
             BEGIN
               SELECT RAISE(ABORT, 'outbox blocked');
             END;",
        )
        .expect("install outbox abort trigger");
}

#[test]
fn sync_state_reads_pending_outbox_and_records_retry_without_losing_operation() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let db = LocalDatabase::open(&db_path).expect("open local database");
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: "00000000-0000-4000-8000-000000000010",
            name: "待同步项目",
            year: 2026,
            status: "施工中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-24T10:00:00.000Z",
            commit_sequence: 1,
            sync_state: "PENDING",
            can_edit: 1,
        },
    );
    insert_outbox_fixture(&db_path, "op-1", "00000000-0000-4000-8000-000000000010");

    let pending = db.pending_outbox(10).expect("read pending outbox");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].operation_id, "op-1");
    assert_eq!(pending[0].attempts, 0);

    db.record_outbox_failure("op-1", "network unavailable")
        .expect("record retry");
    let retry = db.pending_outbox(10).expect("read retry outbox");
    assert_eq!(retry[0].attempts, 1);
    assert_eq!(retry[0].last_error.as_deref(), Some("network unavailable"));
}

#[test]
fn sync_state_acknowledges_outbox_and_persists_pull_cursor() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let db = LocalDatabase::open(&db_path).expect("open local database");
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: "00000000-0000-4000-8000-000000000011",
            name: "已同步项目",
            year: 2026,
            status: "施工中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-24T10:00:00.000Z",
            commit_sequence: 1,
            sync_state: "PENDING",
            can_edit: 1,
        },
    );
    insert_outbox_fixture(&db_path, "op-2", "00000000-0000-4000-8000-000000000011");

    db.acknowledge_outbox("op-2").expect("acknowledge outbox");
    assert!(db.pending_outbox(10).expect("read outbox").is_empty());
    assert_eq!(db.pull_cursor().expect("read cursor"), 0);
    db.advance_pull_cursor(12).expect("advance cursor");
    assert_eq!(db.pull_cursor().expect("read cursor"), 12);
}

#[test]
fn sync_state_discards_forbidden_outbox_and_locks_project() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let db = LocalDatabase::open(&db_path).expect("open local database");
    let project_id = "00000000-0000-0000-0000-000000000013";
    insert_project_fixture(
        &db_path,
        ProjectFixture {
            id: project_id,
            name: "无权限项目",
            year: 2026,
            status: "施工中",
            lifecycle: "ACTIVE",
            local_updated_at: "2026-08-24T10:00:00.000Z",
            commit_sequence: 1,
            sync_state: "PENDING",
            can_edit: 1,
        },
    );
    insert_outbox_fixture(&db_path, "op-forbidden", project_id);

    db.discard_outbox("op-forbidden", project_id, "FORBIDDEN")
        .expect("discard forbidden outbox");
    assert!(db.pending_outbox(10).expect("read outbox").is_empty());
    let project = db.get_project(project_id).expect("read locked project");
    assert_eq!(project.sync_state, "SYNCED");
    assert!(!project.permissions.can_edit);
}

fn insert_outbox_fixture(path: &Path, operation_id: &str, project_id: &str) {
    let connection = rusqlite::Connection::open(path).expect("open sqlite");
    connection
        .execute(
            "INSERT INTO sync_outbox (
                operation_id, protocol_version, device_id, client_sequence,
                entity_type, entity_id, project_id, action, base_revision,
                payload_json, created_at
             ) VALUES (?1, 1, '00000000-0000-4000-8000-000000000099', 1,
                'PROJECT', ?2, ?2, 'UPSERT', 1, '{}', datetime('now'))",
            rusqlite::params![operation_id, project_id],
        )
        .expect("insert outbox fixture");
}

#[test]
fn sync_state_applies_a_pulled_project_and_advances_cursor_atomically() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let db_path = temp_dir.path().join("local.sqlite");
    let db = LocalDatabase::open(&db_path).expect("open local database");
    let project_id = "00000000-0000-4000-8000-000000000012";

    db.apply_project_change(
        project_id,
        2,
        18,
        false,
        Some(serde_json::json!({
            "name": "服务端同步项目",
            "year": 2026,
            "type": "展览展示",
            "status": "施工中",
            "phase": "现场实施",
            "filingStatus": "无需报建",
            "plannedCompletionDate": "2026-12-31",
            "actualCompletionDate": null
        })),
    )
    .expect("apply project change");

    let project = db.get_project(project_id).expect("read applied project");
    assert_eq!(project.project.name, "服务端同步项目");
    assert_eq!(project.project.revision, 2);
    assert_eq!(project.project.commit_sequence, 18);
    assert_eq!(project.sync_state, "SYNCED");
    assert_eq!(db.pull_cursor().expect("read cursor"), 18);
}

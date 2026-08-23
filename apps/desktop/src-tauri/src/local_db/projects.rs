use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::{LocalDatabase, LocalDbError};

const PROJECT_STATUSES: &[&str] = &[
    "中标待签",
    "施工中",
    "深化中",
    "完工未验收",
    "待验收",
    "验收未结算",
    "结算未回款",
    "已结算待回款",
];

const PROJECT_LIFECYCLES: &[&str] = &["ACTIVE", "ARCHIVED"];
const SYNC_STATES: &[&str] = &["SYNCED", "PENDING"];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListFilters {
    pub query: Option<String>,
    pub year: Option<i64>,
    pub status: Option<String>,
    pub lifecycle: Option<String>,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProjectRecord {
    pub id: String,
    pub name: String,
    pub year: i64,
    pub r#type: String,
    pub status: String,
    pub phase: String,
    pub filing_status: String,
    pub planned_completion_date: Option<String>,
    pub actual_completion_date: Option<String>,
    pub lifecycle: String,
    pub created_at: String,
    pub created_by: String,
    pub updated_at: String,
    pub updated_by: String,
    pub revision: i64,
    pub commit_sequence: i64,
    pub archived_at: Option<String>,
    pub archived_by: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProjectListItem {
    pub project: LocalProjectRecord,
    pub owner_labels: Vec<String>,
    pub sync_state: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProjectPage {
    pub items: Vec<LocalProjectListItem>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProjectPermissions {
    pub can_edit: bool,
    pub can_manage_members: bool,
    pub can_change_lifecycle: bool,
    pub can_read_audit: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProjectDetails {
    pub project: LocalProjectRecord,
    pub permissions: LocalProjectPermissions,
    pub sync_state: String,
}

struct ProjectRow {
    project: LocalProjectRecord,
    can_edit: i64,
    sync_state: String,
}

impl LocalDatabase {
    pub fn list_projects(
        &self,
        filters: ProjectListFilters,
    ) -> Result<LocalProjectPage, LocalDbError> {
        let page = filters.page.max(1);
        let page_size = filters.page_size.clamp(1, 100);
        let offset = (page - 1) * page_size;
        let query = filters.query.filter(|value| !value.trim().is_empty());
        let like_query = query.as_ref().map(|value| format!("%{}%", value.trim()));

        let total = self
            .connection
            .query_row(
                "SELECT COUNT(*)
                 FROM local_projects
                 WHERE (?1 IS NULL OR name LIKE ?1)
                   AND (?2 IS NULL OR year = ?2)
                   AND (?3 IS NULL OR status = ?3)
                   AND (?4 IS NULL OR lifecycle = ?4)",
                params![
                    like_query.as_deref(),
                    filters.year,
                    filters.status.as_deref(),
                    filters.lifecycle.as_deref()
                ],
                |row| row.get(0),
            )
            .map_err(LocalDbError::State)?;

        let mut statement = self
            .connection
            .prepare(
                "SELECT
                    id,
                    name,
                    year,
                    type,
                    status,
                    phase,
                    filing_status,
                    planned_completion_date,
                    actual_completion_date,
                    lifecycle,
                    created_at,
                    created_by,
                    updated_at,
                    updated_by,
                    revision,
                    commit_sequence,
                    archived_at,
                    archived_by,
                    can_edit,
                    sync_state
                 FROM local_projects
                 WHERE (?1 IS NULL OR name LIKE ?1)
                   AND (?2 IS NULL OR year = ?2)
                   AND (?3 IS NULL OR status = ?3)
                   AND (?4 IS NULL OR lifecycle = ?4)
                 ORDER BY local_updated_at DESC, id ASC
                 LIMIT ?5 OFFSET ?6",
            )
            .map_err(LocalDbError::State)?;

        let rows = statement
            .query_map(
                params![
                    like_query.as_deref(),
                    filters.year,
                    filters.status.as_deref(),
                    filters.lifecycle.as_deref(),
                    page_size,
                    offset
                ],
                read_project_row,
            )
            .map_err(LocalDbError::State)?;

        let items = rows
            .map(|row| {
                row.map_err(LocalDbError::State)
                    .and_then(LocalProjectListItem::try_from)
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(LocalProjectPage {
            items,
            page,
            page_size,
            total,
        })
    }

    pub fn get_project(&self, project_id: &str) -> Result<LocalProjectDetails, LocalDbError> {
        let row = self
            .connection
            .query_row(
                "SELECT
                    id,
                    name,
                    year,
                    type,
                    status,
                    phase,
                    filing_status,
                    planned_completion_date,
                    actual_completion_date,
                    lifecycle,
                    created_at,
                    created_by,
                    updated_at,
                    updated_by,
                    revision,
                    commit_sequence,
                    archived_at,
                    archived_by,
                    can_edit,
                    sync_state
                 FROM local_projects
                 WHERE id = ?1",
                params![project_id],
                read_project_row,
            )
            .optional()
            .map_err(LocalDbError::State)?
            .ok_or(LocalDbError::ProjectNotFound)?;

        LocalProjectDetails::try_from(row)
    }
}

impl TryFrom<ProjectRow> for LocalProjectListItem {
    type Error = LocalDbError;

    fn try_from(row: ProjectRow) -> Result<Self, Self::Error> {
        validate_project_row(&row)?;
        Ok(Self {
            project: row.project,
            owner_labels: Vec::new(),
            sync_state: row.sync_state,
        })
    }
}

impl TryFrom<ProjectRow> for LocalProjectDetails {
    type Error = LocalDbError;

    fn try_from(row: ProjectRow) -> Result<Self, Self::Error> {
        validate_project_row(&row)?;
        Ok(Self {
            project: row.project,
            permissions: LocalProjectPermissions {
                can_edit: row.can_edit == 1,
                can_manage_members: false,
                can_change_lifecycle: false,
                can_read_audit: false,
            },
            sync_state: row.sync_state,
        })
    }
}

fn read_project_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        project: LocalProjectRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            year: row.get(2)?,
            r#type: row.get(3)?,
            status: row.get(4)?,
            phase: row.get(5)?,
            filing_status: row.get(6)?,
            planned_completion_date: row.get(7)?,
            actual_completion_date: row.get(8)?,
            lifecycle: row.get(9)?,
            created_at: row.get(10)?,
            created_by: row.get(11)?,
            updated_at: row.get(12)?,
            updated_by: row.get(13)?,
            revision: row.get(14)?,
            commit_sequence: row.get(15)?,
            archived_at: row.get(16)?,
            archived_by: row.get(17)?,
        },
        can_edit: row.get(18)?,
        sync_state: row.get(19)?,
    })
}

fn validate_project_row(row: &ProjectRow) -> Result<(), LocalDbError> {
    if !PROJECT_STATUSES.contains(&row.project.status.as_str()) {
        return Err(LocalDbError::CorruptProject);
    }
    if !PROJECT_LIFECYCLES.contains(&row.project.lifecycle.as_str()) {
        return Err(LocalDbError::CorruptProject);
    }
    if !SYNC_STATES.contains(&row.sync_state.as_str()) {
        return Err(LocalDbError::CorruptProject);
    }
    if row.can_edit != 0 && row.can_edit != 1 {
        return Err(LocalDbError::CorruptProject);
    }
    if row.project.revision < 1 || row.project.commit_sequence < 1 {
        return Err(LocalDbError::CorruptProject);
    }
    validate_optional_date(row.project.planned_completion_date.as_deref())?;
    validate_optional_date(row.project.actual_completion_date.as_deref())?;
    Ok(())
}

fn validate_optional_date(value: Option<&str>) -> Result<(), LocalDbError> {
    match value {
        Some(date)
            if date.len() == 10
                && date.as_bytes()[4] == b'-'
                && date.as_bytes()[7] == b'-'
                && date
                    .bytes()
                    .enumerate()
                    .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit()) =>
        {
            Ok(())
        }
        Some(_) => Err(LocalDbError::CorruptProject),
        None => Ok(()),
    }
}
